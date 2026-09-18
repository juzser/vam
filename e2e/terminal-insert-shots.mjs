/**
 * THE TERMINAL IS ENTERED ON PURPOSE, AND THERE IS A KEY THAT ENTERS IT.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * The operator's report, translated: "when I go into terminal mode, can it
 * not automatically enter insert mode straight away — can I still have to
 * press `i` to focus the terminal input?" Opening the Terminal view took the
 * keyboard: `TerminalTab`'s latched `FOCUS ON ARRIVAL, ONCE` effect focused
 * the hidden compose box the first time a screen was drawn, so arriving at a
 * tab to LOOK at it put the next keystroke into somebody's running agent.
 *
 * AND THE HALF THAT MAKES IT MORE THAN A PREFERENCE. That grab was the only
 * keyboard way IN. Measured on the shipped bundle before this guard existed:
 * `Mod-0` let go of the pane and `i` did not get back — `i` resolves to
 * `prompt`, which called `beginComposing()`, and a Terminal pane draws no
 * composer for that to open (`DetailPanel.tsx`: the composer bar is not drawn
 * on `Terminal` or `Files`). So deleting the grab on its own would have left
 * the terminal reachable by mouse alone. `case 'prompt'` in `Canvas.tsx` now
 * asks the pane whether it HAS a composer, and lands the keyboard on the
 * pane's own first insert stop when it has none.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 * Every claim here is about `document.activeElement` after a real key press,
 * and a keystroke that lands is exactly what no unit environment can deliver:
 * happy-dom's `document.activeElement` is whatever the test last called
 * `.focus()` on, so the whole family of "the mode reads Insert while the body
 * holds the keyboard" defects is invisible there. Two mechanisms this rests
 * on exist nowhere else either -- the pane's `onFocus` forwards focus to its
 * hidden compose box A MICROTASK LATER, and `focusInsertStop` reports a
 * landing by asking the document who has focus NOW.
 *
 * `I`, AND THE MEASUREMENT THAT NEARLY BECAME A FINDING. A first pass read
 * `I` as broken too, because Playwright's `press('I')` delivers `key: 'I'`
 * with `shiftKey: false` -- and `normalizeKey` deliberately decides a bare
 * letter's case from `shiftKey` rather than from the character, so that
 * CapsLock cannot silently resolve `i` as `I` (`keyboard/capslock.test.ts`).
 * Unshifted `I` therefore IS `i`, correctly. It is pressed as `Shift+I` below
 * for that reason; a future edit that drops the modifier is measuring the
 * other key.
 *
 * Every string in the stub is invented -- no session id, path, host or branch
 * here belongs to a real machine. `?demo=1` is kept on the URL for the reason
 * `terminal-chrome-shots.mjs` records: the stub is what answers, and the
 * marker says so on the face of the request.
 *
 * Falsified by hand against a real build, each mutation alone and restored
 * after -- the red is quoted in the PR that introduced this file.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-insert-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const ONE = 'atlas-one';
const TWO = 'atlas-two';
/** The fixed slot `Terminal` holds in `TABS` -- the bare digit that opens it. */
const TERMINAL_DIGIT = '3';

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
 * A `PreloadSourceApi` stub with TWO sessions in one project, both carrying a
 * terminal, and a `send` that RECORDS rather than swallows.
 *
 * The second session is what makes the session-switch case measurable: the
 * screen is named after the row it was read for, so "the pane is drawing the
 * other session now" is a fact read off the badge rather than assumed from a
 * keystroke. The recorder is what makes Escape's case measurable: "Escape did
 * not leave" and "Escape was sent into the agent" are two different claims and
 * this file makes both.
 */
