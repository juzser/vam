/**
 * THE TERMINAL STILL SCROLLS WHILE THE OPERATOR IS TYPING INTO IT.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * The operator's report, translated: "can't scroll in the terminal view",
 * against a build carrying the echo read's screen-only capture (#437). It was
 * exact, and it was a chicken and egg. An `echo` read answers with the SCREEN
 * alone -- the whole of its measured win, 7,760 bytes against 86,260 -- and
 * the tab put that answer on screen as the entire view, so the five hundred
 * lines above it left the DOM with it. A pane holding one screen has
 * `scrollHeight === clientHeight` and nothing to scroll; `atLiveEnd()` is
 * therefore permanently true, so `echo-scrollback` is never asked for; and
 * while typing continues the echo sequence outruns every poll's full window,
 * whose answer the sequence guard then drops as stale. MEASURED here, on the
 * build that shipped: `scrollHeight` collapsed 10401 -> 714 against a
 * `clientHeight` of 714 the moment typing began, stayed there across every
 * interleaved `poll`, and a wheel of -1200 over the pane moved `scrollTop`
 * by exactly 0.
 *
 * ── WHY THE GUARD BESIDE THIS ONE DID NOT SEE IT ─────────────────────────
 * `terminal-scrollback-shots.mjs` proves the pane scrolls and the poll leaves
 * it alone -- but its stub answers every read with the whole window whatever
 * `mode` was asked, so the echo read's shorter answer never reached its DOM,
 * and it never types. The unit suite cannot see it at all: happy-dom lays
 * nothing out, so `scrollHeight` is whatever the test writes. THIS file's
 * stub honours `mode` exactly as main does (`main/terminal/ipc.ts`: no
 * history for `echo`, the `-S -500` window for the other two), and it types.
 *
 * ── WHAT IS ASSERTED, AND AGAINST WHAT ───────────────────────────────────
 * Every number is read off the engine's own scroller, never off React state:
 * the pane holds more than one screen while keys are going in, a wheel in the
 * middle of a burst really moves it, the position holds while the burst
 * continues (which is the moment the mode has to flip to `echo-scrollback`),
 * it is still held once typing stops, and `End` takes it back to the live
 * end -- which it then follows.
 *
 * FALSIFIED against the build that shipped (the fix reverted, this stub in
 * place): 6 of 8 checks redden, the first two of them
 *   `the pane still overflows its box while keys are going in -- 714 <= 714`
 *   `a wheel over the pane mid-burst really moves it ... scrollTop 0 against 9686, of 0`
 * which is the operator's report exactly. Restored, 8 of 8 pass.
 *
 * Every string in the stub is invented. `?demo=1` is kept on the URL for the
 * reason `terminal-chrome-shots.mjs` records.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-echo-scroll-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'atlas-echo-scroll';
const BRANCH = 'work/atlas-echo-scroll';
/** How many lines of history the stub puts above the screen for a windowed read. */
const HISTORY = 500;

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` -- ${detail}`}`);
  failures.push(label);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

/**
 * A `PreloadSourceApi` stub whose `read` answers BY MODE the way main does:
 * the screen alone for `echo`, `HISTORY` lines above it for `poll` and
 * `echo-scrollback`. The screen is exactly the rows vam asked for
 * (`__resized`), so "more than one screen" is measured against vam's own
 * number. The last line carries a spinner so every capture differs -- a
 * still screen is dropped before React sees it (`sameScreen`) and would
 * prove nothing about what a read does to the DOM.
 */
await page.addInitScript(
  ({ session, branch, history }) => {
    let reads = 0;
    const modes = [];
    globalThis.window.__resized = [];
    globalThis.window.__reads = () => reads;
    globalThis.window.__modes = () => modes.slice();
    const screenRows = () => globalThis.window.__resized.at(-1)?.rows ?? 24;
    const SPIN = ['|', '/', '-', '\\'];
    const capture = (mode) => {
      reads += 1;
      modes.push(mode ?? 'absent');
      const rows = screenRows();
      const lines = [];
      if (mode !== 'echo') {
        for (let i = 0; i < history; i += 1) {
          lines.push(
            `history ${String(i).padStart(4, '0')}  the agent printed this and it scrolled`,
          );
        }
      }
      for (let i = 0; i < rows; i += 1) {
        lines.push(`screen  ${String(i).padStart(4, '0')}  this line is on the visible screen now`);
      }
      lines[lines.length - 1] = `screen  ${SPIN[reads % 4]} esc to interrupt (${String(reads)}s)`;
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
        read: async (_projectId, _rowId, mode) => {
          const { text, row } = capture(mode);
          return {
            kind: 'ok',
            name: 'vam-atlas-echo-scroll-a1b2c3',
            text,
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
// The measurement is debounced and the screen is sized from its answer.
await page.waitForTimeout(2_400);

/** What the engine says about the pane, and what vam asked for. */
const readPane = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-terminal-pane]');
    const screen = pane.querySelector('pre');
    return {
      scrollTop: Math.round(pane.scrollTop),
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
      drawn: (screen.textContent ?? '').split('\n').length,
      rows: globalThis.window.__resized.at(-1)?.rows ?? null,
      reads: globalThis.window.__reads(),
      modes: globalThis.window.__modes(),
    };
  });

const atBottom = (seen, slack = 2) =>
  seen.scrollHeight - seen.scrollTop - seen.clientHeight <= slack;

/** One keystroke into the pane, then a moment for its echo read to land. */
const type = async (key) => {
  await page.keyboard.type(key);
  await page.waitForTimeout(40);
};

/* ── 0: THE STARTING POINT, which the other guard already proves ─────────── */

await page.locator('[data-terminal-pane]').click();
const first = await readPane();
console.log('first:', JSON.stringify({ ...first, modes: undefined }));
check(
  'the pane opens overflowing its box, at the live end',
  first.scrollHeight > first.clientHeight && atBottom(first),
  `${first.scrollHeight} vs ${first.clientHeight}, scrollTop ${first.scrollTop}`,
);

/* ── 1: KEYS GO IN, AND THE SCROLLBACK STAYS IN THE DOM ──────────────────── */

const samples = [];
for (let i = 0; i < 8; i += 1) {
  await type('a');
  samples.push(await readPane());
}
const echoes = samples.at(-1).modes.filter((m) => m === 'echo').length;
console.log(
  'while typing:',
  samples.map((s) => `${s.scrollHeight}/${s.clientHeight}/${s.drawn}`).join(' '),
  `echo reads: ${echoes}`,
);
check(
  'the cheap read really was asked for -- the echo read still costs no scrollback',
  echoes > 0,
  `modes seen: ${[...new Set(samples.at(-1).modes)].join(',')}`,
);
check(
  'the pane still overflows its box while keys are going in',
  samples.every((s) => s.scrollHeight > s.clientHeight),
  `${Math.min(...samples.map((s) => s.scrollHeight))} <= ${samples[0].clientHeight}`,
);
check(
  'and holds more lines than the screen vam sized on every sample',
  first.rows !== null && samples.every((s) => s.drawn > first.rows),
  `min drawn ${Math.min(...samples.map((s) => s.drawn))} against ${first.rows} rows`,
);

/* ── 2: A WHEEL IN THE MIDDLE OF A BURST REALLY MOVES IT ─────────────────── */

await page.locator('[data-terminal-pane]').hover();
await page.mouse.wheel(0, -1_200);
await type('b');
const scrolled = await readPane();
check(
  'a wheel over the pane mid-burst really moves it back into the history',
  scrolled.scrollTop < first.scrollTop - 100 && !atBottom(scrolled),
  `scrollTop ${scrolled.scrollTop} against ${first.scrollTop}, of ${scrolled.scrollHeight - scrolled.clientHeight}`,
);

await page.screenshot({ path: `${outDir}/terminal-echo-scrolled.png` });
console.log(`${outDir}/terminal-echo-scrolled.png`);

/* ── 3: IT STAYS WHERE IT WAS PUT WHILE THE BURST CONTINUES ──────────────── */

for (let i = 0; i < 10; i += 1) await type('c');
const held = await readPane();
const since = held.modes.slice(scrolled.modes.length);
check(
  'the pane is left where the operator put it while keys keep going in',
  held.reads > scrolled.reads &&
    Math.abs(held.scrollTop - scrolled.scrollTop) <= 2 &&
    !atBottom(held),
  `${held.scrollTop} against ${scrolled.scrollTop}, after ${held.reads - scrolled.reads} reads (${[...new Set(since)].join(',')})`,
);
// The other half of letting go of the live end: once the operator is up in
// the history, the echo has to ask for it (`echo-scrollback`), or the region
// under their cursor would be served from a screen that no longer holds it.
check(
  'and the echo asks for the scrollback once the operator is in it',
  since.includes('echo-scrollback') && !since.includes('echo'),
  `modes after the wheel: ${[...new Set(since)].join(',')}`,
);

/* ── 4: STILL THERE ONCE TYPING STOPS, AND `End` BRINGS IT BACK ──────────── */

await page.waitForTimeout(1_200);
const stillHeld = await readPane();
check(
  'and is still there once typing stops and the poll has the pane to itself',
  Math.abs(stillHeld.scrollTop - scrolled.scrollTop) <= 2 && !atBottom(stillHeld),
  `${stillHeld.scrollTop} against ${scrolled.scrollTop}`,
);

await page.keyboard.press('End');
await page.waitForTimeout(600);
const returned = await readPane();
check(
  'End takes the operator back to the live end, and the pane follows the output again',
  atBottom(returned) && returned.reads > stillHeld.reads,
  `scrollTop ${returned.scrollTop} of ${returned.scrollHeight - returned.clientHeight}`,
);

await page.screenshot({ path: `${outDir}/terminal-echo-returned.png` });
console.log(`${outDir}/terminal-echo-returned.png`);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in terminal-echo-scroll-shots.mjs`);
  process.exit(1);
}
console.log('\nterminal-echo-scroll-shots.mjs: all checks passed.');
