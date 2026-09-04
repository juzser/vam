/**
 * The scrubber, asserted as ABSENCES.
 *
 * vam is a public repository and an issue body is the one thing here that
 * leaves the machine. Every case below therefore checks that a secret is
 * GONE rather than that a placeholder is present: a rule that stops firing
 * still produces a plausible-looking string, and only `not.toContain` on the
 * original catches that.
 *
 * Every fixture is invented -- `/Users/ada`, `sonnet-lane`, `feature/moon` --
 * because a fixture carrying a real home path would be the exact leak the
 * function exists to prevent, committed to the public repo by the test that
 * proves it cannot happen.
 */

import { describe, expect, it } from 'vitest';
import { REDACTED, scrub } from '../../src/renderer/errors/scrub.js';

describe('scrub', () => {
  it('replaces a home path with ~ and keeps nothing after it', () => {
    const out = scrub('cwd-missing: /Users/ada/code/sonnet-lane no longer exists', '/Users/ada');
    expect(out).not.toContain('/Users/ada');
    expect(out).not.toContain('ada');
    expect(out).not.toContain('sonnet-lane');
    expect(out).toContain('cwd-missing');
    expect(out).toContain('~/');
  });

  it('replaces a home path it was never told about', () => {
    // The renderer cannot always name the home directory -- the browser build
    // has no `os.homedir` at all -- so the shape has to be enough on its own.
    const out = scrub('spawn failed in /home/grace/work/atlas');
    expect(out).not.toContain('grace');
    expect(out).not.toContain('atlas');
  });

  it('removes a username even outside a path', () => {
    const out = scrub('permission denied for ada on /Users/ada/notes', '/Users/ada');
    expect(out).not.toContain('ada');
  });

  it('redacts quoted names: session titles, tmux sessions, branches', () => {
    const out = scrub('session-exists: tmux session "vam-sonnet-lane" already exists');
    expect(out).not.toContain('vam-sonnet-lane');
    expect(out).toContain('session-exists');
    const branch = scrub("checkout refused: branch 'feature/moon' has changes");
    expect(branch).not.toContain('feature/moon');
    const backtick = scrub('run `claude attach sess-77` to resume');
    expect(backtick).not.toContain('sess-77');
  });

  it('redacts session ids: uuids and long hex runs', () => {
    const uuid = scrub('no-such-session: 3f8c1b62-9a41-4d2e-8b77-0c1d55ee9012 is gone');
    expect(uuid).not.toContain('3f8c1b62');
    expect(uuid).not.toContain('0c1d55ee9012');
    const hex = scrub('session a1b2c3d4e5f60718 not found');
    expect(hex).not.toContain('a1b2c3d4e5f60718');
  });

  it('redacts pids', () => {
    const out = scrub('killed: pid 48213 exited with SIGKILL');
    expect(out).not.toContain('48213');
    expect(out).toContain('killed');
  });

  it('redacts email addresses', () => {
    const out = scrub('author ada@example.invalid is not a collaborator');
    expect(out).not.toContain('ada@example.invalid');
    expect(out).not.toContain('example.invalid');
  });

  it('keeps the code and the prose, which is the whole point of scrubbing rather than dropping', () => {
    const out = scrub('cli-failed: pairing refused, 3 live sessions share this cwd, 1 vam pane');
    expect(out).toBe('cli-failed: pairing refused, 3 live sessions share this cwd, 1 vam pane');
  });

  it('is pure: same input, same output, and the input is not mutated', () => {
    const input = 'no-server: /Users/ada/x';
    expect(scrub(input, '/Users/ada')).toBe(scrub(input, '/Users/ada'));
    expect(input).toBe('no-server: /Users/ada/x');
  });

  it('names its placeholder once, so a caller can assert on it', () => {
    expect(scrub('tmux session "vam-x" gone')).toContain(REDACTED);
  });
});
