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
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
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
  const dir = mkdtempSync(path.join(TMUX_SOCKET_ROOT, `${prefix}-`));
  // PRE-CREATE TMUX'S OWN `tmux-<uid>` SOCKET DIRECTORY, HERE, SYNCHRONOUSLY,
  // BEFORE THIS FUNCTION EVER RETURNS -- CI evidence (main, post-#546+#540
  // combined, run 36396039883): a session appeared on the OPERATOR'S REAL
  // DEFAULT server during an isolated launch, with a pane cwd exactly the
  // repo root -- the shape a bare, unisolated `tmux -C new-session -A -s
  // vamctl` produces. Production code is NEVER given `-S`/`-L` (the whole
  // point of `TMUX_TMPDIR`-only isolation, this file's own header), so
  // every tmux call the launched app makes relies ENTIRELY on tmux itself
  // resolving `TMUX_TMPDIR` and creating `tmux-<uid>` under it, ON ITS OWN,
  // the FIRST time any of them connects. A single launch makes several
  // near-simultaneous tmux calls (the vamctl control connection, plus at
  // least one plain `list-sessions`/`-V` the sidebar and the streaming
  // version-gate both fire on mount) that can all reach a BRAND-NEW
  // `tmuxTmpdir` before any of them has created that subdirectory --
  // exactly the shape of gap the incident's own mechanism (tmux's
  // `"$TMUX_TMPDIR:/tmp/"` search list, silently skipping an entry it
  // cannot use) has no obligation to lose safely under. Creating it here,
  // mode 0700 and owned by this process, removes the race entirely: every
  // tmux call the launched app makes finds an already-valid, already-owned
  // directory waiting for it, with nothing left to create -- and therefore
  // nothing left to race over -- on its first connect.
  mkdirSync(path.join(dir, `tmux-${process.getuid?.() ?? 0}`), { recursive: true, mode: 0o700 });
  return dir;
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

/** One process's environment, as `/proc/<pid>/environ` spells it (`KEY=value`
 *  entries, NUL-separated) -- `Readonly` because this is a diagnostic
 *  snapshot, never something a caller should mutate and reuse. */
export type ProcEnv = Readonly<Record<string, string>>;

/**
 * Reads `/proc/<pid>/environ` -- Linux only (CI's `check` job runs on
 * `ubuntu-latest`, which is the one place this diagnostic is actually
 * needed), and only for a process this UID owns; `null` for anything that
 * stops it (macOS/Windows, the process already gone, no permission), never
 * a thrown error -- a diagnostic that cannot read must say so, not turn an
 * already-failing assertion into a DIFFERENT crash.
 */
export function readProcEnviron(pid: number): ProcEnv | null {
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, 'utf8');
    const env: Record<string, string> = {};
    for (const entry of raw.split('\0')) {
      if (entry === '') continue;
      const eq = entry.indexOf('=');
      if (eq === -1) continue;
      env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return env;
  } catch {
    return null;
  }
}

/** The minimal shape a diagnostic exec call needs: a command, its args, and
 *  a string answer -- narrower than `execFileSync`'s own type for the same
 *  reason `TmuxExec` is, and injectable so `describeDefaultServerLeak`'s
 *  own tests never run a real `tmux`/`ps`. */
export type DiagnosticExec = (file: string, args: readonly string[]) => string;

/** Whether a path exists at all, and -- when it does -- the `dev`/`ino`
 *  pair that identifies WHICH underlying file it is, socket or not. Two
 *  different PATHS with the same `dev`+`ino` are the same file (a hard
 *  link, or one reached via a symlinked ancestor); this is how
 *  `describeDefaultServerLeak` below tells apart "this really is a
 *  separate, genuine private socket" from "this is the real default
 *  socket, reached under a different name". */
export type PathInspection = {
  readonly exists: boolean;
  readonly isSocket: boolean;
  readonly dev: number | null;
  readonly ino: number | null;
};

/** The real inspection: `lstatSync`, never a thrown error -- a path that
 *  does not exist answers `{ exists: false, ... }`, not an exception. */
export function inspectPath(target: string): PathInspection {
  try {
    const st = lstatSync(target);
    return { exists: true, isSocket: st.isSocket(), dev: st.dev, ino: st.ino };
  } catch {
    return { exists: false, isSocket: false, dev: null, ino: null };
  }
}

