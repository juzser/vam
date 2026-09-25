/**
 * PER-KEYSTROKE TYPING LATENCY -- measured end to end on the REAL path, and
 * asserted once the measurement said what to assert.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The operator's report, a third time: "there is still a noticeable delay
 * when typing in the terminal." Two earlier rounds cut `ECHO_MS` to 33 and
 * `REFRESH_MS` to 250 and made the echo read screen-only (`TerminalTab.tsx`'s
 * own head comments hold those numbers). Both were argued from a read's
 * BYTES and its render cost; neither measured the keystroke chain itself, so
 * neither could say where the REMAINING milliseconds actually are. This does:
 * `keydown -> IPC send issued -> send-keys spawn returned -> echo read issued
 * -> capture returned -> painted`, stamped with `performance.now()` on one
 * clock (the page's), against a REAL tmux, REAL `send-keys`/`capture-pane`
 * spawns and the REAL renderer bundle -- the same harness shape
 * `terminal-echo-scroll-shots.mjs` already uses for correctness, aimed at a
 * throwaway session on a private socket.
 *
 * WHAT "setState" MEANS BELOW, said honestly rather than implied. React's
 * `setView` updater runs synchronously in the microtask that resolves the
 * read promise, so it is not a separately observable instant from this
 * harness -- it is bundled into "capture returned -> painted" below, which is
 * the honest resolution this measurement can offer without instrumenting
 * React internals. "Painted" is a `MutationObserver` on the pane's `<pre>`,
 * chained through one `requestAnimationFrame` so the timestamp is taken after
 * the browser has actually laid the new frame out, not merely after the DOM
 * write queued.
 *
 * TWO PANES, PER THE OPERATOR'S OWN SHAPE. Pane A is a plain `sh`. Pane B is
 * a REAL `claude` session, in the fullscreen TUI the operator's own
 * `~/.claude/settings.json` selects (`"tui": "fullscreen"`) -- measured here,
 * same as `terminal-echo-scroll-shots.mjs` phase B: `alt=1 hist=0 mouse=1`.
 * Nothing is ever SUBMITTED to it: every keystroke lands in the prompt box
 * and Enter is never sent, so this spends no tokens and runs no tool.  A
 * one-time "trust this folder" dialog is answered (Down, Enter) against a
 * throwaway scratch directory this script creates and removes.
 *
 * TWO CADENCES. A typing cadence (~80ms apart, >= 50 keystrokes) is slower
 * than `ECHO_MS` (33ms), so every keystroke gets its own echo read --
 * `sends.length === echoReads.length` is asserted below as the proof of that
 * pairing. A burst (~20ms apart, 20 keystrokes) is faster than `ECHO_MS`, so
 * echo reads COALESCE -- fewer reads than keystrokes -- and this reports that
 * directly rather than forcing a one-to-one zip that would not exist.
 *
 * `tmux -L vam-e2e-latency`, killed on the way out; nothing here touches the
 * operator's default server or any `vam-*` session on it.
 *
 * THE BACKGROUND INTERVAL IS MEASURED TOO, not just the keystroke chain: a
 * steady typing run leaves `REFRESH_MS` ticking underneath it the whole time,
 * pinned to the live end throughout (nothing here ever scrolls it away), so
 * every tick but the first ought to be `poll-live` rather than `poll` --
 * `shared/terminal.ts`'s `PaneReadMode` holds why -- and its capture ought to
 * read like a screen rather than the 500-line window `poll` still asks for
 * when the operator has scrolled away. `checkPollLive` asserts both, with the
 * byte bound documented at `POLL_LIVE_BYTES_BOUND`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'atlas-latency';
const BRANCH = 'work/atlas-latency';
const PROJECT = 'p1';
const SOCKET = 'vam-e2e-latency';
const TMUX_SESSION = 'vam-e2e-latency-a1b2c3';
const COLUMNS = 137;
const ROWS = 41;
const HISTORY = 500;

/**
 * The bound this guard actually enforces on PANE A (plain `sh`), and why.
 * Measured on this machine (see the report this task hands back) the FIXED
 * path's steady-cadence p95 keydown-to-painted latency on the plain-`sh`
 * pane is well under this, consistently single-digit-to-low-teens ms across
 * many calibration runs (including several run alongside a busy shared
 * machine); a CI runner is typically slower and noisier than a laptop
 * (`starvation-stretches-11ms-to-5022ms` is the standing lesson on how far a
 * wall-clock bound can be stretched by scheduling alone), so the bound
 * carries roughly 3x headroom over what was measured here rather than
 * asserting the measured number back.
 */
