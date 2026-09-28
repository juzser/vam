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
import { mkdtempSync } from 'node:fs';
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
 * How many sessions exist on the PRIVATE server named by `tmuxTmpdir` --
 * `-L default`, the same socket NAME production vam's own un-prefixed calls
 * resolve to, only redirected by `TMUX_TMPDIR` rather than by an explicit
 * `-L`/`-S` vam's code does not carry. `0` for "no server running" (the
 * launch never made a tmux call at all -- not every harness run does),
 * never a failure.
 */
export function isolatedServerSessionCount(tmuxTmpdir: string): number {
  try {
    const stdout = execFileSync('tmux', ['-L', 'default', 'list-sessions'], {
      env: isolatedTmuxEnv(process.env, tmuxTmpdir),
      encoding: 'utf8',
    });
    return stdout.split('\n').filter((line) => line.trim() !== '').length;
  } catch (error) {
    if (NO_SERVER.test(stderrOf(error))) return 0;
    throw error;
  }
}

/**
 * Tears down the PRIVATE server, addressed ONLY by the same `TMUX_TMPDIR` it
 * was given -- never by a bare session or socket NAME, which could reach
 * something else entirely on a shared default server. A server that was
 * never started (no tmux call happened during the run) answers "no server
 * running"; that is success, not a failure, so it is swallowed the same way
 * every other read here swallows it.
 */
export function killIsolatedServer(tmuxTmpdir: string): void {
  try {
    execFileSync('tmux', ['-L', 'default', 'kill-server'], {
      env: isolatedTmuxEnv(process.env, tmuxTmpdir),
      stdio: 'ignore',
    });
  } catch {
    // Nothing running on this private socket -- nothing to clean up.
  }
}
