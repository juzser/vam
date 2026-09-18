/**
 * The exact argv for every tmux verb vam runs.
 *
 * These assertions are deliberately literal -- the whole array, not a
 * `toContain` -- because argv IS the security boundary here. `execFile` runs
 * no shell on OUR side, so a session name or a cwd the operator typed has no
 * meaning beyond being a name or a path; a test that only checked "the name is
 * in there somewhere" would still pass if a future edit built a shell string.
 *
 * For `new-session` there is a SECOND boundary, on tmux's side, and it is the
 * one that actually decides whether a shell runs: tmux treats a `shell-command`
 * given as ONE argument as an `sh(1)` command line, and only a `shell-command`
 * given as MULTIPLE arguments is executed directly. So the assertion that
 * matters here is that the command arrives split.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  capturePaneArgv,
  hasSessionArgv,
  killSessionArgv,
  listSessionsArgv,
  newSessionArgv,
  promptKeystrokes,
  sendBackspaceArgv,
  sendBackTabArgv,
  sendEnterArgv,
  sendEscapeArgv,
  sendTextArgv,
  tagPidArgv,
  tagSessionArgv,
  VAM_PID_OPTION,
  VAM_PROJECT_OPTION,
  VAM_SESSION_PREFIX,
  vamSessionName,
} from '../../src/main/sources/tmux/argv.js';

describe('tmux argv', () => {
  it('creates a detached, named session in a cwd running a command, printing the pane’s pid', () => {
    // `-P -F '#{pane_pid}'` costs no second round trip: tmux already knows the
    // pid of the child it just forked before that child has done anything at
    // all, so the SAME call that starts the session also answers the question
    // `createVamSession` needs for `VAM_PID_OPTION` (`spawn.ts`).
    expect(newSessionArgv({ name: 'vam-a1b2c3', cwd: '/w/demo', command: ['claude'] })).toEqual([
      'new-session',
      '-d',
      '-P',
      '-F',
      '#{pane_pid}',
      '-s',
      'vam-a1b2c3',
      '-c',
      '/w/demo',
      'claude',
    ]);
  });

  it('spreads the command into MULTIPLE argv elements, so tmux execs it without sh -c', () => {
    const argv = newSessionArgv({
      name: 'vam-a1b2c3',
      cwd: '/w/a b; rm -rf /',
      command: ['claude', '--resume', 'x y'],
    });
    expect(argv).toEqual([
      'new-session',
      '-d',
      '-P',
      '-F',
      '#{pane_pid}',
      '-s',
      'vam-a1b2c3',
      '-c',
      '/w/a b; rm -rf /',
      'claude',
      '--resume',
      'x y',
    ]);
  });

  it('does not let a metacharacter in one word become a second tmux command', () => {
    const argv = newSessionArgv({
      name: 'vam-a1b2c3',
      cwd: '/w/demo',
      command: ['claude; touch /w/pwned'],
    });
    // The whole injection stays ONE element, so tmux execs a program with that
    // literal name and fails -- it never reaches an `sh -c`, which is what a
    // single-argument shell-command would have done.
    expect(argv.slice(-1)).toEqual(['claude; touch /w/pwned']);
    expect(argv.filter((a) => a.includes('touch'))).toHaveLength(1);
  });

  it('rejects an empty command rather than starting a login shell', () => {
    expect(() => newSessionArgv({ name: 'vam-a1b2c3', cwd: '/w/demo', command: [] })).toThrow(
      /empty/i,
    );
  });

  it('rejects a command whose first word tmux would read as an option', () => {
    // There is no `--` here on purpose: tmux's own end-of-options handling for
    // `shell-command` is not something this repository can exercise (running it
    // would create a real session), so the argv refuses the shape instead of
    // relying on a terminator it cannot verify.
    expect(() =>
      newSessionArgv({ name: 'vam-a1b2c3', cwd: '/w/demo', command: ['-c', 'claude'] }),
    ).toThrow(/option/i);
  });

  it('targets exactly, never by prefix, for every verb that names a session', () => {
    expect(hasSessionArgv('vam-a1b2c3')).toEqual(['has-session', '-t', '=vam-a1b2c3']);
  });

  it('names a PANE, not a bare session, wherever tmux wants a target-pane', () => {
    // Measured against a real tmux (on a private `-L` socket, never the
    // operator's server): `capture-pane -t '=vam-a1b2c3'` answers
    // `can't find pane: =vam-a1b2c3` and exits 1, and `send-keys` does the
    // same. `=name` is how a TARGET-SESSION is written exactly; a target-pane
    // is `session:window.pane`, so the session part needs its `:` before tmux
    // will read it as a session at all. Dropping the `=` would work and is not
    // the fix: tmux would then resolve the name by prefix and then by fnmatch,
    // and `send-keys` reaching a session other than the one vam meant is the
    // thing the exactness is there to prevent.
    // The read is TWO commands in one invocation now (the cursor query and
    // the capture), and the target-pane rule applies to both of them: a
    // `display-message` with no `-t` answers about whatever pane tmux calls
    // current, which is somebody else's session as easily as this one.
    expect(capturePaneArgv('vam-a1b2c3')).toEqual([
      'display-message',
      '-p',
      '-t',
      '=vam-a1b2c3:',
      '-F',
      '@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y}',
      ';',
      'capture-pane',
      '-p',
      '-e',
      '-t',
      '=vam-a1b2c3:',
    ]);
    expect(sendTextArgv('vam-a1b2c3', 'hello')).toEqual([
      'send-keys',
      '-t',
      '=vam-a1b2c3:',
      '-l',
      '--',
      'hello',
    ]);
    expect(sendEnterArgv('vam-a1b2c3')).toEqual(['send-keys', '-t', '=vam-a1b2c3:', 'Enter']);
    // Escape, INTERPRETED. The same measurement that justifies `-l` for text
    // is what justifies its absence here: `send-keys 'Escape'` delivers `^[`
    // to the pane, `send-keys -l -- 'Escape'` types the six letters.
    expect(sendEscapeArgv('vam-a1b2c3')).toEqual(['send-keys', '-t', '=vam-a1b2c3:', 'Escape']);
    expect(sendEscapeArgv('vam-a1b2c3')).not.toContain('-l');
    // The third INTERPRETED key, and the reason it cannot be the literal one:
    // measured on tmux 3.7b over a private `-L` socket, `send-keys 'BSpace'`
    // deleted the character before the cursor, while `send-keys -l -- 'BSpace'`
    // typed the six letters into the line. Backspace is a key, not text.
    expect(sendBackspaceArgv('vam-a1b2c3')).toEqual(['send-keys', '-t', '=vam-a1b2c3:', 'BSpace']);
    expect(sendBackspaceArgv('vam-a1b2c3')).not.toContain('-l');
    // The FOURTH interpreted key, and the one whose wrong spelling is silent.
    // Measured on tmux 3.7b over a private `-L` socket, against `cat -v` in
    // the pane: `send-keys BTab` put `^[[Z` on the screen -- the escape
    // sequence a terminal sends for Shift-Tab -- while `send-keys S-Tab`
    // EXITED 0 and delivered a plain tab, and `send-keys -l -- 'BTab'` typed
    // the four letters. So the only wrong spelling that reports a failure is
    // the literal one; `S-Tab` looks like it worked and moves the cursor in
    // somebody's running agent instead of cycling its mode.
    expect(sendBackTabArgv('vam-a1b2c3')).toEqual(['send-keys', '-t', '=vam-a1b2c3:', 'BTab']);
    expect(sendBackTabArgv('vam-a1b2c3')).not.toContain('-l');
    expect(sendBackTabArgv('vam-a1b2c3')).not.toContain('S-Tab');
    expect(sendBackTabArgv('vam-a1b2c3')).not.toContain('Tab');
  });

  it('types text tmux would otherwise read as a key or as an option', () => {
    // Measured on tmux 3.7b over a private `-L` socket: without `-l` the pane
    // received `^[` for this text, and with it the six characters. A reply of
    // `Escape` or `C-c` is the operator answering, never a key to press.
    expect(sendTextArgv('vam-a1b2c3', 'Escape')).toContain('-l');
    expect(sendTextArgv('vam-a1b2c3', '-N 5')).toEqual([
      'send-keys',
      '-t',
      '=vam-a1b2c3:',
      '-l',
      '--',
      '-N 5',
    ]);
  });

  it('asks the listing for the recorded project id and pid beside each name', () => {
    // Without the options in the format there is nothing to pair on, and the
    // matcher is back to guessing from a truncated slug (project) or counting
    // live rows (pid).
    expect(listSessionsArgv()).toEqual([
      'list-sessions',
      '-F',
      `#{${VAM_PROJECT_OPTION}}\t#{${VAM_PID_OPTION}}\t#{session_name}`,
    ]);
  });

  /**
   * THE FAMILY, COUNTED. Measured on tmux 3.7b: a client whose LC_CTYPE is not
   * UTF-8 -- a GUI launch has none -- prints every control character of a
   * `-F` expansion as `_`. The listing's tabs were the one member that was
   * hit, and it cost every session vam started (`listVamSessions`). This pins
   * the count at one: a new `-F` format that leans on a tab or a newline must
   * either join the list here, with its parser refusing a rewritten line the
   * way the listing's does, or use a printable separator.
   */
  it('puts a control character in exactly one -F format, and that one is the listing', () => {
    const formats = new Map<string, string>();
    for (const [name, argv] of [
      ['newSessionArgv', newSessionArgv({ name: 'vam-a1b2c3', cwd: '/w', command: ['claude'] })],
      ['capturePaneArgv', capturePaneArgv('vam-a1b2c3')],
      ['listSessionsArgv', listSessionsArgv()],
    ] as const) {
      const at = argv.indexOf('-F');
      expect(at, `${name} carries a -F`).toBeGreaterThan(-1);
      formats.set(name, argv[at + 1] ?? '');
    }
    const isControl = (code: number): boolean => code < 0x20 || code === 0x7f;
    const controlled = [...formats].filter(([, format]) =>
      [...format].some((char) => isControl(char.charCodeAt(0))),
    );
    expect(controlled.map(([name]) => name)).toEqual(['listSessionsArgv']);
    // And the corpus is the whole of argv.ts: a fourth `-F` written there
    // without joining the list above fails here, rather than going unchecked.
    const source = readFileSync(
      new URL('../../src/main/sources/tmux/argv.ts', import.meta.url),
      'utf8',
    );
    expect(source.match(/'-F'/g)?.length).toBe(formats.size);
  });

  it('records the project on the session with a BARE target, not an =target', () => {
    // Measured against a real tmux (3.7b, private `-L` socket): every other
    // verb here takes `=name`, and `set-option -t '=name'` answers
    // `no such session: =name` and exits 1. An `=` added for consistency would
    // leave every session vam starts unpaired and every Terminal tab empty.
    expect(tagSessionArgv('vam-a1b2c3', 'claude-code:demo-11111111')).toEqual([
      'set-option',
      '-t',
      'vam-a1b2c3',
      '@vam-project',
      'claude-code:demo-11111111',
    ]);
  });

  it('records the pid on the session the same bare way, right beside the project', () => {
    // Same target shape as `tagSessionArgv`, and the same reason: this call
    // only ever follows immediately after the session vam just created it, so
    // there is nothing else for a bare `-t` to resolve onto by prefix or
    // fnmatch.
    expect(tagPidArgv('vam-a1b2c3', '14709')).toEqual([
      'set-option',
      '-t',
      'vam-a1b2c3',
      '@vam-pid',
      '14709',
    ]);
  });

  it('names a new session under vam’s own prefix', () => {
    const name = vamSessionName('demo project');
    expect(name.startsWith(VAM_SESSION_PREFIX)).toBe(true);
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('killSessionArgv', () => {
  /**
   * `kill-session` takes a target-SESSION, so the exact-match `=` is right and
   * the trailing `:` of a target-PANE is wrong -- see the note on `paneTarget`
   * in `argv.ts`. A prefix-resolvable bare name here would kill a session vam
   * never started.
   */
  it('is exactly `kill-session -t =<name>`, with no pane colon', () => {
    expect(killSessionArgv('vam-a1b2c3')).toEqual(['kill-session', '-t', '=vam-a1b2c3']);
  });

  it('never builds a bare target tmux could resolve by prefix', () => {
    expect(killSessionArgv('vam-a1')).not.toContain('vam-a1');
  });
});

/**
 * THE VOCABULARY BOUNDARY, frozen by value.
 *
 * A grouping layer above today's project makes "project" mean the OUTER thing
 * in the UI and the INNER thing in the code, and that inversion is exactly
 * what makes renaming the inner one look like a tidy-up. It is not. The tmux
 * option below is a contract with sessions that are RUNNING RIGHT NOW on the
 * operator's own tmux server, and nothing re-tags a live session.
 *
 * WHAT A REPOINT ACTUALLY COSTS, because "it just would not match" understates
 * it by a lot. An option nobody set formats as the EMPTY STRING rather than an
 * error, so a renamed key reads back as a session vam tagged with nothing --
 * and `paneForRow` treats a published-pane/tag disagreement as evidence of a
 * CORRUPT PAIRING and returns `null` without falling through. The operator's
 * live session then reports `vamControlled: false`, its Terminal tab reads
 * `mispaired`, and Close and Enter both refuse on a session vam did start.
 * Renaming the key and repointing its value are the same bug.
 *
 * So the assertion is on the literal, not on the exported name: a rename that
 * carries every reference along with it still goes red here, which is the
 * whole point.
 */
describe('the @vam-project boundary', () => {
  it('is the literal `@vam-project`, and may not be renamed with the new group layer', () => {
    expect(VAM_PROJECT_OPTION).toBe('@vam-project');
  });

  it('tags a session with exactly that option and nothing else', () => {
    expect(tagSessionArgv('vam-a1b2c3', 'claude-code:demo-11111111')).toEqual([
      'set-option',
      '-t',
      'vam-a1b2c3',
      '@vam-project',
      'claude-code:demo-11111111',
    ]);
  });
});

/**
 * THE SECOND BOUNDARY, frozen the same way and for the same reason: this is a
 * contract with sessions running right now, not an internal name free to be
 * tidied. `paneForRow` (`reply.ts`) compares a row's OWN pid against exactly
 * this option, read back from `list-sessions -F`; renaming or repointing it
 * silently un-answers every row it used to resolve, the same way repointing
 * `@vam-project` would.
 */
describe('the @vam-pid boundary', () => {
  it('is the literal `@vam-pid`', () => {
    expect(VAM_PID_OPTION).toBe('@vam-pid');
  });

  it('tags a session with exactly that option and nothing else', () => {
    expect(tagPidArgv('vam-a1b2c3', '14709')).toEqual([
      'set-option',
      '-t',
      'vam-a1b2c3',
      '@vam-pid',
      '14709',
    ]);
  });
});

/**
 * Typing a WHOLE prompt into a pane, newlines and all.
 *
 * These are PROPERTY assertions, not a copy of the array the function returns:
 * an argv test that asserts equality with the builder's own output cannot
 * fail for a real reason. What is pinned instead is behaviour a wrong edit
 * would break -- that a newline inside the prompt does NOT reach the pane as a
 * bare submit, that the operator's text is always ONE argv element, that `-l`
 * and `--` guard every literal chunk -- plus a round-trip that reconstructs
 * the exact prompt from the keystrokes, which is what proves nothing was lost
 * or interpreted.
 *
 * MEASURED, on tmux 3.7b over a private `-L` socket into a pty in RAW MODE
 * (the mode Claude Code's input runs in, unlike a cooked-mode shell):
 *   `send-keys Enter`          delivered 0x0d (CR)   -- the REPL reads submit
 *   `send-keys -l -- $'a<LF>b'` delivered 0x61 0x0a 0x62 -- a raw newline is 0x0a
 *   a literal backslash        delivered 0x5c        -- a plain byte under `-l --`
 * and the CLI's own footer (version 2.1.274) advertises `\` + Return as the
 * interactive prompt's universal newline (the one needing no `/terminal-setup`).
 * So an internal line break is a literal backslash then an interpreted Enter:
 * the REPL turns a trailing `\` + submit into an inserted newline, and the bare
 * newline a single `send-keys -l` of the whole prompt would deliver would
 * submit the first line and drop the rest.
 */
const PANE = '=vam-a1b2c3:';

/** Replay the keystrokes the way the REPL would, to recover the typed buffer. */
function reconstruct(steps: readonly (readonly string[])[]): string {
  let buffer = '';
  for (const step of steps) {
    if (step.includes('-l')) {
      // A literal chunk: the operator's text is the LAST element, whole.
      buffer += step[step.length - 1] ?? '';
    } else {
      // An interpreted Enter. It is a NEWLINE only because the buffer ends in
      // the escape backslash; the REPL consumes that `\` and inserts `\n`.
      if (!buffer.endsWith('\\')) {
        throw new Error('an Enter inside the prompt was not preceded by the newline escape');
      }
      buffer = `${buffer.slice(0, -1)}\n`;
    }
  }
  return buffer;
}

const isLiteral = (step: readonly string[]): boolean => step.includes('-l');
const isEnter = (step: readonly string[]): boolean =>
  !step.includes('-l') && step[step.length - 1] === 'Enter';

describe('promptKeystrokes', () => {
  it('types a single-line prompt as one literal chunk and adds no submit of its own', () => {
    const steps = promptKeystrokes('vam-a1b2c3', 'ship it');
    expect(steps).toHaveLength(1);
    const [only] = steps;
    // The whole prompt is ONE element, guarded by `-l --`, exactly as
    // `sendTextArgv` builds it.
    expect(only).toEqual(['send-keys', '-t', PANE, '-l', '--', 'ship it']);
    // The submit is the caller's to add, never buried in here: nothing that
    // reaches the pane from this function may press Return.
    expect(steps.some(isEnter)).toBe(false);
  });

  it('breaks each internal newline with a backslash escape, never a bare submit', () => {
    const prompt = 'first line\nsecond line\nthird';
    const steps = promptKeystrokes('vam-a1b2c3', prompt);

    // One interpreted Enter per newline -- and each is the escape, so each must
    // sit immediately after a chunk whose text ends in a backslash.
    const enters = steps.filter(isEnter);
    expect(enters).toHaveLength(2);
    steps.forEach((step, index) => {
      if (!isEnter(step)) return;
      const before = steps[index - 1];
      expect(before && isLiteral(before)).toBe(true);
      expect(before?.[before.length - 1]?.endsWith('\\')).toBe(true);
    });

    // No literal chunk carries a raw newline: that is the byte that would
    // submit, and it must have been decomposed into escape + Enter.
    for (const step of steps.filter(isLiteral)) {
      expect(step[step.length - 1]).not.toContain('\n');
    }

    // And the keystrokes reconstruct the operator's exact text.
    expect(reconstruct(steps)).toBe(prompt);
  });

  it('keeps every chunk one `-l -- <text>` element, so text is never read as a flag or a key', () => {
    // A prompt full of the things tmux, a shell, or the REPL might act on: a
    // line that starts with `-`, a `;`, a `#`, backticks and a `$`.
    const prompt = '-rf everything\nfoo; rm -rf /\n#!/bin/sh\n`id` and $HOME\nDone';
    const steps = promptKeystrokes('vam-a1b2c3', prompt);

    for (const step of steps.filter(isLiteral)) {
      // `-l` then `--` then exactly one payload element, and in that order:
      // `-l` makes tmux type the text instead of pressing it, `--` stops a
      // leading `-` being read as an option, and one element means the text
      // is never split across argv.
      expect(step.slice(0, 5)).toEqual(['send-keys', '-t', PANE, '-l', '--']);
      expect(step).toHaveLength(6);
      const dashDash = step.indexOf('--');
      const lit = step.indexOf('-l');
      expect(lit).toBeGreaterThanOrEqual(0);
      expect(lit).toBeLessThan(dashDash);
    }

    // The metacharacters survive byte-for-byte -- no shell ran, nothing was
    // interpreted -- which the round-trip proves for the whole prompt at once.
    expect(reconstruct(steps)).toBe(prompt);
  });

  it('addresses the pane exactly, with the `=`…`:` target every send-keys uses', () => {
    for (const step of promptKeystrokes('vam-a1b2c3', 'a\nb')) {
      expect(step).toContain(PANE);
    }
  });
});
