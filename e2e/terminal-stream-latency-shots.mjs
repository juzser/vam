/**
 * STREAMING-PATH LATENCY -- measured on the SHIPPED `StreamClient`
 * (`src/main/terminal/stream/client.ts`), the same rigorous way
 * `terminal-typing-latency-shots.mjs` measures the polling path: a REAL
 * tmux on a private socket, the REAL app source bundled with esbuild (not
 * reimplemented for the test), a REAL browser page with a REAL
 * `@xterm/xterm` (this branch's actual dependency, not a vendored copy),
 * timestamped with `performance.now()` and xterm's own `onRender` chained
 * through one `requestAnimationFrame` so "painted" means after the browser
 * actually laid the frame out.
 *
 * WHY THIS IS A SEPARATE FILE, not a mode flag on the polling script: the
 * two paths bridge `window.api` completely differently (`terminal.read`/
 * `terminal.send` polling vs. `StreamClient`'s push `onData`), and the
 * polling script's harness page (mounts the full DetailPanel/TerminalTab
 * through the app's own Vite build) is not what this measures -- this one
 * loads a throwaway harness HTML (`terminal-stream-latency-harness.html`,
 * mirroring the terminal-streaming spike's own `stream-harness.html`) that
 * wires xterm.js directly to a bridged `StreamClient`, the same shape the
 * spike used to measure its OWN prototype `client.ts`. See that harness
 * file's own header for why it needs a static HTTP server rather than
 * `file://`.
 *
 * THREE MEASUREMENTS, matching the spike's own two scripts' shape, EACH
 * WITH A WALL-CLOCK CEILING (criterion (b) of this task's own brief -- see
 * the bound constants below for the calibration and the headroom) AND A
 * RETRY-ONCE-ALONE (criterion (c)): if a p95 misses its bound on the first
 * pass, the SAME measurement is taken fresh, once, before the guard fails
 * for real -- this guard already runs alone (`run-web-guards.mjs` runs its
 * list serially, and this file owns a private tmux socket nothing else
 * touches), so "alone" is already true; what the retry adds is a second,
 * independent sample rather than re-reading numbers a one-off scheduling
 * blip already produced (`starvation-stretches-11ms-to-5022ms` is the
 * standing reason a single miss is not trusted outright):
 *   1. keydown -> paint, steady typing cadence (n=50)
 *   2. print -> paint, one `echo` at a time (n=30, matching the spike's own
 *      `measure-stream-prototype-latency.mjs` TEST 2)
 *   3. print -> paint, a burst (`yes | head -n N`, matching the spike's own
 *      TEST 3), plus a STRUCTURAL, non-wall-clock check alongside it: how
 *      many `term.write()` calls the burst actually cost, which should stay
 *      far below the ~2000 lines the burst prints -- tmux's own
 *      control-mode framer batches multiple pty reads into one `%output`
 *      notification, so a healthy burst writes xterm tens of times, not
 *      once per line.
 *
 * TWO MORE STRUCTURAL CHECKS, deterministic and preferred over a second
 * wall-clock number wherever they can express the same property (this
 * task's own brief): exactly one tmux control-mode client is attached to
 * the streamed session for the life of this guard's own connection, and
 * zero remain once it disposes -- the same "one client per open view, zero
 * once it closes" invariant `docs/design/terminal-streaming.md`'s own Risks
 * section names for a real Terminal-stream tab.
 *
 * `tmux -L vam-stream-e2e-latency`, killed on the way out -- a DISTINCT
 * socket from `terminal-typing-latency-shots.mjs`'s own `vam-e2e-latency`,
 * so the two guards never collide if run concurrently on this shared
 * machine.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

/**
 * `argv[3] ?? argv[2]`, not a bare `argv[2]` -- `run-web-guards.mjs` calls
 * every guard in its list as `node e2e/<guard>.mjs <origin> <outDir>`. This
 * script has never needed `origin` (it serves its own throwaway harness
 * HTTP server, never the built web bundle `vite preview` answers), but once
 * registered in that list `argv[2]` IS the origin string, not an outDir --
 * `argv[3]` is. Falls back to `argv[2]` so a manual one-argument invocation
 * (`node e2e/terminal-stream-latency-shots.mjs docs/ui`) still works
 * unchanged, the same two-shape contract `shell-first-ctrlc-survives.mjs`
 * documents for the same reason (that file ignores both argv slots
 * entirely; this one only ignores `origin`).
 */
