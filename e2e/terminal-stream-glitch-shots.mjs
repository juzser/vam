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
// MEASURED, this task's own second defect: this row's own printf count
// used to disagree with BOX_TOP/BOX_BOTTOM's -- ` ❯ Try "how do I..."` is 20
// codepoints (space, ❯, space, then the 17-character quoted prompt text),
// so the padding needed to reach the SAME 98-column interior BOX_TOP/
// BOX_BOTTOM already have is 98 - 20 = 78 spaces, not 74. A real tmux (-L
// socket, `#{cursor_x}`) confirms BOTH sides render exactly as measured:
// `❯`/box-drawing characters are width 1 in tmux and xterm alike (no width-
// table disagreement here at all) -- this was the FIXTURE's own arithmetic
// bug, not a renderer defect, four columns short of the border it was
// supposed to align with.
const BOX_MID = `│ ❯ Try "how do I..."${' '.repeat(78)}│`;
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
// A REVIEW FINDING OF THIS FILE'S OWN, found chasing the cursor-offset
// checks below: `terminalStream.close` used to be a bare `() => {}`, so a
// `TerminalStreamTab.tsx` RECONNECT (`teardownStream()` before the next
// `connect()`, exactly what a real tab hide/show or a `visibilitychange`
// cycle drives) never disposed the OLD `StreamClient` here -- its real
// `tmux -C` child stayed attached forever, and `tmux list-clients` showed
// TWO clients on this one session after a single reconnect. Both received
// the SAME `%output` broadcast for every later keystroke (a real tmux
// broadcasts to every attached client), and both forwarded it through the
// identical `__deliverStreamData` global, so the ONE listener the renderer
// had registered by then was called twice per keystroke -- `hello` arriving
// as `hheelllloo`, discovered by the check (f)/(g) typed-text assertion
// below, NOT a product bug: `stream-ipc.ts`'s own real `closeClient(streamId)`
// already calls `client.dispose()` on an explicit close, this harness's own
// stub simply never wired the call through. Fixed by actually disposing the
// CURRENT `client` on close -- this harness only ever has one stream open at
// a time (`TerminalStreamTab.tsx`'s own invariant), so there is no second
// stream's client to keep track of instead.
await page.exposeFunction('__realClose', () => {
  client?.dispose();
  client = undefined;
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
        // Actually disposes the real `StreamClient` now -- see `__realClose`'s
        // own header for the two-attached-clients bug this used to hide.
        close: () => {
          void globalThis.__realClose();
        },
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
// `streamingTerminalMigrated: true` -- STREAMING DEFAULTS ON NOW
// (`prefs/streaming-terminal.ts`), and omitting this hits `prefs.ts`'s own
// one-time migration ratchet, which treats an UN-migrated payload's
// `streamingTerminal` as unwritten and forces it back to the new default
// regardless of what `on` says.
await page.addInitScript(({ on }) => {
  globalThis.localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({ streamingTerminal: on, streamingTerminalMigrated: true, theme: 'dark' }),
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

/**
 * (e) A WIDE GLYPH FOLLOWED BY `|` LANDS AT THE SAME COLUMN IN XTERM'S
 * BUFFER AS TMUX REPORTS -- the task brief's own falsifiable guard for the
 * xterm-vs-tmux Unicode WIDTH disagreement (distinct from check (b)'s
 * padding-on-mount bug and check (d)'s resize bug above): MEASURED against
 * this real tmux (`#{cursor_x}`, a private `-L` socket) and a real
 * `@xterm/xterm` Terminal headless, U+1F389 (🎉) reports width 2 in tmux
 * and width 1 under xterm's OWN DEFAULT (Unicode 6) table -- every cell
 * after it draws one column off from where tmux put it, this task's own
 * "the emoji overlaps the next character". `Unicode11Addon` (loaded by
 * `TerminalStreamTab.tsx`, `term.unicode.activeVersion = '11'`) is the fix;
 * `@xterm/addon-unicode-graphemes` was measured too (a real Terminal,
 * `activeVersion = '15-graphemes'`) and does NOT agree with tmux for this
 * same glyph -- grapheme clustering answers "how many codepoints form one
 * glyph", not "how many columns wide", a different question.
 *
 * tmux's own column is read via `#{cursor_x}` immediately after printing
 * (a trailing `sleep 3`, no `echo`, keeps the shell from drawing its next
 * prompt over this same row before the read -- `echo`'s own newline, used
 * by check (b)'s WWWW line above, would already have moved off this row by
 * the time `cursor_x` is queried, which is exactly why THIS check cannot
 * reuse that trick: it needs the cursor still ON the printed row). xterm's
 * own column is read from the RENDERED row's pixel width divided by the
 * cell width check (b) already measured off the WWWW row (same font, same
 * zoom, both real) -- not `.textContent.indexOf('|')`, which would count
 * CODEPOINTS (tmux's `capture-pane` text dump carries no width information
 * of its own) rather than the COLUMNS a disagreement actually shifts.
 *
 * FALSIFIED by hand against a real build: commenting out
 * `term.loadAddon(new Unicode11Addon())`/`term.unicode.activeVersion = '11'`
 * in `TerminalStreamTab.tsx` reddens this check (xterm column 11 vs tmux's
 * 12); restoring the two lines greens it again.
 *
 * WRITTEN TO A REAL FILE AND `cat`, not typed through `send-keys` as one
 * escaped line carrying raw UTF-8 -- this file's own header names that
 * exact trap (a hand-escaped fixture corrupting itself before tmux ever
 * saw a bug). Only the ASCII path itself crosses `send-keys`.
 */
const WIDE_MARK = 'wide 你好🎉|';
const wideMarkPath = join(bundleDir, 'wide-mark.txt');
writeFileSync(wideMarkPath, WIDE_MARK, 'utf8'); // no trailing newline: cat leaves the cursor right after `|`
tmux(
  'send-keys',
  '-t',
  `=${TMUX_SESSION}:`,
  '-l',
  '--',
  `clear; cat ${wideMarkPath}; sleep 3`,
);
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
await new Promise((r) => setTimeout(r, 500));
await page.waitForTimeout(500);

const tmuxWideMarkColumn = Number(
  tmux('display-message', '-p', '-t', `=${TMUX_SESSION}:`, '#{cursor_x}').trim(),
);
/**
 * XTERM'S OWN CURSOR ELEMENT, not the row `<div>`'s outer box: that box is
 * ALWAYS rendered at the terminal's full row width (760px, MEASURED,
 * regardless of how much of the row has real content) -- reading its
 * `getBoundingClientRect()` for "where did the content end" was this
 * check's own first bug, caught by its own row text coming back correct
 * while the computed column read 101 (essentially the row's full width in
 * cells). `.xterm-cursor`'s rendered LEFT edge, by contrast, is exactly
 * where xterm placed `buffer.active.cursorX` -- the same fact the DOM
 * renderer used to decide every span's own letter-spacing hack, read back
 * directly instead of re-derived from them.
 */
const xtermWideMarkMetrics = await page.evaluate(() => {
  const pane = document.querySelector('[data-terminal-stream]');
  const paneRect = pane?.getBoundingClientRect();
  const rows = pane?.querySelector('.xterm-rows');
  const markRow = rows
    ? [...rows.children].find((r) => (r.textContent ?? '').includes('wide') && (r.textContent ?? '').includes('|'))
    : null;
  const cursor = markRow?.querySelector('.xterm-cursor') ?? null;
  const cursorRect = cursor ? cursor.getBoundingClientRect() : null;
  return {
    text: markRow ? markRow.textContent : null,
    cursorLeftFromPane: cursorRect && paneRect ? cursorRect.left - paneRect.left : null,
  };
});
const xtermWideMarkColumn =
  xtermWideMarkMetrics.cursorLeftFromPane !== null && wideLineMetrics.cellWidth !== null
    ? Math.round(
        (xtermWideMarkMetrics.cursorLeftFromPane - wideLineMetrics.leftClearance) /
          wideLineMetrics.cellWidth,
      )
    : null;
check(
  'a line of wide glyphs (CJK + 🎉) followed by "|" places "|" at the same column in xterm’s buffer as tmux reports',
  xtermWideMarkColumn !== null && xtermWideMarkColumn === tmuxWideMarkColumn,
  `xterm column ${String(xtermWideMarkColumn)} vs tmux cursor_x ${tmuxWideMarkColumn} (row text ${JSON.stringify(xtermWideMarkMetrics.text)})`,
);
// Let the guard sleep finish so the shell is idle again before the next
// section reuses this same live session.
await new Promise((r) => setTimeout(r, 3000));

/**
 * (f)/(g) THE OPERATOR'S OWN REPORT, REPRODUCED FROM A SCREENSHOT
 * (`docs/design/ref/stream-cursor-offset-report.png`): "I type input but it
 * appears in the wrong position, off from the input box in the terminal" --
 * typed text landing on the row BELOW a Claude Code-style input box,
 * overwriting its bottom border ("——hello").
 *
 * A SECOND BOX FIXTURE, deliberately NOT the pane's last row -- status text
 * sits below it, exactly the screenshot's own shape. Drawn in ONE `cat`
 * (box, border, status lines) that ENDS with an embedded `CSI row;col H`
 * moving tmux's REAL cursor back up to right after the box's own `❯ ` --
 * mirroring how a real full-screen TUI redraws its whole frame and then
 * places the cursor for input -- followed by a blocking `read -r`, which
 * prints nothing, so the cursor stays exactly there. A real file + `cat`,
 * never a hand-escaped `send-keys` line (this file's own header note on
 * why).
 *
 * THE STREAM IS FORCED TO RESEED, not merely left to receive this as live
 * `%output`: a live write was never the bug (xterm has always followed an
 * explicit CSI in `%output` correctly) -- what this task fixes is the
 * SEED `StreamClient#connect`/`#reseed` produces when a view opens or
 * reconnects onto an ALREADY-IDLE pane, which is the operator's own
 * scenario (opening the Terminal tab onto a Claude Code session already
 * sitting at its prompt). A `visibilitychange` cycle drives the SAME
 * teardown-then-`connect()` path `TerminalStreamTab.tsx` wires to a real
 * tab switch, so this exercises the real seed path, not a shortcut.
 */
const BOX2_INTERIOR = 30;
const BOX2_TOP = `╭${'─'.repeat(BOX2_INTERIOR)}╮`;
const PROMPT_PREFIX = '│ ❯ ';
const BOX2_MID = `${PROMPT_PREFIX}${' '.repeat(BOX2_INTERIOR - (PROMPT_PREFIX.length - 1))}│`;
const BOX2_BOTTOM = `╰${'─'.repeat(BOX2_INTERIOR)}╯`;
const STATUS2 = '  ▶▶ auto mode on (shift+tab to cycle)';
// 1-based CSI coordinates: BOX2_TOP is row 1, BOX2_MID is row 2, right after
// PROMPT_PREFIX's own 4 characters (│, space, ❯, space) is column 5.
const PROMPT_ROW = 2;
const PROMPT_COL = PROMPT_PREFIX.length + 1;
const CURSOR_HOME = `\x1b[${PROMPT_ROW};${PROMPT_COL}H`;
const box2Path = join(bundleDir, 'box2.txt');
writeFileSync(
  box2Path,
  `${[BOX2_TOP, BOX2_MID, BOX2_BOTTOM, STATUS2].join('\n')}\n${CURSOR_HOME}`,
  'utf8',
);
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, '-l', '--', `clear; cat ${box2Path}; read -r _x`);
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
await new Promise((r) => setTimeout(r, 400));

// Force a fresh RECONNECT (teardown, then `connect()`) -- the same cycle a
// real tab switch drives -- so the assertions below are against a fresh
// SEED, not live `%output` riding the already-open connection.
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(150);
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForSelector('[data-terminal-stream]', { timeout: 5_000 });
await page.waitForTimeout(400);

await page.screenshot({ path: `${outDir}/terminal-streaming-cursor-offset-after.png` });
console.log(`${outDir}/terminal-streaming-cursor-offset-after.png`);

/* ── (f) after the (re)seed, xterm’s cursor lands on the SAME cell tmux itself reports ── */
const tmuxPromptCursor = tmux(
  'display-message',
  '-p',
  '-t',
  `=${TMUX_SESSION}:`,
  '#{cursor_flag} #{cursor_x} #{cursor_y}',
).trim();
const [promptCursorFlag, promptCursorXRaw, promptCursorYRaw] = tmuxPromptCursor.split(' ');
const tmuxPromptCursorX = Number(promptCursorXRaw);
const tmuxPromptCursorY = Number(promptCursorYRaw);
check(
  'tmux’s own cursor sits on the prompt row (row 1, 0-based), not the pane’s last row -- the fixture’s own precondition',
  promptCursorFlag === '1' && tmuxPromptCursorY === PROMPT_ROW - 1,
  tmuxPromptCursor,
);

const promptSeedCursorMetrics = await page.evaluate(() => {
  const pane = document.querySelector('[data-terminal-stream]');
  const paneRows = pane?.querySelectorAll('.xterm-rows > div');
  const cursorRowIndex = paneRows
    ? [...paneRows].findIndex((row) => row.querySelector('.xterm-cursor') !== null)
    : -1;
  const cursorEl = pane?.querySelector('.xterm-cursor') ?? null;
  const rowEl = cursorRowIndex >= 0 && paneRows ? paneRows[cursorRowIndex] : null;
  return {
    cursorRowIndex,
    cursorVisible: cursorEl !== null,
    rowText: rowEl ? (rowEl.textContent ?? '') : null,
  };
});
check(
  'xterm’s own cursor row (DOM), after the reseed, equals tmux’s cursor_y -- never the end of the seed text',
  promptSeedCursorMetrics.cursorRowIndex === tmuxPromptCursorY,
  JSON.stringify({ ...promptSeedCursorMetrics, tmuxPromptCursorY, tmuxPromptCursorX }),
);
check(
  'the cursor’s own row is the PROMPT row (carries the ❯ glyph), not the border row below it',
  typeof promptSeedCursorMetrics.rowText === 'string' &&
    promptSeedCursorMetrics.rowText.includes('❯'),
  JSON.stringify(promptSeedCursorMetrics),
);
// `__realClose`'s own header: the RECONNECT above must have disposed the
// FIRST client, not left it attached alongside the second -- falsified by
// hand (reverting `close` to `() => {}`) below this file's own header now
// records it caught `hheelllloo`.
const attachedClients = tmux('list-clients', '-F', '#{client_name}')
  .trim()
  .split('\n')
  .filter((line) => line.length > 0);
check(
  'the reconnect leaves exactly ONE tmux -C client attached, never two',
  attachedClients.length === 1,
  `attached: ${JSON.stringify(attachedClients)}`,
);

/* ── (g) typing lands ON the prompt row, and the border row below is left intact ── */
await page.locator('[data-terminal-stream]').click();
await page.waitForTimeout(150);
await page.keyboard.type('hello', { delay: 30 });
await page.waitForTimeout(400);

await page.screenshot({ path: `${outDir}/terminal-streaming-cursor-offset-typed.png` });
console.log(`${outDir}/terminal-streaming-cursor-offset-typed.png`);

const typedMetrics = await page.evaluate(() => {
  const pane = document.querySelector('[data-terminal-stream]');
  const rows = pane?.querySelector('.xterm-rows');
  return rows ? [...rows.children].map((r) => r.textContent ?? '') : [];
});
const promptRowAfterTyping = typedMetrics[tmuxPromptCursorY] ?? '';
const borderRowBelow = typedMetrics[tmuxPromptCursorY + 1] ?? '';
check(
  '"hello" landed ON the prompt row, right where ❯ is -- never a row below it',
  promptRowAfterTyping.includes('❯') && promptRowAfterTyping.includes('hello'),
  JSON.stringify({ promptRowAfterTyping, allRows: typedMetrics }),
);
check(
  'the border row directly below the prompt is untouched -- no "hello" landed there (the screenshot’s own "——hello")',
  !borderRowBelow.includes('hello') && /[─╰╯]/.test(borderRowBelow),
  JSON.stringify({ borderRowBelow }),
);

// Clear the blocking `read` before this session is reused/torn down below.
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
await new Promise((r) => setTimeout(r, 200));

/* ── the OFF screen, same fixture, for the before/after pair the report asks for ──
 * RE-PRINTED, not merely left over: checks (b) and (e) above both write their
 * OWN content into this same live session (the WWWW line, then WIDE_MARK),
 * so by this point the pane no longer shows the original box/CJK/VN fixture
 * this comment's own first line promises -- a pre-existing gap (check (b)'s
 * WWWW line already overwrote it before this section ran, even before this
 * task's own check (e) was added) that would otherwise hand the "before"
 * screenshot an empty prompt instead of the fixture the "after" screenshot
 * shows. `cat`, the same real file already on disk, never a second
 * hand-typed line. */
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, '-l', '--', `clear; cat ${fixturePath}`);
tmux('send-keys', '-t', `=${TMUX_SESSION}:`, 'Enter');
await new Promise((r) => setTimeout(r, 300));
// `streamingTerminalMigrated: true` too -- see the earlier `openInitScript`
// call's own note; this is the `on: false` half of the same comparison,
// which is the half the omission actually broke.
await page.addInitScript(({ on }) => {
  globalThis.localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({ streamingTerminal: on, streamingTerminalMigrated: true, theme: 'dark' }),
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