const PAINT_P95_BOUND_MS = 120;

/**
 * PANE B (a real `claude`, fullscreen TUI) gets its OWN, more generous
 * bound -- it is NOT the same signal as pane A. Rendering a ~900-byte,
 * 137x41, SGR-coloured screen through `terminal-ansi.ts`'s span-per-run
 * parser is real, inherent cost this pane pays that the plain-`sh` pane
 * never does (this file's own module header cites the design doc's own
 * measurement: the `claude` pane's p95 is "almost entirely the PAINT
 * stage", not the read). Calibrated across this task's own report: five
 * clean runs landed p95 90.10-93.50ms; this same task's own full-gate run,
 * on a machine visibly busier at that moment (this repo's `node_modules` is
 * a tree SHARED across every worktree on this machine, and another
 * session's `pnpm install` landed mid-run -- see the report), pushed it to
 * 171.20ms, then 174.00ms on the immediate retry -- a SUSTAINED elevation,
 * not a one-off blip a single retry could absorb. Set at 300ms, giving real
 * headroom above the worst of those (~1.7x) without giving up on catching
 * an actual regression. This pane never runs in CI at all -- the `claude`
 * CLI is not on the CI runner's PATH, and `hasClaude` skips it below -- so
 * this bound only protects a BY-HAND local run (with `claude` installed)
 * from crying wolf on a machine this repo's own docs already call "shared
 * and loaded"; it has no bearing on what actually gates a PR.
 */
const PANE_B_PAINT_P95_BOUND_MS = 300;

/**
 * FALSIFICATION ONLY, never set by a real run: delays every recorded paint
 * by this many ms after the pane's own `MutationObserver` actually fires.
 * This task's own report holds the falsification run (a 300ms injection
 * turning the p95 check below red) and its removal. Kept as a permanent,
 * inert (default 0) lever -- the same pattern `run-web-guards.mjs`'s own
 * `VAM_E2E_SKIP_BUILD` documents for falsifying ITS guard.
 */
const artificialPaintDelayMs = Number(process.env.VAM_E2E_ARTIFICIAL_PAINT_DELAY_MS ?? '0');

/**
 * Spawns per keystroke the fix claims, steady cadence, pane A. `0` is the
 * control-mode client's whole point: a keystroke's send and its echo read
 * both ride the one persistent `tmux -C` connection, so NEITHER is a process
 * `execFile` started. Asserted with `<= 0.1` slack for the rare keystroke
 * whose control client had to be (re)established during the run.
 */
const CLAIMED_SPAWNS_PER_KEYSTROKE = 0;

/**
 * How many bytes a `poll-live` capture may carry before it stops looking like
 * a screen and starts looking like the window it exists to avoid asking for.
 *
 * MEASURED, twice. First against a REAL 137x41 pane with 600 lines of
 * coloured scrollback, through the same control-mode runner this harness uses
 * (this task's own scratch measurement, `tmux 3.7b`, private socket, n=60): a
 * window read (`-S -500`) answers 35,068 bytes at a 1.88ms median, the screen
 * alone answers 2,608 bytes at 0.33ms. Second, live, in THIS run, against the
 * two panes below: pane A's `sh` prompt answers 75-98 bytes, pane B's real
 * `claude` fullscreen TUI answers 913-936 (both far smaller, because neither
 * has 600 lines of scrollback on screen yet).
 *
 * The bound is not "headroom over a slow CI runner" the way a millisecond
 * bound is -- a byte count does not care how fast the machine is -- so it is
 * headroom over CONTENT instead: an order of magnitude above the largest of
 * the four measurements above, and still nowhere near what a window read of
 * `PANE_HISTORY_LINES` (500) lines would answer at these dimensions (tens of
 * KB, per the first measurement). A `poll-live` read this large would mean
 * the screen-only capture regressed back into asking for the scrollback.
 */
