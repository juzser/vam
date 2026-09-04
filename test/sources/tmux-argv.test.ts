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
  listSessionsArgv,
  newSessionArgv,
  sendKeysArgv,
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
    expect(capturePaneArgv('vam-a1b2c3')).toEqual(['capture-pane', '-p', '-t', '=vam-a1b2c3:']);
    expect(sendKeysArgv('vam-a1b2c3', 'hello')).toEqual([
      'send-keys',
      '-t',
      '=vam-a1b2c3:',
      'hello',
      'Enter',
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
