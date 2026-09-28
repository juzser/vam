/**
 * Proves the fix for the harness-userdata leak: a test/fixture Electron
 * launch gets its OWN throwaway `userData`, never the operator's real
 * profile -- see `src/main/index.ts`'s `VAM_USER_DATA_DIR` handling, read
 * before anything else touches `app`, and `src/main/env/user-data-dir.ts`
 * (unit-tested on its own in `test/main/user-data-dir.test.ts`) for the
 * override logic itself.
 *
 * MEASURED, NOT ASSUMED: every launch here inherits the real environment
 * rather than faking a decoy `HOME`, because a decoy `HOME` does not work --
 * measured directly (`electron` binary, macOS): `app.getPath('userData')`
 * resolves from the OS user's actual home directory regardless of
 * `process.env.HOME` on the spawned child. That also means the ONE scenario
 * this file deliberately never spawns for real is "no override at all" --
 * doing so here would genuinely write under the real home (specifically
 * `~/Library/Application Support/Electron`, Electron's generic default name
 * for a script launched outside a `package.json`-bearing directory -- NOT
 * `~/Library/Application Support/vam`, which only a name-resolved launch
 * like the packaged app or `pnpm run dev:app` ever reaches; still measured
 * evidence, not this file's assumption, and still not a directory a test
 * run should be touching on every invocation). That fallback case is instead
 * covered where it is safe to: `resolveUserDataOverride({})` in the unit
 * test, which never spawns a process at all.
 *
 * Falsification (run manually, not part of this suite, to keep the suite's
 * own side effects bounded to the override under test): comment out the
 * `app.setPath('userData', ...)` call in `src/main/index.ts`, rebuild, and
 * re-run the first test below alone -- with the override no longer applied,
 * `userData` falls back to `~/Library/Application Support/Electron` instead
 * of the explicit override directory, and the `toBe` assertion on the
 * resolved path fails. Still never the operator's real `vam` profile.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_REMOTE_PORT } from '../../src/main/remote/launch.js';
import {
  assertNoNewSessionUnderOnDefaultServer,
  defaultServerPaneCwds,
  describeDefaultServerLeak,
  isolatedServerSessionCount,
  isolatedTmuxEnv,
  killIsolatedServer,
  mkIsolatedTmuxTmpdir,
  tmuxAvailable,
} from '../support/tmux-harness-env.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = (name: string) => path.join(repoRoot, 'node_modules', '.bin', name);
const probePath = path.join('test', 'electron', 'userdata-probe.cjs');

const scratchDirs: string[] = [];
function scratchDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

// One private tmux socket for the whole describe block below: the second
// test in it deliberately runs two Electron instances CONCURRENTLY, and
// sharing one isolated server between them is exactly as safe as sharing
// the operator's real one is in production (`control.ts`'s own "a second
// vam instance" note) -- the only property this file cares about is that
// NEITHER instance ever reaches the operator's actual default server.
let tmuxTmpdir: string;

/**
 * A genuinely free loopback port, never the operator's own remote-serve port
 * (58217, `DEFAULT_REMOTE_PORT` in `src/main/remote/launch.ts`) -- main starts
 * a remote transport unconditionally on `whenReady`, defaulting to that port
 * when `VAM_REMOTE_PORT` is unset. A bind against an already-taken port is
 * caught and non-fatal by design (`startRemoteTransport`'s own comment), but
 * this harness does not even attempt it: every probe below is handed its own
 * dynamically allocated port instead.
 */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address !== null && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('no port assigned'));
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

interface ProbeRun {
  code: number | null;
  stdout: string;
  stderr: string;
  userData: string | null;
}

function spawnProbe(env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  return spawn(bin('electron'), [probePath], {
    cwd: repoRoot,
    // ITS OWN PROCESS GROUP -- CI evidence (PR #548, runs 36402029062 and
    // 36403787763): killing only the Electron MAIN process (a bare
    // `child.kill('SIGKILL')`, this function's own prior shape) left its
    // own tmux control-mode GRANDCHILD (`spawnRealControlChild`,
    // `src/main/sources/tmux/control.ts`) running, orphaned, reparented to
    // init (`ps` showed `PPID=1`). That orphan resolves/opens its tmux
    // connection on its OWN schedule, independent of its dead parent -- and
    // when that happens to land AFTER this file's own `afterAll` already
    // `rmSync`'d `tmuxTmpdir`, tmux's own `TMUX_TMPDIR` resolution falls
    // through to `/tmp` (the exact incident this whole harness exists to
    // prevent), even though the orphan's own env still names the (by then
    // deleted) private directory -- confirmed directly: the diagnostic
    // `describeDefaultServerLeak` prints for the leaked session reported
    // "its claimed private socket ... does NOT exist" both times. `settings-
    // update.test.ts`'s own `runProbe` already carries the identical fix,
    // for the identical reason (its own comment: "SIGKILL on the main
    // process alone left them running").
    detached: true,
    env: isolatedTmuxEnv({ ...process.env, VAM_FIXTURE_SOURCE: '1', ...env }, tmuxTmpdir),
  }) as ChildProcessWithoutNullStreams;
}