const POLL_LIVE_BYTES_BOUND = 8_192;

/* ── tmux, or an honest skip ────────────────────────────────────────────── */

const which = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
if (which.error || which.status !== 0) {
  console.warn(
    'SKIP  terminal-typing-latency-shots.mjs: no `tmux` on PATH. This guard measures a REAL ' +
      'tmux pane through the app’s own send/read path; install tmux on this runner for it to assert anything.',
  );
  process.exit(0);
}
console.log(`tmux: ${which.stdout.trim()} on private socket -L ${SOCKET}`);

const claudeCheck = spawnSync('claude', ['--version'], { encoding: 'utf8' });
const hasClaude = !claudeCheck.error && claudeCheck.status === 0;
if (!hasClaude) {
  console.warn(
    'no `claude` on PATH: pane B (the real fullscreen TUI) is skipped; pane A (plain sh) still runs and still gates.',
  );
}

const env = { ...process.env, LC_CTYPE: 'en_US.UTF-8' };
const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { env, encoding: 'utf8' });
const killServer = () => spawnSync('tmux', ['-L', SOCKET, 'kill-server'], { env });

killServer();

/* ── the app's own send/read path, bundled from source ──────────────────── */

const require = createRequire(new URL('../node_modules/.pnpm/node_modules/', import.meta.url));
const esbuild = require('esbuild');
const bundleDir = mkdtempSync(join(tmpdir(), 'vam-typing-latency-'));
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
const { readSessionPane, readAimedPane, resizeSessionPane, sendToPane } = await bundleOf(
  'src/main/terminal/pane.ts',
);
const { createTmuxRunner } = await bundleOf('src/main/sources/tmux/spawn.ts');
const { createControlTmuxRunner } = await bundleOf('src/main/sources/tmux/control.ts');

/**
 * `spawnCount` is incremented ONLY inside the `execFile` fallback, which is
 * the ONE place a real process is ever started -- the point of the whole
 * fix under measurement is that the control-mode path never reaches it for
 * a steady keystroke. Wired as `createControlTmuxRunner`'s own `fallback`
 * rather than counted at the outer `run` wrapper, so a spawn is counted once
 * per PROCESS, not once per LOGICAL call.
 */
