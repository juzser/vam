/**
 * THE STREAMING-GLITCH REPORT, REPRODUCED AGAINST A REAL TMUX: two operator
 * complaints, translated -- "In xterm mode, the input line shows 3
 * nonsensical question-mark symbols, and on the right there is a grey bar
 * that the input line overlaps", escalated to "Xterm mode is displaying
 * wrong and all the output is misaligned; it looks like the width is not
 * being computed correctly against the wrapper."
 *
 * ── WHY THIS NEEDS A REAL TMUX, unlike `terminal-stream-frame-shots.mjs` ──
 * That file's own stub answers `terminalStream.open` with a canned seed --
 * proven CSS/font parity, never proven that CONTENT survives the real
 * control-mode wire. This file bundles the SHIPPED `StreamClient`
 * (`src/main/terminal/stream/client.ts`) with esbuild -- the same technique
 * `terminal-stream-latency-shots.mjs` already uses -- and bridges it to a
 * REAL `tmux -L <private socket>` pane through `page.exposeFunction`, so the
 * REAL `TerminalStreamTab.tsx` (mounted through the `?demo=1` fixture, same
 * technique `terminal-stream-frame-shots.mjs` uses) is driven end to end:
 * real control-mode bytes in, real `@xterm/xterm` DOM out.
 *
 * ── THE FIXTURE ────────────────────────────────────────────────────────────
 * A Claude Code-style input box (`╭─…─╮`/`│ ❯ …│`/`╰─…─╯`, the `⏵⏵ accept
 * edits on` / `✻` status glyphs this task's own brief names), a CJK line
 * with a wide emoji, and Vietnamese with a combining acute -- written to a
 * real file and `cat`, never typed through `send-keys` as one long escaped
 * line (a shell-quoting trap this file's own author hit first: tmux's
 * control-mode line is ALSO shell-like grammar, `control-protocol.ts`'s own
 * module note, and a hand-escaped fixture corrupted itself before tmux ever
 * saw a bug).
 *
 * ── WHAT WAS FOUND, both real (this file falsifies each independently) ────
 *   1. `TerminalStreamTab.tsx` used to put the frame's `px-3 py-2` padding
 *      on the SAME element `term.open()` mounts into. `@xterm/addon-fit`
 *      reads that element's PARENT's `getComputedStyle().width` for the
 *      available space -- which, under this renderer's own `box-sizing:
 *      border-box` (Tailwind's preflight), is the BORDER-BOX size, padding
 *      included -- and subtracts only the MOUNT element's own (zero)
 *      padding, never the padding vam put there. MEASURED: cols computed
 *      105 against a 781px content box that only fit ~101, and
 *      `.xterm-screen` rendered 790px wide inside a 781px viewport, eating
 *      most of the right padding. Fixed by moving the padding to an OUTER
 *      frame and mounting into an INNER, unpadded `[data-terminal-stream-mount]`
 *      div that fills it.
 *   2. A seed (`capture-pane -p`'s own bare-`\n`-joined text dump) written
 *      into a `convertEol: false` terminal never returns the cursor to
 *      column 0 between rows -- a staircase, one row's width worse each
 *      line, that is this task's OWN reproduction of "3 nonsensical
 *      question-mark symbols" (a box-drawn `│`/`╮`/`╯` landing mid-row reads
 *      as noise) and of "ALL the output is misaligned". Fixed by
 *      `asXtermSeed()` (`TerminalStreamTab.tsx`), converting a bare `\n` to
 *      `\r\n` before every `term.write()` of a seed.
 *   3. `.xterm-viewport`'s own vendor CSS paints a hardcoded `background:
 *      #000`; `@xterm/addon-fit` also always reserves 14 real px on the
 *      right for a native scrollbar this pane already hides via CSS
 *      (`scrollbar-width: none`) -- unfixable without also instantiating
 *      xterm's OWN overview-ruler canvas (falsified below: it crashes
 *      `@vitest-environment happy-dom` outright, `Ctx cannot be null`, and
 *      would add a real second canvas layer in production). Fixed instead
 *      by painting that leftover strip transparent (`styles.css`), so the
 *      frame's own themed background shows through it rather than a black
 *      seam -- this task's own "grey bar".
 *   REFUTED: hypothesis 1 (the control CLIENT's own locale corrupting
 *      `%output` bytes). Run with EVERY `LANG`/`LC_*` stripped from
 *      `process.env` (no `applyUtf8Ctype` in this harness at all, a
 *      launchd-shaped environment) -- the full fixture, CJK and combining
 *      marks included, still decoded byte-for-byte correctly. tmux's
 *      control-mode wire only escapes bytes below 32
 *      (`decodeOutputPayload`'s own header); the client's locale governs
 *      `-F` FORMAT-STRING expansion (`utf8-ctype.ts`'s own repair, a
 *      different bug with its own test file), never pane bytes.
 *
 *   4. TMUX'S OWN WINDOW SIZE has to equal what xterm fit itself to, not
 *      merely echo the last number this pane sent -- `TerminalStreamTab.tsx`
 *      used to re-assert this on the INITIAL `connect()` only; a
 *      `StreamClient` reconnect or a `%pause`/`%continue` catch-up pushes a
 *      fresh seed through the SAME `onSeed` subscription without re-opening
 *      the stream, and nothing re-sent `resize-window` on that path. Fixed by
 *      refitting and re-resizing inside `onSeed` too, checked here against
 *      the REAL tmux server (check (d), `#{window_width}x#{window_height}`),
 *      never a client-side echo of the number this pane itself last sent.
 *   INVESTIGATED, NO CHANGE NEEDED: whether a second attached client (the
 *      operator's tmux, outside vam) fights this pane's `resize-window` over
 *      tmux's own `window-size latest` option. MEASURED on a real tmux 3.7b:
 *      `StreamClient`'s own `-C attach-session` (no real tty, no `-x`/`-y`)
 *      never overrides a manual `resize-window`, whether idle or freshly
 *      active as tmux's own "latest" client -- vam's architecture never
 *      creates the contention this would require (`TerminalTab.tsx`'s own
 *      polling path never attaches a client at all, `control.ts`'s own
 *      persistent connection attaches to a SEPARATE housekeeping session,
 *      never the operator's). A genuine second REAL client (the operator
 *      attached by hand, outside vam) can still win this fight -- an
 *      inherent tmux characteristic `TerminalTab.tsx`'s own `resize-window`
 *      calls are equally exposed to today, predating this task and out of
 *      this fix's own scope.
 *
 * Falsified by hand, each alone, against a real build:
 *   - put the padding back on `[data-terminal-stream-mount]` -> the ORIGINAL
 *     version of check (b) (reading its own expected clearance off
 *     `[data-terminal-stream]`'s `paddingRight`) did NOT redden: moving the
 *     padding also moves where that check reads its OWN expectation from, so
 *     `paddingRight` read back `0` and the check's target quietly widened to
 *     match (MEASURED: `wRowRight` 1082 <= a `contentRight` that had grown to
 *     1086, while the real clearance had gone asymmetric, 13px left vs 4px
 *     right). Check (b) is now two checks measuring LEFT vs RIGHT clearance
 *     directly off the frame's own rendered rectangle, fooled by neither
 *     element's CSS -- re-falsified against the identical bug afterward:
 *     13px vs 4px, correctly caught.
 *   - drop `asXtermSeed()`'s `\r\n` conversion -> check (c) reddens (the
 *     box/CJK/combining-mark lines no longer match the fixture).
 *   - disable every `terminal.resize` call site -> check (d) reddens
 *     (xterm fits to 101x34, tmux stays at the session's original 80x24).
 *
 * Run by hand (real tmux required; skips cleanly without one):
 *   node e2e/terminal-stream-glitch-shots.mjs http://localhost:5520 docs/ui
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SOCKET = 'vam-stream-glitch-e2e';
const TMUX_SESSION = 'vam-stream-glitch-e2e-a1b2c3';
const COLUMNS = 80;
const ROWS = 24;

const which = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
if (which.error || which.status !== 0) {
  console.warn(
    'SKIP  terminal-stream-glitch-shots.mjs: no `tmux` on PATH. This guard measures the REAL ' +
      'streaming client against a real tmux control-mode connection; install tmux on this runner for it to assert anything.',
  );
  process.exit(0);
}
console.log(`tmux: ${which.stdout.trim()} on private socket -L ${SOCKET}`);

const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8' });
const killServer = () => spawnSync('tmux', ['-L', SOCKET, 'kill-server']);
killServer();

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/* ── the SHIPPED client, bundled from source (terminal-stream-latency-shots.mjs's own technique) ── */
const require = createRequire(new URL('../node_modules/.pnpm/node_modules/', import.meta.url));
const esbuild = require('esbuild');
const bundleDir = mkdtempSync(join(tmpdir(), 'vam-stream-glitch-e2e-'));
const { StreamClient } = await (async () => {
  const outfile = join(bundleDir, 'client.mjs');
  await esbuild.build({
    entryPoints: [new URL('../src/main/terminal/stream/client.ts', import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
})();

tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');

/* ── the fixture: a real UTF-8 file, `cat`, never a hand-escaped send-keys line ── */
const BOX_TOP = `╭${'─'.repeat(98)}╮`;
const BOX_MID = `│ ❯ Try "how do I..."${' '.repeat(74)}│`;
const BOX_BOTTOM = `╰${'─'.repeat(98)}╯`;
const STATUS = '  ⏵⏵ accept edits on (shift+tab to cycle)   ✻ Ready';
const CJK = 'CJK: 你好世界 🎉 emoji';
const VN = `VN combining: é (e + acute) and Tiển đề`;
const DIGITS = 'DIGITS0123456789';
const FIXTURE_LINES = [BOX_TOP, BOX_MID, BOX_BOTTOM, STATUS, CJK, VN, DIGITS];
const fixturePath = join(bundleDir, 'fixture.txt');
writeFileSync(fixturePath, `${FIXTURE_LINES.join('\n')}\n`, 'utf8');
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, '-l', '--', `clear; cat ${fixturePath}`);
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
await new Promise((r) => setTimeout(r, 300));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

let client;
let deliverChain = Promise.resolve();
await page.exposeFunction('__realOpen', async () => {
  client = new StreamClient({ binary: 'tmux', prefix: ['-L', SOCKET], target: TMUX_SESSION });
  client.onData((chunk) => {
    deliverChain = deliverChain
      .then(() => page.evaluate((c) => globalThis.window.__deliverStreamData?.(c), chunk))
      .catch((err) => console.error('deliver to page failed:', err));
  });
  client.onSeed((seed) => {
    void page.evaluate((s) => globalThis.window.__deliverStreamSeed?.(s), seed);
  });
  client.onDown((event) => {
    void page.evaluate((e) => globalThis.window.__deliverStreamDown?.(e), event);
  });
  const seed = await client.connect();
  return { ok: true, streamId: 'real-stream', seed, name: TMUX_SESSION };
});
await page.exposeFunction('__realWrite', (text) => {
  client?.write(text);
});
await page.exposeFunction('__realResize', (cols, rows) => {
  try {
    tmux('resize-window', '-t', `=${TMUX_SESSION}:`, '-x', String(cols), '-y', String(rows));
    return true;
  } catch (err) {
    console.error('resize-window failed:', err.message);
    return false;
  }
});
// So the OFF (polling) screenshot below shows the SAME real fixture the
// streaming path does, rather than a canned/empty stub -- a real
// `capture-pane`, on demand, the same call `terminal/pane.ts`'s own
// `readPane` makes in production.
await page.exposeFunction('__realRead', () => tmux('capture-pane', '-e', '-p', '-t', `=${TMUX_SESSION}:`));

const SESSION = 'atlas-stream-glitch';
const BRANCH = 'work/atlas-stream-glitch';

await page.addInitScript(
  ({ session, branch, tmuxName }) => {
    const listeners = { data: new Map(), seed: new Map(), down: new Map() };
    globalThis.window.__deliverStreamData = (chunk) => {
      for (const l of listeners.data.values()) l(chunk);
    };
    globalThis.window.__deliverStreamSeed = (seed) => {
      for (const l of listeners.seed.values()) l(seed);
    };
    globalThis.window.__deliverStreamDown = (event) => {
      for (const l of listeners.down.values()) l(event);
    };
    let n = 0;
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
              decisions: [],
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
      history: async () => ({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'stub' },
      }),
      agentWork: async () => ({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'stub' },
      }),
      applyWaivers: async () => {},
      transitionLesson: async () => {},
      usage: { get: async () => ({ kind: 'unavailable' }) },
      terminal: {
        read: async () => ({
          kind: 'ok',
          name: tmuxName,
          text: await globalThis.__realRead(),
          cursor: { kind: 'unreadable' },
        }),
        resize: async (_projectId, columns, rows) => await globalThis.__realResize(columns, rows),
        send: async () => 'sent',
        answer: async () => ({ kind: 'unavailable' }),
        prompt: async () => ({ kind: 'unavailable' }),
      },
      terminalStream: {
        open: async () => await globalThis.__realOpen(),
        close: () => {},
        write: (_streamId, bytes) => {
          void globalThis.__realWrite(new TextDecoder().decode(bytes));
        },
        onData: (_streamId, listener) => {
          const id = n++;
          listeners.data.set(id, listener);
          return () => listeners.data.delete(id);
        },
        onSeed: (_streamId, listener) => {
          const id = n++;
          listeners.seed.set(id, listener);
          return () => listeners.seed.delete(id);
        },
        onDown: (_streamId, listener) => {
          const id = n++;
          listeners.down.set(id, listener);
          return () => listeners.down.delete(id);
        },
      },
    };
  },
  { session: SESSION, branch: BRANCH, tmuxName: TMUX_SESSION },
);
await page.addInitScript(({ on }) => {
  globalThis.localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({ streamingTerminal: on, theme: 'dark' }),
  );
}, { on: true });

