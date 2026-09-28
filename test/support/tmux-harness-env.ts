/**
 * ISOLATES EVERY TMUX CALL A REAL, LAUNCHED VAM APP MAKES, from the
 * operator's own default tmux server -- the fix for a real hazard measured on
 * the operator's machine: `test/electron/launch.test.ts` (and its siblings,
 * every file that spawns a REAL `electron` binary or launches the packaged
 * app) left tmux's socket resolution untouched, so the app's own control-mode
 * client (`src/main/sources/tmux/control.ts`, `createControlTmuxRunner`)
 * spawned `tmux -C new-session -A -s vamctl` against the OPERATOR'S REAL
 * default server -- the same server that hosts their own live `vam-*`
 * sessions and the operator's OWN `vamctl` session, if their real app is
 * open. `-A` ATTACHES to an existing session by that name rather than
 * refusing, so a concurrent test run could have reached across into the
 * operator's own live control session.
 *
 * WHY `TMUX_TMPDIR` AND NOTHING ELSE. Every tmux entry point vam's production
 * code has -- `createTmuxRunner` (`spawn.ts`), and `spawnRealControlChild`
 * inside `createControlTmuxRunner` (`control.ts`) -- invokes the bare `tmux`
 * binary with NO `-L`/`-S` and NO explicit `env` option on either the
 * `execFile` or the `spawn` call. Node inherits the CALLING process's own
 * `process.env` whenever `env` is omitted from those options (node's own
 * documented default), so the one thing that changes where EVERY one of
 * those calls looks for its socket -- `list-sessions`, `new-session`, the
 * `-C` control client, `kill-session`, all of it, with no vam code touched at
 * all -- is the environment of the ELECTRON PROCESS ITSELF once it is
 * launched. Production is unaffected: nothing here ever runs unless a test
 * harness explicitly builds this env and hands it to a spawned/launched
 * Electron process.
 *
 * MEASURED, on tmux 3.7b, from this repo's own worktree: `TMUX_TMPDIR=<dir>
 * tmux -L default start-server` resolves its socket at
 * `<dir>/tmux-<uid>/default` -- never `/tmp/tmux-<uid>/default`, the
 * operator's own -- and a `list-sessions`/`kill-server` aimed at the SAME
 * `TMUX_TMPDIR` reaches exactly that private socket and nothing else. `TMUX`
 * is stripped from the child's env too: it plays no part in tmux's OWN
 * socket-path resolution (only `-S`/`-L`/`TMUX_TMPDIR` do), but handing a
 * test process the operator's real `TMUX` value -- naming their real pane --
 * is wrong data regardless, and tmux's own "sessions should be nested with
 * care" warning is not a thing an automated harness should ever be able to
 * trigger.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * `/tmp` ITSELF, NEVER `os.tmpdir()` -- MEASURED, on this exact worktree: a
 * tmux socket is a real AF_UNIX path (`<TMUX_TMPDIR>/tmux-<uid>/<name>`), and
 * macOS's own per-process `os.tmpdir()`
 * (`/private/var/folders/xx/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/T`) is already
 * within a few characters of the kernel's ~104-byte `sun_path` ceiling before
 * this file's own `tmux-<uid>/<name>` suffix is even added -- reproduced
 * directly while writing this file: `tmux -L default start-server` under
 * such a `TMUX_TMPDIR` answers `File name too long` and exits 1, not "no
 * server running", which `defaultServerPaneCwds`'s own `NO_SERVER` pattern
 * does not match, so a caller would see a thrown error instead of an isolated
 * server. `/tmp` is short on every platform this app ships tmux support for
 * (macOS, Linux) and is exactly what a bare `tmux` invocation with NO
 * `TMUX_TMPDIR` at all falls back to (`/tmp/tmux-<uid>/default`) -- so this
 * private directory sits beside the operator's real one, never inside it.
 */
const TMUX_SOCKET_ROOT = '/tmp';

/**
 * A fresh, private tmux socket DIRECTORY for one harness process --
 * suffixed with this process's own pid, the same discipline
 * `e2e/support/tmux-socket.mjs`'s `privateTmuxSocket` already applies to its
 * own socket NAMES: two harness runs on one machine at once (this repo's own
 * worktrees routinely run several agents in parallel) must never be handed
 * the same directory, or the second run's cleanup would tear down the
 * first's private server mid-test.
 */
export function mkIsolatedTmuxTmpdir(prefix: string): string {
  if (prefix === '') {
    throw new Error('mkIsolatedTmuxTmpdir requires a non-empty prefix');
  }
  return mkdtempSync(path.join(TMUX_SOCKET_ROOT, `${prefix}-`));
}

