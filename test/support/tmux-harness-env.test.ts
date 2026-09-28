import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertNoNewSessionUnderOnDefaultServer,
  defaultServerPaneCwds,
  isolatedServerSessionCount,
  isolatedTmuxEnv,
  killIsolatedServer,
  mkIsolatedTmuxTmpdir,
  resolveIsolatedSocket,
  tmuxAvailable,
} from './tmux-harness-env.js';

const UID = process.getuid?.() ?? 0;

/**
 * A REAL unix-domain socket file at the exact path `resolveIsolatedSocket`
 * computes (`<tmuxTmpdir>/tmux-<uid>/default`) -- built with `node:net`
 * rather than real tmux, so these tests never depend on a tmux binary being
 * installed and never risk touching any real tmux server, isolated or not.
 */
function makeFakeSocket(tmuxTmpdir: string): { socketPath: string; close: () => void } {
  const dir = path.join(tmuxTmpdir, `tmux-${UID}`);
  mkdirSync(dir, { recursive: true });
  const socketPath = path.join(dir, 'default');
  const server = createServer();
  server.listen(socketPath);
  return { socketPath, close: () => server.close() };
}

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

describe('resolveIsolatedSocket', () => {
  const dirs: string[] = [];
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the tmpdir does not exist at all -- no exec should ever be attempted', () => {
    const dir = path.join(os.tmpdir(), `vam-resolve-socket-missing-${process.pid}`);
    expect(existsSync(dir)).toBe(false);
    expect(resolveIsolatedSocket(dir)).toBeNull();
  });

  it('returns null when the tmpdir exists but no socket was ever created under it', () => {
    const dir = mkdtempSync(path.join('/tmp', 'vam-resolve-socket-empty-'));
    dirs.push(dir);
    expect(resolveIsolatedSocket(dir)).toBeNull();
  });

  it('returns the absolute socket path when a real socket exists there', () => {
    const dir = mkdtempSync(path.join('/tmp', 'vam-resolve-socket-real-'));
    dirs.push(dir);
    const { socketPath, close } = makeFakeSocket(dir);
    closers.push(close);
    expect(resolveIsolatedSocket(dir)).toBe(socketPath);
  });

  it('throws rather than resolve a path under /tmp that is not a socket, once it equals the default server path', () => {
    // `/tmp` itself as the "tmpdir" makes the computed path exactly
    // `/tmp/tmux-<uid>/default` -- the operator's own real default socket.
    expect(() => resolveIsolatedSocket('/tmp')).toThrow(/default/);
  });

  it('throws for the $TMPDIR-rooted default path too, not only the /tmp one', () => {
    expect(() => resolveIsolatedSocket(os.tmpdir())).toThrow(/default/);
  });

  it('throws for a tmpdir outside any tmp root entirely', () => {
    expect(() => resolveIsolatedSocket('/Users/someone/not-a-tmp-dir')).toThrow(/tmp/);
  });
});

describe('killIsolatedServer, with an injected exec (no real tmux needed)', () => {
  const dirs: string[] = [];
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('a missing dir means no exec at all', () => {
    const dir = path.join(os.tmpdir(), `vam-kill-missing-${process.pid}`);
    const exec = vi.fn();
    killIsolatedServer(dir, exec);
    expect(exec).not.toHaveBeenCalled();
  });

  it('an existing socket means exec runs with -S <absolute path>, never -L', () => {
    const dir = mkdtempSync(path.join('/tmp', 'vam-kill-real-'));
    dirs.push(dir);
    const { socketPath, close } = makeFakeSocket(dir);
    closers.push(close);
    const exec = vi.fn().mockReturnValue('');
    killIsolatedServer(dir, exec);
    expect(exec).toHaveBeenCalledTimes(1);
    const [file, args, options] = exec.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(file).toBe('tmux');
    expect(args).toEqual(['-S', socketPath, 'kill-server']);
    expect(args).not.toContain('-L');
    expect(options.env.TMUX).toBeUndefined();
    expect(options.env.TMUX_PANE).toBeUndefined();
  });

  it('a default-server path throws and never calls exec', () => {
    const exec = vi.fn();
    expect(() => killIsolatedServer('/tmp', exec)).toThrow(/default/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('a mutated guard (existence check removed) would exec against a directory that never held a socket -- falsifying the guard', () => {
    // This test documents the guard's job rather than mutating production
    // source at test time: `resolveIsolatedSocket` returning the computed
    // path unconditionally (skipping the `isSocket()` check) is exactly the
    // regression that would make this assertion fail, since `dir` here was
    // never given a real socket.
    const dir = mkdtempSync(path.join('/tmp', 'vam-kill-nosocket-'));
    dirs.push(dir);
    const exec = vi.fn();
    killIsolatedServer(dir, exec);
    expect(exec).not.toHaveBeenCalled();
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