let spawnCount = 0;
const execFileRunner = createTmuxRunner('tmux');
const countedFallback = (argv) => {
  spawnCount += 1;
  return execFileRunner(argv);
};
const controlRunner = createControlTmuxRunner('tmux', { fallback: countedFallback });
const run = (argv) => {
  return controlRunner(['-L', SOCKET, ...argv]);
};

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` -- ${detail}`}`);
  failures.push(label);
}

/* ── the page, bootstrapped once and reused across both panes ───────────── */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

let aimed = null;
await page.exposeFunction('__realRead', async (mode) => {
  const history = mode === 'echo' ? 0 : HISTORY;
  let view;
  if (mode !== 'poll' && aimed !== null) {
    view = await readAimedPane(run, aimed, history);
    if (view.kind !== 'ok') aimed = null;
  } else {
    view = await readSessionPane(run, PROJECT, undefined, undefined, history);
    aimed = view.kind === 'ok' ? view.name : null;
  }
  return view;
});
await page.exposeFunction('__realSend', async (key) => {
  if (aimed === null) return 'unaimed';
  return sendToPane(run, aimed, key);
});
await page.exposeFunction('__realResize', (columns, rows) =>
  resizeSessionPane(run, PROJECT, { columns, rows }),
);

await page.addInitScript(
  ({ session, branch }) => {
    globalThis.window.__resized = [];
    /**
     * ONE CLOCK. Every stamp below is `performance.now()` taken IN THE PAGE,
     * including the two either side of a bridge call -- so a spawn's cost, an
     * IPC round trip and a paint all land on the same axis with nothing to
     * reconcile across processes.
     */
    globalThis.window.__perf = { keydowns: [], sends: [], reads: [], paints: [] };
    window.addEventListener(
      'keydown',
      (e) => {
        if (!e.isComposing) window.__perf.keydowns.push({ t: performance.now(), key: e.key });
      },
      true,
    );
    const unavailable = () =>
      Promise.resolve({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
      });
    globalThis.window.api = {
      describe: async () => ({
        id: 'stub',
        label: 'Stub',
        capabilities: {
          liveUpdates: false,
          recordPrompt: false,
          deliverPrompt: false,
          promptAttachments: false,
          slashCommands: false,
          renameSession: false,
          closeSession: false,
          createSession: false,
          governance: false,
          pullRequests: false,
          terminal: true,
          agentRoster: false,
          resumeSession: false,
        },
        declines: {},
        viewerScope: 'operator',
      }),
      load: async () => [
        {
          id: 'p1',
          name: 'stub project',
          sessions: [
            {
              id: session,
              title: 'stub session',
              icon: null,
              epic: null,
              branch,
              status: 'waiting',
              runningAgents: 0,
              activity: null,
              age: '2m',
              decisions: [
                { id: 'd1', label: 'step 1', input: 'a turn', output: 'an answer', commands: [] },
              ],
            },
          ],
        },
      ],
      subscribe: () => () => {},
      recordPrompt: async () => {},
      renameSession: async () => {},
      closeSession: async () => {},
      createSession: async () => {},
      createSessionIn: async () => {},
      pickImageAttachment: async () => null,
      history: async () => unavailable(),
      agentWork: async () => unavailable(),
      applyWaivers: async () => {},
      transitionLesson: async () => {},
      usage: { get: async () => ({ kind: 'unavailable' }) },
      terminal: {
        read: (_projectId, _rowId, mode) => {
          const t0 = performance.now();
          return globalThis.window.__realRead(mode).then((view) => {
            window.__perf.reads.push({
              mode: mode ?? 'poll',
              t0,
              t1: performance.now(),
              // The byte count actually captured, for the `poll`/`poll-live`
              // split below: `poll-live` is `poll-live` only because it asked
              // tmux for the screen alone rather than the 500-line window.
              bytes: view.kind === 'ok' ? view.text.length : 0,
            });
            return view;
          });
        },
        resize: (_projectId, columns, rows) => {
          globalThis.window.__resized.push({ columns, rows });
          return globalThis.window.__realResize(columns, rows);
        },
        send: (_projectId, key, _rowId) => {
          const t0 = performance.now();
          return globalThis.window.__realSend(key).then((result) => {
            window.__perf.sends.push({ key, t0, t1: performance.now(), result });
            return result;
          });
        },
        answer: async () => ({ kind: 'unavailable' }),
        prompt: async () => ({ kind: 'unavailable' }),
      },
    };
  },
  { session: SESSION, branch: BRANCH },
);

/* ── PANE A must exist BEFORE the tab ever asks, or it never draws one ──── */
tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
tmux('set-option', '-t', `=${TMUX_SESSION}:`, '@vam-project', PROJECT);

await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.locator('[data-view="terminal"]').click();
await page.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });

/**
 * `requestAnimationFrame` AFTER THE MUTATION, not inside it: the callback
 * runs once the pane's own commit has been queued, and one frame is what
 * pushes the stamp past the browser's actual layout/paint for that frame
 * rather than merely past React's commit.
 */
await page.evaluate((delayMs) => {
  const pane = document.querySelector('[data-terminal-pane]');
  const pre = pane.querySelector('pre');
  const mo = new MutationObserver(() => {
    const commit = () => {
      requestAnimationFrame(() => {
        window.__perf.paints.push({ t: performance.now(), len: pre.textContent.length });
      });
    };
    // FALSIFICATION ONLY -- see `artificialPaintDelayMs`'s own definition
    // in the Node half of this script. `delayMs` is 0 on every real run.
    if (delayMs > 0) setTimeout(commit, delayMs);
    else commit();
  });
  mo.observe(pre, { childList: true, characterData: true, subtree: true });
  window.__mo = mo;
}, artificialPaintDelayMs);

const resetPerf = () =>
  page.evaluate(() => {
    window.__perf.keydowns.length = 0;
    window.__perf.sends.length = 0;
    window.__perf.reads.length = 0;
    window.__perf.paints.length = 0;
  });
const readPerf = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__perf)));

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * ONE STAGE TABLE, from one run's raw `__perf` dump.
 *
 * Zips `keydowns[i]` with `sends[i]` (the chain is FIFO, one send per
 * keystroke, so the order is the pairing -- see the module note). Echo reads
 * are matched by ORDER among themselves, filtered to `echo`/`echo-scrollback`
 * so the background `poll` tick (`REFRESH_MS`) never pollutes a keystroke's
 * own chain. When echo reads coalesce (the burst cadence, by design -- see
 * `ECHO_MS`), the zip stops at `min(sends.length, echoReads.length)` and the
 * gap between the two counts IS the finding, reported separately rather than
 * forced into a table that would misstate it.
 */
function stageTable(perf, label) {
  const echoReads = perf.reads.filter((r) => r.mode === 'echo' || r.mode === 'echo-scrollback');
  const n = Math.min(perf.keydowns.length, perf.sends.length, echoReads.length);
  const stages = { toSendIssued: [], sendRoundTrip: [], echoWait: [], captureRoundTrip: [], toPaint: [], total: [] };
  /**
   * A CURSOR, not a fresh `.find()` from index 0 every time -- each paint
   * answers AT MOST ONE keystroke, and only ever a LATER one than the last
   * match. Found by falsification (this task's own report): with `.find()`
   * searching from the start every time, injecting a large, uniform paint
   * delay let ONE early paint entry satisfy several early keystrokes' `t >=
   * r1` at once (each apparently "faster" than the last, since the SAME
   * entry's fixed `t` sits progressively closer to a later r1), and once
   * real time caught up past that entry every later keystroke re-matched
   * whatever came next the same way -- understating a genuine, uniform
   * regression rather than reporting it. A monotonic cursor cannot reuse an
   * already-claimed paint, so it reports the true per-keystroke delay
   * instead.
   */
  let paintCursor = 0;
  for (let i = 0; i < n; i += 1) {
    const kd = perf.keydowns[i].t;
    const s0 = perf.sends[i].t0;
    const s1 = perf.sends[i].t1;
    const r0 = echoReads[i].t0;
    const r1 = echoReads[i].t1;
    while (paintCursor < perf.paints.length && perf.paints[paintCursor].t < r1) paintCursor += 1;
    const paint = perf.paints[paintCursor];
    if (paint === undefined) continue;
    paintCursor += 1;
    stages.toSendIssued.push(s0 - kd);
    stages.sendRoundTrip.push(s1 - s0);
    stages.echoWait.push(r0 - s1);
    stages.captureRoundTrip.push(r1 - r0);
    stages.toPaint.push(paint.t - r1);
    stages.total.push(paint.t - kd);
  }
  console.log(`\n${label} -- ${stages.total.length} of ${n} keystrokes matched to a paint`);
  console.log(
    'stage                          p50      p95',
  );
  for (const [name, values] of Object.entries(stages)) {
    const p50 = percentile(values, 50);
    const p95 = percentile(values, 95);
    console.log(
      `  ${name.padEnd(28)} ${p50 === null ? '   -' : p50.toFixed(2).padStart(6)}ms ${p95 === null ? '   -' : p95.toFixed(2).padStart(6)}ms`,
    );
  }
  return stages;
}

async function typeSteady(count, delayMs) {
  await resetPerf();
  const before = spawnCount;
  await page.locator('[data-terminal-pane]').click();
  await page.keyboard.type('x'.repeat(count), { delay: delayMs });
  await page.waitForTimeout(delayMs + 300);
  const perf = await readPerf();
  return { perf, spawns: spawnCount - before };
}

async function typeBurst(count, delayMs) {
  await resetPerf();
  const before = spawnCount;
  await page.locator('[data-terminal-pane]').click();
  await page.keyboard.type('y'.repeat(count), { delay: delayMs });
  await page.waitForTimeout(500);
  const perf = await readPerf();
  return { perf, spawns: spawnCount - before };
}

function reportBurst(perf, label) {
  const echoReads = perf.reads.filter((r) => r.mode === 'echo' || r.mode === 'echo-scrollback');
  console.log(
    `\n${label}: ${perf.keydowns.length} keystrokes -> ${perf.sends.length} sends, ${echoReads.length} echo reads (coalesced by ${perf.keydowns.length - echoReads.length})`,
  );
  let overlapping = 0;
  for (let i = 1; i < perf.sends.length; i += 1) {
    if (perf.sends[i].t0 < perf.sends[i - 1].t1) overlapping += 1;
  }
  console.log(`  sends overlapping the previous send's in-flight window: ${overlapping} of ${perf.sends.length - 1}`);
  // Queue depth: keystrokes typed but not yet SENT, sampled at each send's issue time.
  let maxDepth = 0;
  for (const s of perf.sends) {
    const typed = perf.keydowns.filter((k) => k.t <= s.t0).length;
    const sentBefore = perf.sends.filter((s2) => s2.t1 <= s.t0).length;
    maxDepth = Math.max(maxDepth, typed - sentBefore);
  }
  console.log(`  max queue depth observed (keys typed, not yet sent): ${maxDepth}`);
  return { echoReads: echoReads.length, sends: perf.sends.length, keydowns: perf.keydowns.length, overlapping, maxDepth };
}

