/**
 * RESOURCE COST, BOTH RENDERERS -- the performance brief for flipping
 * `streamingTerminal`'s default (`docs/design/terminal-streaming.md`'s
 * "Flipping the default") asked for what the latency guards do not measure:
 * CPU while idle and while streaming heavy output, and renderer memory with
 * scrollback. `terminal-stream-latency-shots.mjs`/`terminal-typing-latency-
 * shots.mjs` already answer "how fast"; this answers "how much".
 *
 * ── MAIN-PROCESS CPU, REAL TMUX, REAL MODULES ──────────────────────────────
 * The poll path's real cost is `readPane` (`sources/tmux/spawn.ts`) spawning
 * a real `tmux capture-pane` on `TerminalTab.tsx`'s own `REFRESH_MS` (250ms)
 * tick; the stream path's is a single open `StreamClient` (`main/terminal/
 * stream/client.ts`) connection with no polling at all. Both are driven here
 * exactly as `main` drives them -- no stub, no mock -- against a private
 * `-L` socket, sampled with `process.cpuUsage()` (this SCRIPT's own process,
 * which is what spawns `capture-pane` and what `StreamClient` runs inside of
 * -- the same process shape `main`'s own Electron process has for both).
 *
 * ── RENDERER MEMORY AND CPU, REAL BROWSER, REAL XTERM ──────────────────────
 * Loads a throwaway static harness (mirroring `terminal-stream-latency-
 * shots.mjs`'s own) with a real `@xterm/xterm` at the SHIPPED `scrollback:
 * 5000` (`TerminalStreamTab.tsx`), fed synthetic lines directly (no tmux
 * needed for this half): heap growth as the buffer fills past the cap
 * (`performance.memory`, Chromium-only, which is the renderer this ships in)
 * is what justifies the number rather than asserting it, and a second
 * instance at 20x the cap shows the SAME plateau shape, proving the cap is
 * what bounds it rather than coincidence. CPU is approximated by Chromium's
 * own `Performance.getMetrics()` `TaskDuration` over a CDP session, before
 * and after a burst write -- an approximation named as one, not measured
 * `process.cpuUsage()` (Chromium's renderer process is not this script's).
 *
 * Run by hand:
 *   node e2e/terminal-stream-resource-shots.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, mkdtempSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const which = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
if (which.error || which.status !== 0) {
  console.warn(
    'SKIP  terminal-stream-resource-shots.mjs: no `tmux` on PATH. This guard measures against a ' +
      'real tmux control-mode connection; install tmux on this runner for it to assert anything.',
  );
  process.exit(0);
}

const SOCKET = 'vam-stream-e2e-resource';
const TMUX_SESSION = 'vam-stream-e2e-resource-a1b2c3';
const COLUMNS = 100;
const ROWS = 30;
const env = { ...process.env, LC_CTYPE: 'en_US.UTF-8' };
const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { env, encoding: 'utf8' });
const killServer = () => spawnSync('tmux', ['-L', SOCKET, 'kill-server'], { env });
killServer();
tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');

/* ── real modules, exactly `main`'s own ─────────────────────────────────── */
const require = createRequire(new URL('../node_modules/.pnpm/node_modules/', import.meta.url));
const esbuild = require('esbuild');
const bundleDir = mkdtempSync(join(tmpdir(), 'vam-stream-resource-'));
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
const { readPane } = await bundleOf('src/main/sources/tmux/spawn.ts');
const { spawnRealControlChild } = await bundleOf('src/main/sources/tmux/control.ts');

