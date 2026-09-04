/**
 * The exact argv for every tmux verb vam runs.
 *
 * These assertions are deliberately literal -- the whole array, not a
 * `toContain` -- because argv IS the security boundary here. `execFile` runs
 * no shell, so a session name or a cwd the operator typed has no meaning
 * beyond being a name or a path; a test that only checked "the name is in
 * there somewhere" would still pass if a future edit built a shell string.
 */

import { describe, expect, it } from 'vitest';
import {
  capturePaneArgv,
  hasSessionArgv,
  killSessionArgv,
  listSessionsArgv,
  newSessionArgv,
  sendKeysArgv,
  VAM_SESSION_PREFIX,
  vamSessionName,
} from '../../src/main/sources/tmux/argv.js';

describe('tmux argv', () => {
  it('creates a detached, named session in a cwd running a command', () => {
    expect(newSessionArgv({ name: 'vam-a1b2c3', cwd: '/w/demo', command: 'claude' })).toEqual([
      'new-session',
      '-d',
      '-s',
      'vam-a1b2c3',
      '-c',
      '/w/demo',
      'claude',
    ]);
  });

  it('keeps a command with spaces and metacharacters as ONE argv element', () => {
    const argv = newSessionArgv({
      name: 'vam-a1b2c3',
      cwd: '/w/a b; rm -rf /',
      command: 'claude --resume "x y"',
    });
    expect(argv).toEqual([
      'new-session',
      '-d',
      '-s',
      'vam-a1b2c3',
      '-c',
      '/w/a b; rm -rf /',
      'claude --resume "x y"',
    ]);
  });

  it('targets exactly, never by prefix, for every verb that names a session', () => {
    expect(hasSessionArgv('vam-a1b2c3')).toEqual(['has-session', '-t', '=vam-a1b2c3']);
    expect(killSessionArgv('vam-a1b2c3')).toEqual(['kill-session', '-t', '=vam-a1b2c3']);
    expect(capturePaneArgv('vam-a1b2c3')).toEqual(['capture-pane', '-p', '-t', '=vam-a1b2c3']);
    expect(sendKeysArgv('vam-a1b2c3', 'hello')).toEqual([
      'send-keys',
      '-t',
      '=vam-a1b2c3',
      'hello',
      'Enter',
    ]);
  });

  it('lists sessions one name per line', () => {
    expect(listSessionsArgv()).toEqual(['list-sessions', '-F', '#{session_name}']);
  });

  it('names a new session under vam’s own prefix', () => {
    const name = vamSessionName('demo project');
    expect(name.startsWith(VAM_SESSION_PREFIX)).toBe(true);
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