/** The real diagnostic exec: `execFileSync`, with a failure turned into
 *  TEXT describing itself rather than a thrown error -- every diagnostic
 *  step below must produce SOME line of output, never abort the ones after
 *  it. */
const runDiagnostic: DiagnosticExec = (file, args) => {
  try {
    return execFileSync(file, args as string[], { encoding: 'utf8' });
  } catch (error) {
    return `<${file} ${args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}>`;
  }
};

/**
 * DIAGNOSTIC ONLY, READ-ONLY, appended to an ALREADY-FAILING
 * `assertNoNewSessionUnderOnDefaultServer` -- CI evidence (PR #548, run
 * 36399341676) that the bare "a new session appeared" message was not
 * enough to find the real mechanism a second time. Gathers, for every pane
 * on the real default server whose cwd is under `watchDir`:
 *  - the session's own NAME and its pane's START COMMAND and PID
 *    (`tmux list-panes -a`, the one call that carries all three at once);
 *  - the OS-level `ps` row for that pane process, and for ITS OWN PARENT
 *    (panes are forked by the tmux SERVER, so the parent row is the
 *    server's own process);
 *  - whether that PARENT's environment carried `TMUX_TMPDIR` at all
 *    (`readProcEnviron`) -- the one fact that tells apart "isolation never
 *    reached this spawn" (absent) from "isolation reached it and tmux's
 *    own resolution fell through anyway" (present, but not honoured);
 *  - when `TMUX_TMPDIR` WAS present, whether the socket it claims
 *    (`<TMUX_TMPDIR>/tmux-<uid>/default`) still exists, and whether it is
 *    the SAME underlying file (`dev`+`ino`) as the real default socket --
 *    telling apart "its own private socket is gone/aliased" from "this is
 *    a genuinely separate, still-live private socket, so something ELSE
 *    entirely created the one on the real default server".
 *
 * Never throws on its own: `exec`'s default (`runDiagnostic`) turns a
 * failed command into descriptive text instead of an exception, and every
 * other branch here resolves to a string for any shape the injected `exec`
 * answers with. This must only ever ADD information to a failure already in
 * progress, never become a second, different one.
 */
