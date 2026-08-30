/**
 * AC-10 (client-side) — the canvas refetches on `hello` alone, with no
 * masking `change` frame, because black-smith stays up and its fingerprint
 * cache is warm.
 * (`factory/specs/active/vam-acg1-discriminating-ac10/epic.md`, sections 3
 * and 4, in the black-smith repo. Full rationale, honest limits and both
 * `--list` outputs: `e2e/README.md`.)
 *
 * ADDS TO, DOES NOT SUBSUME, e2e/sse-drop.spec.ts (AC-G1). AC-G1 restarts
 * BLACK-SMITH; a fresh process's cold cache manufactures a masking `change`
 * on reconnect, so AC-G1 passes even with `onHello` deleted from
 * `src/adapter/useCanvas.ts:113` (finding
 * f-vam-sse-canvas/integration-424bca70). This spec keeps black-smith up and
 * drops the TRANSPORT (vite) instead, against an already-warm cache, so the
 * masking frame never forms — the canvas can then only learn about the
 * session written during the outage through `onHello`'s own refetch.
 *
 * WHY VITE, NOT BLACK-SMITH (epic.md 3.2, e2e/sse-drop.spec.ts:9-20): a dead
 * black-smith is FATAL for `EventSource` through vite's proxy (502); a dead
 * vite is a bare TCP refusal, which is not — the browser retries
 * indefinitely at ~3.00s. Connection-refused console noise during the
 * outage is therefore expected, not a failure.
 *
 * WHY ITS OWN CONFIG (epic.md 3.3): a test cannot kill a `webServer`
 * Playwright manages, so this spec spawns/kills its own vite (port 5274)
 * under e2e/playwright.reconnect.config.ts, whose `testMatch: '**\/*.pw.ts'`
 * — with this file's own `.pw.ts` name — keeps it and the AC-G1 config from
 * collecting each other's spec (AC-9).
 *
 * Every machine-specific path is an environment variable; unset, this test
 * skips rather than false-passing.
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

// A frame recorded on stream A, the harness's own direct SSE client — never
// evaluated in the page, so it carries no `readyState`.
type StreamAFrame = {
  readonly event: string;
  readonly tMs: number;
  readonly detail?: unknown;
};

const CLI_ENTRY_VAR = 'SMITH_CLI_ENTRY';
const STATE_DIR_VAR = 'SMITH_E2E_STATE_DIR';
// The port black-smith's server binds. Stream A hits it directly; the page
// reaches it through vite's own proxy (vite.config.ts's `VAM_SMITH_URL`
// default), so this must match that default unless VAM_SMITH_URL is also
// set — see e2e/README.md.
const PORT_VAR = 'SMITH_E2E_PORT';

const cliEntry = process.env[CLI_ENTRY_VAR];
const stateDirRoot = process.env[STATE_DIR_VAR];
const portRaw = process.env[PORT_VAR];

const VITE_PORT = 5274;

function runId(): string {
  return `e2e-acg10-reconnect-${Date.now()}`;
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

// `vite preview`, not the dev server: the dev client's own HMR websocket
// reconnect forces `location.reload()`, which would reset this harness's
// page-side instrumentation exactly when the test needs it to persist. See
// e2e/README.md for the full reasoning.
function buildOnce(repoRoot: string): void {
  execFileSync('node_modules/.bin/vite', ['build'], { cwd: repoRoot, stdio: 'pipe' });
}

function startVite(repoRoot: string, port: number): ChildProcessWithoutNullStreams {
  return spawn('node_modules/.bin/vite', ['preview', '--port', String(port), '--strictPort'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

// `fromIndex` is the whole point: `__sseEvents` accumulates for the life of
// the page, so a post-reconnect wait that searches the whole array is
// satisfied by the `open`/`hello` recorded at page load and measures
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

test('a client reconnecting to a warm server refetches on hello alone (AC-10, client half)', async ({ page }) => {
  test.skip(!cliEntry, `${CLI_ENTRY_VAR} is not set — see e2e/README.md`);
  test.skip(!stateDirRoot, `${STATE_DIR_VAR} is not set — see e2e/README.md`);
  test.skip(!portRaw, `${PORT_VAR} is not set — see e2e/README.md`);
  test.setTimeout(120_000);

  const cli = cliEntry as string;
  const stateDir = stateDirRoot as string;
  mkdirSync(stateDir, { recursive: true });
  const dbPath = path.join(stateDir, 'e2e.db');
  const port = Number(portRaw);
  const repoRoot = path.resolve(__dirname, '..');
  const t0 = Date.now();

  const id = runId();
  const sessionA = `${id}-a`;
  const sessionB = `${id}-b`;

  appendEvent(id, cli, stateDir, {
    session_id: sessionA,
    actor: 'e2e-tester',
    event_type: 'session-start',
    plan_version: 1,
    causal_parent: null,
    payload: {},
  });

  const blackSmith = startServer(cli, stateDir, dbPath, port);
  // `vite` is declared here, before the protected region opens, so the
  // `finally` below can reach it even when the throw that triggers teardown
  // happens before `startVite` ever runs (in which case it stays undefined
  // and the guarded kill below is a no-op).
  let vite: ChildProcessWithoutNullStreams | undefined;

  // Stream A: a real second SSE client of /api/stream, `fetch`-based (no
  // new dependency, no auto-retry — see the stream-A rationale below).
  // Declared here, outside the `try`, because `finally` needs to reach
  // them for cleanup regardless of where inside the protected region a
  // throw happens; none of these declarations themselves spawn a process
  // or can throw synchronously.
  const streamAController = new AbortController();
  const streamAFrames: StreamAFrame[] = [];
  const streamAState = { tornDown: false, endedUnexpectedly: false, erroredUnexpectedly: false, reopened: false };
  let streamAOpened = false;

  function parseSseChunk(raw: string): StreamAFrame | null {
    if (raw.startsWith(':')) return null; // heartbeat comment (sse.ts:157)
    let event = 'message';
    let dataRaw = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) dataRaw = line.slice('data:'.length).trim();
    }
    if (!dataRaw) return null;
    let detail: unknown;
    try {
      detail = JSON.parse(dataRaw);
    } catch {
      detail = dataRaw;
    }
    return { event, tMs: Date.now() - t0, detail };
  }

  async function readStreamA(): Promise<void> {
    if (streamAOpened) streamAState.reopened = true;
    streamAOpened = true;
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${port}/api/stream`, { signal: streamAController.signal });
    } catch (err) {
      if (!streamAState.tornDown) streamAState.erroredUnexpectedly = true;
      throw err;
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          if (!streamAState.tornDown) streamAState.endedUnexpectedly = true;
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const frame = parseSseChunk(buffer.slice(0, idx));
          if (frame) streamAFrames.push(frame);
          buffer = buffer.slice(idx + 2);
          idx = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      if (!streamAState.tornDown && !streamAController.signal.aborted) streamAState.erroredUnexpectedly = true;
      throw err;
    }
  }

  async function waitForStreamAFrame(predicate: (f: StreamAFrame) => boolean, timeoutMs: number): Promise<StreamAFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = streamAFrames.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out after ${timeoutMs}ms waiting for a matching stream A frame; recorded so far: ${JSON.stringify(streamAFrames)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // `streamAReading` is likewise declared outside `try` (assigned inside)
  // so `finally` can always await it, even if it was never started.
  let streamAReading: Promise<void> | undefined;

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, 15_000);

    // WHY STREAM A EXISTS: subscribing keeps black-smith's
    // `changeFeed.ts:143-169` watcher and floor timer armed — `listeners.size`
    // gates both, arming at 1 and disarming at 0. Without stream A holding
    // `listeners.size >= 1` through the outage, session B would never be
    // projected while vite is down, and the test would collapse back into the
    // confound this epic removes.
    streamAReading = readStreamA();

    // Proof black-smith accepted stream A and armed the watcher.
    await waitForStreamAFrame((f) => f.event === 'hello', 5_000);

    buildOnce(repoRoot);
    vite = startVite(repoRoot, VITE_PORT);
    await waitForHealth(`http://127.0.0.1:${VITE_PORT}/`, 15_000);

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
    await waitForTuple(page, (t) => t.event === 'open', 5_000);
    await waitForTuple(page, (t) => t.event === 'hello', 5_000);

    // AC-2's window starts here, before vite dies (same discipline as
    // e2e/sse-drop.spec.ts's own watermark).
    const watermark = await page.evaluate(() => (window as unknown as { __sseEvents: SseTuple[] }).__sseEvents.length);
    const streamAWatermark = streamAFrames.length;

    // (2) Drop the TRANSPORT, not black-smith. SIGKILL, not the default
    // signal: `vite preview`'s graceful shutdown waits for the page's
    // long-lived SSE connection to drain, which it never does, so a plain
    // `.kill()` would never actually sever the socket (see e2e/README.md).
    vite.kill('SIGKILL');

    // (3) Write session B while vite is down. The still-armed watcher
    // projects B and caches its fingerprint — captured on stream A as the
    // positive control (AC-4).
    appendEvent(id, cli, stateDir, {
      session_id: sessionB,
      actor: 'e2e-tester',
      event_type: 'session-start',
      plan_version: 1,
      causal_parent: null,
      payload: {},
    });
    const positiveControl = await waitForStreamAFrame(
      (f) =>
        f.event === 'change' &&
        Array.isArray((f.detail as { sessions?: unknown })?.sessions) &&
        (f.detail as { sessions: string[] }).sessions.includes(sessionB),
      10_000,
    );
    expect(positiveControl).toBeTruthy();

    // (4) Vite returns. Black-smith's onConnect refresh finds B's
    // fingerprint already cached (epic.md 3.4's precondition), so no
    // `change` reaches the page.
    vite = startVite(repoRoot, VITE_PORT);
    await waitForHealth(`http://127.0.0.1:${VITE_PORT}/`, 15_000);

    // Browser reconnect is a constant ~3.00s (no `retry:` field); sized
    // with slack for a slow-but-correct vite restart.
    await waitForTuple(page, (t) => t.event === 'open', 15_000, watermark);
    const postReconnectHello = await waitForTuple(page, (t) => t.event === 'hello', 10_000, watermark);

    // AC-1 supporting check: liveness AT THIS INSTANT ONLY — corroboration,
    // never the evidence black-smith "never died" (that is stream A, below).
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.ok).toBe(true);

    // AC-2, broadened beyond its literal wording ("no `change` tuple naming
    // session B"): `src/adapter/useCanvas.ts` refetches on ANY well-formed
    // `change`, whatever session it names — its own comment says `sessions`
    // is never read on change, since an ended session must still refetch
    // (§5.4). So a `change` naming only session A in the reconnect window
    // would pass a check narrowed to session B while still masking `onHello`
    // (the exact failure mode that made the earlier AC-G1 test
    // non-discriminating). A check that exceeds its literal criterion still
    // satisfies it — do not narrow this back to session B only.
    //
    // Anchored at the post-reconnect `hello`, not the pre-kill watermark: a
    // legitimate `change` naming session A can land between the watermark
    // and the kill on a slower machine, and anchoring at the watermark would
    // make this flaky.
    const tuplesSoFar = (await page.evaluate(() => (window as unknown as { __sseEvents: SseTuple[] }).__sseEvents)) as SseTuple[];
    // `postReconnectHello` crossed the page.evaluate wire once already (in
    // `waitForTuple`), so it is not reference-equal to its counterpart in
    // this fresh snapshot — match on `tMs`, which `__sseEvents` stamps once
    // per recorded event and never mutates.
    const helloIndex = tuplesSoFar.findIndex((t) => t.event === 'hello' && t.tMs === postReconnectHello.tMs);
    const maskingChange = tuplesSoFar.slice(helloIndex + 1).find((t) => t.event === 'change');
    expect(maskingChange, `a change frame arrived after the post-reconnect hello: ${JSON.stringify(maskingChange)}`).toBeUndefined();

    // (5) Session identity only, never layout or node counts (AC-G1's own
    // discipline).
    const sessionBRowSelector = `[data-session-row="${sessionB}"]`;
    await expect(page.locator(sessionBRowSelector)).toBeVisible({ timeout: 10_000 });

    // AC-1: stream A recorded EXACTLY ONE `hello` for the whole run
    // (sse.ts:138 — a restarted black-smith cannot deliver the same
    // connection twice), and its body never ended, errored or re-opened.
    const streamAHelloCount = streamAFrames.filter((f) => f.event === 'hello').length;
    expect(streamAHelloCount, `stream A hello count: ${JSON.stringify(streamAFrames)}`).toBe(1);
    expect(streamAState.endedUnexpectedly, 'stream A body ended before teardown').toBe(false);
    expect(streamAState.erroredUnexpectedly, 'stream A errored before teardown').toBe(false);
    expect(streamAState.reopened, 'stream A was re-opened during the run').toBe(false);

    const canvasTMs = await page.evaluate(() => Date.now() - (window as unknown as { __t0: number }).__t0);
    const canvas = { selector: sessionBRowSelector, visible: true, tMs: canvasTMs };
    const allTuples = (await page.evaluate(() => (window as unknown as { __sseEvents: SseTuple[] }).__sseEvents)) as SseTuple[];

    const { version: playwrightVersion } = require('@playwright/test/package.json') as { version: string };
    const shaOf = (cwd: string): string => {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim();
      const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd })
        .toString()
        .trim();
      return dirty === '' ? head : `${head}-dirty`;
    };
    const vamSha = shaOf(repoRoot);
    const blackSmithRoot = path.resolve(path.dirname(cli), '..', '..', '..');
    const blackSmithSha = shaOf(blackSmithRoot);

    writeFileSync(
      path.join(__dirname, 'acg10-reconnect-transcript.json'),
      `${JSON.stringify(
        {
          runnerCommand: 'e2e/node_modules/.bin/playwright test --config=e2e/playwright.reconnect.config.ts',
          playwrightVersion,
          vamSha,
          blackSmithSha,
          capturedAt: new Date().toISOString(),
          sessionA,
          sessionB,
          tuples: allTuples,
          canvas,
          streamA: {
            helloCount: streamAHelloCount,
            frames: streamAFrames,
            watermarkIndex: streamAWatermark,
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    // Set BEFORE aborting stream A: this teardown must never be mistaken for
    // the mid-run end-of-body / re-open failure AC-1 forbids.
    streamAState.tornDown = true;
    streamAController.abort();
    // Guarded: a throw before `readStreamA` ran (e.g. the black-smith
    // health check itself failing) leaves `streamAReading` undefined.
    await streamAReading?.catch(() => {});
    // Guarded: a throw before `startVite` ran (e.g. a dead black-smith
    // health check, or `buildOnce` failing) leaves `vite` undefined — there
    // is nothing to kill.
    vite?.kill('SIGKILL');
    blackSmith.kill('SIGKILL');
  }
});
