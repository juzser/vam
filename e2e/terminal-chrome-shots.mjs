/**
 * THE TERMINAL'S SIZE, ITS SCROLLBAR AND ITS STATUS RULE, IN A REAL ENGINE.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 * vam does not style the tmux screen, it MEASURES it: `terminal-size.ts`
 * divides the pane's content box by the advance of one character rendered in
 * the pane's own font, and tells tmux how many columns that is. Every term in
 * that sentence is a layout fact. happy-dom performs no layout at all, so
 * `test/panels/TerminalTab.fit.test.tsx` has to write the rectangles itself --
 * it can prove that a size change re-runs the measurement, and it cannot prove
 * that the advance really follows the size, because in that environment
 * nothing really renders a glyph.
 *
 * So the question this file answers is the one only Chromium can:
 *
 *   1. THE ADVANCE REALLY FOLLOWS THE SETTING. The same string is measured at
 *      each offered size, in the pane's own font, by the engine -- both inside
 *      the `<pre>` that draws the screen and at the ruler vam divides by, so
 *      that a size put on one and not the other is visible here.
 *   2. AND THE COLUMN COUNT REALLY FOLLOWS THE ADVANCE, INCLUDING UNDER A
 *      LIVE PANE. What vam asked tmux for is read back off the bridge stub and
 *      checked against the box over the advance -- at every size, with the
 *      pane's box never changing. A size that moves while the column count
 *      does not is the whole defect this feature could ship: the screen
 *      repaints, tmux keeps composing at the old width, and long lines wrap in
 *      the wrong place. The last block changes the size THROUGH THE DIALOG
 *      with no reload, which is the only form of this check that can fail --
 *      see its own note.
 *   3. THE SCROLLBAR IS REALLY PAINTED. `vam-no-scrollbar` hides the native
 *      one; the overlay thumb appears only when there is more screen than box,
 *      which is a `scrollHeight` a unit environment reports as zero.
 *   4. THE NAME IS REALLY UNDER THE SCREEN AND NOT OVER IT. This is a
 *      RECTANGLE question -- the old badge was absolutely positioned over the
 *      pane's bottom-right corner and every DOM assertion about it passed.
 *      Only real layout can say whether two boxes overlap.
 *
 * ── THE BRIDGE IS A STUB ──────────────────────────────────────────────────
 * Injected with `page.addInitScript`, exactly as `terminal-ime-shots.mjs` does
 * and for the reason recorded there: merely DEFINING `window.api` takes
 * `App.tsx` off the `?demo=1` fixture and onto `createSourceFromPreload(api)`,
 * so the stub has to be a complete `PreloadSourceApi` or the page reddens
 * before a check runs. Every string in it is invented -- no session id, path,
 * host or branch here belongs to a real machine, which is the rule for
 * anything this repo can screenshot. `?demo=1` is kept on the URL for the same
 * reason: the stub is what actually answers, and the marker says on the face
 * of the request that nothing real is behind it.
 *
 * Falsified by hand, each alone, against a real build:
 *   - drop `fontSize` from the measuring effect's dependencies in
 *     `TerminalTab.tsx` -> the LIVE block reddens (`tmux is told the N columns
 *     that now fit, without a reload`). The reload loop alone does NOT catch
 *     it, which is why that block exists.
 *   - pin the `<pre>` to a size of its own (`style={{ fontSize: '10.5px' }}`)
 *     -> case 1 reddens: the character drawn stops being the character
 *     measured.
 *   - stop drawing the overlay thumb -> case 3 reddens.
 *   - take the status rule out of the flow (`absolute bottom-1 right-1.5`) ->
 *     case 4 reddens: the pane grows under it and the name lands on the
 *     screen's last line again.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-chrome-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'atlas-fit';
const BRANCH = 'work/atlas-fit';
/** The sizes `prefs/terminal-font.ts` offers, smallest first. Spelled here
 *  because a browser script cannot import from `src/`; the unit suite is what
 *  holds these two lists together (`test/settings/appearance.test.tsx` derives
 *  its own from the source, and would redden if the source list changed). */
const SIZES = [10.5, 11.5, 12.5, 14];
const DEFAULT_SIZE = 12.5;

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
 * A complete `PreloadSourceApi` stub plus `terminal`, whose `resize` RECORDS
 * what it was asked: the size vam works out is the subject of this file, so
 * the recording is the measurement.
 *
 * The screen is two hundred numbered lines, which is what gives the pane
 * something to scroll, and lines long enough that a wrong column count would
 * be visible in the screenshots.
 */
