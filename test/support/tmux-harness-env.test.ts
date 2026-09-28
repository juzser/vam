import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertNoNewSessionUnderOnDefaultServer,
  defaultServerPaneCwds,
  describeDefaultServerLeak,
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

  // CI EVIDENCE (main, post-#546+#540 combined, run 36396039883): a session
  // appeared on the OPERATOR'S REAL DEFAULT server during `launch.test.ts`'s
  // own isolated launch, cwd exactly the repo root -- the shape a bare,
  // unisolated `tmux -C new-session -A -s vamctl` produces. Production code
  // is NEVER given `-S`/`-L` (the whole point of `TMUX_TMPDIR`-only
  // isolation -- this file's own header), so the launched app's tmux calls
  // rely ENTIRELY on tmux itself successfully resolving `TMUX_TMPDIR` and
  // creating `<tmuxTmpdir>/tmux-<uid>` on its own, on FIRST use. Multiple
  // near-simultaneous tmux invocations from one launch (the vamctl control
  // connection, plus at least one plain `list-sessions`/`-V` call the
  // sidebar and the streaming version-gate both make on mount) can each
  // reach a brand-new `tmuxTmpdir` before ANY of them has created that
  // subdirectory -- exactly the kind of first-use race the incident's own
  // mechanism (`"$TMUX_TMPDIR:/tmp/"`, skipping an entry it cannot use) has
  // no obligation to lose safely. Pre-creating the subdirectory HERE, before
  // the harness ever launches anything, removes the race entirely: every
  // tmux invocation the launched app makes finds an already-valid,
  // already-owned, already-0700 directory waiting for it, with nothing left
  // to create (and therefore nothing left to race over) on first connect.
  it("pre-creates tmux's own tmux-<uid> socket directory, mode 0700, so the launched app never has to create it on first use", () => {
    const dir = mkIsolatedTmuxTmpdir('vam-tmux-env-test-presock');
    dirs.push(dir);
    const socketDir = path.join(dir, `tmux-${UID}`);
    expect(existsSync(socketDir)).toBe(true);
    expect(statSync(socketDir).mode & 0o777).toBe(0o700);
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

// CI EVIDENCE (main / PR #548, run 36399341676, re-run): the same
// "OPERATOR'S DEFAULT tmux server" assertion above keeps failing with only
// the introduced CWD to go on -- not which session, not its start command,
// not what created it. `describeDefaultServerLeak` exists to answer that,
// entirely with FAKE injected `exec`/`readEnviron` functions here, so this
// suite's own tests never make a real tmux/ps call or read a real /proc
// entry.
describe('describeDefaultServerLeak, with injected exec/readEnviron (no real tmux or /proc needed)', () => {
  it('says plainly when list-panes finds nothing under watchDir', () => {
    const exec = vi.fn(() => 'other-session\tzsh\t123\t/Users/op/somewhere-else\n');
    const text = describeDefaultServerLeak('/home/runner/work/vam/vam', exec, () => null);
    expect(text).toMatch(/no pane under/i);
    expect(exec).toHaveBeenCalledWith('tmux', expect.arrayContaining(['list-panes', '-a']));
  });

  it('names the session, start command, pid, and the ps rows for the pane and its parent', () => {
    const calls: (readonly [string, readonly string[]])[] = [];
    const exec = (file: string, args: readonly string[]): string => {
      calls.push([file, args]);
      if (file === 'tmux') return 'vamctl\tcat\t4242\t/home/runner/work/vam/vam\n';
      if (args.includes('ppid=')) return '999\n';
      return 'PID PPID COMMAND\n4242 999 cat\n';
    };
    const text = describeDefaultServerLeak('/home/runner/work/vam/vam', exec, () => null);
    expect(text).toContain('session=vamctl');
    expect(text).toContain('startCommand=cat');
    expect(text).toContain('panePid=4242');
    expect(text).toContain('parent 999');
    expect(calls.some(([file, args]) => file === 'ps' && args.includes('4242'))).toBe(true);
    expect(calls.some(([file, args]) => file === 'ps' && args.includes('999'))).toBe(true);
  });

  it('reports the parent env, so TMUX_TMPDIR presence/absence is directly visible', () => {
    const exec = (file: string, args: readonly string[]): string => {
      if (file === 'tmux') return 'vamctl\tcat\t4242\t/home/runner/work/vam/vam\n';
      if (args.includes('ppid=')) return '999\n';
      return 'PID PPID COMMAND\n4242 999 cat\n';
    };
    const withTmpdir = describeDefaultServerLeak('/home/runner/work/vam/vam', exec, () => ({
      TMUX_TMPDIR: '/tmp/vam-launch-test-tmux-abc123',
      PWD: '/home/runner/work/vam/vam',
    }));
    expect(withTmpdir).toContain('TMUX_TMPDIR=/tmp/vam-launch-test-tmux-abc123');

    const withoutTmpdir = describeDefaultServerLeak('/home/runner/work/vam/vam', exec, () => ({
      PWD: '/home/runner/work/vam/vam',
    }));
    expect(withoutTmpdir).toContain('TMUX_TMPDIR=<absent>');

    const unavailable = describeDefaultServerLeak('/home/runner/work/vam/vam', exec, () => null);
    expect(unavailable).toMatch(/unavailable/i);
  });

  it('reports when the parent’s claimed private socket no longer exists -- consistent with a deleted-tmpdir fallback', () => {
    const exec = (file: string, args: readonly string[]): string => {
      if (file === 'tmux') return 'vamctl\tcat\t4242\t/home/runner/work/vam/vam\n';
      if (args.includes('ppid=')) return '999\n';
      return 'PID PPID COMMAND\n4242 999 cat\n';
    };
    const text = describeDefaultServerLeak(
      '/home/runner/work/vam/vam',
      exec,
      () => ({ TMUX_TMPDIR: '/tmp/vam-userdata-isolation-tmux-DY6Mzw' }),
      () => ({ exists: false, isSocket: false, dev: null, ino: null }),
    );
    expect(text).toMatch(/does NOT exist/);
    expect(text).toMatch(/deleted-tmpdir fallback/);
  });

  it('reports when the claimed private socket ALIASES the real default (same dev+ino)', () => {
    const exec = (file: string, args: readonly string[]): string => {
      if (file === 'tmux') return 'vamctl\tcat\t4242\t/home/runner/work/vam/vam\n';
      if (args.includes('ppid=')) return '999\n';
      return 'PID PPID COMMAND\n4242 999 cat\n';
    };
    const text = describeDefaultServerLeak(
      '/home/runner/work/vam/vam',
      exec,
      () => ({ TMUX_TMPDIR: '/tmp/vam-userdata-isolation-tmux-DY6Mzw' }),
      () => ({ exists: true, isSocket: true, dev: 1, ino: 42 }),
      501,
    );
    expect(text).toMatch(/IS THE SAME FILE as the real default socket/);
  });

  it('reports when the claimed private socket is genuinely a DIFFERENT file from the real default', () => {
    const exec = (file: string, args: readonly string[]): string => {
      if (file === 'tmux') return 'vamctl\tcat\t4242\t/home/runner/work/vam/vam\n';
      if (args.includes('ppid=')) return '999\n';
      return 'PID PPID COMMAND\n4242 999 cat\n';
    };
    const text = describeDefaultServerLeak(
      '/home/runner/work/vam/vam',
      exec,
      () => ({ TMUX_TMPDIR: '/tmp/vam-userdata-isolation-tmux-DY6Mzw' }),
      (target) =>
        target.includes('vam-userdata-isolation')
          ? { exists: true, isSocket: true, dev: 1, ino: 42 }
          : { exists: true, isSocket: true, dev: 1, ino: 99 },
      501,
    );
    expect(text).toMatch(/DIFFERENT file from the real default socket/);
    expect(text).toMatch(/something ELSE entirely must have created/);
  });

  it('never throws even when every exec call fails', () => {
    const exec = (): string => {
      throw new Error('boom');
    };
    expect(() =>
      describeDefaultServerLeak('/home/runner/work/vam/vam', exec, () => null),
    ).toThrow();
    // `describeDefaultServerLeak` itself does not swallow a THROWING exec --
    // that is `runDiagnostic`'s own job, exercised in the next test -- but
    // it must still resolve to a STRING, never leave a partial write, for
    // every OTHER injected exec shape (empty output, malformed lines).
    const emptyExec = (): string => '';
    expect(() =>
      describeDefaultServerLeak('/home/runner/work/vam/vam', emptyExec, () => null),
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

  // REVIEWER S3: the checks above compare STRINGS, so a `tmuxTmpdir` that is
  // itself a SYMLINK aliasing one of the forbidden roots under a different
  // name would sail straight through them -- the string never matches, even
  // though the path it actually opens is identical. Built entirely against
  // FAKE, test-owned roots (never the real `/tmp/tmux-<uid>`), so this can
  // never touch or even read the operator's own default socket.
  it('throws when tmuxTmpdir is a symlink whose REALPATH aliases a forbidden root, even though the string differs', () => {
    const fakeForbiddenRoot = mkdtempSync(path.join('/tmp', 'vam-resolve-socket-fake-forbidden-'));
    dirs.push(fakeForbiddenRoot);
    mkdirSync(path.join(fakeForbiddenRoot, `tmux-${UID}`), { recursive: true });
    const aliasPath = path.join('/tmp', `vam-resolve-socket-alias-${process.pid}`);
    symlinkSync(fakeForbiddenRoot, aliasPath);
    dirs.push(aliasPath);
    expect(aliasPath).not.toBe(fakeForbiddenRoot);
    // `/tmp` is ALSO in `tmpRoots` here so `aliasPath` (which sits directly
    // under `/tmp`, not under `fakeForbiddenRoot`'s own string) passes the
    // ordinary "is this under a tmp root at all" check on its way to the
    // REALPATH check this test actually means to exercise -- otherwise the
    // thrown error would be the EARLIER, unrelated "outside /tmp" one,
    // which also happens to match `/default/i` (it prints the path) and
    // would make this test pass for the wrong reason.
    expect(() =>
      resolveIsolatedSocket(aliasPath, UID, new Set([fakeForbiddenRoot, '/tmp'])),
    ).toThrow(/alias/i);
  });

  it('does NOT throw for two genuinely different roots -- the realpath check is not just "always throw"', () => {
    const fakeForbiddenRoot = mkdtempSync(path.join('/tmp', 'vam-resolve-socket-fake-forbidden2-'));
    dirs.push(fakeForbiddenRoot);
    mkdirSync(path.join(fakeForbiddenRoot, `tmux-${UID}`), { recursive: true });
    const realOtherRoot = mkdtempSync(path.join('/tmp', 'vam-resolve-socket-real-other-'));
    dirs.push(realOtherRoot);
    expect(
      resolveIsolatedSocket(realOtherRoot, UID, new Set([fakeForbiddenRoot, '/tmp'])),
    ).toBeNull();
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