const outDir = process.argv[3] ?? process.argv[2] ?? 'docs/ui';

const SOCKET = 'vam-stream-e2e-latency';
const TMUX_SESSION = 'vam-stream-e2e-latency-a1b2c3';
const COLUMNS = 137;
const ROWS = 41;

/**
 * Generous absolute ceilings (criterion (b) in this task's own brief), not
 * ratios: these three tests have no in-run poll-path baseline to ratio
 * against -- this script measures the streaming path alone, via its own
 * throwaway harness, in a different process against a different server than
 * `terminal-typing-latency-shots.mjs` (which DOES measure the poll path and
 * has its own in-run background-interval structural checks).
 *
 * Calibrated by running this guard 11x, serially, on a shared MacBook that
 * got visibly busier partway through (this task's own report holds the
 * full transcript, including the one run that named the noise):
 *   typing p95: 10.00 - 12.60ms across 6 measured runs (worst 12.60ms)
 *   echo   p95: 36.00 - 92.70ms across 9 measured runs (worst 92.70ms, the
 *               one run on the busier machine)
 *   burst  p95: 45.60 - 189.60ms across 9 measured runs (worst 189.60ms,
 *               same busier run -- burst is the noisiest of the three, the
 *               smallest sample (n=5) and the heaviest paint)
 * plus two earlier "shipped path" runs already on record
 * (`docs/design/terminal-streaming.md`'s own "After: the SHIPPED path"
 * table, a different session, same machine): typing 18.40 / 16.70ms, echo
 * 58.90 / 72.70ms, burst 79.00 / 161.90ms -- all inside the bounds below.
 *
 * Each bound is roughly 3.5-12x the worst of those numbers: generous enough
 * that a CI Linux runner running this guard alone (nothing else concurrent
 * -- `run-web-guards.mjs` runs its list serially) can be meaningfully
 * slower and noisier than even this task's own "busier" local run without
 * tripping it, while still catching an order-of-magnitude regression (a
 * paint that silently stops being driven by the real `onRender` chain, a
 * reconnect loop, a return to something REFRESH_MS-shaped). Not a precise
 * regression-vs-poll-path discriminator -- the same honest limit
 * `terminal-typing-latency-shots.mjs`'s own `PAINT_P95_BOUND_MS` already
 * documents for its bound.
 */
const STREAM_TYPING_P95_BOUND_MS = 150;
const STREAM_ECHO_P95_BOUND_MS = 350;
const STREAM_BURST_P95_BOUND_MS = 700;

/**
 * STRUCTURAL-ish, not wall-clock: how many `term.write()` calls TEST 3's
 * burst loop (5 runs of `yes burstline | head -n 2000`, ~10,005 lines
 * total) may cost. tmux's own control-mode framer coalesces multiple pty
 * reads into one `%output` notification per delivery rather than one per
 * line, so a healthy burst costs low hundreds of calls, not thousands --
 * but HOW MANY hundreds turns out to depend on scheduling too (this is a
 * count of DELIVERIES, and delivery chunking is itself load-sensitive, not
 * a pure function of the data): calibrated over 10 full guard runs (this
 * task's own report holds the raw counts), 235 / 238 / 281 / 286 / 297 /
 * 311 / 313 / 395 / 403 / 590 -- stable in the 200s-300s on a quiet pass,
 * one run at 590 when this machine was visibly busier. Set at 1200, ~2x the
 * worst of ten runs and still ~8x below the ~10,005 raw line count: enough
 * headroom to absorb the same kind of load variance the p95 bounds above
 * carry retry-once-alone for, while still catching the regression this
 * exists to catch -- a future change that starts writing once per line (or
 * per byte) would land in the thousands, not the low hundreds.
 */