/**
 * The env to hand a spawned/launched Electron process so every tmux call it
 * makes lands on the private server named by `tmuxTmpdir`, never the
 * operator's default one.
 *
 * `base` is spread FIRST and this function's own two keys are set AFTER, so
 * a `TMUX_TMPDIR`/`TMUX` this harness process happens to have inherited
 * (nested test runs, an operator running the suite from inside their own
 * tmux pane) can never win over the isolation this call exists to apply.
 */
export function isolatedTmuxEnv(base: NodeJS.ProcessEnv, tmuxTmpdir: string): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...base, TMUX_TMPDIR: tmuxTmpdir };
  delete next.TMUX;
  return next;
}

/** Whether `tmux` is on PATH at all. Every function below that actually runs
 *  tmux degrades to a named, non-fatal skip rather than a red suite when it
 *  is not -- CI's `test:app`/`test:e2e:electron` jobs install no tmux at
 *  all (only the web-guards job does), so this is the ordinary case there. */
export function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** tmux's own words for "no server is running on this socket at all" -- the
 *  identical pattern `src/main/sources/tmux/spawn.ts`'s own `NO_SERVER`
 *  matches, so a harness that finds no server reads it as the honest empty
 *  list, never as a failure. */
const NO_SERVER = /no server running|error connecting to .*\(no such file/i;

function stderrOf(error: unknown): string {
  return error !== null && typeof error === 'object' && 'stderr' in error
    ? String((error as { stderr: unknown }).stderr)
    : '';
}

/**
 * READ-ONLY. Every pane cwd on the OPERATOR'S REAL DEFAULT tmux server --
 * `env` is the harness's own ambient environment, never one carrying
 * `TMUX_TMPDIR`, so this always asks the true default socket. Never a
 * `kill-session`, never a `new-session`: `list-sessions` cannot create a
 * server that does not exist, so "no server running" is read as the empty
 * set rather than a failure -- `listVamSessions`'s own rule (`spawn.ts`).
 */
export function defaultServerPaneCwds(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  try {
    const stdout = execFileSync('tmux', ['list-sessions', '-F', '#{pane_current_path}'], {
      env,
      encoding: 'utf8',
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch (error) {
    if (NO_SERVER.test(stderrOf(error))) return [];
    throw error;
  }
}

/**
 * The read-only assertion at the heart of the runtime check: no session
 * whose pane cwd is UNDER `watchDir` (the harness's own worktree or temp
 * dir) may appear on the default server between `before` and `after` --
 * whatever else changed there, which is none of this harness's business and
 * is why this compares only the one directory it owns.
 */
export function assertNoNewSessionUnderOnDefaultServer(input: {
  before: readonly string[];
  after: readonly string[];
  watchDir: string;
}): void {
  const { before, after, watchDir } = input;
  const beforeSet = new Set(before);
  const isUnder = (cwd: string): boolean => cwd === watchDir || cwd.startsWith(watchDir + path.sep);
  const introduced = after.filter((cwd) => !beforeSet.has(cwd) && isUnder(cwd));
  if (introduced.length > 0) {
    throw new Error(
      `a new session appeared on the OPERATOR'S DEFAULT tmux server with a pane cwd under ` +
        `${watchDir}, which the isolated launch must never reach: ${introduced.join(', ')}`,
    );
  }
}

/**
 * THE INCIDENT THIS GUARDS AGAINST. tmux resolves a NAMED socket (`-L name`,
 * including the implicit `default` name any bare `tmux` call or `-L default`
 * uses) by searching the list `"$TMUX_TMPDIR:/tmp/"` for the first entry
 * whose `realpath` succeeds, then appends `tmux-<uid>/<name>` -- SKIPPING,
 * not erroring on, any entry whose `realpath` fails (a deleted directory,
 * for instance). So `TMUX_TMPDIR=<a deleted dir> tmux -L default kill-server`
 * does not fail closed: it silently falls through to `/tmp`, and because the
 * socket NAME is `default` -- the exact name a bare, unisolated `tmux` call
 * always uses -- it reaches `/tmp/tmux-<uid>/default`, the OPERATOR'S REAL
 * default server, and kills it. Measured on this machine, 2026-09-28: this
 * is exactly what happened, killing every live session the operator had.
 *
 * `resolveIsolatedSocket` exists so nothing in this file ever again asks
 * tmux to resolve a socket by NAME through that search list for a
 * destructive or count-bearing call. It computes the absolute path itself
 * (`<tmuxTmpdir>/tmux-<uid>/default`, precisely the path tmux's own
 * resolution would produce when `tmuxTmpdir` is genuinely valid) and hands
 * every caller `-S <that exact path>` instead of `-L default` -- `-S` is an
 * explicit path tmux opens directly, with NO search-list fallback of any
 * kind. A `tmuxTmpdir` that no longer exists, or whose `tmux-<uid>/default`
 * entry is missing or is not actually a socket, resolves to `null`: the
 * caller does nothing, rather than ever letting tmux itself guess.
 *
 * DEFENCE IN DEPTH, for the case a caller ever passes a `tmuxTmpdir` that
 * itself somehow already equals a live root (a future bug, not the one
 * measured here): this throws if the computed path is not safely under
 * `/tmp` or `os.tmpdir()`, and throws again if it exactly equals either
 * real default-server path (`/tmp/tmux-<uid>/default` or
 * `<os.tmpdir()>/tmux-<uid>/default` -- `$TMPDIR`, when set, resolves to the
 * same place `os.tmpdir()` reports). Both throws happen BEFORE any
 * filesystem check, so they fire even when a real default socket happens to
 * sit at that exact path.
 */
export function resolveIsolatedSocket(
  tmuxTmpdir: string,
  uid: number = process.getuid?.() ?? 0,
): string | null {
  const socketPath = path.join(tmuxTmpdir, `tmux-${uid}`, 'default');

  const tmpRoots = new Set<string>(['/tmp', os.tmpdir()]);
  if (process.env.TMPDIR) tmpRoots.add(process.env.TMPDIR);
  const underATmpRoot = [...tmpRoots].some(
    (root) =>
      socketPath === path.join(root, `tmux-${uid}`, 'default') ||
      socketPath.startsWith(`${root}${path.sep}`),
  );
  if (!underATmpRoot) {
    throw new Error(
      `refusing to resolve a tmux socket outside /tmp or os.tmpdir(): ${socketPath} (from tmuxTmpdir=${tmuxTmpdir})`,
    );
  }

  const forbiddenDefaultPaths = [...tmpRoots].map((root) =>
    path.join(root, `tmux-${uid}`, 'default'),
  );
  if (forbiddenDefaultPaths.includes(socketPath)) {
    throw new Error(
      `refusing to target the operator's own default tmux socket (${socketPath}) -- ` +
        `an isolated/destructive call must never be able to reach it, even via TMUX_TMPDIR's own fallback`,
    );
  }

  try {
    return lstatSync(socketPath).isSocket() ? socketPath : null;
  } catch {
    return null;
  }
}

/** Strips both `TMUX` (names the caller's own real pane -- wrong data for a
 *  process addressing an explicit `-S` path) and `TMUX_PANE` from the env
 *  handed to an explicit-socket tmux call, so nothing about the calling
 *  process's own possible tmux nesting leaks into it. */
function withoutTmuxNesting(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...base };
  delete next.TMUX;
  delete next.TMUX_PANE;
  return next;
}

/**
 * The minimal shape this module needs from `execFileSync` -- narrow enough
 * that a test can inject a `vi.fn()` without satisfying every overload of
 * the real, multiply-overloaded `execFileSync` type.
 */
export type TmuxExec = (
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; stdio?: 'ignore'; encoding?: 'utf8' },
) => string;

const runTmux: TmuxExec = (file, args, options) =>
  String(execFileSync(file, args as string[], options));

/**
 * How many sessions exist on the PRIVATE server named by `tmuxTmpdir` --
 * addressed by the exact absolute socket path `resolveIsolatedSocket`
 * computes, via `-S`, never `-L default`/`TMUX_TMPDIR` (see that function's
 * own doc for why). `0` both when the private tmpdir was never given a real
 * socket (`resolveIsolatedSocket` returns `null` -- not every harness run
 * makes a tmux call at all) and when tmux itself answers "no server
 * running"; neither is a failure.
 */
export function isolatedServerSessionCount(tmuxTmpdir: string, exec: TmuxExec = runTmux): number {
  const socket = resolveIsolatedSocket(tmuxTmpdir);
  if (socket === null) return 0;
  try {
    const stdout = exec('tmux', ['-S', socket, 'list-sessions'], {
      env: withoutTmuxNesting(process.env),
      encoding: 'utf8',
    });
    return stdout.split('\n').filter((line) => line.trim() !== '').length;
  } catch (error) {
    if (NO_SERVER.test(stderrOf(error))) return 0;
    throw error;
  }
}

/**
 * Tears down the PRIVATE server, addressed ONLY by the exact absolute
 * socket path `resolveIsolatedSocket` computes and verifies -- via `-S`,
 * NEVER `-L default` / `TMUX_TMPDIR`, so a `tmuxTmpdir` that no longer
 * resolves (deleted, or never had a socket) can never make this call fall
 * through to the operator's real default server (see `resolveIsolatedSocket`
 * for the measured incident this exists to close). A private tmpdir with no
 * real socket under it does nothing at all -- there is nothing to tear
 * down, not a failure.
 */
export function killIsolatedServer(tmuxTmpdir: string, exec: TmuxExec = runTmux): void {
  const socket = resolveIsolatedSocket(tmuxTmpdir);
  if (socket === null) return;
  try {
    exec('tmux', ['-S', socket, 'kill-server'], {
      env: withoutTmuxNesting(process.env),
      stdio: 'ignore',
    });
  } catch {
    // Gone already between the isSocket() check and this call -- fine.
  }
}
