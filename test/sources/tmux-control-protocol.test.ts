/**
 * The pure half of the control-mode fast path: which argv it will trust
 * itself to encode as a control-mode command LINE, how it encodes one, and
 * how it frames tmux's `%begin`/`%end`/`%error` replies back into the same
 * `TmuxRunResult` shape `spawn.ts`'s `execFile` path already produces.
 *
 * No process here. `control.ts`'s `ControlClient` is the stateful half that
 * actually spawns a `tmux -C` child; this file is what makes THAT half
 * trustworthy without needing a real tmux to prove it, exactly as
 * `tmux-argv.test.ts` pins the execFile path's argv without ever running one.
 */

import { describe, expect, it } from 'vitest';
import {
  capturePaneArgv,
  listSessionsArgv,
  resizeWindowArgv,
  sendBackspaceArgv,
  sendBackTabArgv,
  sendControlArgv,
  sendEnterArgv,
  sendEscapeArgv,
  sendNavArgv,
  sendNewlineArgv,
  sendTextArgv,
  sendWheelArgv,
} from '../../src/main/sources/tmux/argv.js';
import {
  CONTROL_SESSION_NAME,
  ControlFramer,
  encodeControlLine,
  reconstructResult,
  splitServerPrefix,
} from '../../src/main/sources/tmux/control-protocol.js';

describe('CONTROL_SESSION_NAME', () => {
  it('is outside the vam- prefix, so it never surfaces as a project pane', async () => {
    // `isVamSession` is what filters `list-sessions` down to vam's own rows
    // (`spawn.ts`); if the housekeeping session's name ever matched it, the
    // Terminal tab would draw a session vam never started for any project.
    const { isVamSession } = await import('../../src/main/sources/tmux/argv.js');
    expect(isVamSession(CONTROL_SESSION_NAME)).toBe(false);
  });
});

describe('splitServerPrefix', () => {
  it('names the default server when argv carries no -L/-S prefix', () => {
    expect(splitServerPrefix(['list-sessions', '-F', 'x'])).toEqual({
      key: 'default',
      prefix: [],
      rest: ['list-sessions', '-F', 'x'],
    });
  });

  it('keys a private socket by its exact name, and strips the prefix from the rest', () => {
    expect(splitServerPrefix(['-L', 'vam-e2e-latency', 'list-sessions'])).toEqual({
      key: 'L:vam-e2e-latency',
      prefix: ['-L', 'vam-e2e-latency'],
      rest: ['list-sessions'],
    });
  });

  it('keys an explicit socket PATH the same way, under -S', () => {
    expect(splitServerPrefix(['-S', '/tmp/x.sock', 'list-sessions'])).toEqual({
      key: 'S:/tmp/x.sock',
      prefix: ['-S', '/tmp/x.sock'],
      rest: ['list-sessions'],
    });
  });

  it('refuses any other leading flag rather than guess which server it names', () => {
    expect(splitServerPrefix(['-f', 'some.conf', 'list-sessions'])).toBeNull();
  });
});