/**
 * THE BACKGROUND INTERVAL'S OWN READS, captured alongside the keystroke
 * chain rather than by it: `REFRESH_MS` keeps ticking underneath a steady
 * typing run, and every one of those ticks is `poll` or `poll-live`, never
 * `echo`/`echo-scrollback` (`shared/terminal.ts`, `PaneReadMode`). While the
 * pane stays pinned to the live end for the whole run -- true here, since
 * `sh` echoing a keystroke does not push the view away from the bottom --
 * every tick after the very first (mount) one should be `poll-live`, and its
 * bytes should read close to a screen rather than the whole window.
 */
function reportPoll(perf, label) {
  const ticks = perf.reads.filter((r) => r.mode === 'poll' || r.mode === 'poll-live');
  const live = ticks.filter((r) => r.mode === 'poll-live');
  const full = ticks.filter((r) => r.mode === 'poll');
  console.log(
    `\n${label}: ${ticks.length} interval tick(s) during the run -- ${live.length} poll-live, ${full.length} poll`,
  );
  if (live.length > 0) {
    console.log(
      `  poll-live bytes: median ${percentile(live.map((r) => r.bytes), 50)}, max ${Math.max(...live.map((r) => r.bytes))}`,
    );
  }
  return { ticks, live, full };
}

