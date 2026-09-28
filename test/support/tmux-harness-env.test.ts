import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNoNewSessionUnderOnDefaultServer,
  defaultServerPaneCwds,
  isolatedServerSessionCount,
  isolatedTmuxEnv,
  killIsolatedServer,
  mkIsolatedTmuxTmpdir,
  tmuxAvailable,
} from './tmux-harness-env.js';

describe('mkIsolatedTmuxTmpdir', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates a fresh, existing directory', () => {
    const dir = mkIsolatedTmuxTmpdir('vam-tmux-env-test');
    dirs.push(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it('gives two calls two different directories', () => {
    const a = mkIsolatedTmuxTmpdir('vam-tmux-env-test-a');
    const b = mkIsolatedTmuxTmpdir('vam-tmux-env-test-b');
    dirs.push(a, b);
    expect(a).not.toBe(b);
  });

  it('requires a non-empty prefix', () => {
    expect(() => mkIsolatedTmuxTmpdir('')).toThrow();
  });
});

describe('isolatedTmuxEnv', () => {
  it('sets TMUX_TMPDIR to the given directory', () => {
    const env = isolatedTmuxEnv({ PATH: '/bin' }, '/tmp/vam-example');
    expect(env.TMUX_TMPDIR).toBe('/tmp/vam-example');
  });

  it('preserves everything else the base env carried', () => {
    const env = isolatedTmuxEnv({ PATH: '/bin', HOME: '/home/x' }, '/tmp/vam-example');
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBe('/home/x');
  });

  it('strips an inherited TMUX, so a nested-tmux warning can never fire', () => {
    const env = isolatedTmuxEnv({ TMUX: '/tmp/tmux-501/default,123,0' }, '/tmp/vam-example');
    expect(env.TMUX).toBeUndefined();
  });

  it('the isolation wins over a TMUX_TMPDIR the base env already carried', () => {
    const env = isolatedTmuxEnv({ TMUX_TMPDIR: '/somewhere/else' }, '/tmp/vam-example');
    expect(env.TMUX_TMPDIR).toBe('/tmp/vam-example');
  });
});

describe('assertNoNewSessionUnderOnDefaultServer', () => {
  it('does not throw when nothing new appeared', () => {
    expect(() =>
      assertNoNewSessionUnderOnDefaultServer({
        before: ['/Users/op/notes'],
        after: ['/Users/op/notes'],
        watchDir: '/Users/op/work/vam-worktree',
      }),
    ).not.toThrow();
  });

  it("does not throw for a new session OUTSIDE the watched directory -- not this harness's business", () => {
    expect(() =>
      assertNoNewSessionUnderOnDefaultServer({
        before: [],
        after: ['/Users/op/some-other-project'],
        watchDir: '/Users/op/work/vam-worktree',
      }),
    ).not.toThrow();
  });

  it('throws when a new session appeared with a cwd under the watched directory', () => {
    expect(() =>
      assertNoNewSessionUnderOnDefaultServer({
        before: [],
        after: ['/Users/op/work/vam-worktree/sub'],
        watchDir: '/Users/op/work/vam-worktree',
      }),
    ).toThrow(/DEFAULT tmux server/);
  });

  it('throws when the new cwd IS the watched directory exactly', () => {
    expect(() =>
      assertNoNewSessionUnderOnDefaultServer({
        before: [],
        after: ['/Users/op/work/vam-worktree'],
        watchDir: '/Users/op/work/vam-worktree',
      }),
    ).toThrow();
  });

  it('does not match a sibling directory that merely shares the watched dir as a prefix', () => {
    expect(() =>
      assertNoNewSessionUnderOnDefaultServer({
        before: [],
        after: ['/Users/op/work/vam-worktree-other'],
        watchDir: '/Users/op/work/vam-worktree',
      }),
    ).not.toThrow();
  });
});

describe.skipIf(!tmuxAvailable())('the private server, over a real tmux', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      killIsolatedServer(dir);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports zero sessions on a private socket nothing ever connected to', () => {
    const dir = mkIsolatedTmuxTmpdir('vam-tmux-env-test-empty');
    dirs.push(dir);
    expect(isolatedServerSessionCount(dir)).toBe(0);
  });

  it('counts a real session created on the private socket, and none other', () => {
    const dir = mkIsolatedTmuxTmpdir('vam-tmux-env-test-real');
    dirs.push(dir);
    const env = isolatedTmuxEnv(process.env, dir);
    execFileSync(
      'tmux',
      ['-L', 'default', 'new-session', '-d', '-s', 'probe', '-x', '10', '-y', '4', 'cat'],
      {
        env,
      },
    );
    expect(isolatedServerSessionCount(dir)).toBe(1);
  });

  it('killIsolatedServer tears the private session down, never touching the default server', () => {
    const dir = mkIsolatedTmuxTmpdir('vam-tmux-env-test-kill');
    dirs.push(dir);
    const env = isolatedTmuxEnv(process.env, dir);
    execFileSync(
      'tmux',
      ['-L', 'default', 'new-session', '-d', '-s', 'probe', '-x', '10', '-y', '4', 'cat'],
      {
        env,
      },
    );
    const before = defaultServerPaneCwds();
    killIsolatedServer(dir);
    expect(isolatedServerSessionCount(dir)).toBe(0);
    expect(defaultServerPaneCwds()).toEqual(before);
  });

  it('defaultServerPaneCwds never sees a session created on the private socket', () => {
    const dir = mkIsolatedTmuxTmpdir('vam-tmux-env-test-isolation');
    dirs.push(dir);
    const before = defaultServerPaneCwds();
    const env = isolatedTmuxEnv(process.env, dir);
    execFileSync(
      'tmux',
      [
        '-L',
        'default',
        'new-session',
        '-d',
        '-s',
        'probe',
        '-c',
        dir,
        '-x',
        '10',
        '-y',
        '4',
        'cat',
      ],
      { env },
    );
    const after = defaultServerPaneCwds();
    expect(after).toEqual(before);
    expect(() =>
      assertNoNewSessionUnderOnDefaultServer({ before, after, watchDir: dir }),
    ).not.toThrow();
  });
});