describe('encodeControlLine', () => {
  it('encodes a plain send-keys of a named key untouched', () => {
    expect(encodeControlLine(sendEnterArgv('vam-a1b2c3'))).toEqual({
      line: 'send-keys -t =vam-a1b2c3: Enter',
      blocks: 1,
    });
    expect(encodeControlLine(sendBackspaceArgv('vam-a1b2c3'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: BSpace',
    );
    expect(encodeControlLine(sendBackTabArgv('vam-a1b2c3'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: BTab',
    );
    expect(encodeControlLine(sendEscapeArgv('vam-a1b2c3'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: Escape',
    );
    expect(encodeControlLine(sendControlArgv('vam-a1b2c3', 'u'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- C-u',
    );
  });

  it('encodes each of the eight navigation keys untouched, `--` and all', () => {
    // vam/terminal-arrows. `sendNavArgv`'s own shape -- `send-keys -t <target>
    // -- <Name>` -- rather than the six-token `-l --` shape above, so this
    // rides the plain bareword loop exactly as `sendControlArgv`'s output
    // does, and the fast path never has to fall back to a real spawn for a
    // key the operator presses on every arrow, Home, End, PageUp or PageDown.
    expect(encodeControlLine(sendNavArgv('vam-a1b2c3', 'up'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- Up',
    );
    expect(encodeControlLine(sendNavArgv('vam-a1b2c3', 'down'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- Down',
    );
    expect(encodeControlLine(sendNavArgv('vam-a1b2c3', 'left'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- Left',
    );
    expect(encodeControlLine(sendNavArgv('vam-a1b2c3', 'right'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- Right',
    );
    expect(encodeControlLine(sendNavArgv('vam-a1b2c3', 'home'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- Home',
    );
    expect(encodeControlLine(sendNavArgv('vam-a1b2c3', 'end'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- End',
    );
    expect(encodeControlLine(sendNavArgv('vam-a1b2c3', 'page-up'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- PageUp',
    );
    expect(encodeControlLine(sendNavArgv('vam-a1b2c3', 'page-down'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -- PageDown',
    );
  });

  it('rewrites literal TEXT as -H hex bytes instead of a quoted string', () => {
    // This is the one argument on the whole keystroke path that is the
    // OPERATOR'S OWN BYTES, so it is the one thing this file never hands to
    // tmux's own command tokenizer -- see the module comment on why that
    // tokenizer cannot be trusted with them.
    expect(encodeControlLine(sendTextArgv('vam-a1b2c3', 'a'))).toEqual({
      line: 'send-keys -t =vam-a1b2c3: -H 61',
      blocks: 1,
    });
  });

  it('hex-encodes MULTI-BYTE utf-8 text the same way', () => {
    expect(encodeControlLine(sendTextArgv('vam-a1b2c3', 'é'))?.line).toBe(
      'send-keys -t =vam-a1b2c3: -H c3 a9',
    );
  });

  it('routes Shift+Enter’s literal newline (#446, sendNewlineArgv) through the SAME -H rewrite', () => {
    // `sendNewlineArgv` is `sendTextArgv(name, '\n')` -- argv.ts's own
    // builder, not a shape this file invented -- so it already matches the
    // six-token `send-keys -t <target> -l -- <text>` special case above.
    // Asserted against the real builder, not a hand-typed argv, so a future
    // change to that builder's shape is what this test would actually catch.
    expect(encodeControlLine(sendNewlineArgv('vam-a1b2c3'))).toEqual({
      line: 'send-keys -t =vam-a1b2c3: -H 0a',
      blocks: 1,
    });
  });

  it('hex-encodes text carrying tmux/shell metacharacters -- the exact case a quoted string could not survive', () => {
    // MEASURED: tmux's own control-mode command parser expands `$HOME`
    // inside a double-quoted argument exactly as a shell would, so a naive
    // `"..."`-quoted `-l --` would have silently rewritten the operator's own
    // typed text. `-H` never asks that parser to look at the bytes at all.
    const text = 'a "quote" $HOME `x` ; y';
    const encoded = encodeControlLine(sendTextArgv('vam-a1b2c3', text));
    expect(encoded).not.toBeNull();
    expect(encoded?.line).not.toMatch(/HOME|quote|`/);
    const hex = Buffer.from(text, 'utf8').toString('hex').match(/../g)?.join(' ');
    expect(encoded?.line).toBe(`send-keys -t =vam-a1b2c3: -H ${hex}`);
  });

  it('encodes the wheel report -- an SGR escape sequence, not operator text, by the SAME -H rewrite', () => {
    const argv = sendWheelArgv('vam-a1b2c3', { direction: 'up', ticks: 2, column: 3, row: 4 });
    const encoded = encodeControlLine(argv);
    expect(encoded).not.toBeNull();
    expect(encoded?.line.startsWith('send-keys -t =vam-a1b2c3: -H ')).toBe(true);
  });

  it('encodes capture-pane with its cursor query as TWO blocks, quoting the fixed format string', () => {
    const encoded = encodeControlLine(capturePaneArgv('vam-a1b2c3', 500));
    expect(encoded).toEqual({
      line:
        'display-message -p -t =vam-a1b2c3: -F "@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag}" ; ' +
        'capture-pane -p -e -S -500 -t =vam-a1b2c3:',
      blocks: 2,
    });
  });

  it('encodes a screen-only capture (history 0) as one segment with no -S', () => {
    expect(encodeControlLine(capturePaneArgv('vam-a1b2c3', 0))?.line).toBe(
      'display-message -p -t =vam-a1b2c3: -F "@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag}" ; ' +
        'capture-pane -p -e -t =vam-a1b2c3:',
    );
  });

  it('encodes resize-window and list-sessions, the other two hot-path verbs', () => {
    expect(encodeControlLine(resizeWindowArgv('vam-a1b2c3', 137, 41))?.line).toBe(
      'resize-window -t =vam-a1b2c3: -x 137 -y 41',
    );
    expect(encodeControlLine(listSessionsArgv())?.line).toBe(
      'list-sessions -F "#{@vam-project}\t#{@vam-pid}\t#{session_name}\t#{pane_current_command}\t#{@vam-session}\t#{pane_current_path}"',
    );
  });

  it('refuses (returns null) an argv naming a session outside vam\u2019s own charset', () => {
    // Defence in depth: `targetSession` never hands this a name that did not
    // already pass `isVamSession`, but this function does not take that on
    // faith -- an unrecognised token means "fall back to a real spawn",
    // never "guess how to encode it".
    expect(encodeControlLine(['send-keys', '-t', '=not-vam:', 'Enter'])).toBeNull();
  });

  it('refuses a verb it does not know how to encode -- new-session, set-option, kill-session stay on the spawn path', () => {
    expect(encodeControlLine(['new-session', '-d', '-s', 'vam-x'])).toBeNull();
    expect(encodeControlLine(['set-option', '-t', 'vam-x', '@vam-project', 'p1'])).toBeNull();
    expect(encodeControlLine(['kill-session', '-t', '=vam-x'])).toBeNull();
  });

  it('refuses a malformed `;` split -- an empty segment either side', () => {
    expect(encodeControlLine(['list-sessions', ';'])).toBeNull();
    expect(encodeControlLine([';', 'list-sessions'])).toBeNull();
  });
});

describe('ControlFramer', () => {
  it('yields one block per %begin/%end pair, with its body lines joined', () => {
    const framer = new ControlFramer();
    const blocks = framer.feed('%begin 1 1 0\nline one\nline two\n%end 1 1 0\n');
    expect(blocks).toEqual([{ ok: true, body: 'line one\nline two\n' }]);
  });

  it('marks a %error block failed and keeps its body as the error text', () => {
    const framer = new ControlFramer();
    const blocks = framer.feed('%begin 1 1 0\ncan\u2019t find session: x\n%error 1 1 0\n');
    expect(blocks).toEqual([{ ok: false, body: 'can\u2019t find session: x\n' }]);
  });

  it('discards unsolicited notifications between blocks', () => {
    const framer = new ControlFramer();
    const blocks = framer.feed(
      '%output %0 hello\n%begin 1 1 0\nok\n%end 1 1 0\n%window-renamed @0 x\n',
    );
    expect(blocks).toEqual([{ ok: true, body: 'ok\n' }]);
  });

  it('yields two blocks for one compound line, in order', () => {
    // MEASURED against a real tmux 3.7b: a `display-message ; capture-pane`
    // line produces TWO %begin/%end pairs, in order -- this file does not
    // need their `cmd_num`s to relate to each other, only that they arrive
    // in the order the sub-commands were written.
    const framer = new ControlFramer();
    const blocks = framer.feed(
      '%begin 1 1 0\n@vam-cursor 1 8 0 0 0\n%end 1 1 0\n%begin 1 2 0\nsh-3.2$\n\n%end 1 2 0\n',
    );
    expect(blocks).toEqual([
      { ok: true, body: '@vam-cursor 1 8 0 0 0\n' },
      { ok: true, body: 'sh-3.2$\n\n' },
    ]);
  });

  it('holds a block across a chunk boundary that lands mid-line', () => {
    const framer = new ControlFramer();
    expect(framer.feed('%begin 1 1 0\nhalf')).toEqual([]);
    expect(framer.feed(' line\n%end 1 1 0\n')).toEqual([{ ok: true, body: 'half line\n' }]);
  });

  it('carries a partial trailing line across feeds without losing it', () => {
    const framer = new ControlFramer();
    expect(framer.feed('%beg')).toEqual([]);
    expect(framer.feed('in 1 1 0\nx\n%end 1 1 0\n')).toEqual([{ ok: true, body: 'x\n' }]);
  });
});

describe('reconstructResult', () => {
  it('joins every OK block into stdout, with no failure, when the last block succeeds', () => {
    expect(
      reconstructResult([
        { ok: true, body: '@vam-cursor 1 8 0 0 0\n' },
        { ok: true, body: 'sh-3.2$\n\n' },
      ]),
    ).toEqual({ failure: null, stdout: '@vam-cursor 1 8 0 0 0\nsh-3.2$\n\n', stderr: '' });
  });

  it('reports a plain exit-1 failure when the LAST block errors, matching execFile\u2019s own shape', () => {
    // `classifyTmuxFailure` reads `stderr` by pattern, not `failure` by
    // shape, so a synthetic `{code:1, killed:false, signal:null}` here is
    // read exactly as an ordinary non-zero `execFile` exit is -- the shape
    // `spawn.ts`'s own comment on `SpawnFailure` documents.
    const result = reconstructResult([{ ok: false, body: "can't find session: x\n" }]);
    expect(result.failure).toEqual({
      code: 1,
      killed: false,
      signal: null,
      message: expect.any(String),
    });
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe("can't find session: x\n");
  });

  it('succeeds when only an EARLIER block fails but the LAST one lands -- the compound cursor query', () => {
    // MEASURED against a real tmux (this task\u2019s own report): a bad target
    // on the `display-message` half and a good one on `capture-pane` exits
    // ZERO with an empty cursor line and the screen behind it intact --
    // `readCursorLine` already treats a stdout with no `@vam-cursor` marker
    // as "unreadable", not as a crash, so dropping the failed block from
    // stdout (rather than aborting the whole read) reproduces that exactly.
    const result = reconstructResult([
      { ok: false, body: "can't find pane: x\n" },
      { ok: true, body: 'sh-3.2$\n\n' },
    ]);
    expect(result.failure).toBeNull();
    expect(result.stdout).toBe('sh-3.2$\n\n');
    expect(result.stderr).toBe("can't find pane: x\n");
  });
});