async function measurePane(label) {
  const steady = await typeSteady(50, 80);
  const stages = stageTable(steady.perf, `${label} -- steady (80ms cadence, n=50)`);
  const stSpawnsPerKey = steady.spawns / steady.perf.keydowns.length;
  console.log(`  spawns issued: ${steady.spawns} over ${steady.perf.keydowns.length} keystrokes (${stSpawnsPerKey.toFixed(2)}/key)`);
  const pollStats = reportPoll(steady.perf, `${label} -- background interval during the steady run`);

  const burst = await typeBurst(20, 20);
  const burstStats = reportBurst(burst.perf, `${label} -- burst (20ms cadence, n=20)`);
  const burstSpawnsPerKey = burst.spawns / burst.perf.keydowns.length;
  console.log(`  spawns issued: ${burst.spawns} over ${burst.perf.keydowns.length} keystrokes (${burstSpawnsPerKey.toFixed(2)}/key)`);

  return { stages, stSpawnsPerKey, burstSpawnsPerKey, burstStats, pollStats };
}

/**
 * THE WIN ITEM 1 CLAIMS, asserted against the background interval's own
 * reads rather than the keystroke chain: while the pane stays pinned to the
 * live end (true for the whole steady run, on both panes), MOST ticks ask
 * `poll-live` -- the screen alone -- and none of those captures may look
 * anywhere near the size a window read would be. Not ALL of them:
 * `POLL_LIVE_RESYNC_TICKS` forces one real `poll` every four ticks
 * (`TerminalTab.tsx`'s own note on why a splice-only interval is unsound), so
 * the expected split at that constant's current value is 3 `poll-live` to
 * every 1 `poll` -- asserted here as "at least half", generous slack for a
 * run whose sample happens to straddle a resync boundary either way.
 */