await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.locator('[data-view="terminal"]').click();
await page.waitForSelector('[data-terminal-stream]', { timeout: 5_000 });
await page.waitForTimeout(600);
await page.locator('[data-terminal-stream]').click();
await page.waitForTimeout(200);

await page.screenshot({ path: `${outDir}/terminal-streaming-unicode-on.png` });
console.log(`${outDir}/terminal-streaming-unicode-on.png`);

/* ── (c) the unicode/box fixture renders byte-for-byte correct ─────────── */
const rowTexts = await page.evaluate(() => {
  const pane = document.querySelector('[data-terminal-stream]');
  const rows = pane?.querySelector('.xterm-rows');
  return rows ? [...rows.children].map((r) => r.textContent ?? '') : [];
});
for (const line of FIXTURE_LINES) {
  const found = rowTexts.some((t) => t.trimEnd() === line.trimEnd() || t.includes(line));
  check(`the streamed screen renders this line correctly: ${JSON.stringify(line)}`, found, rowTexts.join('\n'));
}

/* ── (a) no visible scrollbar element with nonzero painted width ────────── */
const scrollbarMetrics = await page.evaluate(() => {
  const pane = document.querySelector('[data-terminal-stream]');
  const viewport = pane?.querySelector('.xterm-viewport');
  if (!viewport) return null;
  return {
    scrollbarWidthStyle: getComputedStyle(viewport).scrollbarWidth,
    paintedScrollbar: viewport.offsetWidth - viewport.clientWidth,
    viewportBackground: getComputedStyle(viewport).backgroundColor,
    frameBackground: getComputedStyle(pane).backgroundColor,
  };
});
check(
  'the xterm viewport declares no native scrollbar (scrollbar-width: none)',
  scrollbarMetrics?.scrollbarWidthStyle === 'none',
  JSON.stringify(scrollbarMetrics),
);
check(
  'no native scrollbar is actually painted with nonzero width inside the frame',
  scrollbarMetrics?.paintedScrollbar === 0,
  JSON.stringify(scrollbarMetrics),
);
check(
  'the viewport paints no background of its own -- the frame’s own theme shows through any leftover strip',
  scrollbarMetrics?.viewportBackground === 'rgba(0, 0, 0, 0)',
  JSON.stringify(scrollbarMetrics),
);

