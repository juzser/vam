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
  decodeOutputPayload,
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
      mutating: true,
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
      mutating: true,
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
      mutating: true,
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
      mutating: false,
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
      'list-sessions -F "#{@vam-project}\t#{@vam-pid}\t#{session_name}\t#{pane_current_command}\t#{@vam-session}\t#{pane_current_path}\t#{session_created}"',
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

  it('marks a call MUTATING when any segment is send-keys or resize-window -- A2', () => {
    // control.ts's own A2 fix reads this to decide whether a command that
    // may already have reached tmux is safe to run again through a fallback
    // spawn: a READ asked twice answers the same question again, but a
    // send-keys or resize-window run twice REPEATS AN EFFECT -- a keystroke
    // delivered twice, a window resized twice. Every verb this file
    // recognises is one or the other, with no third case.
    expect(encodeControlLine(sendTextArgv('vam-a1b2c3', 'a'))?.mutating).toBe(true);
    expect(encodeControlLine(sendEnterArgv('vam-a1b2c3'))?.mutating).toBe(true);
    expect(encodeControlLine(resizeWindowArgv('vam-a1b2c3', 80, 24))?.mutating).toBe(true);
    expect(encodeControlLine(capturePaneArgv('vam-a1b2c3'))?.mutating).toBe(false);
    expect(encodeControlLine(listSessionsArgv())?.mutating).toBe(false);
  });
});

describe('ControlFramer', () => {
  it('yields one block per %begin/%end pair, with its body lines joined', () => {
    const framer = new ControlFramer();
    const blocks = framer.feed('%begin 1 1 1\nline one\nline two\n%end 1 1 1\n');
    expect(blocks).toEqual([{ ok: true, body: 'line one\nline two\n', reply: true }]);
  });

  it('marks a %error block failed and keeps its body as the error text', () => {
    const framer = new ControlFramer();
    const blocks = framer.feed('%begin 1 1 1\ncan\u2019t find session: x\n%error 1 1 1\n');
    expect(blocks).toEqual([{ ok: false, body: 'can\u2019t find session: x\n', reply: true }]);
  });

  it('discards unsolicited notifications between blocks', () => {
    const framer = new ControlFramer();
    const blocks = framer.feed(
      '%output %0 hello\n%begin 1 1 1\nok\n%end 1 1 1\n%window-renamed @0 x\n',
    );
    expect(blocks).toEqual([{ ok: true, body: 'ok\n', reply: true }]);
  });

  it('yields two blocks for one compound line, in order', () => {
    // MEASURED against a real tmux 3.7b: a `display-message ; capture-pane`
    // line produces TWO %begin/%end pairs, in order, BOTH carrying flags `1`
    // -- this file does not need their `cmd_num`s to relate to each other,
    // only that they arrive in the order the sub-commands were written.
    const framer = new ControlFramer();
    const blocks = framer.feed(
      '%begin 1 1 1\n@vam-cursor 1 8 0 0 0\n%end 1 1 1\n%begin 1 2 1\nsh-3.2$\n\n%end 1 2 1\n',
    );
    expect(blocks).toEqual([
      { ok: true, body: '@vam-cursor 1 8 0 0 0\n', reply: true },
      { ok: true, body: 'sh-3.2$\n\n', reply: true },
    ]);
  });

  it('holds a block across a chunk boundary that lands mid-line', () => {
    const framer = new ControlFramer();
    expect(framer.feed('%begin 1 1 1\nhalf')).toEqual([]);
    expect(framer.feed(' line\n%end 1 1 1\n')).toEqual([
      { ok: true, body: 'half line\n', reply: true },
    ]);
  });

  it('carries a partial trailing line across feeds without losing it', () => {
    const framer = new ControlFramer();
    expect(framer.feed('%beg')).toEqual([]);
    expect(framer.feed('in 1 1 1\nx\n%end 1 1 1\n')).toEqual([
      { ok: true, body: 'x\n', reply: true },
    ]);
  });

  it('marks a block NOT a reply when flags bit 0 is unset -- A1, tmux\u2019s own unsolicited startup block', () => {
    // MEASURED against a real tmux 3.7b (a private `-L` socket): the
    // `%begin`/`%end` block tmux emits unsolicited on EVERY `-C` connect --
    // new and reconnected alike -- carries flags `0`; every block answering
    // a command this file's own client actually wrote carries flags `1`.
    // `control.ts`'s `#onData` reads this field to drop that block instead
    // of letting it satisfy the first real command's reply.
    const framer = new ControlFramer();
    const blocks = framer.feed('%begin 1790226903 279 0\n%end 1790226903 279 0\n');
    expect(blocks).toEqual([{ ok: true, body: '', reply: false }]);
  });

  it('treats an odd flags value as a reply too -- only bit 0 is read, per the man page\u2019s own field width', () => {
    const framer = new ControlFramer();
    const blocks = framer.feed('%begin 1 1 3\nx\n%end 1 1 3\n');
    expect(blocks[0]?.reply).toBe(true);
  });

  it('closes a block only on an EXACT header match, never on a line merely SHAPED like a close -- A3', () => {
    // VERIFIED cross-review finding, reproduced against a real tmux: pane
    // TEXT is not escaped by this grammar the way a command's ARGUMENTS are,
    // so a program printing a line that itself starts `%end ` (trivially,
    // `echo '%end 9 9 9'`) must not be read as closing the block -- only the
    // line carrying the SAME `<time> <n> <flags>` the matching `%begin` had
    // may close it, and a `%begin`-shaped pane line must not be read as
    // starting a nested block either. Ported from the terminal-streaming
    // spike's own `StreamFramer`, proven there against the identical
    // grammar.
    const framer = new ControlFramer();
    const blocks = framer.feed(
      '%begin 1 1 1\nsome text\n%end 9 9 9\n%begin 9 9 9\nmore text\n%end 1 1 1\n',
    );
    expect(blocks).toEqual([
      {
        ok: true,
        body: 'some text\n%end 9 9 9\n%begin 9 9 9\nmore text\n',
        reply: true,
      },
    ]);
  });
});