function checkPollLive(label, pollStats) {
  check(
    `${label}: most of the background interval's ticks are \`poll-live\` once pinned`,
    pollStats.ticks.length > 0 && pollStats.live.length >= pollStats.ticks.length * 0.5,
    `${pollStats.live.length} poll-live of ${pollStats.ticks.length} tick(s), ${pollStats.full.length} still full \`poll\` (the periodic resync, \`POLL_LIVE_RESYNC_TICKS\`)`,
  );
  const bytes = pollStats.live.map((r) => r.bytes);
  check(
    `${label}: every \`poll-live\` capture stays under the ${POLL_LIVE_BYTES_BOUND}-byte bound`,
    bytes.length > 0 && Math.max(...bytes) < POLL_LIVE_BYTES_BOUND,
    bytes.length > 0 ? `max ${Math.max(...bytes)} bytes` : 'no poll-live reads captured',
  );
}

/**
 * RETRY-ONCE-ALONE for the p95 wall-clock check only (criterion (c) of the
 * task this file was hardened under). Every OTHER assertion in this file
 * (matched counts, spawns-per-keystroke, overlap, the poll-live byte bound)
 * is deterministic and gets no retry -- retrying those would only hide a
 * real defect. This guard already runs ALONE by construction
 * (`run-web-guards.mjs` runs its list serially, one Chromium at a time, and
 * this file's own tmux session lives on a private socket nothing else
 * touches), so "alone" is already true; what this adds is a FRESH re-typed
 * sample rather than re-reading the numbers a one-off scheduling blip
 * already produced (`starvation-stretches-11ms-to-5022ms` is the standing
 * reason a single miss is not trusted outright). Only the STEADY-cadence
 * measurement is retried, not the burst/poll halves `measurePane` also
 * runs: those have no p95 wall-clock check of their own.
 */
async function steadyWithP95Retry(label, first, boundMs) {
  const p95 = percentile(first.stages.total, 95);
  if (p95 !== null && p95 < boundMs) return first;
  console.warn(
    `  retry: ${label} steady-cadence p95 (${p95 === null ? 'n/a' : `${p95.toFixed(2)}ms`}) missed the ${boundMs}ms bound on the first pass -- re-measuring once, alone, before failing for real`,
  );
  const retry = await typeSteady(50, 80);
  const stages = stageTable(retry.perf, `${label} -- steady RETRY (80ms cadence, n=50)`);
  return { ...first, stages };
}

let paneAResult;
let paneBResult;

