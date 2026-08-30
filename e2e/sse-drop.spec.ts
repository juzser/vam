/**
 * AC-G1 — the drop reaches the client, through vam's OWN vite dev proxy.
 * (`factory/specs/active/vam-sse-canvas/epic.md`, section 3.4 and AC-G1, in
 * the black-smith repo.)
 *
 * WHAT THIS CAN SHOW: on this machine, through vam's own `vite` dev proxy
 * (`vite.config.ts`, target `VAM_SMITH_URL` or its own default,
 * `changeOrigin: false`), a black-smith process that is killed surfaces at
 * the browser as an `error` event, and once the process is back the browser's
 * own reconnect surfaces `open` then `hello`. On the path this spec drives —
 * kill, then restart inside the browser's single retry — no tuple carries
 * `readyState` 2 (CLOSED), and the canvas then shows, with no reload, the
 * session that changed while the server was down. That is scoped to this
 * path, not general: with the server NOT restarted, the browser gives up —
 * one retry at ~3.7s, an `error` with `readyState` 2, and no further
 * attempt — because vite answers a dead upstream with `GET /api/stream` ->
 * `HTTP/1.1 502 Bad Gateway`, `Content-Type: text/plain`, and the HTML
 * specification makes a non-200/non-`text/event-stream` response fatal for
 * `EventSource`. This epic's own negative control records exactly that:
 * `state/artifacts/vam-sse-canvas/task-4-acg1-e2e/falsification-no-restart.txt`.
 *
 * WHAT THIS CANNOT SHOW: `kill()` closes the TCP socket cleanly, which is the
 * EASY case for a proxy to propagate. It says nothing about a half-open
 * connection — the silent stall epic.md section 3.4 records, where a proxy
 * failed to forward an upstream close and the browser never saw an `error`
 * at all. It also says nothing about a production host with no proxy.
 * `vite.config.ts:22` declares one `const proxy` object referenced by BOTH
 * `server.proxy` and `preview.proxy`, so `vite preview` shares the same
 * `configure` hook and the same fix — but no run here has exercised preview,
 * only that the code path is shared; a future edit that splits that shared
 * object into two literals would drop the hook from one of them with
 * nothing in this repo to catch it.
 *
 * THE COST THIS ADDS: a pinned Playwright harness fetched at run time and a
 * headless Chromium download (near-zero on a machine with
 * `~/Library/Caches/ms-playwright` already populated, ~100MB on a fresh
 * clone), plus this `e2e/` directory itself — `vitest.config.ts`,
 * `tsconfig*.json` and `biome.json` all deliberately exclude it (see
 * `e2e/README.md`), so nothing in vam's own gates will ever tell a future
 * change that this spec has rotted. Re-run it by hand after any change to
 * the SSE wire contract, the vite proxy, or `src/adapter/**`.
 *
 * Every machine-specific path is read from an environment variable; see
 * `e2e/README.md`. Unset, the test skips rather than false-passing.
 */

import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SseTuple = {
  readonly event: 'open' | 'error' | 'hello' | 'change';
  readonly readyState: number;
  readonly tMs: number;
  readonly detail?: unknown;
};

const CLI_ENTRY_VAR = 'SMITH_CLI_ENTRY';
const STATE_DIR_VAR = 'SMITH_E2E_STATE_DIR';
// The port black-smith's server binds and vam's vite proxy forwards to (its
// own default, see vite.config.ts). Read from the environment, never
// hardcoded here, so this file cannot be mistaken for one that addresses
// black-smith's port directly instead of going through the proxy.
const PORT_VAR = 'SMITH_E2E_PORT';

const cliEntry = process.env[CLI_ENTRY_VAR];
const stateDirRoot = process.env[STATE_DIR_VAR];
const portRaw = process.env[PORT_VAR];

function runId(): string {
  return `e2e-acg1-${Date.now()}`;
}