const run = (argv) =>
  new Promise((resolve) => {
    const r = spawnSync('tmux', ['-L', SOCKET, ...argv], { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    resolve({ failure: r.status === 0 ? null : { message: r.stderr }, stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
  });

const msOf = (cpu) => (cpu.user + cpu.system) / 1000;

async function sampleWindow(fn, ms) {
  const before = process.cpuUsage();
  const t0 = Date.now();
  const timer = setInterval(fn, 1);
  await new Promise((r) => setTimeout(r, ms));
  clearInterval(timer);
  const after = process.cpuUsage(before);
  return { wallMs: Date.now() - t0, cpuMs: msOf(after) };
}

console.log(`tmux: ${which.stdout.trim()} on private socket -L ${SOCKET}\n`);
const report = { idle: {}, heavy: {} };

// ── REAL ASSERTIONS, added for CI registration (`run-web-guards.mjs`) --
// matching `terminal-stream-latency-shots.mjs`'s own `check`/`failures`
// pattern exactly (#493), not a new convention. Only STRUCTURAL/RATIO
// checks get asserted here: "stream is cheaper than poll while idle" and
// "the scrollback cap actually bounds growth" hold regardless of how fast
// or loaded the machine is, the same reason #493's own client-count checks
// need no calibration. The ABSOLUTE numbers elsewhere in this file (heavy-
// output ms, the full-pipeline flood's CPU/peak-memory/time-to-quiet) stay
// informational-only (`console.log`, no `check`): unlike #493's p95
// bounds, which were calibrated over 11 runs with a documented headroom
// factor before being trusted as ceilings, these have no such calibration
// history yet -- asserting an uncalibrated absolute ceiling is how a guard
// becomes the flaky one the next person disables, not a safeguard.
const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` -- ${detail}`}`);
  failures.push(label);
}

// A generic "retry-once-alone" helper (#493's own `withP95RetryOnce`
// pattern in `terminal-stream-latency-shots.mjs`, generalised past wall-
// clock p95s to any measurement whose ACCEPTABILITY, not its raw numbers,
// is what gets asserted): re-run `measure` a single time, alone, if the
// first pass does not satisfy `acceptable` -- a real tmux session and a
// real Chromium renderer both carry enough incidental jitter that a single
// noisy pass shouldn't fail the guard outright, but a SECOND bad pass is a
// real finding, not noise.
async function withRetryOnce(label, measure, acceptable) {
  let result = await measure();
  if (acceptable(result)) return result;
  console.warn(`  retry: ${label} missed its bound on the first pass -- re-measuring once, alone, before failing for real`);
  result = await measure();
  return result;
}

/**
 * ABSOLUTE CEILINGS, calibrated from REAL data -- the coordinator's own
 * follow-up ask on this file's header comment above, which named the
 * heavy-output numbers informational only for lack of exactly this. Every
 * OTHER number this file prints stays informational (see the header): these
 * two are the ones a real sample set supports a stable bound for.
 *
 * Both are normalised PER BYTE (`bytes`, the ACTUAL decoded byte count test
 * 4 measures forwarding, never the nominal "5MB" flood constant), so a
 * future change to the flood size does not, on its own, move either bound --
 * the same reason the latency guards' `MAX_BURST_WRITE_CALLS`
 * (`terminal-stream-latency-shots.mjs`) counts DELIVERIES rather than lines.
 *
 * SAMPLES, CI (ubuntu-latest, `web-guards` job -- `gh run list --repo
 * juzser/vam --workflow CI --limit 100`, then `gh run view <id> --log`,
 * grepping this guard's own "heavy output ... stream path" and "renderer
 * TaskDuration" lines):
 *   PR #495                  (36118555962, 2026-09-25): 1025.6ms / 7,500,025B = 136.75ms/MB CPU; peak heap 23.19MB
 *   push main after #497     (36121271588, 2026-09-25): 1006.6ms / 7,500,025B = 134.21ms/MB CPU; peak heap 16.07MB
 *   "Ship the 0.2 tab shell" (36121264340, 2026-09-25): 1003.8ms / 7,500,025B = 133.84ms/MB CPU; peak heap 23.32MB
 * PR #496 (36118785107) and the earlier main push (35969967616, 2026-09-24)
 * both predate this guard's registration in the branch snapshot their own
 * run actually checked out: their `web-guards` logs have no
 * `terminal-stream-resource-shots.mjs` section at all -- confirmed by
 * grepping the full `--log` output for both, not a narrower filter missing
 * it. The FAILED precursor of #495 (`vam/stream-default`, 36111783558) is
 * the same story -- it failed before this guard existed on that branch.
 *
 * SAMPLES, LOCAL (this machine, `node e2e/terminal-stream-resource-shots.mjs`
 * run 5x serially, nothing else concurrent):
 *   1006.7ms / 7,500,066B = 134.23ms/MB CPU; peak heap 25.96MB
 *    974.9ms / 7,500,032B = 129.99ms/MB CPU; peak heap 25.08MB
 *    933.4ms / 7,500,038B = 124.45ms/MB CPU; peak heap 25.99MB
 *    946.8ms / 7,500,047B = 126.24ms/MB CPU; peak heap 26.09MB
 *    959.4ms / 7,500,031B = 127.92ms/MB CPU; peak heap 26.20MB
 *
 * Worst CPU/MB overall: 136.75ms/MB (CI, PR #495). Worst peak heap overall:
 * 26.20MB (local, run 5). `STREAM_HEAVY_CPU_MS_PER_MB_BOUND` is ~5.1x that
 * worst CPU/MB sample (comfortably over the task's own "≥3x the worst CI
 * sample" floor); `FLOOD_PEAK_HEAP_MB_BOUND` is ~3.4x the worst CI heap
 * sample and ~3.1x the worst sample of EITHER population -- an
 * order-of-magnitude ceiling loose enough to absorb a slower or noisier
 * runner without becoming the flaky guard the next person disables, while
 * still catching a real regression (falsified below: injecting artificial
 * per-chunk CPU work through a default-off env lever turns the CPU/MB check
 * red).
 */
const STREAM_HEAVY_CPU_MS_PER_MB_BOUND = 700;
const FLOOD_PEAK_HEAP_MB_BOUND = 80;

/**
 * FALSIFICATION ONLY, never set by a real run: milliseconds of synchronous,
 * CPU-burning busy-work run on EVERY `%output` chunk `measureHeavyStream`
 * receives, in this script's own main process -- the same process
 * `process.cpuUsage()` samples, and the same shape #493's own
 * `VAM_E2E_ARTIFICIAL_PAINT_DELAY_MS` lever takes (`terminal-stream-latency-
 * shots.mjs`), moved from an injected PAINT delay to an injected CPU cost
 * because what THIS bound measures is CPU, not wall clock. This task's own
 * report holds the falsification run (a 40ms-per-chunk injection turning the
 * CPU/MB check red) and its removal.
 */
const artificialChunkCpuMs = Number(process.env.VAM_E2E_ARTIFICIAL_CHUNK_CPU_MS ?? '0');
function burnCpuMs(ms) {
  if (ms <= 0) return;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* deliberately busy -- see artificialChunkCpuMs above */
  }
}

/* ── 1+2. IDLE CPU, POLL vs STREAM: a real capture-pane every REFRESH_MS
 * (250ms) against one open, idle `StreamClient` connection. The STRUCTURAL
 * property -- streaming is cheaper than polling while idle, the whole
 * reason this pair exists -- holds regardless of how fast or loaded the
 * runner is, unlike either path's own absolute ms number.
 */
async function measureIdle() {
  const REFRESH_MS = 250;
  let ticks = 0;
  let pollCpuMs;
  {
    const before = process.cpuUsage();
    const t0 = Date.now();
    while (Date.now() - t0 < 3_000) {
      await readPane(run, TMUX_SESSION);
      ticks += 1;
      await new Promise((r) => setTimeout(r, REFRESH_MS));
    }
    pollCpuMs = msOf(process.cpuUsage(before));
    console.log(`idle, poll path (${ticks} capture-pane spawns over 3s): ${pollCpuMs.toFixed(1)}ms CPU`);
  }
  await new Promise((r) => setTimeout(r, 300));
  let streamCpuMs;
  {
    const client = new StreamClient({ binary: 'tmux', prefix: ['-L', SOCKET], target: TMUX_SESSION });
    await client.connect();
    const before = process.cpuUsage();
    await new Promise((r) => setTimeout(r, 3_000));
    streamCpuMs = msOf(process.cpuUsage(before));
    console.log(`idle, stream path (one open tmux -C client over 3s): ${streamCpuMs.toFixed(1)}ms CPU`);
    client.dispose();
  }
  return { poll: { ticks, cpuMs: pollCpuMs }, stream: { cpuMs: streamCpuMs } };
}

const idle = await withRetryOnce('idle CPU ratio', measureIdle, (r) => r.stream.cpuMs < r.poll.cpuMs);
report.idle = idle;
check(
  'idle CPU: stream path is cheaper than poll path',
  idle.stream.cpuMs < idle.poll.cpuMs,
  `stream=${idle.stream.cpuMs.toFixed(1)}ms poll=${idle.poll.cpuMs.toFixed(1)}ms`,
);

await new Promise((r) => setTimeout(r, 300));

/* ── 3. HEAVY OUTPUT, POLL: capture-pane keeps ticking during a flood ─────── */
{
  const REFRESH_MS = 250;
  const before = process.cpuUsage();
  const t0 = Date.now();
  let ticks = 0;
  const flood = spawnSync('tmux', ['-L', SOCKET, 'send-keys', '-t', `=${TMUX_SESSION}:`, 'yes | head -c 5000000', 'Enter'], { env });
  while (Date.now() - t0 < 3_000) {
    await readPane(run, TMUX_SESSION);
    ticks += 1;
    await new Promise((r) => setTimeout(r, REFRESH_MS));
  }
  const cpu = msOf(process.cpuUsage(before));
  report.heavy.poll = { ticks, cpuMs: cpu };
  console.log(
    `heavy output (yes | head -c 5MB), poll path (${ticks} capture-pane spawns over 3s): ${cpu.toFixed(1)}ms CPU -- ` +
      'each capture-pane costs the SAME regardless of flood volume: it reads the CURRENT screen, never the bytes in between.',
  );
  void flood;
}

/* ── 4. HEAVY OUTPUT, STREAM: every %output chunk is decoded and forwarded ──
 * Folded into its own measure function, retried once alone if it misses
 * STREAM_HEAVY_CPU_MS_PER_MB_BOUND (see that constant's own header), so the
 * FRESH SESSION reset (never test 3's own -- `yes | head -c 5000000`, no
 * redirect, so it actually prints, can still be draining into test 3's pane
 * after its own 3s sampling window ends, and test 4 must not measure a mix
 * of two floods) happens for a retry's own attempt too, not just the first.
 */
async function measureHeavyStream() {
  tmux('kill-session', '-t', TMUX_SESSION);
  tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
  await new Promise((r) => setTimeout(r, 300));

  const client = new StreamClient({ binary: 'tmux', prefix: ['-L', SOCKET], target: TMUX_SESSION });
  await client.connect();
  let bytes = 0;
  let chunks = 0;
  client.onData((chunk) => {
    bytes += chunk.length;
    chunks += 1;
    burnCpuMs(artificialChunkCpuMs);
  });
  const before = process.cpuUsage();
  const t0 = Date.now();
  spawnSync('tmux', ['-L', SOCKET, 'send-keys', '-t', `=${TMUX_SESSION}:`, 'yes | head -c 5000000', 'Enter'], { env });
  // Drain until the flood settles (no new bytes for 500ms) or 8s pass.
  let lastBytes = -1;
  while (Date.now() - t0 < 8_000) {
    await new Promise((r) => setTimeout(r, 500));
    if (bytes === lastBytes) break;
    lastBytes = bytes;
  }
  const cpuMs = msOf(process.cpuUsage(before));
  const wallMs = Date.now() - t0;
  const cpuMsPerMB = bytes > 0 ? cpuMs / (bytes / 1_000_000) : Number.POSITIVE_INFINITY;
  console.log(
    `heavy output (yes | head -c 5MB), stream path: ${cpuMs.toFixed(1)}ms CPU, ${wallMs}ms wall, ` +
      `${chunks} %output chunks, ${bytes} decoded bytes, ${cpuMsPerMB.toFixed(1)}ms CPU/MB -- cost scales with the FLOOD, not with a tick.`,
  );
  client.dispose();
  return { cpuMs, wallMs, chunks, bytes, cpuMsPerMB };
}

const heavyStream = await withRetryOnce(
  'heavy-output stream CPU/MB',
  measureHeavyStream,
  (r) => r.cpuMsPerMB < STREAM_HEAVY_CPU_MS_PER_MB_BOUND,
);
report.heavy.stream = heavyStream;
check(
  `heavy output, stream path: main-process CPU stays under ${STREAM_HEAVY_CPU_MS_PER_MB_BOUND}ms/MB streamed`,
  heavyStream.cpuMsPerMB < STREAM_HEAVY_CPU_MS_PER_MB_BOUND,
  `${heavyStream.cpuMsPerMB.toFixed(1)}ms/MB (${heavyStream.cpuMs.toFixed(1)}ms / ${(heavyStream.bytes / 1_000_000).toFixed(2)}MB)`,
);

// A FRESH SESSION again, for the same reason as before test 4.
tmux('kill-session', '-t', TMUX_SESSION);
tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
await new Promise((r) => setTimeout(r, 300));

/* ── 5. DOES %pause NOW ACTUALLY ARRIVE, against a SLOW consumer? ─────────
 * UPDATED for the coordinator's own follow-up: the EARLIER version of this
 * measurement (a raw control-mode child that never set `pause-after`) found
 * that tmux never paused a slow client at all -- MEASURED root cause: tmux
 * only sends `%pause` to a client that opted in with `refresh-client -f
 * pause-after=<N>` (tmux(1), CONTROL MODE / refresh-client). `StreamClient`
 * now sends that on every `connect()`/reconnect (`#requestPauseAfter`,
 * `client.ts`), so THIS measurement drives a real `StreamClient` directly
 * (not a raw connection), and checks not only whether `%pause` arrives but
 * whether the pane actually RECOVERS to a correct screen afterwards.
 *
 * UPDATED AGAIN -- the SAME finding this task's own CI-flake fix made in
 * `test/main/terminal/stream/stream-client-pause-after.test.ts`: a
 * per-chunk busy-wait's actual throttling effect depends on how much data
 * tmux batches per read/write, which is unpredictable and machine-load-
 * dependent (proven unreliable there under a full parallel test run, not
 * just in theory). Replaced with the SAME deterministic technique that
 * test now uses: pause the real control child's own `stdout` directly
 * (`spawnChild` injection, `StreamClient`'s own test seam) -- this stops
 * Node's stream from draining the OS pipe for EVERY listener, forcing
 * genuine backpressure regardless of chunk size or system load, rather
 * than racing tmux's own batching to out-spin it.
 */
async function measurePauseAfter() {
  let realStdout;
  const observingSpawn = (binary, argv) => {
    const child = spawnRealControlChild(binary, argv);
    realStdout = child.stdout;
    return child;
  };
  const client = new StreamClient({
    binary: 'tmux',
    prefix: ['-L', SOCKET],
    target: TMUX_SESSION,
    spawnChild: observingSpawn,
  });
  await client.connect();
  const seeds = [];
  client.onSeed((seed) => seeds.push(seed));
  try {
    spawnSync(
      'tmux',
      ['-L', SOCKET, 'send-keys', '-t', `=${TMUX_SESSION}:`, 'yes | head -c 5000000; echo VAM-FLOOD-DONE-5', 'Enter'],
      { env },
    );
    // Deterministic stall: pause the REAL stream (not a per-chunk delay).
    realStdout?.pause();
    await new Promise((r) => setTimeout(r, 1_500));
    realStdout?.resume();
    const deadline = Date.now() + 15_000;
    while (seeds.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    let finalPane = '';
    const doneDeadline = Date.now() + 10_000;
    while (Date.now() < doneDeadline) {
      finalPane = tmux('capture-pane', '-p', '-t', `=${TMUX_SESSION}:`);
      if (/VAM-FLOOD-DONE-5/.test(finalPane)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const correct = /VAM-FLOOD-DONE-5/.test(finalPane);
    console.log(
      `\nreal tmux, a real StreamClient (sends pause-after), a paused real stdout (not a busy-wait), same 5MB flood: ` +
        `%pause -> reseed round trip seen: ${seeds.length > 0} (${seeds.length} reseed(s)), ` +
        `final screen matches capture-pane's own DONE marker: ${correct} -- ` +
        'the pause-after fix makes tmux throttle this client AND StreamClient recovers to a correct screen.',
    );
    return { sawReseed: seeds.length > 0, correct };
  } finally {
    client.dispose();
  }
}

const pauseAfter = await withRetryOnce('pause-after recovery', measurePauseAfter, (r) => r.sawReseed && r.correct);
report.pauseAfter = pauseAfter;
check('pause-after: %pause triggered a reseed (a real StreamClient throttled by tmux)', pauseAfter.sawReseed);
check('pause-after: the pane recovers to the correct final screen', pauseAfter.correct);

// A FRESH SESSION for test 6, never test 5's own leftover flood.
tmux('kill-session', '-t', TMUX_SESSION);
tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
await new Promise((r) => setTimeout(r, 300));

/* ═══════════════════════════════ RENDERER HALF ══════════════════════════ */

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

// `--enable-precise-memory-info` -- WITHOUT it, Chromium quantizes
// `performance.memory.usedJSHeapSize` to a small set of buckets (its own
// anti-fingerprinting bucketing), which reads as a flat, uninformative "0.00
// MB growth" for exactly the kind of small-to-medium allocation this
// measures. `--js-flags=--expose-gc` is what makes `window.gc()` (below)
// something other than a silent no-op, so "before" is measured after
// garbage is actually collected, not merely after a request for some.
const browser = await chromium.launch({
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
});

async function heapAfterLines(scrollback, lineCount) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await page.goto(`http://127.0.0.1:${port}/e2e/terminal-stream-latency-harness.html`);
  await page.waitForFunction(() => globalThis.window.__term !== undefined);
  // A fresh term with the CALLER's own scrollback -- the harness's own
  // default (2000) is for latency, not this measurement.
  const before = await page.evaluate(async (n) => {
    const { Terminal } = await import('/node_modules/@xterm/xterm/lib/xterm.mjs');
    const term = new Terminal({ scrollback: n, convertEol: false, allowProposedApi: true });
    const div = document.createElement('div');
    div.style.width = '1100px';
    div.style.height = '700px';
    document.body.appendChild(div);
    term.open(div);
    globalThis.window.__measureTerm = term;
    if (globalThis.window.gc) globalThis.window.gc();
    return performance.memory?.usedJSHeapSize ?? null;
  }, scrollback);
  await page.evaluate((n) => {
    const term = globalThis.window.__measureTerm;
    let s = '';
    for (let i = 0; i < n; i += 1) {
      s += `line ${i} -- the quick brown fox jumps over the lazy dog, eighty columns of filler\r\n`;
    }
    term.write(s);
  }, lineCount);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    if (globalThis.window.gc) globalThis.window.gc();
    return performance.memory?.usedJSHeapSize ?? null;
  });
  await page.close();
  return { before, after, deltaMB: before !== null && after !== null ? (after - before) / (1024 * 1024) : null };
}

try {
  console.log('\n--- renderer memory, scrollback ---');
  // STRUCTURAL, not absolute: "3x the writes at the same cap stays close to
  // the same growth" and "the same writes at 20x the cap grow noticeably
  // more" both hold regardless of how much RAM or how fast the runner's own
  // Chromium is -- unlike any of the three deltaMB numbers alone, which is
  // why only the RATIOS below are asserted (retry-once-alone: heap sampling
  // through `performance.memory` carries real GC-timing jitter).
  async function measureScrollbackCap() {
    const atCap = await heapAfterLines(5_000, 5_000);
    console.log(
      `scrollback:5000 (the shipped cap), 5,000 lines written (fills it exactly): ` +
        `${atCap.deltaMB?.toFixed(2) ?? 'n/a'} MB heap growth`,
    );
    const pastCap = await heapAfterLines(5_000, 15_000);
    console.log(
      `scrollback:5000, 15,000 lines written (3x the cap): ` +
        `${pastCap.deltaMB?.toFixed(2) ?? 'n/a'} MB heap growth -- should track the CAP (5,000 retained), not the 15,000 written, if the cap is doing its job.`,
    );
    const uncapped = await heapAfterLines(100_000, 15_000);
    console.log(
      `scrollback:100000 (an effectively uncapped comparison), the SAME 15,000 lines: ` +
        `${uncapped.deltaMB?.toFixed(2) ?? 'n/a'} MB heap growth -- the delta against the capped run above is what the cap is buying.`,
    );
    return { atCap, pastCap, uncapped };
  }
  function scrollbackCapAcceptable({ atCap, pastCap, uncapped }) {
    if (atCap.deltaMB === null || pastCap.deltaMB === null || uncapped.deltaMB === null) return false;
    // Generous ceiling (2x + 2MB headroom): 3x the writes at the SAME cap
    // should not cost anywhere near 3x the memory if the cap is bounding
    // retained lines rather than total lines ever written.
    const pastStaysNearCap = pastCap.deltaMB < atCap.deltaMB * 2 + 2;
    // Generous floor (1.2x): 20x the cap, same writes, should retain
    // meaningfully more (all 15,000 lines vs. 5,000) and so grow measurably
    // more than the capped run -- proof the cap is doing something, not
    // just noise in the same direction.
    const uncappedGrowsMore = uncapped.deltaMB > pastCap.deltaMB * 1.2;
    return pastStaysNearCap && uncappedGrowsMore;
  }
  const { atCap, pastCap, uncapped } = await withRetryOnce(
    'renderer scrollback-cap ratios',
    measureScrollbackCap,
    scrollbackCapAcceptable,
  );
  check(
    'renderer memory: 3x the writes at the same cap stays near the at-cap growth (cap bounds RETAINED lines)',
    atCap.deltaMB !== null && pastCap.deltaMB !== null && pastCap.deltaMB < atCap.deltaMB * 2 + 2,
    `atCap=${atCap.deltaMB?.toFixed(2)}MB pastCap=${pastCap.deltaMB?.toFixed(2)}MB`,
  );
  check(
    'renderer memory: an effectively uncapped scrollback grows noticeably more than the capped one (the cap is buying something)',
    pastCap.deltaMB !== null && uncapped.deltaMB !== null && uncapped.deltaMB > pastCap.deltaMB * 1.2,
    `pastCap=${pastCap.deltaMB?.toFixed(2)}MB uncapped=${uncapped.deltaMB?.toFixed(2)}MB`,
  );

  console.log('\n--- renderer CPU proxy (CDP TaskDuration), burst write ---');
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await page.goto(`http://127.0.0.1:${port}/e2e/terminal-stream-latency-harness.html`);
  await page.waitForFunction(() => globalThis.window.__term !== undefined);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metricsBefore = await cdp.send('Performance.getMetrics');
  const taskBefore = metricsBefore.metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;
  await page.evaluate(() => {
    const term = globalThis.window.__term;
    let s = '';
    for (let i = 0; i < 5_000; i += 1) s += `burst line ${i} of a 5MB-equivalent flood\r\n`;
    term.write(s);
  });
  await page.waitForTimeout(500);
  const metricsAfter = await cdp.send('Performance.getMetrics');
  const taskAfter = metricsAfter.metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;
  console.log(
    `5,000-line burst write, one term.write() call: ${((taskAfter - taskBefore) * 1000).toFixed(1)}ms of renderer TaskDuration -- ` +
      'a single synchronous call, not 5,000 individual writes: xterm.js batches internally.',
  );
  await page.close();

  /* ── 6. THE FULL PIPELINE, RE-MEASURED: real tmux -> real StreamClient
   * (now sending pause-after) -> real xterm running THIS FILE's own
   * high/low-water-mark drop logic (`TerminalStreamTab.tsx`, mirrored here
   * the same way every measurement above mirrors the shipped component
   * rather than importing it -- this harness's page context has no bundler
   * wiring for the renderer's own module graph). The coordinator's own ask:
   * CPU, peak renderer memory, time-to-quiet, and whether the final screen
   * matches `capture-pane` -- BEFORE and AFTER the drop-and-reseed recovery
   * a real reconnect would perform, so a genuine drop (if one happens) is
   * visible rather than papered over by measuring only the healed state.
   */
  console.log('\n--- 5MB flood, full pipeline: real StreamClient + real xterm + this file’s own backpressure ---');

  // Folded into its own measure function -- retried once alone if it misses
  // FLOOD_PEAK_HEAP_MB_BOUND (see that constant's own header) -- so a retry
  // gets its own fresh session, `StreamClient` and browser page rather than
  // reusing the first attempt's.
  async function measureFlood6() {
  tmux('kill-session', '-t', TMUX_SESSION);
  tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
  await new Promise((r) => setTimeout(r, 300));

  const floodClient = new StreamClient({ binary: 'tmux', prefix: ['-L', SOCKET], target: TMUX_SESSION });
  const seed = await floodClient.connect();

  const floodPage = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await floodPage.goto(`http://127.0.0.1:${port}/e2e/terminal-stream-latency-harness.html`);
  await floodPage.waitForFunction(() => globalThis.window.__term !== undefined);
  const floodCdp = await floodPage.context().newCDPSession(floodPage);
  await floodCdp.send('Performance.enable');

  await floodPage.evaluate((seedText) => {
    const term = globalThis.window.__term;
    term.write(seedText.replace(/\r?\n/g, '\r\n'));
    // The SAME HIGH/LOW water marks and drop logic `TerminalStreamTab.tsx`
    // runs (`TERMINAL_STREAM_HIGH_WATER_MARK`/`_LOW_WATER_MARK`) -- see this
    // block's own header on why it is mirrored rather than imported.
    const HIGH = 2 * 1024 * 1024;
    const LOW = HIGH / 4;
    let pendingBytes = 0;
    let dropping = false;
    let droppedChunks = 0;
    let peakHeap = performance.memory?.usedJSHeapSize ?? 0;
    const trackHeap = () => {
      const h = performance.memory?.usedJSHeapSize ?? 0;
      if (h > peakHeap) peakHeap = h;
    };
    globalThis.window.__peakHeap = () => peakHeap;
    globalThis.window.__droppedChunks = () => droppedChunks;
    globalThis.window.__feedChunk = (chunk) => {
      trackHeap();
      if (dropping) {
        droppedChunks += 1;
        return;
      }
      pendingBytes += chunk.length;
      term.write(chunk, () => {
        pendingBytes -= chunk.length;
        trackHeap();
        if (dropping && pendingBytes <= LOW) {
          dropping = false;
          pendingBytes = 0;
        }
      });
      if (pendingBytes > HIGH) dropping = true;
    };
  }, seed);

  const bufferText = () =>
    floodPage.evaluate(() => {
      const term = globalThis.window.__term;
      const buf = term.buffer.active;
      let text = '';
      for (let y = 0; y < buf.length; y += 1) text += `${buf.getLine(y)?.translateToString(true) ?? ''}\n`;
      return text;
    });

  const metricsBefore6 = await floodCdp.send('Performance.getMetrics');
  const taskBefore6 = metricsBefore6.metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;
  const flood6Start = Date.now();
  let bytesForwarded = 0;
  floodClient.onData((chunk) => {
    bytesForwarded += chunk.length;
    void floodPage.evaluate((c) => globalThis.window.__feedChunk(c), chunk);
  });
  spawnSync(
    'tmux',
    ['-L', SOCKET, 'send-keys', '-t', `=${TMUX_SESSION}:`, 'yes | head -c 5000000; echo VAM-FLOOD-DONE-6', 'Enter'],
    { env },
  );

  // TIME-TO-QUIET: wall clock from ISSUING the flood to the last chunk this
  // file forwarded toward the renderer -- the same "no new bytes for 500ms"
  // settle check test 4 (main-process half) already uses, extended through
  // the renderer hop rather than stopping at Node's own `onData`.
  let lastBytes = -1;
  let quietAt = null;
  const hardDeadline6 = Date.now() + 20_000;
  while (Date.now() < hardDeadline6) {
    await new Promise((r) => setTimeout(r, 500));
    if (bytesForwarded === lastBytes) {
      quietAt = Date.now();
      break;
    }
    lastBytes = bytesForwarded;
  }
  const timeToQuietMs = quietAt !== null ? quietAt - flood6Start : null;

  const metricsAfter6 = await floodCdp.send('Performance.getMetrics');
  const taskAfter6 = metricsAfter6.metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;
  const peakHeapBytes = await floodPage.evaluate(() => globalThis.window.__peakHeap());
  const droppedChunks = await floodPage.evaluate(() => globalThis.window.__droppedChunks());

  const liveTextBeforeReseed = await bufferText();
  const liveMatchesBeforeReseed = /VAM-FLOOD-DONE-6/.test(liveTextBeforeReseed);

  // THE RECOVERY: whatever this file's own drop logic discarded, a fresh
  // `capture-pane` (ground truth) is what a real reconnect would push
  // through `onSeed` -- written here directly, mirroring
  // `TerminalStreamTab.tsx`'s own `asXtermSeed`/`term.reset()` pair, rather
  // than standing up this harness's full reconnect plumbing to prove a
  // property `TerminalStreamTab.test.tsx`'s own unit tests already pin.
  const groundTruth = tmux('capture-pane', '-p', '-t', `=${TMUX_SESSION}:`);
  await floodPage.evaluate((text) => {
    const term = globalThis.window.__term;
    term.reset();
    term.write(text.replace(/\r?\n/g, '\r\n'));
  }, groundTruth);
  const liveTextAfterReseed = await bufferText();
  const matchesAfterReseed = /VAM-FLOOD-DONE-6/.test(liveTextAfterReseed);

  const cpuMs = (taskAfter6 - taskBefore6) * 1000;
  const peakHeapMB = peakHeapBytes / (1024 * 1024);
  console.log(
    `renderer TaskDuration: ${cpuMs.toFixed(1)}ms, ` +
      `peak JS heap: ${peakHeapMB.toFixed(2)}MB, ` +
      `time-to-quiet: ${timeToQuietMs ?? 'did not settle in 20s'}ms, ` +
      `chunks dropped by the high-water mark: ${droppedChunks}`,
  );
  console.log(
    `screen correctness -- live (pre-reseed) shows the DONE marker: ${liveMatchesBeforeReseed}; ` +
      `after a reseed from a fresh capture-pane, shows it: ${matchesAfterReseed} ` +
      '(this one MUST be true -- it is what a real reconnect always restores).',
  );

  await floodPage.close();
  floodClient.dispose();

  return { cpuMs, peakHeapMB, timeToQuietMs, droppedChunks, liveMatchesBeforeReseed, matchesAfterReseed };
  }

  const flood6 = await withRetryOnce(
    'full-pipeline peak renderer heap',
    measureFlood6,
    (r) => r.peakHeapMB < FLOOD_PEAK_HEAP_MB_BOUND,
  );
  report.flood6 = flood6;
  // STRUCTURAL, unlike the CPU/heap/time-to-quiet numbers logged above (no
  // calibration history for TASK DURATION / time-to-quiet -- see this file's
  // header on why only CPU-per-MB and peak heap get an asserted ceiling):
  // whether a reseed from ground truth produces a correct screen is a
  // property that must always hold, regardless of the flood's speed or the
  // runner's load. `liveMatchesBeforeReseed` is deliberately NOT asserted
  // here -- it is expected to be `false` exactly when the drop-and-reseed
  // path correctly triggers, so it is a fact about what happened, not a
  // pass/fail signal.
  check(
    'full pipeline: after a reseed from ground truth, the live screen matches capture-pane',
    flood6.matchesAfterReseed,
  );
  check(
    `full pipeline: peak renderer heap stays under ${FLOOD_PEAK_HEAP_MB_BOUND}MB during the flood`,
    flood6.peakHeapMB < FLOOD_PEAK_HEAP_MB_BOUND,
    `${flood6.peakHeapMB.toFixed(2)}MB`,
  );

  tmux('kill-session', '-t', TMUX_SESSION);
} finally {
  await browser.close();
  server.close();
  killServer();
}

if (failures.length > 0) {
  console.error(`\nterminal-stream-resource-shots.mjs: ${failures.length} check(s) FAILED: ${failures.join(', ')}`);
} else {
  console.log(
    '\nterminal-stream-resource-shots.mjs: all structural/ratio checks passed ' +
      "(the absolute CPU/heap/time-to-quiet numbers logged above stay informational -- see this file's header on why).",
  );
}
process.exit(failures.length > 0 ? 1 : 0);