/** Kills `child`'s WHOLE PROCESS GROUP, not just its own pid -- see
 *  `spawnProbe`'s own `detached: true` note for why a bare `child.kill()`
 *  is not enough. `-child.pid` is POSIX's own "signal the whole group"
 *  spelling; a group with nothing left to signal (already exited) is not a
 *  failure here, just nothing left to do. */
function killTree(child: ChildProcessWithoutNullStreams): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Already gone -- the group has no members left to signal.
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<ProbeRun> {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      killTree(child);
      reject(
        new Error(`userdata-probe did not exit within 30s\nstdout:\n${stdout}\nstderr:\n${stderr}`),
      );
    }, 30_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('VAM_USERDATA_RESULT '));
      resolve({
        code,
        stdout,
        stderr,
        userData:
          line === undefined
            ? null
            : (JSON.parse(line.slice('VAM_USERDATA_RESULT '.length)) as { userData: string })
                .userData,
      });
    });
  });
}

/** Resolves once the probe has printed its result line, without waiting for exit -- used to hold a second instance open while a third launches. */
function waitForReady(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += String(chunk);
      const line = buf.split('\n').find((l) => l.startsWith('VAM_USERDATA_RESULT '));
      if (line !== undefined) {
        child.stdout.off('data', onData);
        resolve(
          (JSON.parse(line.slice('VAM_USERDATA_RESULT '.length)) as { userData: string }).userData,
        );
      }
    };
    child.stdout.on('data', onData);
    child.on('error', reject);
    const timer = setTimeout(
      () => reject(new Error('probe did not become ready within 20s')),
      20_000,
    );
    child.on('close', () => clearTimeout(timer));
  });
}