function appendEvent(entry: string, cli: string, stateDir: string, event: Record<string, unknown>): void {
  execFileSync(process.execPath, [cli, 'event', 'append', JSON.stringify(event), '--state-dir', stateDir], {
    stdio: 'pipe',
  });
  void entry;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`server did not become healthy within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function startServer(cli: string, stateDir: string, dbPath: string, port: number): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [cli, 'ui', 'serve', '--port', String(port), '--state-dir', stateDir, '--db', dbPath], {
    stdio: 'pipe',
  });
}

// `fromIndex` is the whole point of this helper: `__sseEvents` accumulates for
// the life of the page, so a post-reconnect wait that searches the whole array
// is satisfied by the `open`/`hello` recorded at page load and measures
// nothing. Callers past the drop pass a watermark taken before it.
async function waitForTuple(
  page: import('@playwright/test').Page,
  predicate: (t: SseTuple) => boolean,
  timeoutMs: number,
  fromIndex = 0,
): Promise<SseTuple> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = (await page.evaluate(() => (window as unknown as { __sseEvents: SseTuple[] }).__sseEvents)) ?? [];
    const found = events.slice(fromIndex).find(predicate);
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for a matching SSE tuple at or after index ${fromIndex}; recorded so far: ${JSON.stringify(events)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('the drop reaches the client through vam\'s own vite proxy (AC-G1)', async ({ page }) => {
  test.skip(!cliEntry, `${CLI_ENTRY_VAR} is not set — see e2e/README.md`);
  test.skip(!stateDirRoot, `${STATE_DIR_VAR} is not set — see e2e/README.md`);
  test.skip(!portRaw, `${PORT_VAR} is not set — see e2e/README.md`);
  // Two 15s health waits plus a 30s + 10s reconnect window exceed 60s in the
  // worst case, so the old 60s cap could have expired on a slow-but-correct
  // run. Observed on this machine the whole test takes ~5s.
  test.setTimeout(120_000);

  const cli = cliEntry as string;
  const stateDir = stateDirRoot as string;
  mkdirSync(stateDir, { recursive: true });
  const dbPath = path.join(stateDir, 'e2e.db');
  const port = Number(portRaw);

  const id = runId();
  const sessionA = `${id}-a`;
  const sessionB = `${id}-b`;

  // A session present before the browser ever connects, so step (b) has
  // something real to name.
  appendEvent(id, cli, stateDir, {
    session_id: sessionA,
    actor: 'e2e-tester',
    event_type: 'session-start',
    plan_version: 1,
    causal_parent: null,
    payload: {},
  });

  let server = startServer(cli, stateDir, dbPath, port);
  await waitForHealth(`http://127.0.0.1:${port}/api/health`, 15_000);

  // Instrument the SAME EventSource the app opens (src/adapter/stream.ts's
  // default `new EventSource('/api/stream')`) by wrapping the constructor
  // before any page script runs. No app code is touched.
  await page.addInitScript(() => {
    const w = window as unknown as { __t0: number; __sseEvents: SseTuple[] };
    w.__t0 = Date.now();
    w.__sseEvents = [];
    const Native = window.EventSource;
    // biome-ignore-file: this init script runs in the page, not through vam's lint config.
    window.EventSource = new Proxy(Native, {
      construct(target, args: ConstructorParameters<typeof EventSource>) {
        const es = new target(...args);
        const record = (name: SseTuple['event']) => (ev: Event) => {
          let detail: unknown;
          const data = (ev as MessageEvent<string>).data;
          if (typeof data === 'string') {
            try {
              detail = JSON.parse(data);
            } catch {
              detail = undefined;
            }
          }
          w.__sseEvents.push({
            event: name,
            readyState: es.readyState,
            tMs: Date.now() - w.__t0,
            ...(detail !== undefined ? { detail } : {}),
          });
        };
        es.addEventListener('open', record('open'));
        es.addEventListener('error', record('error'));
        es.addEventListener('hello', record('hello'));
        es.addEventListener('change', record('change'));
        return es;
      },
    });
  });

  await page.goto('/');

  // (a) open then hello within 2000ms of page load.
  await waitForTuple(page, (t) => t.event === 'open', 2_000);
  await waitForTuple(page, (t) => t.event === 'hello', 2_000);

  // (b) a real server-side write, not a poke at vam, produces a `change`
  // naming the session within 2000ms.
  appendEvent(id, cli, stateDir, {
    session_id: sessionA,
    actor: 'e2e-tester',
    event_type: 'operator-note',
    plan_version: 1,
    causal_parent: `${sessionA}#0`,
    payload: { note: 'acg1 probe' },
  });
  const changeTuple = await waitForTuple(
    page,
    (t) => t.event === 'change' && Array.isArray((t.detail as { sessions?: unknown })?.sessions) && (t.detail as { sessions: string[] }).sessions.includes(sessionA),
    2_000,
  );
  expect(changeTuple).toBeTruthy();

  // (c) kill the server. While it is down, a second session's frame lands in
  // the log with nobody holding the socket — the exact case section 3.2 says
  // is gone for good unless the client refetches on reconnect (AC-10).
  server.kill('SIGKILL');
  await waitForTuple(page, (t) => t.event === 'error', 10_000);

  // Everything already recorded is pre-drop evidence. The post-restart waits
  // below may only be satisfied by tuples recorded after this line.
  const watermark = await page.evaluate(() => (window as unknown as { __sseEvents: SseTuple[] }).__sseEvents.length);

  appendEvent(id, cli, stateDir, {
    session_id: sessionB,
    actor: 'e2e-tester',
    event_type: 'session-start',
    plan_version: 1,
    causal_parent: null,
    payload: {},
  });

  server = startServer(cli, stateDir, dbPath, port);
  await waitForHealth(`http://127.0.0.1:${port}/api/health`, 15_000);

  // The server sends no `retry:` field (epic.md section 3.2); the browser's
  // own default reconnect governs, measured at a constant 3.00s with no
  // backoff. These windows are not sized for that reconnect — they are sized
  // for the SERVER RESTART: `startServer` plus `waitForHealth` above already
  // spent up to 15s, and `waitForTuple` here budgets the same 15s twice more
  // (30_000 covers `open` after `waitForHealth`'s own retries; 10_000 covers
  // `hello` right behind it) so a slow-but-correct restart still passes.
  await waitForTuple(page, (t) => t.event === 'open', 30_000, watermark);
  await waitForTuple(page, (t) => t.event === 'hello', 10_000, watermark);

  // (d) the session that changed while the server was down is now visible,
  // with no reload — AC-10 measured against a real server. Session identity
  // (`data-session-row`, `src/panels/SessionList.tsx`), never layout or node
  // counts: a sibling epic is free to redraw the canvas around this session
  // list without invalidating this assertion.
  const sessionBRowSelector = `[data-session-row="${sessionB}"]`;
  await expect(page.locator(sessionBRowSelector)).toBeVisible({ timeout: 10_000 });

  // Sampled only now, after the recovery assertion: a transcript captured
  // before step (d) is a snapshot of the pre-reconnect state and is silent
  // about the very property AC-G1 exists to record.
  const allTuples = (await page.evaluate(() => (window as unknown as { __sseEvents: SseTuple[] }).__sseEvents)) as SseTuple[];
  expect(allTuples.some((t) => t.readyState === 2)).toBe(false);

  // Same locator, same passing assertion, recorded rather than discarded:
  // the transcript's own (d), so a second operator can adjudicate AC-G1 from
  // the committed file instead of a run nobody can re-read.
  const canvasTMs = await page.evaluate(() => Date.now() - (window as unknown as { __t0: number }).__t0);
  const canvas = { selector: sessionBRowSelector, visible: true, tMs: canvasTMs };

  server.kill('SIGKILL');

  const { version: playwrightVersion } = require('@playwright/test/package.json') as { version: string };
  const vamSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '..') }).toString().trim();
  const blackSmithRoot = path.resolve(path.dirname(cli), '..', '..', '..');
  const blackSmithSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: blackSmithRoot }).toString().trim();

  writeFileSync(
    path.join(__dirname, 'acg1-transcript.json'),
    `${JSON.stringify(
      {
        runnerCommand: 'npx @playwright/test@1.62.1 test --config=e2e/playwright.config.ts',
        playwrightVersion,
        vamSha,
        blackSmithSha,
        capturedAt: new Date().toISOString(),
        sessionA,
        sessionB,
        tuples: allTuples,
        canvas,
      },
      null,
      2,
    )}\n`,
  );
});