export function describeDefaultServerLeak(
  watchDir: string,
  exec: DiagnosticExec = runDiagnostic,
  readEnviron: (pid: number) => ProcEnv | null = readProcEnviron,
  inspect: (target: string) => PathInspection = inspectPath,
  uid: number = process.getuid?.() ?? 0,
): string {
  const listing = exec('tmux', [
    'list-panes',
    '-a',
    '-F',
    '#{session_name}\t#{pane_start_command}\t#{pane_pid}\t#{pane_current_path}',
  ]);
  const isUnder = (cwd: string): boolean => cwd === watchDir || cwd.startsWith(watchDir + path.sep);
  const matches = listing
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(
      (fields): fields is [string, string, string, string] =>
        fields.length === 4 && isUnder(fields[3] ?? ''),
    );
  if (matches.length === 0) {
    return `no pane under ${watchDir} found by \`tmux list-panes -a\` -- raw listing:\n${listing}`;
  }
  const blocks = matches.map(([sessionName, startCommand, panePidText, cwd]) => {
    const lines = [
      `session=${sessionName} startCommand=${startCommand} panePid=${panePidText} cwd=${cwd}`,
    ];
    const panePid = Number(panePidText);
    if (!Number.isFinite(panePid)) {
      lines.push('(pane_pid was not a number -- cannot inspect its process tree)');
      return lines.join('\n');
    }
    lines.push(
      `ps (pane process):\n${exec('ps', ['-o', 'pid,ppid,command', '-p', String(panePid)])}`,
    );
    const ppidText = exec('ps', ['-o', 'ppid=', '-p', String(panePid)]).trim();
    const ppid = Number(ppidText);
    if (!Number.isFinite(ppid)) {
      lines.push(`(could not read the pane process's ppid: "${ppidText}")`);
      return lines.join('\n');
    }
    lines.push(
      `ps (parent ${ppid}, likely the tmux server itself):\n` +
        `${exec('ps', ['-o', 'pid,ppid,command', '-p', String(ppid)])}`,
    );
    const env = readEnviron(ppid);
    if (env === null) {
      lines.push(
        `/proc/${ppid}/environ unavailable (not Linux, process already gone, or no permission)`,
      );
      return lines.join('\n');
    }
    lines.push(
      `parent(${ppid}) env: TMUX_TMPDIR=${env.TMUX_TMPDIR ?? '<absent>'} TMUX=${env.TMUX ?? '<absent>'} ` +
        `PWD=${env.PWD ?? '<absent>'} SHELL=${env.SHELL ?? '<absent>'}`,
    );
    if (env.TMUX_TMPDIR === undefined) return lines.join('\n');
    const claimedSocket = path.join(env.TMUX_TMPDIR, `tmux-${uid}`, 'default');
    const claimed = inspect(claimedSocket);
    if (!claimed.exists) {
      lines.push(
        `its claimed private socket ${claimedSocket} does NOT exist -- ` +
          `consistent with a deleted-tmpdir fallback (the exact incident mechanism)`,
      );
      return lines.join('\n');
    }
    const realDefaultCandidates = [
      path.join('/tmp', `tmux-${uid}`, 'default'),
      path.join(os.tmpdir(), `tmux-${uid}`, 'default'),
    ];
    const aliasesRealDefault = realDefaultCandidates.some((candidate) => {
      const real = inspect(candidate);
      return real.exists && real.dev === claimed.dev && real.ino === claimed.ino;
    });
    lines.push(
      `its claimed private socket ${claimedSocket} exists (dev=${claimed.dev} ino=${claimed.ino}, ` +
        `isSocket=${claimed.isSocket}) and ${
          aliasesRealDefault
            ? 'IS THE SAME FILE as the real default socket (same dev+ino) -- an alias, not a separate connection'
            : 'is a DIFFERENT file from the real default socket -- a genuinely separate, still-live private ' +
              'socket, so something ELSE entirely must have created the session on the real default server'
        }`,
    );
    return lines.join('\n');
  });
  return blocks.join('\n\n');
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
 *
 * A SECOND DEFENCE-IN-DEPTH PASS, BY REALPATH (a reviewer finding): the
 * checks above compare STRINGS, so a `tmuxTmpdir` that is itself a SYMLINK
 * aliasing one of `tmpRoots` under a different name would sail straight
 * through them -- the string never matches, even though the directory it
 * actually opens is identical. Once both the socket's own parent directory
 * and a forbidden root's `tmux-<uid>` directory genuinely EXIST, their
 * `realpathSync` is compared instead of their spelling. Skipped whenever
 * either side does not exist yet: a directory that is not there cannot
 * alias anything, and `lstatSync` below already refuses a socket that was
 * never created.
 *
 * `tmpRoots`, the third parameter, is INJECTABLE so a test can exercise
 * this whole function -- including this exact alias check -- against
 * fake, test-owned roots, never the real `/tmp/tmux-<uid>`.
 */
export function resolveIsolatedSocket(
  tmuxTmpdir: string,
  uid: number = process.getuid?.() ?? 0,
  tmpRoots: ReadonlySet<string> = defaultTmpRoots(),
): string | null {
  const socketPath = path.join(tmuxTmpdir, `tmux-${uid}`, 'default');

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

  const socketDir = path.dirname(socketPath);
  if (existsSync(socketDir)) {
    const realSocketDir = realpathSync(socketDir);
    for (const root of tmpRoots) {
      const forbiddenDir = path.join(root, `tmux-${uid}`);
      if (forbiddenDir === socketDir || !existsSync(forbiddenDir)) continue;
      if (realpathSync(forbiddenDir) === realSocketDir) {
        throw new Error(
          `refusing to target the operator's own default tmux socket directory -- ` +
            `${socketDir} is a symlink alias of ${forbiddenDir} (both realpath to ${realSocketDir})`,
        );
      }
    }
  }

  try {
    return lstatSync(socketPath).isSocket() ? socketPath : null;
  } catch {
    return null;
  }
}

/** `tmpRoots`'s own default: `/tmp` and `os.tmpdir()`, plus `$TMPDIR` when
 *  the environment carries one -- computed fresh on every call (never a
 *  module-level constant) so a test that changes `process.env.TMPDIR`
 *  between calls is not reading a stale snapshot. */
function defaultTmpRoots(): ReadonlySet<string> {
  const roots = new Set<string>(['/tmp', os.tmpdir()]);
  if (process.env.TMPDIR) roots.add(process.env.TMPDIR);
  return roots;
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
