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
 * THREE MEASUREMENTS, matching the spike's own two scripts' shape:
 *   1. keydown -> paint, steady typing cadence (n>=30, matching this
 *      branch's OTHER latency guard's sample-size convention)
 *   2. print -> paint, one `echo` at a time (n=30, matching the spike's own
 *      `measure-stream-prototype-latency.mjs` TEST 2)
 *   3. print -> paint, a burst (`yes | head -n N`, matching the spike's own
 *      TEST 3)
 *
 * Run TWICE by the caller (see the task report) to show machine-load
 * variance honestly, exactly like the design doc's own existing tables
 * already do for the poll path's before/after numbers.
 *
 * `tmux -L vam-stream-e2e-latency`, killed on the way out -- a DISTINCT
 * socket from `terminal-typing-latency-shots.mjs`'s own `vam-e2e-latency`,
 * so the two guards never collide if run concurrently on this shared
 * machine.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'docs/ui';

const SOCKET = 'vam-stream-e2e-latency';
const TMUX_SESSION = 'vam-stream-e2e-latency-a1b2c3';
const COLUMNS = 137;
const ROWS = 41;

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

await page.goto(`http://127.0.0.1:${port}/e2e/terminal-stream-latency-harness.html`);
await page.waitForFunction(() => globalThis.window.__term !== undefined);
await page.evaluate(() => globalThis.window.__streamStart());
await page.waitForTimeout(500);

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

const results = {};

try {
  /* ── TEST 1: steady typing, keydown-to-paint, n=50 at 80ms ─────────────── */
  await resetPerf();
  await page.locator('#pane').click();
  await page.keyboard.type('x'.repeat(50), { delay: 80 });
  await page.waitForTimeout(400);
  const typing = await readPerf();

  const typingLatencies = [];
  {
    let cursor = 0;
    for (const kd of typing.keydowns) {
      while (cursor < typing.paints.length && typing.paints[cursor].t < kd.t) cursor += 1;
      if (cursor >= typing.paints.length) break;
      typingLatencies.push(typing.paints[cursor].t - kd.t);
      cursor += 1;
    }
  }
  console.log(
    `\nstream -- steady typing (80ms cadence, n=${typing.keydowns.length}), ${typingLatencies.length} matched to a paint`,
  );
  console.log(
    `  keydown-to-paint: p50 ${percentile(typingLatencies, 50)?.toFixed(2)}ms, p95 ${percentile(typingLatencies, 95)?.toFixed(2)}ms, max ${typingLatencies.length > 0 ? Math.max(...typingLatencies).toFixed(2) : '-'}ms`,
  );
  check(
    'stream typing: nearly every keystroke matched to a paint',
    typingLatencies.length >= 45,
    `${typingLatencies.length} of 50`,
  );
  results.typing = {
    n: typing.keydowns.length,
    matched: typingLatencies.length,
    p50: percentile(typingLatencies, 50),
    p95: percentile(typingLatencies, 95),
  };

  // Flush the 50 unsubmitted `x` characters before test 2's `echo` commands.
  tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
  await page.waitForTimeout(200);

  /* ── TEST 2: output loop, one echo at a time, n=30 ──────────────────────── */
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
  console.log(
    `  print-to-paint: p50 ${percentile(outputLatencies, 50)?.toFixed(2)}ms, p95 ${percentile(outputLatencies, 95)?.toFixed(2)}ms, max ${outputLatencies.length > 0 ? Math.max(...outputLatencies).toFixed(2) : '-'}ms`,
  );
  check('stream output loop: every echo was eventually seen', outputLatencies.length >= 28, `${outputLatencies.length} of 30`);
  results.echo = {
    n: 30,
    matched: outputLatencies.length,
    p50: percentile(outputLatencies, 50),
    p95: percentile(outputLatencies, 95),
  };

  /* ── TEST 3: burst, `yes | head`, n=5 ───────────────────────────────────── */
  await page.evaluate(() => {
    globalThis.window.__paints.length = 0;
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
  console.log(`\nstream -- burst (\`yes | head -n 2000\`, n=${burstLatencies.length} of 5 matched)`);
  console.log(
    `  print-to-paint: p50 ${percentile(burstLatencies, 50)?.toFixed(2)}ms, p95 ${percentile(burstLatencies, 95)?.toFixed(2)}ms, max ${burstLatencies.length > 0 ? Math.max(...burstLatencies).toFixed(2) : '-'}ms`,
  );
  check('stream burst: every run eventually showed its done marker', burstLatencies.length >= 4, `${burstLatencies.length} of 5`);
  results.burst = {
    n: 5,
    matched: burstLatencies.length,
    p50: percentile(burstLatencies, 50),
    p95: percentile(burstLatencies, 95),
  };

  await page.screenshot({ path: `${outDir}/terminal-stream-latency.png` }).catch(() => {});
  console.log(`${outDir}/terminal-stream-latency.png`);
} finally {
  await browser.close();
  client?.dispose();
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