await page.addInitScript(
  ({ session, branch }) => {
    const SCREEN = Array.from(
      { length: 200 },
      (_, i) => `${String(i).padStart(3, '0')}  $ the pane composes this line at the width tmux was told`,
    ).join('\n');
    globalThis.window.__resized = [];
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
        read: async () => ({
          kind: 'ok',
          name: 'vam-atlas-fit-a1b2c3',
          text: SCREEN,
          cursor: { kind: 'unreadable' },
        }),
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
  { session: SESSION, branch: BRANCH },
);

/**
 * Put one size in the store, then open the Terminal tab on it.
 *
 * A load per size rather than four trips through the settings dialog: the
 * subject here is the measurement, and the dialog has its own tests.
 *
 * AN INIT SCRIPT AND NOT AN `evaluate` + `reload`, and the difference was a
 * real failure rather than a preference. Writing the store from the page and
 * reloading loses a race with the app's own write-back: `activatePrefs` runs
 * on every read AND every write, so the mounted app can put the WHOLE prefs
 * object back -- including the size it read a moment ago -- after the write
 * and before the reload. Measured: the first size in this loop came back
 * drawn at the default. An init script runs before any page script, so the
 * value is simply there when the bundle first looks.
 *
 * They STACK, and that is what makes the loop correct rather than a bug: init
 * scripts run in registration order on every navigation, so after registering
 * the Nth size the Nth script runs last and its value is the one in force.
 */
async function openTerminal(size) {
  await page.addInitScript((px) => {
    globalThis.localStorage.setItem('vam.prefs.v1', JSON.stringify({ terminalFontSize: px }));
  }, size);
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${SESSION}"]`).first().click();
  await page.locator('[data-view="terminal"]').click();
  await page.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
  // The measurement is debounced, and it is the thing being read back.
  await page.waitForTimeout(400);
}

/**
 * What the engine says about the pane at whatever size is in force.
 *
 * TWO ADVANCES ARE MEASURED, AND THE DIFFERENCE BETWEEN THEM IS THE POINT.
 *
 *  - `drawn` is measured by a probe appended INSIDE THE `<pre>` that draws the
 *    screen, so it is the width of a character as the operator actually sees
 *    it, whatever element happens to carry the size.
 *  - `ruler` is `[data-terminal-ruler]`, the element vam itself divides by.
 *
 * Reading only the ruler would make this file self-consistent and blind: put
 * the size on the `<pre>` and leave the pane at the old one, and vam's column
 * count would still match its own ruler exactly while every line on screen was
 * composed for the wrong width. The expectation below is therefore built from
 * `drawn`, and the two are compared to each other as well.
 *
 * Ten characters, which is `RULER_TEXT`'s own length: the browser rounds a
 * rectangle, and a measurement taken over a different count could disagree
 * with vam's in the last place and floor to a different column.
 */
const readPane = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-terminal-pane]');
    const screen = pane.querySelector('pre');
    const style = getComputedStyle(pane);
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(10);
    probe.style.whiteSpace = 'pre';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    screen.appendChild(probe);
    const drawn = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const rulerEl = pane.querySelector('[data-terminal-ruler]');
    const ruler = rulerEl.getBoundingClientRect().width / (rulerEl.textContent ?? '').length;
    const px = (value) => Number.parseFloat(value) || 0;
    const width = pane.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
    const asked = globalThis.window.__resized.at(-1) ?? null;
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: style.lineHeight,
      width,
      drawn,
      ruler,
      columns: asked === null ? null : asked.columns,
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
    };
  });