/* ── (b) the rightmost cell of a full-width line lies inside the frame's content box ── */
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, '-l', '--', `printf '%0.sW' $(seq 1 400); echo`);
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
await new Promise((r) => setTimeout(r, 500));
await page.waitForTimeout(500);

/**
 * MEASURED BLIND SPOT, closed here (falsified against the padding-on-mount
 * bug this file's own header names): the ORIGINAL version of this check read
 * `contentRight` from `[data-terminal-stream]`'s OWN `getComputedStyle(...)
 * .paddingRight` -- a PROXY for "where the padding lives", not the padding
 * itself. Reintroducing the bug by hand (padding moved onto
 * `[data-terminal-stream-mount]`, none left on the frame) also moves WHERE
 * this check reads its own expectation from, so `paddingRight` read back `0`
 * and `contentRight` silently widened to match -- the check still passed
 * (`wRowRight` 1082 <= a `contentRight` that had quietly grown to 1086) while
 * the REAL, painted clearance had gone asymmetric: 13px on the left (the
 * mount's OWN padding, still real) against 4px on the right (`this repo's own
 * standing lesson, "assert the property not its proxy"`).
 *
 * THE FIX: measure clearance directly off the FRAME's outer box
 * (`paneRect`), on BOTH sides, and assert them symmetric -- nothing here can
 * be fooled by which element currently claims to own the padding, because
 * neither side is read from a CSS property at all, only from rendered
 * rectangles. The right side is allowed to run a little WIDER than the left
 * (never narrower) by up to one cell plus `@xterm/addon-fit`'s own permanent
 * `DEFAULT_SCROLL_BAR_WIDTH` (14px) reservation for a scrollbar this pane
 * never draws (`styles.css`'s own comment on that same 14px) -- both are
 * unavoidable, already-documented slack, not a defect.
 */
