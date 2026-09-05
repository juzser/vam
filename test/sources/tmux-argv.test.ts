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

import { describe, expect, it } from 'vitest';
import {
  capturePaneArgv,
  hasSessionArgv,
  killSessionArgv,
  listSessionsArgv,
  newSessionArgv,
  sendBackspaceArgv,
  sendBackTabArgv,
  sendEnterArgv,
  sendEscapeArgv,
  sendTextArgv,
  tagSessionArgv,
  VAM_PROJECT_OPTION,
  VAM_SESSION_PREFIX,
  vamSessionName,
} from '../../src/main/sources/tmux/argv.js';

describe('tmux argv', () => {
  it('creates a detached, named session in a cwd running a command', () => {
    expect(newSessionArgv({ name: 'vam-a1b2c3', cwd: '/w/demo', command: ['claude'] })).toEqual([
      'new-session',
      '-d',
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
    expect(capturePaneArgv('vam-a1b2c3')).toEqual([
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

  it('asks the listing for the recorded project id beside each name', () => {
    // Without the option in the format there is nothing to pair on, and the
    // matcher is back to guessing from a truncated slug.
    expect(listSessionsArgv()).toEqual([
      'list-sessions',
      '-F',
      `#{${VAM_PROJECT_OPTION}}\t#{session_name}`,
    ]);
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