const measured = [];
for (const size of SIZES) {
  await openTerminal(size);
  const pane = await readPane();
  measured.push({ size, ...pane });

  check(
    `the screen is drawn at ${size}px, which is what the store says`,
    Math.abs(pane.fontSize - size) < 0.01,
    `the pane is ${pane.fontSize}px`,
  );
  check(
    `and the character vam measures is the character it draws at ${size}px`,
    pane.drawn > 0 && Math.abs(pane.drawn - pane.ruler) < 0.01,
    `the screen draws ${pane.drawn}px per character and vam divided by ${pane.ruler}px`,
  );
  // THE ASSERTION THIS FILE EXISTS FOR. The box is identical at every size --
  // the same window, the same pane, the same layout -- so the only thing that
  // can move the column count is the advance, and the only thing that can move
  // the advance is the size.
  const want = Math.floor(pane.width / pane.drawn);
  check(
    `and vam asked tmux for the ${want} columns that actually fit at ${size}px`,
    pane.columns === want,
    `vam asked for ${pane.columns}, the box fits ${want} (${pane.width}px / ${pane.drawn}px)`,
  );

  if (size === DEFAULT_SIZE) {
    // ── THE SCROLLBAR ──────────────────────────────────────────────────────
    check(
      'the screen really overflows its box, so there is something to say',
      pane.scrollHeight > pane.clientHeight,
      `${pane.scrollHeight} <= ${pane.clientHeight}`,
    );
    await page.locator('[data-terminal-pane]').hover();
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(250);
    const thumb = await page.locator('[data-overlay-thumb]').count();
    check(
      'and a thumb is painted over it rather than nothing at all',
      thumb === 1,
      `${thumb} thumbs`,
    );
    const boxes = await page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        return el === null ? null : el.getBoundingClientRect().toJSON();
      };
      return {
        pane: rect('[data-terminal-pane]'),
        thumb: rect('[data-overlay-thumb]'),
        status: rect('[data-terminal-status]'),
        name: rect('[data-terminal-badge]'),
      };
    });
    check(
      'the thumb has real height and sits inside the pane it reports on',
      boxes.thumb !== null && boxes.thumb.height > 8 && boxes.thumb.right <= boxes.pane.right + 1,
      JSON.stringify(boxes.thumb),
    );

    // ── THE RULE, AS RECTANGLES ────────────────────────────────────────────
    // The old badge floated over the pane's bottom-right corner, which every
    // DOM assertion in the unit suite was happy with. Only layout can tell.
    check(
      'the session name is BELOW the screen, not painted over its last line',
      boxes.name !== null && boxes.name.top >= boxes.pane.bottom - 1,
      `name ${JSON.stringify(boxes.name)} vs pane bottom ${boxes.pane.bottom}`,
    );
    check(
      'and the rule is one line under a pane that still fills the tab',
      boxes.status.height > 8 && boxes.status.height < 40,
      `the rule is ${boxes.status?.height}px tall`,
    );
    const text = await page.evaluate(() => ({
      branch: document.querySelector('[data-terminal-branch]')?.textContent ?? null,
      name: document.querySelector('[data-terminal-badge]')?.textContent ?? null,
    }));
    check(
      'the branch is drawn on the rule, from the session rather than invented',
      text.branch === BRANCH,
      `the rule says ${JSON.stringify(text.branch)}`,
    );
    check(
      'and so is the tmux session name, which is what tells two panes apart',
      (text.name ?? '').includes('vam-atlas-fit'),
      `the rule says ${JSON.stringify(text.name)}`,
    );
    // AND NOTHING IT HAS NO SOURCE FOR. vam's model carries no model name and
    // no per-session context percentage, and a status line that invents one is
    // worse than a short one.
    const invented = await page.evaluate(
      () => document.querySelector('[data-terminal-status]')?.textContent ?? '',
    );
    check(
      'and no model name, context percentage or token budget it has no source for',
      !/opus|sonnet|haiku|gpt|%|tokens?\b/i.test(invented),
      `the rule says ${JSON.stringify(invented)}`,
    );
  }

  if (size === SIZES[0] || size === SIZES.at(-1) || size === DEFAULT_SIZE) {
    await page.screenshot({
      path: `${outDir}/terminal-chrome-${String(size).replace('.', '-')}px.png`,
    });
  }
}

/**
 * ── AND THE SAME THING WITHOUT A RELOAD, WHICH IS THE OPERATOR'S OWN PATH ──
 *
 * THIS BLOCK EXISTS BECAUSE THE LOOP ABOVE COULD NOT FAIL FOR THE REASON IT
 * WAS WRITTEN FOR. Every iteration up there loads the page with the size
 * already in the store, so the pane is MOUNTED at that size and measures it
 * once, correctly, no matter how the size is wired. Dropping `fontSize` from
 * the measuring effect's dependencies -- the exact defect the whole feature
 * risks -- was applied to the source, built and run against those checks, and
 * they all passed. A guard that cannot fail for its own subject is worth
 * nothing, and this is what was missing: the size changing UNDER A LIVE PANE,
 * through the dialog, with no reload to paper over it.
 */
const sizeOf = (px) => measured.find((m) => m.size === px);

await openTerminal(DEFAULT_SIZE);
await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });

for (const size of [SIZES.at(-1), SIZES[0], DEFAULT_SIZE]) {
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator(`[data-terminal-size-option="${size}"]`).click();
  await page.locator('button[aria-label="close"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { state: 'detached', timeout: 5_000 });
  // The measurement is debounced, and a resize is a process spawned against a
  // live session -- so it is deliberately not instant.
  await page.waitForTimeout(500);

  const live = await readPane();
  const want = sizeOf(size);
  check(
    `choosing ${size}px in the dialog redraws the live pane at ${size}px`,
    Math.abs(live.fontSize - size) < 0.01,
    `the pane is ${live.fontSize}px`,
  );
  // THE ASSERTION THE RELOAD LOOP CANNOT MAKE. The pane's box never moved, so
  // nothing fires a `ResizeObserver`; the only thing that can put a new column
  // count on the bridge is the size reaching React and re-running the
  // measurement.
  check(
    `and tmux is told the ${want.columns} columns that now fit, without a reload`,
    live.columns === want.columns,
    `vam asked for ${live.columns}, a fresh load at ${size}px asked for ${want.columns}`,
  );
}

// ── AND ACROSS THE SIZES ────────────────────────────────────────────────────
const columns = measured.map((m) => m.columns);
check(
  'every offered size asks tmux for a different width — none of them is cosmetic',
  new Set(columns).size === SIZES.length,
  `columns: ${JSON.stringify(columns)}`,
);
check(
  'and bigger type means fewer columns, in that direction',
  columns.every((count, i) => i === 0 || count < columns[i - 1]),
  `columns: ${JSON.stringify(columns)}`,
);
check(
  'the default is the middle-large one, not the size that shipped',
  measured.find((m) => m.size === DEFAULT_SIZE)?.fontSize === DEFAULT_SIZE,
  JSON.stringify(measured.map((m) => [m.size, m.fontSize])),
);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll terminal chrome checks passed.');
