/**
 * THE TERMINAL REALLY SCROLLS, AND IT REALLY STAYS AT THE BOTTOM.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * The operator's report, translated: "the terminal has no scroll". It was
 * exact. `capture-pane` with no `-S` returns the VISIBLE SCREEN and nothing
 * else, and `resizeWindowArgv` sizes the tmux window to exactly the rows the
 * pane can show — so the tab drew `rows` lines into a box `rows` tall,
 * `scrollHeight === clientHeight`, and there was nothing to scroll at all. The
 * hidden native scrollbar (`vam-no-scrollbar`) was not hiding a scrollbar;
 * there was no overflow under it. `sources/tmux/argv.ts` now asks for five
 * hundred lines of history above the screen.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST, AND WHAT IT DOES *NOT* PROVE ─────────
 * `scrollHeight`, `clientHeight` and a wheel are layout and input. happy-dom
 * reports zero for the first two and has no wheel at all, so
 * `test/panels/TerminalTab.scrollback.test.tsx` has to write the rectangles
 * itself: it can prove the pin's arithmetic and that every captured line is
 * drawn, and it cannot prove that a capture longer than the box produces
 * overflow, that the overflow is reachable, or that a poll leaves it alone.
 *
 * WHAT IS BEHIND THE PAGE IS A STUB, and this file is honest about the limit
 * that puts on it: the stub is what answers `read`, so nothing here can show
 * that vam asks TMUX for the history. That half is
 * `test/sources/tmux-history-live.test.ts`, which runs vam's own argv against
 * a real tmux over a private socket. What this file adds is the half that one
 * cannot reach — and it is not a free pass either, because the stub sizes its
 * screen from the rows VAM ITSELF ASKED FOR (`__resized`), so "the pane holds
 * more lines than the screen" is measured against vam's own number rather
 * than against a fixture's guess.
 *
 * Every string in the stub is invented — no session id, path, host or branch
 * here belongs to a real machine, which is the rule for anything this repo can
 * screenshot. `?demo=1` is kept on the URL for the reason
 * `terminal-chrome-shots.mjs` records: the stub is what actually answers, and
 * the marker says on the face of the request that nothing real is behind it.
 *
 * Falsified by hand, each mutation alone and restored after, against a real
 * build — the red is quoted in the PR that introduced this file:
 *   - clip the drawn lines to fewer than the box holds (`.slice(-20)` on the
 *     `lines` memo — the tempting way to make a long capture cheap, and the
 *     renderer-side shape of the defect itself) -> 6 checks redden, including
 *     `so the pane really overflows its box` with `679 <= 679`, which is the
 *     operator's report exactly.
 *   - make the pin unconditional (`scrollPane(pane, 'bottom', row)` with no
 *     `atBottom` guard) -> 4 redden: the poll between the wheel and the read
 *     throws the operator at the live end, so the wheel itself cannot be
 *     measured and neither `held` check can hold.
 *   - remove the pin -> 4 redden, from the other side: the pane opens at the
 *     top of the history, the caret sits 10376px below the box, and nothing
 *     follows the output.
 *
 * NOTE WHAT IS *NOT* IN THAT LIST. Dropping `-S` from `capturePaneArgv` — the
 * defect itself — changes NOTHING here, because the stub is what answers
 * `read`. That mutation reddens `test/sources/tmux-history-live.test.ts`
 * instead, against a real tmux; the two files are the two halves, and neither
 * on its own is the proof.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-scrollback-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'atlas-scrollback';
const BRANCH = 'work/atlas-scrollback';
/** How many lines of history the stub puts above the screen. */
const HISTORY = 500;

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

/**
 * A complete `PreloadSourceApi` stub whose `read` answers the way a tmux
 * capture with `-S -500` does: `HISTORY` lines that have scrolled off, then
 * exactly the rows VAM ASKED FOR, with the caret on the last of them.
 *
 * IT COUNTS ITS READS, and every read appends a line, because "stays at the
 * bottom while output is live" is not a question you can ask of a still
 * screen. The counter is also what makes each capture DIFFERENT — the tab
 * drops one identical to the screen it is showing before React sees it
 * (`TerminalTab.tsx`, `sameScreen`), which is correct and would make a static
 * fixture prove nothing about a poll.
 */