const wideLineMetrics = await page.evaluate(() => {
  const pane = document.querySelector('[data-terminal-stream]');
  const paneRect = pane.getBoundingClientRect();
  const rows = pane.querySelector('.xterm-rows');
  const wRow = rows
    ? [...rows.children].find((r) => (r.textContent ?? '').includes('WWWWWWWWWW'))
    : null;
  const wRowRect = wRow ? wRow.getBoundingClientRect() : null;
  const cellWidth = wRowRect && wRow.textContent.length > 0 ? wRowRect.width / wRow.textContent.length : null;
  return {
    paneRect,
    wRowRect,
    cellWidth,
    leftClearance: wRowRect ? wRowRect.left - paneRect.left : null,
    rightClearance: wRowRect ? paneRect.right - wRowRect.right : null,
    // `.xterm-rows` always renders exactly `term.rows` row elements (the DOM
    // renderer's own viewport, one per screen row, regardless of scrollback)
    // -- reading its CHILD COUNT is `term.rows` with no private API needed.
    // `cols` has no equivalent single DOM count, so it is read off THIS row
    // instead: a full, un-wrapped middle row of a 400-`W` line is exactly
    // `cols` characters wide by construction (tmux wraps it at exactly the
    // window's own column count), so its `textContent.length` IS `term.cols`
    // whenever the wrap happened at the size this pane itself asked for.
    rowsCount: rows ? rows.children.length : null,
    colsFromWideRow: wRow ? wRow.textContent.length : null,
  };
});
const SCROLLBAR_RESERVE_PX = 14; // `@xterm/addon-fit`'s own `DEFAULT_SCROLL_BAR_WIDTH`.
check(
  'a full-width line’s rightmost drawn cell never crowds the right edge tighter than the left (the padding-on-mount bug’s own symptom)',
  wideLineMetrics.rightClearance !== null &&
    wideLineMetrics.leftClearance !== null &&
    wideLineMetrics.rightClearance >= wideLineMetrics.leftClearance - 2,
  JSON.stringify(wideLineMetrics),
);
check(
  'and the right side is not implausibly wider either (no more than one cell plus the scrollbar reservation past the left)',
  wideLineMetrics.rightClearance !== null &&
    wideLineMetrics.leftClearance !== null &&
    wideLineMetrics.cellWidth !== null &&
    wideLineMetrics.rightClearance <=
      wideLineMetrics.leftClearance + SCROLLBAR_RESERVE_PX + wideLineMetrics.cellWidth + 2,
  JSON.stringify(wideLineMetrics),
);

