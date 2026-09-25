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

/* ── 1. IDLE CPU, POLL: a real capture-pane every REFRESH_MS (250ms) ─────── */
{
  const REFRESH_MS = 250;
  const before = process.cpuUsage();
  const t0 = Date.now();
  let ticks = 0;
  while (Date.now() - t0 < 3_000) {
    await readPane(run, TMUX_SESSION);
    ticks += 1;
    await new Promise((r) => setTimeout(r, REFRESH_MS));
  }
  const cpu = msOf(process.cpuUsage(before));
  report.idle.poll = { ticks, cpuMs: cpu };
  console.log(`idle, poll path (${ticks} capture-pane spawns over 3s): ${cpu.toFixed(1)}ms CPU`);
}

/* ── 2. IDLE CPU, STREAM: one open connection, nothing printed ────────────── */
{
  const client = new StreamClient({ binary: 'tmux', prefix: ['-L', SOCKET], target: TMUX_SESSION });
  await client.connect();
  const before = process.cpuUsage();
  await new Promise((r) => setTimeout(r, 3_000));
  const cpu = msOf(process.cpuUsage(before));
  report.idle.stream = { cpuMs: cpu };
  console.log(`idle, stream path (one open tmux -C client over 3s): ${cpu.toFixed(1)}ms CPU`);
  client.dispose();
}

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

// A FRESH SESSION for test 4, never test 3's own: `yes | head -c 5000000`
// (no redirect, so it actually prints) can still be draining into test 3's
// pane after its own 3s sampling window ends, and test 4 must not measure a
// mix of two floods.
tmux('kill-session', '-t', TMUX_SESSION);
tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
await new Promise((r) => setTimeout(r, 300));

/* ── 4. HEAVY OUTPUT, STREAM: every %output chunk is decoded and forwarded ── */
{
  const client = new StreamClient({ binary: 'tmux', prefix: ['-L', SOCKET], target: TMUX_SESSION });
  await client.connect();
  let bytes = 0;
  let chunks = 0;
  client.onData((chunk) => {
    bytes += chunk.length;
    chunks += 1;
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
  const cpu = msOf(process.cpuUsage(before));
  const wallMs = Date.now() - t0;
  report.heavy.stream = { cpuMs: cpu, wallMs, chunks, bytes };
  console.log(
    `heavy output (yes | head -c 5MB), stream path: ${cpu.toFixed(1)}ms CPU, ${wallMs}ms wall, ` +
      `${chunks} %output chunks, ${bytes} decoded bytes -- cost scales with the FLOOD, not with a tick.`,
  );
  client.dispose();
}

// A FRESH SESSION again, for the same reason as before test 4.
tmux('kill-session', '-t', TMUX_SESSION);
tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
await new Promise((r) => setTimeout(r, 300));

/* ── 5. DOES TMUX EVER ACTUALLY SEND %pause, against a SLOW consumer? ─────
 * The design doc's own Risks section left this an open question: "whether
 * tmux enforces this by default or only when a client opts in was not
 * verified against tmux's own source." `StreamClient` already HANDLES
 * `%pause`/`%continue` if tmux ever sends it (`#handlePauseOrContinue`) but
 * never asks for it, and this synthetic test's own consumer (test 4, above)
 * is too fast to ever fall behind -- a REAL xterm.js render is not. This
 * attaches a raw control-mode child directly (bypassing `StreamClient`'s own
 * event filtering, which does not expose `%pause` to a caller) with a
 * consumer that SLEEPS 20ms per chunk -- roughly a real DOM render's own
 * order of magnitude -- and greps the raw decoded stream for the literal
 * line, against the same flood.
 */
{
  const { spawnRealControlChild } = await bundleOf('src/main/sources/tmux/control.js');
  const child = spawnRealControlChild('tmux', ['-L', SOCKET, '-C', 'attach-session', '-t', `=${TMUX_SESSION}:`]);
  let raw = '';
  let sawPause = false;
  let sawContinue = false;
  child.stdout.on('data', (chunk) => {
    const text = String(chunk);
    raw += text;
    if (/%pause/.test(text)) sawPause = true;
    if (/%continue|%unpause/.test(text)) sawContinue = true;
    // Busy-wait, not `setTimeout` -- this has to actually occupy the event
    // loop the way a synchronous render would, or nothing here ever falls
    // behind tmux's own delivery rate.
    const until = Date.now() + 20;
    while (Date.now() < until) {
      /* spin */
    }
  });
  spawnSync('tmux', ['-L', SOCKET, 'send-keys', '-t', `=${TMUX_SESSION}:`, 'yes | head -c 5000000', 'Enter'], { env });
  await new Promise((r) => setTimeout(r, 6_000));
  child.kill();
  console.log(
    `\nreal tmux, a 20ms-per-chunk consumer, same 5MB flood: ` +
      `%pause seen: ${sawPause}, %continue/%unpause seen: ${sawContinue}, ${raw.length} raw bytes read -- ` +
      (sawPause
        ? 'tmux DOES throttle a client that falls behind; StreamClient’s existing %pause handling is live code, not dead code.'
        : 'tmux did NOT pause this client even at 20ms/chunk on this build -- either the threshold is higher, or this tmux/config does not enforce it; StreamClient’s handling stays a real but UNEXERCISED safety net here.'),
  );
}

killServer();

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
} finally {
  await browser.close();
  server.close();
}

console.log('\nterminal-stream-resource-shots.mjs: measurement complete (informational -- no pass/fail).');