await page.addInitScript(
  ({ session, branch, history }) => {
    let reads = 0;
    globalThis.window.__resized = [];
    globalThis.window.__reads = () => reads;
    const screenRows = () => globalThis.window.__resized.at(-1)?.rows ?? 24;
    const capture = () => {
      reads += 1;
      const rows = screenRows();
      const lines = [];
      for (let i = 0; i < history; i += 1) {
        lines.push(`history ${String(i).padStart(4, '0')}  the agent printed this and it scrolled`);
      }
      for (let i = 0; i < rows; i += 1) {
        lines.push(`screen  ${String(i).padStart(4, '0')}  this line is on the visible screen now`);
      }
      // THE LAST LINE MOVES, which is what makes this live output rather than
      // a photograph of it.
      lines[lines.length - 1] = `screen  LAST  read ${String(reads).padStart(4, '0')}`;
      return { text: lines.join('\n'), row: lines.length - 1 };
    };
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
        read: async () => {
          const { text, row } = capture();
          return {
            kind: 'ok',
            name: 'vam-atlas-scrollback-a1b2c3',
            text,
            // The row is an index into THE TEXT, scrollback and all -- main
            // offsets tmux's screen-relative `cursor_y` by the history it
            // asked for (`shared/terminal.ts`, `PaneCursor`).
            cursor: { kind: 'at', column: 0, row },
          };
        },
        resize: async (_projectId, columns, rows) => {
          globalThis.window.__resized.push({ columns, rows });
          return true;
        },
        send: async () => 'sent',
        answer: async () => ({ kind: 'unavailable' }),
        prompt: async () => ({ kind: 'unavailable' }),
      },
    };
  },
  { session: SESSION, branch: BRANCH, history: HISTORY },
);

await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.locator('[data-view="terminal"]').click();
await page.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
// The measurement is debounced and the screen is sized from its answer, so
// two polls have to have gone by before anything here is true.
await page.waitForTimeout(2_400);

/** What the engine says about the pane, and what vam asked tmux for. */
const readPane = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-terminal-pane]');
    const screen = pane.querySelector('pre');
    const caret = pane.querySelector('[data-terminal-cursor]');
    const asked = globalThis.window.__resized.at(-1) ?? null;
    const paneBox = pane.getBoundingClientRect();
    const caretBox = caret === null ? null : caret.getBoundingClientRect();
    return {
      scrollTop: pane.scrollTop,
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
      drawn: (screen.textContent ?? '').split('\n').length,
      rows: asked === null ? null : asked.rows,
      reads: globalThis.window.__reads(),
      text: screen.textContent ?? '',
      caret:
        caretBox === null
          ? null
          : {
              top: caretBox.top - paneBox.top,
              bottom: caretBox.bottom - paneBox.top,
              height: paneBox.height,
            },
    };
  });

/* ── 1: THERE IS SOMETHING TO SCROLL, AND IT IS THE SCROLLBACK ───────────── */

const first = await readPane();
console.log('first read:', JSON.stringify({ ...first, text: undefined, caret: first.caret }));

check(
  'vam sized the tmux window to the rows its box can show',
  first.rows !== null && first.rows > 4,
  `vam asked for ${first.rows} rows`,
);
check(
  'the pane holds more lines than the screen vam sized — the scrollback is drawn',
  first.rows !== null && first.drawn > first.rows,
  `${first.drawn} lines drawn against a ${first.rows}-row screen`,
);
check(
  'so the pane really overflows its box, which is what there was none of',
  first.scrollHeight > first.clientHeight,
  `${first.scrollHeight} <= ${first.clientHeight}`,
);

/* ── 2: IT ARRIVES AT THE LIVE END AND STAYS THERE ───────────────────────── */

const atBottom = (seen, slack = 2) =>
  seen.scrollHeight - seen.scrollTop - seen.clientHeight <= slack;