await page.addInitScript(
  ({ one, two }) => {
    globalThis.window.__sent = [];
    globalThis.window.__resized = [];
    let reads = 0;
    const capture = (rowId) => {
      reads += 1;
      const rows = globalThis.window.__resized.at(-1)?.rows ?? 24;
      const lines = [];
      for (let i = 0; i < rows - 1; i += 1) {
        lines.push(`${rowId}  line ${String(i).padStart(3, '0')}  the agent printed this`);
      }
      // The last line moves, so a redraw is a redraw rather than a photograph.
      lines.push(`${rowId}  read ${String(reads).padStart(4, '0')}`);
      return { text: lines.join('\n'), row: lines.length - 1 };
    };
    const unavailable = () =>
      Promise.resolve({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
      });
    const session = (id, title, branch) => ({
      id,
      title,
      icon: null,
      epic: null,
      branch,
      status: 'waiting',
      runningAgents: 0,
      activity: null,
      age: '2m',
      decisions: [
        { id: `${id}-d1`, label: 'step 1', input: 'a turn', output: 'an answer', commands: [] },
      ],
    });
    globalThis.window.api = {
      describe: async () => ({
        id: 'stub',
        label: 'Stub',
        capabilities: {
          liveUpdates: false,
          recordPrompt: true,
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
        },
        declines: {},
        viewerScope: 'operator',
      }),
      load: async () => [
        {
          id: 'p1',
          name: 'stub project',
          sessions: [
            session(one, 'stub session one', 'work/one'),
            session(two, 'stub session two', 'work/two'),
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
        // `read(projectId, rowId)` -- the NAME is keyed to the row, which is
        // what makes the session switch visible on the badge.
        read: async (_projectId, rowId) => {
          const { text, row } = capture(rowId ?? one);
          return {
            kind: 'ok',
            name: `vam-${rowId ?? one}-a1b2c3`,
            text,
            cursor: { kind: 'at', column: 0, row },
          };
        },
        resize: async (_projectId, columns, rows) => {
          globalThis.window.__resized.push({ columns, rows });
          return true;
        },
        send: async (_projectId, key) => {
          globalThis.window.__sent.push(key);
          return 'sent';
        },
        answer: async () => ({ kind: 'unavailable' }),
        prompt: async () => ({ kind: 'unavailable' }),
      },
    };
  },
  { one: ONE, two: TWO },
);

await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

/**
 * WHO HOLDS THE KEYBOARD, AND WHAT THE BAR SAYS ABOUT IT -- the two facts
 * every case below is made of, read in one evaluate so they cannot disagree
 * about the moment they describe.
 *
 * `activeElement` IS THE PROPERTY, and the mode cell is READ BESIDE IT rather
 * than instead of it: the whole defect family this guards against is a mode
 * that claims a cursor nothing holds, so a check that asked the chip alone
 * would be asking the proxy.
 */
const state = () =>
  page.evaluate(() => {
    const active = document.activeElement;
    const pane = document.querySelector('[data-terminal-pane]');
    return {
      mode: document.querySelector('[data-mode]')?.textContent ?? null,
      tag: active === null ? 'null' : active.tagName,
      // The one element in the pane a keystroke can be typed into.
      onInput: active !== null && active.hasAttribute?.('data-terminal-input') === true,
      inPane: pane !== null && active !== null && pane.contains(active),
      pane: pane !== null,
      badge: document.querySelector('[data-terminal-badge]')?.textContent ?? null,
      status: document.querySelector('[data-status]')?.textContent ?? null,
      sent: globalThis.window.__sent.map((key) => key.kind),
    };
  });

const say = (seen) =>
  `mode ${seen.mode}, focus on ${seen.tag}${seen.inPane ? ' inside the pane' : ' outside the pane'}`;

/* ── 1: ARRIVING AT THE TERMINAL LEAVES THE KEYBOARD ON THE SHELL ────────── */

// The KEYBOARD route in, deliberately: a click would leave focus on whatever
// was clicked and make "nothing in the pane has the keyboard" true for a
// reason that has nothing to do with this pane.
await page.locator(`[data-session-row="${ONE}"]`).first().click();
await page.keyboard.press(TERMINAL_DIGIT);
await page.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
// The screen is sized from a debounced measurement and drawn from the read
// that follows it, so the arrival this is about has not finished until two
// polls have gone by. Whatever grabs the keyboard has had every chance to.
await page.waitForTimeout(2_400);

const arrived = await state();
check('the terminal is drawn on arrival', arrived.pane, JSON.stringify(arrived));
check(
  'and nothing in it has the keyboard — the operator came to look, not to type',
  !arrived.inPane,
  say(arrived),
);
check('so the mode cell reads Select', arrived.mode === 'Select', say(arrived));

await page.screenshot({ path: `${outDir}/terminal-insert-arrival.png` });
console.log(`${outDir}/terminal-insert-arrival.png`);

/* ── 2: `i` IS THE WAY IN ────────────────────────────────────────────────── */

// FROM A STATE THAT IS ASSERTED TO BE OUT, and the assertion is the whole of
// why the `Mod-0` is here. Written without it, this case ran straight on from
// the arrival above -- and on a build where the arrival GRABS the keyboard,
// "i put the keyboard on the input" is true before `i` is pressed at all.
// Measured: against the unfixed bundle, every check in this section passed
// while the two above it were red. A check that cannot fail is not a check.
await page.keyboard.press('Meta+Digit0');
await page.waitForTimeout(150);
const released = await state();
check(
  'and `i` is measured from a pane that really does not have the keyboard',
  !released.inPane,
  say(released),
);

await page.keyboard.press('i');
await page.waitForTimeout(150);
const entered = await state();
check(
  'i lands the keyboard on the terminal’s own input',
  entered.onInput,
  `${say(entered)} — status ${JSON.stringify(entered.status)}`,
);
check('and the mode cell follows it to Insert', entered.mode === 'Insert', say(entered));

await page.screenshot({ path: `${outDir}/terminal-insert-entered.png` });
console.log(`${outDir}/terminal-insert-entered.png`);

/* ── 3: WHAT IS TYPED THERE GOES TO TMUX, ESCAPE INCLUDED ────────────────── */

await page.keyboard.press('j');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const typed = await state();
check(
  'a printable key typed there reaches the session rather than moving vam’s cursor',
  typed.sent.includes('text'),
  JSON.stringify(typed.sent),
);
check(
  'Escape is SENT into the session — it is the pane’s key, not an exit',
  typed.sent.includes('escape'),
  JSON.stringify(typed.sent),
);
check(
  'and Escape did not let go: the next key is still the session’s',
  typed.onInput && typed.mode === 'Insert',
  say(typed),
);

/* ── 4: THE WAY OUT, AND BACK IN AGAIN ───────────────────────────────────── */

// `Meta`, not `Control`: `Mod-<digit>` is Cmd on macOS and Ctrl elsewhere
// since the fold was removed, and Meta is the command modifier on both — the
// reasoning `key-truth-shots.mjs` carries in full.
await page.keyboard.press('Meta+Digit0');
await page.waitForTimeout(150);
const left = await state();
check('Mod-0 hands the keyboard back to the shell', !left.inPane, say(left));
check('and the mode cell says so', left.mode === 'Select', say(left));

// `Shift+I` AND NOT `I` — see this file's header. Unshifted, `normalizeKey`
// resolves the character as `i`, which is the OTHER key.
await page.keyboard.press('Shift+I');
await page.waitForTimeout(150);
const again = await state();
check(
  'I is the same door — the pane’s only insert stop is its screen',
  again.onInput && again.mode === 'Insert',
  say(again),
);

/* ── 5: A SESSION SWITCH DOES NOT TAKE THE KEYBOARD BACK ─────────────────── */

// THE REGRESSION THE OLD LATCH EXISTED TO PREVENT, asked of the code that no
// longer has a latch. `view` is cleared during render when the row changes,
// so the pane goes away and comes back on every switch: a focus rule phrased
// as "there is a screen, take the keyboard" grabs it again each time, and the
// `j` that moves to the next session ends up typed into an agent.
//
// THE VIEW IS A FACT ABOUT THE SESSION (`viewBySession`), so the second
// session has to be put on its Terminal view before there are two terminals
// to switch between at all -- without this the switch lands on a Response
// pane and the case measures nothing about a terminal.
await page.keyboard.press('Meta+Digit0');
await page.waitForTimeout(150);
await page.keyboard.press('j');
await page.keyboard.press(TERMINAL_DIGIT);
await page.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
await page.waitForTimeout(2_400);
const before = await state();
// `k` IS THE MEASUREMENT AND NOT THE SETUP. A pane that took the keyboard on
// arrival eats this keystroke -- it is a printable key typed into a running
// agent -- so on such a build the switch below never happens and the badge
// check is what says so.
await page.keyboard.press('k');
await page.waitForTimeout(2_400);
const switched = await state();
check(
  'the pane really is drawing the other session now — `k` moved rather than being typed',
  switched.pane && switched.badge !== null && switched.badge !== before.badge,
  `${JSON.stringify(before.badge)} -> ${JSON.stringify(switched.badge)}`,
);
check(
  'and the keyboard stayed where the operator left it — out',
  !switched.inPane && switched.mode === 'Select',
  say(switched),
);

// AND ONE MORE POLL, because the grab that was removed fired on the first
// screen a mount drew: a replacement that latched per session would pass the
// check above and fail here.
await page.waitForTimeout(2_400);
const polled = await state();
check(
  'and the polls that follow leave it alone too',
  !polled.inPane && polled.mode === 'Select',
  say(polled),
);

/* ── 6: THE MOUSE PATH IS UNCHANGED ──────────────────────────────────────── */

// A click on a terminal means "type here", and it always has: the pane takes
// the focus and forwards it to the box a microtask later.
await page.locator('[data-terminal-pane]').click();
await page.waitForTimeout(150);
const clicked = await state();
check(
  'clicking the screen still hands the keyboard to its input',
  clicked.onInput && clicked.mode === 'Insert',
  say(clicked),
);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in terminal-insert-shots.mjs`);
  process.exit(1);
}
console.log('\nterminal-insert-shots.mjs: all checks passed.');