describe('the Electron harness gets its own throwaway userData', () => {
  let defaultServerBefore: readonly string[];

  // Built ONCE for the whole run by `vitest.app.config.ts`'s globalSetup
  // (`test/electron/global-build.ts`) -- never per file, see its header.
  // Only the tmux isolation setup belongs here now.
  beforeAll(() => {
    tmuxTmpdir = mkIsolatedTmuxTmpdir('vam-userdata-isolation-tmux');
    defaultServerBefore = tmuxAvailable() ? defaultServerPaneCwds() : [];
  });

  afterAll(() => {
    for (const dir of scratchDirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    if (tmuxTmpdir !== undefined) {
      killIsolatedServer(tmuxTmpdir);
      rmSync(tmuxTmpdir, { recursive: true, force: true });
    }
  });

  it('honours VAM_USER_DATA_DIR, and Chromium really writes there', async () => {
    const override = scratchDir('vam-override-');
    const remotePort = await freePort();
    const run = await waitForExit(
      spawnProbe({ VAM_USER_DATA_DIR: override, VAM_REMOTE_PORT: String(remotePort) }),
    );
    expect(`${run.code} ${run.stderr}`).toBe(`0 ${run.stderr}`);
    expect(run.userData, `no VAM_USERDATA_RESULT line.\nstderr:\n${run.stderr}`).not.toBeNull();
    expect(realpathSync(run.userData as string)).toBe(realpathSync(override));
    // Chromium's own storage backend created this, not the probe script.
    expect(existsSync(path.join(override, 'Local Storage'))).toBe(true);
  });

  it('stays isolated to its own dir while a second, concurrent instance holds a different one', async () => {
    const userDataA = scratchDir('vam-override-a-');
    const remotePortA = await freePort();
    const childA = spawnProbe({
      VAM_USER_DATA_DIR: userDataA,
      VAM_REMOTE_PORT: String(remotePortA),
      VAM_PROBE_HOLD_MS: '15000',
    });
    try {
      const userDataAReported = await waitForReady(childA);
      expect(realpathSync(userDataAReported)).toBe(realpathSync(userDataA));

      const userDataB = scratchDir('vam-override-b-');
      const remotePortB = await freePort();
      const runB = await waitForExit(
        spawnProbe({ VAM_USER_DATA_DIR: userDataB, VAM_REMOTE_PORT: String(remotePortB) }),
      );
      expect(`${runB.code} ${runB.stderr}`).toBe(`0 ${runB.stderr}`);
      expect(realpathSync(runB.userData as string)).toBe(realpathSync(userDataB));
      expect(existsSync(path.join(userDataB, 'Local Storage'))).toBe(true);
      // Instance A's own dir is untouched by B, and vice versa (already
      // shown by the realpath assertions above resolving to two different
      // directories rather than throwing or colliding).
      expect(existsSync(path.join(userDataA, 'Local Storage'))).toBe(true);
    } finally {
      killTree(childA);
    }
  }, 40_000);

  /**
   * `VAM_USER_DATA_DIR` ISOLATES STORAGE, NOT THE REMOTE ENDPOINT.
   *
   * `src/main/index.ts` starts `startRemoteTransport()` unconditionally on
   * every launch, fixture or not, and `remote/launch.ts`'s own header
   * explains why it defaults to `DEFAULT_REMOTE_PORT` (58217) rather than
   * refusing to listen: a packaged app launched from Finder has no shell to
   * set `VAM_REMOTE_PORT` in. That default is exactly what the operator's
   * own, already-running `vam.app` binds on the same machine -- and unlike
   * `userData`, nothing about a fresh profile touches it.
   *
   * Every call this suite makes itself passes `VAM_REMOTE_PORT` explicitly
   * (`freePort()`, above) -- but a probe run directly, the way this bug was
   * actually found, does not go through this file at all, and used to fall
   * straight through to the default. This spawns exactly that: no
   * `VAM_REMOTE_PORT`, a decoy already holding 58217 (standing in for the
   * operator's live app, or simply IS it, if one happens to be running),
   * and asserts the probe never even tries that port -- `main.ts` itself
   * (via `test/electron/free-port.cjs`, the probes' own guard) must pick a
   * throwaway one before `require`-ing main, exactly as this file's own
   * `freePort()` does for every OTHER launch here.
   */
  it('never lets the remote endpoint default to the operator’s own live port, even when the caller forgets VAM_REMOTE_PORT', async () => {
    let decoy: ReturnType<typeof createServer> | null = createServer();
    const decoyIsBorrowed = await new Promise<boolean>((resolve, reject) => {
      decoy?.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          // Already taken -- almost certainly the operator's own real app.
          // Either way the port is spoken for, which is all this test needs.
          decoy = null;
          resolve(true);
        } else {
          reject(error);
        }
      });
      decoy?.listen(DEFAULT_REMOTE_PORT, '127.0.0.1', () => resolve(false));
    });
    try {
      const override = scratchDir('vam-override-remote-');
      // VAM_REMOTE_PORT DELIBERATELY OMITTED.
      const run = await waitForExit(spawnProbe({ VAM_USER_DATA_DIR: override }));
      expect(`${run.code} ${run.stderr}`).toBe(`0 ${run.stderr}`);
      expect(run.stderr).not.toContain(`could not bind port ${DEFAULT_REMOTE_PORT}`);
    } finally {
      if (!decoyIsBorrowed) {
        decoy?.close();
      }
    }
  }, 40_000);

  // THE TMUX ISOLATION, PROVEN AT RUNTIME -- see `launch.test.ts`'s identical
  // assertion for the full rationale. Defined LAST so it reads the default
  // server only after every launch above (three Electron processes across
  // the three tests in this describe, one of them killed with `SIGKILL`) has
  // already run and exited -- vitest runs a describe's own tests in
  // definition order, so this genuinely reads AFTER them, not merely appears
  // to.
  (tmuxAvailable() ? it : it.skip)(
    'never lets any of this file’s launches reach the operator’s real default tmux server',
    () => {
      // DIAGNOSTICS ON FAILURE ONLY -- see `launch.test.ts`'s identical
      // wrap for the full rationale (CI evidence, PR #548 run 36399341676).
      try {
        assertNoNewSessionUnderOnDefaultServer({
          before: defaultServerBefore,
          after: defaultServerPaneCwds(),
          watchDir: repoRoot,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${message}\n\n--- DIAGNOSTICS ---\n${describeDefaultServerLeak(repoRoot)}`,
        );
      }
      expect(() => isolatedServerSessionCount(tmuxTmpdir)).not.toThrow();
    },
  );
});