describe('decodeOutputPayload', () => {
  it('passes raw text through untouched', () => {
    expect(decodeOutputPayload('hello world')).toBe('hello world');
  });

  it('unescapes a backslash-escaped-as-itself', () => {
    expect(decodeOutputPayload('a\\\\b')).toBe('a\\b');
  });

  it('unescapes a control byte as three octal digits', () => {
    // 015 is CR (0x0d), 012 is LF (0x0a) -- tmux's own escaping of the two
    // bytes a `%output` payload is most likely to carry.
    expect(decodeOutputPayload('a\\015\\012b')).toBe('a\r\nb');
  });

  it('keeps a malformed escape literal rather than eating bytes silently', () => {
    expect(decodeOutputPayload('a\\0')).toBe('a\\0');
  });

  it('passes multi-byte UTF-8 through literally -- it is never escaped by this grammar', () => {
    expect(decodeOutputPayload('xin ch\u00e0o')).toBe('xin ch\u00e0o');
  });
});

describe('ControlFramer.feedEvents (streaming reuse -- one framer, not two)', () => {
  it('still yields block events for a %begin/%end pair, now tagged kind: block', () => {
    const framer = new ControlFramer();
    const events = framer.feedEvents('%begin 1 1 1\nline one\n%end 1 1 1\n');
    expect(events).toEqual([{ kind: 'block', ok: true, body: 'line one\n', reply: true }]);
  });

  it('surfaces %output as a decoded output event instead of dropping it', () => {
    const framer = new ControlFramer();
    const events = framer.feedEvents('%output %3 hello\\015\\012\n');
    expect(events).toEqual([{ kind: 'output', paneId: '%3', data: 'hello\r\n' }]);
  });

  it('surfaces any other unsolicited notification as kind: other, instead of dropping it', () => {
    const framer = new ControlFramer();
    const events = framer.feedEvents('%window-renamed @0 x\n');
    expect(events).toEqual([{ kind: 'other', line: '%window-renamed @0 x' }]);
  });

  it('decodes a multi-byte UTF-8 character split across two feed() chunks', () => {
    // 'à' is 0xc3 0xa0 in UTF-8. Split the %output line so the chunk boundary
    // lands between the two bytes of the character -- StreamClient decodes
    // with node:string_decoder over the RAW BYTES the child process hands it,
    // but the octal-escape unwrap this framer does operates on already-
    // decoded JS string characters one at a time, so this pins that a
    // %output LINE split mid-line (the framer's own buffering) still decodes
    // correctly once the full line has arrived.
    const framer = new ControlFramer();
    expect(framer.feedEvents('%output %3 h\\303')).toEqual([]);
    expect(framer.feedEvents('\\240i\n')).toEqual([
      { kind: 'output', paneId: '%3', data: 'h\u00c3\u00a0i' },
    ]);
  });

  it('does not close a block on a %end-shaped line inside pane text, same A3 rule as feed()', () => {
    const framer = new ControlFramer();
    const events = framer.feedEvents(
      '%begin 1 1 1\nsome text\n%end 9 9 9\n%begin 9 9 9\nmore text\n%end 1 1 1\n',
    );
    expect(events).toEqual([
      {
        kind: 'block',
        ok: true,
        body: 'some text\n%end 9 9 9\n%begin 9 9 9\nmore text\n',
        reply: true,
      },
    ]);
  });

  it('feed() itself is unchanged: a block-shaped subset of feedEvents(), no kind field', () => {
    // The shipping caller (control.ts) still calls feed() and filters on
    // `.reply` -- this pins that feed()'s return shape never picked up the
    // `kind` discriminant feedEvents() needed, so control.ts needed no changes
    // to its own filter logic.
    const framer = new ControlFramer();
    const blocks = framer.feed(
      '%output %0 hello\n%begin 1 1 1\nok\n%end 1 1 1\n%window-renamed @0 x\n',
    );
    expect(blocks).toEqual([{ ok: true, body: 'ok\n', reply: true }]);
  });
});

describe('reconstructResult', () => {
  it('joins every OK block into stdout, with no failure, when the last block succeeds', () => {
    expect(
      reconstructResult([
        { ok: true, body: '@vam-cursor 1 8 0 0 0\n', reply: true },
        { ok: true, body: 'sh-3.2$\n\n', reply: true },
      ]),
    ).toEqual({ failure: null, stdout: '@vam-cursor 1 8 0 0 0\nsh-3.2$\n\n', stderr: '' });
  });

  it('reports a plain exit-1 failure when the LAST block errors, matching execFile\u2019s own shape', () => {
    // `classifyTmuxFailure` reads `stderr` by pattern, not `failure` by
    // shape, so a synthetic `{code:1, killed:false, signal:null}` here is
    // read exactly as an ordinary non-zero `execFile` exit is -- the shape
    // `spawn.ts`'s own comment on `SpawnFailure` documents.
    const result = reconstructResult([{ ok: false, body: "can't find session: x\n", reply: true }]);
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
      { ok: false, body: "can't find pane: x\n", reply: true },
      { ok: true, body: 'sh-3.2$\n\n', reply: true },
    ]);
    expect(result.failure).toBeNull();
    expect(result.stdout).toBe('sh-3.2$\n\n');
    expect(result.stderr).toBe("can't find pane: x\n");
  });
});
