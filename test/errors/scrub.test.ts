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

  it('redacts an email whose TLD is two letters, which most country TLDs are', () => {
    // `{2,}` rather than `{3,}` is load-bearing: a committer address in a
    // `git` error is as likely to end `.io` or `.de` as `.com`.
    const out = scrub('author ada@lab.io is not a collaborator');
    expect(out).not.toContain('ada@lab.io');
    expect(out).not.toContain('lab.io');
  });

  it('redacts a pid written with = or :, not only with a space', () => {
    // Three separators occur in the same log line, and only one of them was
    // covered: `pid 12`, `pid=12`, `pid: 12`.
    const equals = scrub('spawn failed, pid=48213 is gone');
    expect(equals).not.toContain('48213');
    const colon = scrub('spawn failed, pid: 48213 is gone');
    expect(colon).not.toContain('48213');
  });

  it('redacts the home directory owner when only homeDir names them', () => {
    // The `homeDir` argument is the only source here -- no `/Users/...` in
    // the text -- so a rule that leans on the path shape leaks the name.
    const out = scrub('permission denied for ada', '/Users/ada');
    expect(out).not.toContain('ada');
    expect(out).toContain('permission denied');
  });

  it('redacts a username the text names outside a path, with no homeDir given', () => {
    // The mirror of the case above: the renderer usually has no `homeDir`,
    // so the name has to be learned from the path that IS in the text and
    // then removed from the prose around it.
    const out = scrub('ada could not write to /home/ada/work');
    expect(out).not.toContain('ada');
    expect(out).toContain('could not write');
  });

  it('matches a username with a dot literally, and does not let it become a wildcard', () => {
    // `first.last` is an ordinary account name. Unescaped, its `.` matches
    // any character, and the scrubber starts eating unrelated words that
    // differ only there -- a project called `ada-dev` in this case.
    const out = scrub('ada.dev cannot open project ada-dev', '/Users/ada.dev');
    expect(out).not.toContain('ada.dev');
    expect(out).toContain('ada-dev');
  });

  it('does not let an apostrophe in prose open a quoted run', () => {
    // The negative direction. A scrubber that redacts everything passes
    // every leak test and is useless: between the apostrophes of `don't`
    // and `didn't` lies the whole sentence.
    const out = scrub("cli-failed: it isn't running, so vam won't resume it");
    expect(out).toBe("cli-failed: it isn't running, so vam won't resume it");
  });

  it('redacts a long hex id when an underscore abuts it, because _ is not a word break', () => {
    // Shape taken from the session files vam reads (`~/.claude/sessions`),
    // where an id field is a short hex run, an underscore and a long one.
    // `\b` does not fire between `_` and a hex digit -- both are word
    // characters -- so the whole id survived a rule whose stated job is
    // session ids. The value below is invented, like every other here.
    const out = scrub('bridge f0a1b2c_0d1e2f3a4b5c6d7e8f90a1b2 refused the frame');
    expect(out).not.toContain('0d1e2f3a4b5c6d7e8f90a1b2');
    expect(out).toContain('refused the frame');
  });

  it('does not redact hex-looking prose, which has no 12-character run', () => {
    const out = scrub('cli-failed: the cafe faded, access decided, 3 sessions live');
    expect(out).toBe('cli-failed: the cafe faded, access decided, 3 sessions live');
  });

  it('scrubs a message built from the shapes a real session record has', () => {
    // cwd, a uuid session id, a pid and a vam-minted tmux name, which is
    // what `~/.claude/sessions/<pid>.json` actually carries -- with every
    // value invented, because a fixture holding a real one would be the
    // leak this function exists to prevent.
    const out = scrub(
      'cli-failed: session 3f8c1b62-9a41-4d2e-8b77-0c1d55ee9012 in /Users/ada/code/sonnet-lane ' +
        '(pane vam-sonnet-lane-a1b2c3, pid=48213) did not answer within 60s',
      '/Users/ada',
    );
    for (const secret of [
      '3f8c1b62-9a41-4d2e-8b77-0c1d55ee9012',
      '/Users/ada',
      'ada',
      'sonnet-lane',
      'vam-sonnet-lane-a1b2c3',
      '48213',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('cli-failed');
    expect(out).toContain('did not answer within 60s');
  });

  it('names its placeholder once, so a caller can assert on it', () => {
    expect(scrub('tmux session "vam-x" gone')).toContain(REDACTED);
  });
});