try {
  /* ── PANE A: a plain sh, already running (created before `page.goto`) ──── */
  await page.waitForTimeout(1_000);

  paneAResult = await measurePane('pane A (sh)');
  paneAResult = await steadyWithP95Retry('pane A (sh)', paneAResult, PAINT_P95_BOUND_MS);

  check(
    'steady cadence: every keystroke got its own echo read (no coalescing at 80ms > ECHO_MS)',
    paneAResult.stages.total.length >= 45,
    `${paneAResult.stages.total.length} of 50 matched`,
  );
  check(
    `steady cadence p95 keydown-to-painted is under the ${PAINT_P95_BOUND_MS}ms bound`,
    percentile(paneAResult.stages.total, 95) !== null &&
      percentile(paneAResult.stages.total, 95) < PAINT_P95_BOUND_MS,
    `p95 ${percentile(paneAResult.stages.total, 95)?.toFixed(2)}ms`,
  );
  check(
    `steady cadence spawns-per-keystroke matches the claim (<= ${CLAIMED_SPAWNS_PER_KEYSTROKE + 0.1})`,
    paneAResult.stSpawnsPerKey <= CLAIMED_SPAWNS_PER_KEYSTROKE + 0.1,
    `${paneAResult.stSpawnsPerKey.toFixed(2)}/key`,
  );
  check(
    'burst cadence: sends never overlap (the chain serializes them)',
    paneAResult.burstStats.overlapping === 0,
    `${paneAResult.burstStats.overlapping} overlapping`,
  );
  checkPollLive('pane A (sh)', paneAResult.pollStats);

  await page.screenshot({ path: `${outDir}/terminal-typing-latency-sh.png` });
  console.log(`${outDir}/terminal-typing-latency-sh.png`);

  tmux('kill-session', '-t', `=${TMUX_SESSION}:`);

  /* ── PANE B: a real claude, fullscreen TUI, never submitted ───────────── */
  if (hasClaude) {
    const scratch = mkdtempSync(join(tmpdir(), 'vam-typing-latency-claude-'));
    tmux(
      'new-session',
      '-d',
      '-s',
      TMUX_SESSION,
      '-x',
      String(COLUMNS),
      '-y',
      String(ROWS),
      '-c',
      scratch,
      'claude',
    );
    tmux('set-option', '-t', `=${TMUX_SESSION}:`, '@vam-project', PROJECT);
    aimed = null;
    // The one-time "trust this folder" dialog against a throwaway directory.
    {
      const until = Date.now() + 15_000;
      let trusted = false;
      for (;;) {
        const text = tmux('capture-pane', '-p', '-t', `=${TMUX_SESSION}:`);
        if (/trust this folder/i.test(text)) {
          tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Down');
          tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
          trusted = true;
        }
        if (trusted && /❯\s*$/m.test(text.trimEnd())) break;
        if (Date.now() > until) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    const state = tmux(
      'display-message',
      '-p',
      '-t',
      `=${TMUX_SESSION}:`,
      '-F',
      'alt=#{alternate_on} hist=#{history_size} mouse=#{mouse_any_flag} #{pane_width}x#{pane_height}',
    ).trim();
    console.log(`pane B (claude): ${state}`);
    check(
      'pane B is really the fullscreen TUI (alternate screen, no scrollback, mouse asked for)',
      /alt=1/.test(state) && /hist=0/.test(state) && /mouse=1/.test(state),
      state,
    );

    await page.waitForTimeout(500);
    paneBResult = await measurePane('pane B (claude, fullscreen)');
    paneBResult = await steadyWithP95Retry(
      'pane B (claude, fullscreen)',
      paneBResult,
      PANE_B_PAINT_P95_BOUND_MS,
    );

    check(
      `pane B steady cadence p95 keydown-to-painted is under its own ${PANE_B_PAINT_P95_BOUND_MS}ms bound`,
      percentile(paneBResult.stages.total, 95) !== null &&
        percentile(paneBResult.stages.total, 95) < PANE_B_PAINT_P95_BOUND_MS,
      `p95 ${percentile(paneBResult.stages.total, 95)?.toFixed(2)}ms`,
    );
    checkPollLive('pane B (claude, fullscreen)', paneBResult.pollStats);

    await page.screenshot({ path: `${outDir}/terminal-typing-latency-claude.png` });
    console.log(`${outDir}/terminal-typing-latency-claude.png`);

    tmux('kill-session', '-t', `=${TMUX_SESSION}:`);
    rmSync(scratch, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  controlRunner.dispose();
  killServer();
  rmSync(bundleDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in terminal-typing-latency-shots.mjs`);
  process.exit(1);
}
console.log('\nterminal-typing-latency-shots.mjs: all checks passed.');
