/**
 * Settings -> Update, under the real Electron shell: the one guard proving
 * the section survives its own real launch (real bridge, real preload, real
 * `checkForUpdate` GET) rather than only the mocked bridge `test/settings/
 * update-panel.test.tsx` drives and the mocked network `test/update/
 * check.test.ts` drives -- neither of those two can see a page error, a
 * tripped `ErrorBoundary`, or a genuinely dead renderer, because neither of
 * them runs Electron at all.
 *
 * THE BUG THIS GUARDS: `checkForUpdate` had no timeout on its one outbound
 * `fetch`, so a connection that neither refuses nor answers (a captive
 * portal, a firewall dropping packets instead of resetting the socket) left
 * `UpdatePanel.tsx`'s button disabled and reading "checking…" forever --
 * `test/update/check.test.ts`'s own new case pins that at the unit level,
 * with an injected fetcher; this file is the same claim at the level an
 * operator actually meets it, over the real preload bridge and the real
 * network this machine has.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const probePath = path.join('test', 'electron', 'settings-update-probe.cjs');

interface Result {
  readonly versionText: string | null;
  readonly outcomeText: string | null;
  readonly checkButtonState: { disabled: boolean; ariaBusy: string | null; text: string } | null;
  readonly renderFailureText: string | null;
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly renderProcessGone: unknown;
}

interface ProbeRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly result: Result | null;
}

/** A genuinely free loopback port, never the operator's own remote-serve
 *  port -- the same discipline every probe in this directory follows. */
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

/**
 * Resolves the moment the probe has PRINTED its answer, rather than waiting
 * for the Electron process to fully exit -- `app.exit(0)`'s own cleanup can
 * take far longer than the work this probe actually did to reach that line,
 * on a machine busy running other work at the same time (measured: the exact
 * same probe, unmodified, took anywhere from under a second to well past 40s
 * to close on a loaded box). What this test is FOR -- did Settings -> Update
 * crash, log a page error, or leave the button stuck -- is already answered
 * the instant the line appears; a slow-to-close child process afterwards is
 * `app.exit`'s own concern, not this section's.
 */