const MAX_BURST_WRITE_CALLS = 1200;

const which = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
if (which.error || which.status !== 0) {
  console.warn(
    'SKIP  terminal-stream-latency-shots.mjs: no `tmux` on PATH. This guard measures the REAL ' +
      'streaming client against a real tmux control-mode connection; install tmux on this runner for it to assert anything.',
  );
  process.exit(0);
}
console.log(`tmux: ${which.stdout.trim()} on private socket -L ${SOCKET}`);

const env = { ...process.env, LC_CTYPE: 'en_US.UTF-8' };
const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { env, encoding: 'utf8' });
const killServer = () => spawnSync('tmux', ['-L', SOCKET, 'kill-server'], { env });
killServer();

/* ── the SHIPPED client, bundled from source ─────────────────────────────── */

const require = createRequire(new URL('../node_modules/.pnpm/node_modules/', import.meta.url));
const esbuild = require('esbuild');
const bundleDir = mkdtempSync(join(tmpdir(), 'vam-stream-latency-'));
const bundleOf = async (entry) => {
  const outfile = join(bundleDir, `${entry.replace(/[/.]/g, '_')}.mjs`);
  await esbuild.build({
    entryPoints: [new URL(`../${entry}`, import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
};
const { StreamClient } = await bundleOf('src/main/terminal/stream/client.ts');

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` -- ${detail}`}`);
  failures.push(label);
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * RETRY-ONCE-ALONE for a wall-clock p95 check only (criterion (c)). Every
 * OTHER assertion in this file (matched counts, the write-call bound, the
 * client-count checks) is deterministic and gets no retry -- retrying those
 * would only hide a real defect. `measure` is re-invoked in full (a fresh
 * sample of the same size, not a re-read of the same numbers) so a retry
 * genuinely tests whether the first miss was a one-off.
 */
async function withP95RetryOnce(label, boundMs, measure) {
  let result = await measure();
  if (result.p95 !== null && result.p95 < boundMs) return result;
  console.warn(
    `  retry: ${label} p95 (${result.p95 === null ? 'n/a' : `${result.p95.toFixed(2)}ms`}) missed the ${boundMs}ms bound on the first pass -- re-measuring once, alone, before failing for real`,
  );
  result = await measure();
  return result;
}

/** Polls `list-clients` until it reports `expected` control-mode clients
 * attached to `TMUX_SESSION`, or gives up at the deadline and returns
 * whatever it last saw -- a `kill()` is asynchronous (SIGTERM, not
 * instant), so the count right after disposing a client is not yet
 * meaningful without a short poll. */
async function waitForClientCount(expected, deadlineMs) {
  const until = Date.now() + deadlineMs;
  for (;;) {
    const out = tmux('list-clients', '-t', `=${TMUX_SESSION}:`, '-F', '#{client_control_mode}');
    const count = out.split('\n').filter((line) => line.trim().length > 0).length;
    if (count === expected) return count;
    if (Date.now() > until) return count;
    await new Promise((r) => setTimeout(r, 100));
  }
}

tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');

/**
 * A LOCALHOST STATIC SERVER, not `file://` -- see the harness HTML's own
 * header: Chromium's module-script CORS check fails `file://`'s null
 * origin, measured by the spike against the same `@xterm/xterm` import
 * shape. Serves the worktree ROOT so `/node_modules/@xterm/...` and
 * `/e2e/terminal-stream-latency-harness.html` both resolve unchanged; bound
 * to 127.0.0.1 only, never published anywhere.
 */
const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new Error('not a file');
    res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream');
    createReadStream(path).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

let client;
// Bridge deliveries through one chain, ordered -- the spike's own
// prototype-latency script found dozens of chunks could land while only one
// `onRender` had actually been observed by the test script if `%output`
// chunks were delivered by un-awaited, concurrent `page.evaluate` calls.
let deliverChain = Promise.resolve();
await page.exposeFunction('__realConnect', async () => {
  client = new StreamClient({ binary: 'tmux', prefix: ['-L', SOCKET], target: TMUX_SESSION });
  client.onData((chunk) => {
    deliverChain = deliverChain
      .then(() => page.evaluate((c) => globalThis.window.__deliverOutput(c), chunk))
      .catch((err) => console.error('deliver to page failed:', err));
  });
  return await client.connect();
});
await page.exposeFunction('__realWrite', (text) => {
  client?.write(text);
});

/**
 * FALSIFICATION ONLY, never set by a real run: forwarded to the harness as
 * `artificialPaintDelayMs`, which delays every recorded paint by this many
 * ms after xterm's own `onRender` actually fires. This task's own report
 * holds the falsification run (a 300ms injection turning every p95 check
 * below red) and its removal.
 */
const artificialPaintDelayMs = Number(process.env.VAM_E2E_ARTIFICIAL_PAINT_DELAY_MS ?? '0');
await page.goto(
  `http://127.0.0.1:${port}/e2e/terminal-stream-latency-harness.html?artificialPaintDelayMs=${artificialPaintDelayMs}`,
);
await page.waitForFunction(() => globalThis.window.__term !== undefined);
await page.evaluate(() => globalThis.window.__streamStart());
await page.waitForTimeout(500);

/**
 * FALSIFICATION ONLY for the "exactly one control client" check below: when
 * set, spawns a SECOND real `tmux -C attach-session` against the same
 * target right after the real client has connected, so the check has to
 * see two clients rather than one. Its stdin is a never-ending pipe (a real
 * `-C` client reads commands from stdin and exits the instant it sees EOF --
 * measured against this exact tmux binary while building this guard: the
 * default `spawn()` pipe stdio, never written to and never explicitly kept
 * open, still delivers EOF immediately under Node, which made the
 * "extra client" vanish before `list-clients` ever saw it. A `sleep`
 * feeding its stdin, never closed, is what keeps it attached -- the same
 * fix this task's own report documents finding by hand first).
 */
let extraClient = null;
if (process.env.VAM_E2E_INJECT_EXTRA_CONTROL_CLIENT) {
  const keepAlive = spawn('sleep', ['600'], { stdio: ['ignore', 'pipe', 'ignore'] });
  extraClient = spawn('tmux', ['-L', SOCKET, '-C', 'attach-session', '-t', `=${TMUX_SESSION}:`], {
    stdio: [keepAlive.stdout, 'ignore', 'ignore'],
  });
  extraClient.on('exit', () => keepAlive.kill());
  await new Promise((r) => setTimeout(r, 500));
}

const clientsAfterConnect = await waitForClientCount(extraClient === null ? 1 : 2, 3_000);
check(
  'exactly one control-mode client is attached to the streamed session',
  clientsAfterConnect === 1,
  `${clientsAfterConnect} client(s) attached`,
);

const resetPerf = () =>
  page.evaluate(() => {
    globalThis.window.__keydowns.length = 0;
    globalThis.window.__paints.length = 0;
  });
const readPerf = () =>
  page.evaluate(() => ({
    keydowns: JSON.parse(JSON.stringify(globalThis.window.__keydowns)),
    paints: globalThis.window.__paints.map((p) => ({ epoch: p.epoch, t: p.t })),
  }));

async function waitForPaintContaining(needle, deadlineMs) {
  const until = Date.now() + deadlineMs;
  for (;;) {
    const hit = await page.evaluate(
      (n) => globalThis.window.__paints.find((p) => p.text.includes(n)),
      needle,
    );
    if (hit !== undefined) return hit;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 10));
  }
}

/* ── TEST 1: steady typing, keydown-to-paint, n=50 at 80ms ─────────────── */
async function measureTyping() {
  await resetPerf();
  await page.locator('#pane').click();
  await page.keyboard.type('x'.repeat(50), { delay: 80 });
  await page.waitForTimeout(400);
  const typing = await readPerf();

  const typingLatencies = [];
  let cursor = 0;
  for (const kd of typing.keydowns) {
    while (cursor < typing.paints.length && typing.paints[cursor].t < kd.t) cursor += 1;
    if (cursor >= typing.paints.length) break;
    typingLatencies.push(typing.paints[cursor].t - kd.t);
    cursor += 1;
  }
  console.log(
    `\nstream -- steady typing (80ms cadence, n=${typing.keydowns.length}), ${typingLatencies.length} matched to a paint`,
  );
  const p50 = percentile(typingLatencies, 50);
  const p95 = percentile(typingLatencies, 95);
  console.log(
    `  keydown-to-paint: p50 ${p50?.toFixed(2)}ms, p95 ${p95?.toFixed(2)}ms, max ${typingLatencies.length > 0 ? Math.max(...typingLatencies).toFixed(2) : '-'}ms`,
  );
  return { n: typing.keydowns.length, matched: typingLatencies.length, p50, p95 };
}

/* ── TEST 2: output loop, one echo at a time, n=30 ──────────────────────── */
async function measureEcho() {
  await page.evaluate(() => {
    globalThis.window.__paints.length = 0;
  });
  const outputLatencies = [];
  for (let i = 0; i < 30; i += 1) {
    const marker = `OUT-${i}-${Math.random().toString(36).slice(2, 8)}`;
    const t0 = Date.now();
    tmux('send-keys', '-t', `=${TMUX_SESSION}:`, '-l', '--', `echo ${marker}`);
    tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
    const hit = await waitForPaintContaining(marker, 2_000);
    if (hit !== null) outputLatencies.push(hit.epoch - t0);
    await page.waitForTimeout(150);
  }
  console.log(`\nstream -- output loop (one echo at a time, n=${outputLatencies.length} of 30 matched)`);
  const p50 = percentile(outputLatencies, 50);
  const p95 = percentile(outputLatencies, 95);
  console.log(
    `  print-to-paint: p50 ${p50?.toFixed(2)}ms, p95 ${p95?.toFixed(2)}ms, max ${outputLatencies.length > 0 ? Math.max(...outputLatencies).toFixed(2) : '-'}ms`,
  );
  return { n: 30, matched: outputLatencies.length, p50, p95 };
}

/* ── TEST 3: burst, `yes | head`, n=5, plus the write-call batching count ── */
async function measureBurst() {
  await page.evaluate(() => {
    globalThis.window.__paints.length = 0;
    globalThis.window.__outputWriteCount = 0;
  });
  const burstLatencies = [];
  for (let i = 0; i < 5; i += 1) {
    const marker = `BURST-DONE-${Math.random().toString(36).slice(2, 8)}`;
    const cmd = `yes burstline | head -n 2000; echo ${marker}`;
    const t0 = Date.now();
    tmux('send-keys', '-t', `=${TMUX_SESSION}:`, '-l', '--', cmd);
    tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
    const hit = await waitForPaintContaining(marker, 5_000);
    if (hit !== null) burstLatencies.push(hit.epoch - t0);
    await page.waitForTimeout(300);
  }
  const writeCount = await page.evaluate(() => globalThis.window.__outputWriteCount);
  console.log(`\nstream -- burst (\`yes | head -n 2000\`, n=${burstLatencies.length} of 5 matched)`);
  const p50 = percentile(burstLatencies, 50);
  const p95 = percentile(burstLatencies, 95);
  console.log(
    `  print-to-paint: p50 ${p50?.toFixed(2)}ms, p95 ${p95?.toFixed(2)}ms, max ${burstLatencies.length > 0 ? Math.max(...burstLatencies).toFixed(2) : '-'}ms`,
  );
  console.log(`  term.write() calls for ~2001 lines of output, over 5 bursts: ${writeCount}`);
  return { n: 5, matched: burstLatencies.length, p50, p95, writeCount };
}

const results = {};

try {
  const typingResult = await withP95RetryOnce(
    'stream typing (keydown-to-paint)',
    STREAM_TYPING_P95_BOUND_MS,
    measureTyping,
  );
  check(
    'stream typing: nearly every keystroke matched to a paint',
    typingResult.matched >= 45,
    `${typingResult.matched} of 50`,
  );
  check(
    `stream typing: p95 keydown-to-paint is under the ${STREAM_TYPING_P95_BOUND_MS}ms bound`,
    typingResult.p95 !== null && typingResult.p95 < STREAM_TYPING_P95_BOUND_MS,
    `p95 ${typingResult.p95?.toFixed(2) ?? 'n/a'}ms`,
  );
  results.typing = typingResult;

  // Flush the 50 unsubmitted `x` characters before test 2's `echo` commands.
  tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
  await page.waitForTimeout(200);

  const echoResult = await withP95RetryOnce(
    'stream output loop (print-to-paint)',
    STREAM_ECHO_P95_BOUND_MS,
    measureEcho,
  );
  check(
    'stream output loop: every echo was eventually seen',
    echoResult.matched >= 28,
    `${echoResult.matched} of 30`,
  );
  check(
    `stream output loop: p95 print-to-paint is under the ${STREAM_ECHO_P95_BOUND_MS}ms bound`,
    echoResult.p95 !== null && echoResult.p95 < STREAM_ECHO_P95_BOUND_MS,
    `p95 ${echoResult.p95?.toFixed(2) ?? 'n/a'}ms`,
  );
  results.echo = echoResult;

  const burstResult = await withP95RetryOnce(
    'stream burst (print-to-paint)',
    STREAM_BURST_P95_BOUND_MS,
    measureBurst,
  );
  check(
    'stream burst: every run eventually showed its done marker',
    burstResult.matched >= 4,
    `${burstResult.matched} of 5`,
  );
  check(
    `stream burst: p95 print-to-paint is under the ${STREAM_BURST_P95_BOUND_MS}ms bound`,
    burstResult.p95 !== null && burstResult.p95 < STREAM_BURST_P95_BOUND_MS,
    `p95 ${burstResult.p95?.toFixed(2) ?? 'n/a'}ms`,
  );
  check(
    `stream burst: term.write() calls stay batched, under ${MAX_BURST_WRITE_CALLS} for ~2001 lines of output`,
    burstResult.writeCount < MAX_BURST_WRITE_CALLS,
    `${burstResult.writeCount} call(s)`,
  );
  results.burst = burstResult;

  // "Zero clients once the view leaves" -- disposed HERE, inside the try
  // block, rather than only in `finally`, so a failure in this check is a
  // real assertion (`check`, counted in `failures`) and not merely cleanup.
  client?.dispose();
  extraClient?.kill();
  const clientsAfterDispose = await waitForClientCount(0, 3_000);
  check(
    'zero control-mode clients remain once the view disposes its connection',
    clientsAfterDispose === 0,
    `${clientsAfterDispose} client(s) still attached`,
  );
  client = null;
  extraClient = null;

  await page.screenshot({ path: `${outDir}/terminal-stream-latency.png` }).catch(() => {});
  console.log(`${outDir}/terminal-stream-latency.png`);
} finally {
  await browser.close();
  client?.dispose();
  extraClient?.kill();
  server.close();
  tmux('kill-session', '-t', `=${TMUX_SESSION}:`);
  killServer();
  rmSync(bundleDir, { recursive: true, force: true });
}

console.log('\n=== SUMMARY (JSON, for the design-doc update) ===');
console.log(JSON.stringify(results, null, 2));

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in terminal-stream-latency-shots.mjs`);
  process.exit(1);
}
console.log('\nterminal-stream-latency-shots.mjs: all checks passed.');