/**
 * (d) TMUX'S OWN WINDOW SIZE MUST EQUAL WHAT XTERM FIT ITSELF TO -- the task
 * brief's own guard, checked against the REAL tmux server this file already
 * drives (`#{window_width}x#{window_height}`, the same tmux format string
 * `argv.ts`'s own `resizeWindowArgv` targets), never a client-side echo of
 * the number this pane itself sent. A mismatch here means the
 * `terminal.resize` IPC call either never reached tmux, or tmux declined it
 * (a second, real client attached with its own reported size -- `window-size
 * latest`, this repo's own investigation for this task found no such second
 * client in vam's own architecture, but this check would catch it returning).
 */
const tmuxWindowSize = tmux('display-message', '-p', '-t', `=${TMUX_SESSION}:`, '#{window_width}x#{window_height}').trim();
check(
  'tmux’s own window size equals xterm’s fitted cols×rows (not merely what this pane last asked for)',
  wideLineMetrics.colsFromWideRow !== null &&
    wideLineMetrics.rowsCount !== null &&
    tmuxWindowSize === `${wideLineMetrics.colsFromWideRow}x${wideLineMetrics.rowsCount}`,
  `xterm ${wideLineMetrics.colsFromWideRow}x${wideLineMetrics.rowsCount} vs tmux ${tmuxWindowSize}`,
);

/* ── the OFF screen, same fixture, for the before/after pair the report asks for ── */
await page.addInitScript(({ on }) => {
  globalThis.localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({ streamingTerminal: on, theme: 'dark' }),
  );
}, { on: false });
await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.locator('[data-view="terminal"]').click();
await page.waitForSelector('[data-terminal-pane]', { timeout: 5_000 }).catch(() => {});
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/terminal-streaming-unicode-off.png` });
console.log(`${outDir}/terminal-streaming-unicode-off.png`);

await browser.close();
client?.dispose();
tmux('kill-session', '-t', `=${TMUX_SESSION}:`);
killServer();
rmSync(bundleDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll terminal-stream-glitch checks passed.');