function runProbe(userDataDir: string, remotePort: number, tmuxTmpdir: string): Promise<ProbeRun> {
  return new Promise((resolve, reject) => {
    // ITS OWN PROCESS GROUP, so `killTree` below reaches Electron's helpers
    // (GPU, renderer, network service) too. SIGKILL on the main process alone
    // left them running and still writing into `userDataDir`, and the teardown
    // `rmSync` then failed with ENOTEMPTY on CI.
    const child = spawn(bin('electron'), [probePath], {
      cwd: repoRoot,
      detached: true,
      env: isolatedTmuxEnv(
        {
          ...process.env,
          // A session, and therefore the sidebar's settings gear -- the same
          // fixture `launch.test.ts` uses, for the same reason.
          VAM_FIXTURE_SOURCE: '1',
          VAM_USER_DATA_DIR: userDataDir,
          VAM_REMOTE_PORT: String(remotePort),
        },
        tmuxTmpdir,
      ),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const killTree = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone -- the group has no members left to signal.
      }
    };
    const finish = (run: ProbeRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // The answer is in; the whole process tree goes, and this resolves only
      // once the main process has closed, so nothing is still writing into
      // `userDataDir` when `afterAll` removes it.
      killTree();
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(run);
        return;
      }
      child.once('close', () => resolve(run));
    };
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (settled) return;
      const line = stdout.split('\n').find((l) => l.startsWith('VAM_SETTINGS_UPDATE_RESULT '));
      if (line !== undefined) {
        finish({
          code: 0,
          stdout,
          stderr,
          result: JSON.parse(line.slice('VAM_SETTINGS_UPDATE_RESULT '.length)) as Result,
        });
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree();
      reject(
        new Error(
          `settings-update-probe printed no result within 90s\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 90_000);
    child.on('error', reject);
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('VAM_SETTINGS_UPDATE_RESULT '));
      finish({
        code,
        stdout,
        stderr,
        result:
          line === undefined
            ? null
            : (JSON.parse(line.slice('VAM_SETTINGS_UPDATE_RESULT '.length)) as Result),
      });
    });
  });
}

describe('Settings -> Update, under the real shell', () => {
  let userDataDir: string;
  let tmuxTmpdir: string;
  let defaultServerBefore: readonly string[];

  beforeAll(() => {
    // Built ONCE for the whole run by `vitest.app.config.ts`'s globalSetup
    // (`test/electron/global-build.ts`) -- never per file, see its header.
    userDataDir = mkdtempSync(path.join(tmpdir(), 'vam-settings-update-userdata-'));
    tmuxTmpdir = mkIsolatedTmuxTmpdir('vam-settings-update-tmux');
    // READ-ONLY, before this describe's isolated Electron process exists at
    // all -- see `test/electron/launch.test.ts`'s own note on the identical
    // pair. This probe is the one killed with `SIGKILL` (`runProbe`'s own
    // header) rather than allowed to quit gracefully, so any control-mode
    // tmux connection it made would NOT be disposed by the app's own
    // `before-quit` handling -- exactly the shape most likely to leave a
    // session sitting on whatever server it reached, which is why this
    // describe carries its own before/after pair rather than relying on
    // `launch.test.ts`'s alone.
    defaultServerBefore = tmuxAvailable() ? defaultServerPaneCwds() : [];
  }, 180_000);

  afterAll(() => {
    if (userDataDir !== undefined) {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    if (tmuxTmpdir !== undefined) {
      killIsolatedServer(tmuxTmpdir);
      rmSync(tmuxTmpdir, { recursive: true, force: true });
    }
  });

  // A generous per-test budget (the third argument, below) on top of the
  // global 60s `vitest.app.config.ts` sets: this probe's own worst-case
  // internal waits (a 30s cold-start window, several 5s selector waits, up to
  // a 12s check-outcome wait) can stack past that default on a machine
  // already busy running other work, measured directly rather than assumed.
  it('opens, reaches the Update card, checks for an update, and never crashes', async () => {
    const remotePort = await freePort();
    const run = await runProbe(userDataDir, remotePort, tmuxTmpdir);
    expect(`${run.code} ${run.stderr}`).toBe(`0 ${run.stderr}`);
    expect(
      run.result,
      `no VAM_SETTINGS_UPDATE_RESULT line.\nstderr:\n${run.stderr}`,
    ).not.toBeNull();
    const result = run.result as Result;

    // THE VERSION IS UNCONDITIONAL -- reached the card at all.
    expect(result.versionText).toContain('0.1.0');

    // NEVER A TRIPPED ERROR BOUNDARY.
    expect(result.renderFailureText).toBeNull();

    // NEVER A DEAD RENDERER.
    expect(result.renderProcessGone).toBeNull();

    // NEVER A PAGE ERROR OR AN UNHANDLED REJECTION -- the exact two routes a
    // render throw or a rejected promise reach the page by.
    expect(result.pageErrors).toEqual([]);

    // NEVER A DEVTOOLS CONSOLE ERROR from this run either.
    expect(result.consoleErrors).toEqual([]);

    // THE CHECK SETTLED -- a real GitHub round trip, or the bounded timeout
    // if this runner has none, but never left reading "checking…" forever
    // (the defect `UPDATE_CHECK_TIMEOUT_MS` exists to close).
    expect(
      result.outcomeText,
      `the check never settled within the probe's own wait -- button state: ${JSON.stringify(result.checkButtonState)}`,
    ).not.toBeNull();
    expect(result.checkButtonState?.disabled).toBe(false);
    expect(result.checkButtonState?.ariaBusy).toBe('false');

    // A SENTENCE, NEVER A RAW CODE OR A STACK.
    expect(result.outcomeText).not.toMatch(/^[a-z-]+$/);
    expect(result.outcomeText?.toLowerCase()).not.toContain('error:');
    expect(result.outcomeText).not.toMatch(/\bat\s+\S+:\d+:\d+/);

    // THE TMUX ISOLATION, PROVEN AT RUNTIME -- see `launch.test.ts`'s
    // identical assertion for the full rationale. This probe is killed with
    // `SIGKILL` above rather than quit gracefully, so it is the harness in
    // this repo most likely to leave an un-disposed tmux session behind --
    // exactly why this check belongs here and not only on a gracefully
    // exited launch.
    if (tmuxAvailable()) {
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
    }
  }, 100_000);
});