check(
  'the pane arrives at the live end rather than at the top of the history',
  atBottom(first),
  `scrollTop ${first.scrollTop} of ${first.scrollHeight - first.clientHeight}`,
);
check(
  'and the caret — whose row counts from the top of the WHOLE capture — is visible in it',
  first.caret !== null && first.caret.top >= 0 && first.caret.bottom <= first.caret.height + 1,
  first.caret === null ? 'no caret drawn' : JSON.stringify(first.caret),
);

await page.waitForTimeout(2_400);
const following = await readPane();
check(
  'it follows the output down as the agent keeps printing',
  following.reads > first.reads && atBottom(following),
  `after ${following.reads - first.reads} more reads: scrollTop ${following.scrollTop} of ${following.scrollHeight - following.clientHeight}`,
);
// The screen's last line is the one that moves; read it back to prove the
// operator is looking at the newest output rather than at a stale bottom.
check(
  'and what is at the bottom is the newest line, not the one the tab opened on',
  following.text.trimEnd().endsWith(`read ${String(following.reads).padStart(4, '0')}`),
  following.text.trimEnd().slice(-40),
);

await page.screenshot({ path: `${outDir}/terminal-scrollback-bottom.png` });
console.log(`${outDir}/terminal-scrollback-bottom.png`);

/* ── 3: THE WHEEL REACHES THE HISTORY, AND THE POLL LEAVES IT ALONE ──────── */

await page.locator('[data-terminal-pane]').hover();
await page.mouse.wheel(0, -1_200);
await page.waitForTimeout(150);
const scrolled = await readPane();
check(
  'a wheel over the pane really moves it back into the history',
  scrolled.scrollTop < following.scrollTop - 100,
  `${scrolled.scrollTop} against ${following.scrollTop}`,
);
check(
  'and what is on screen there is the scrollback, not the live screen',
  !atBottom(scrolled),
  `scrollTop ${scrolled.scrollTop} of ${scrolled.scrollHeight - scrolled.clientHeight}`,
);

await page.screenshot({ path: `${outDir}/terminal-scrollback-scrolled.png` });
console.log(`${outDir}/terminal-scrollback-scrolled.png`);

await page.waitForTimeout(2_400);
const held = await readPane();
// `!atBottom` AS WELL AS "unmoved", and it is not belt and braces: without it
// this check passes trivially whenever the one above it has already failed --
// a pane yanked to the bottom before the wheel was measured is "unmoved" from
// a position that was never the operator's. Measured: with the pin made
// unconditional, this check stayed green on that account alone.
check(
  'the pane is left where the operator put it when the next capture arrives',
  held.reads > scrolled.reads && Math.abs(held.scrollTop - scrolled.scrollTop) <= 2 && !atBottom(held),
  `${held.scrollTop} against ${scrolled.scrollTop}, after ${held.reads - scrolled.reads} reads`,
);

await page.waitForTimeout(2_400);
const stillHeld = await readPane();
check(
  'and is still there after three more reads — a terminal that jumps is worse than none',
  Math.abs(stillHeld.scrollTop - scrolled.scrollTop) <= 2 && !atBottom(stillHeld),
  `${stillHeld.scrollTop} against ${scrolled.scrollTop}`,
);

/* ── 4: GOING BACK TO THE BOTTOM RE-PINS IT ──────────────────────────────── */

// `End` is one of the six scroll keys the pane binds (`SCROLL_KEYS`), and the
// pane has to hold the keyboard for it — a click is how an operator gives it.
await page.locator('[data-terminal-pane]').click();
await page.keyboard.press('End');
await page.waitForTimeout(150);
const returned = await readPane();
check(
  'End takes the operator back to the live end',
  atBottom(returned),
  `scrollTop ${returned.scrollTop} of ${returned.scrollHeight - returned.clientHeight}`,
);

await page.waitForTimeout(2_400);
const followingAgain = await readPane();
check(
  'and the pane follows the output again once they are back at it',
  followingAgain.reads > returned.reads && atBottom(followingAgain),
  `scrollTop ${followingAgain.scrollTop} of ${followingAgain.scrollHeight - followingAgain.clientHeight}`,
);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in terminal-scrollback-shots.mjs`);
  process.exit(1);
}
console.log('\nterminal-scrollback-shots.mjs: all checks passed.');
