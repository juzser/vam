/**
 * THE VIEWS' WIDTH, MEASURED IN CHARACTERS, IN A REAL ENGINE.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 * The setting promises a LINE LENGTH -- no more than eighty characters -- and
 * every term of that sentence is a layout fact. happy-dom performs no layout,
 * so `test/panels/DetailPanel.view-width.test.tsx` can prove only WHICH
 * element the cap is put on; it cannot see a character, a `calc()`, a `ch` or
 * a rectangle. Worse, the two halves of this feature fail in ways that look
 * identical to a DOM assertion:
 *
 *   - the prose cap is a pixel maximum derived from a MEASURED advance. If the
 *     advance is wrong, or the container's padding is not accounted for, the
 *     declaration is still exactly what the test asserted and the line is 75
 *     characters, or 95.
 *   - the terminal's cap is written in `ch`, which resolves against the
 *     ELEMENT'S OWN FONT. Moved onto a box drawn in the app's sans face it
 *     silently means the advance of a proportional `0` -- 35% wider here --
 *     and the "narrowed" terminal comes out at 59 columns with every unit
 *     assertion green.
 *
 * So this file measures the CONSEQUENCE in the unit the promise is made in:
 * characters for the three prose views, and the column count vam actually sent
 * tmux for the fourth.
 *
 *   1. THE CAP BINDS, AND IT BINDS IN CHARACTERS. The same demo transcript is
 *      measured full-pane and narrowed at 1600px; the advance is measured off
 *      the prose the page really drew, and the capacity that falls out of it
 *      must cross from "past eighty" to "at most eighty".
 *   2. THE SAME BODY, THE SAME WIDTH, IN ALL THREE PROSE VIEWS. One flag, one
 *      promise: PRs and Agents must land on the identical rectangle Response
 *      does, or the setting means three different things.
 *   3. A MAXIMUM IS NOT A FLOOR. At a 560px window (a desktop pane under
 *      `DETAIL_MIN + SIDEBAR_MIN`) and at a 390px phone, the capped body must
 *      be the very same width as the uncapped one -- to the pixel. A cap that
 *      changed a rectangle there would be a horizontal scrollbar on the one
 *      surface that cannot afford one.
 *   4. THE TERMINAL'S COLUMN COUNT REALLY FOLLOWS, AT EVERY OFFERED SIZE.
 *      What vam asked tmux for is read back off the bridge stub. Narrowed it
 *      must be exactly eighty at 10.5px and at 14px alike -- that is the whole
 *      claim of writing the cap in `ch` -- and full-pane it must be the box
 *      over the advance, unchanged from what shipped.
 *
 * ── WHAT IS BEHIND THE PAGE ───────────────────────────────────────────────
 * The three prose views run on `?demo=1`, vam's own invented fixture. The
 * Terminal cannot: `?demo=1` has no terminal bridge at all, so the pane is
 * stubbed with `page.addInitScript` exactly as `terminal-chrome-shots.mjs`
 * does, and `?demo=1` is kept on the URL to say on the face of the request
 * that nothing real is behind it. Every string in the stub is invented -- no
 * session id, path, host or branch here belongs to a real machine.
 *
 * Falsified, each mutation alone and restored after, against a real build:
 *   - drop the half cell from `NARROW_TERMINAL_MAX_WIDTH` -> `narrowed, vam
 *     asks tmux for exactly 80 columns at 12.5px` and `...at 14px` redden with
 *     79. 10.5px and 11.5px stay green, which is the measurement the slack was
 *     added for: the rounding costs a column at some sizes and not others, so a
 *     guard that checked one size would have passed over it.
 *   - take `font-mono` off the element `TerminalTab.tsx` puts the cap on ->
 *     ALL FOUR of those checks redden. That is `ch` silently becoming the
 *     advance of a proportional `0`.
 *   - round `NARROW_PROSE_TEXT_PX` up instead of down -> `narrowed, the
 *     response line holds at 80 characters or fewer` reddens at 80.06. This is
 *     how the rounding was found in the first place.
 *   - write the prose cap as `width` instead of `max-width` -> both `the cap
 *     changes no rectangle` checks redden, at 560px and at the phone.
 *   - drop `Agents` from `narrowsAsProse` -> `narrowed, the agents view is the
 *     same rectangle the response view is` reddens.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/view-width-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** `factory-sse-1` in `src/renderer/fixtures/demo.ts`. */
const DEMO_SESSION = 'factory-sse-1';
/** Invented, for the stubbed terminal. Nothing here names a real machine. */
const STUB_SESSION = 'atlas-width';
const STUB_BRANCH = 'work/atlas-width';

/**
 * The promise, and the sizes the terminal offers.
 *
 * SPELLED HERE BECAUSE A BROWSER SCRIPT CANNOT IMPORT FROM `src/` -- the same
 * constraint `terminal-chrome-shots.mjs` records for its own copy of the size
 * list. The unit suite is what holds the two lists together: the number below
 * is `NARROW_MAX_CHARACTERS`, and `test/prefs/prefs.view-width.test.ts`
 * derives every other number in the feature from it, so a change in the source
 * that was not made here fails there.
 */
const MAX_CHARACTERS = 80;
const SIZES = [10.5, 11.5, 12.5, 14];

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

/* ── 1 AND 2: THE THREE PROSE VIEWS ──────────────────────────────────────── */

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

/**
 * Seed the store and open the demo session.
 *
 * AN INIT SCRIPT AND NOT AN `evaluate` + `reload`, for the reason
 * `terminal-chrome-shots.mjs` records as a real failure rather than a
 * preference: `activatePrefs` runs on every read AND every write, so a mounted
 * app can put the whole prefs object back -- including the value read a moment
 * ago -- between the write and the reload. Init scripts run before any page
 * script, and they STACK in registration order, so the last one registered is
 * the one in force.
 */
async function openDemo(target, narrow, phone = false) {
  await target.addInitScript((value) => {
    globalThis.localStorage.setItem('vam.prefs.v1', JSON.stringify({ narrowViews: value }));
  }, narrow);
  await target.goto(`${origin}/?demo=1&history=off`, { waitUntil: 'networkidle' });
  if (phone) {
    // The phone's session screen is reachable only by tapping a row, which is
    // the point of that screen: it is one session, not a browser over all of
    // them. `PhoneShell` mounts its own `DetailPanel`, which is exactly why
    // this width has to be checked here and not only on the desktop.
    await target.waitForSelector('[data-phone-shell="list"]');
    await target.locator('[data-session-row]').first().click();
    await target.waitForSelector('[data-phone-shell="session"]');
  }
  await target.waitForSelector('[data-detail-body]', { timeout: 10_000 });
  await target.waitForTimeout(250);
}

/**
 * The body's content box, and how many characters of the page's OWN prose fit
 * across it.
 *
 * THE ADVANCE IS MEASURED OFF WHAT WAS DRAWN, never assumed and never taken
 * from `ch`. `ch` is the advance of `0`, which in this face is 35% wider than
 * a character of English -- using it would report a comfortable 80 over a line
 * that really runs to 108. So every text node inside the answer blocks that
 * the engine laid out as a SINGLE line is measured with a `Range`, and the
 * total ink over the total characters is the advance.
 */
const readProse = (target) =>
  target.evaluate(() => {
    const body = document.querySelector('[data-detail-body]');
    const style = getComputedStyle(body);
    const px = (value) => Number.parseFloat(value) || 0;
    const content = body.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
    let chars = 0;
    let ink = 0;
    let longest = 0;
    for (const block of document.querySelectorAll('[data-detail-block="out"]')) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node !== null) {
        const text = node.textContent ?? '';
        if (text.trim().length >= 20 && !/Mono/.test(getComputedStyle(node.parentElement).fontFamily)) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = [...range.getClientRects()];
          // Only a run the engine kept on ONE line has a clean advance.
          if (rects.length === 1) {
            chars += text.length;
            ink += rects[0].width;
            longest = Math.max(longest, rects[0].width);
          }
        }
        node = walker.nextNode();
      }
    }
    const advance = chars === 0 ? 0 : ink / chars;
    return {
      paneWidth: body.parentElement.clientWidth,
      boxWidth: body.getBoundingClientRect().width,
      content,
      advance,
      sampled: chars,
      longestRunPx: longest,
      characters: advance === 0 ? 0 : content / advance,
    };
  });

const openView = async (target, view) => {
  await target.locator(`[data-view="${view}"]`).click();
  await target.waitForTimeout(150);
};

await openDemo(page, false);
const full = await readProse(page);
console.log('full pane:', JSON.stringify(full));
check(
  'the demo really drew prose to measure, so the advance is not an empty average',
  full.sampled > 300 && full.advance > 3,
  `${full.sampled} characters sampled, advance ${full.advance}`,
);
check(
  'full-pane, the response body fills its pane',
  Math.abs(full.boxWidth - full.paneWidth) < 1,
  `body ${full.boxWidth}px in a ${full.paneWidth}px pane`,
);
check(
  'and a 1600px window really is the complaint: the line runs well past eighty characters',
  full.characters > MAX_CHARACTERS + 20,
  `${full.characters.toFixed(1)} characters across ${full.content}px`,
);
await page.screenshot({ path: `${outDir}/view-width-full.png` });
console.log(`${outDir}/view-width-full.png`);

await page.close();

const narrowPage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
narrowPage.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await openDemo(narrowPage, true);
const narrow = await readProse(narrowPage);
console.log('narrowed:', JSON.stringify(narrow));
/**
 * The capacity of the narrowed column, in characters of the SAME face.
 *
 * DIVIDED BY THE FULL-PANE ADVANCE, and that is a methodology decision rather
 * than a convenience. The advance is a property of the face, not of the box --
 * but the SAMPLE is a property of the box: a narrow column wraps more, so
 * fewer runs survive the single-rectangle filter and the ones that do are
 * short, differently-distributed lines. Measured: 822 characters sampled
 * full-pane against 280 narrowed, and the two averages differ by 0.024px,
 * which is a quarter of a character across eighty of them. The larger sample
 * is the better estimate of the face, and it is the one taken.
 */
const narrowCharacters = narrow.content / full.advance;
check(
  'narrowed, the cap actually binds',
  narrow.boxWidth < narrow.paneWidth - 100,
  `body ${narrow.boxWidth}px in a ${narrow.paneWidth}px pane`,
);
// THE ASSERTION THIS FILE EXISTS FOR, in the unit the promise is made in.
check(
  `narrowed, the response line holds at ${MAX_CHARACTERS} characters or fewer`,
  narrowCharacters <= MAX_CHARACTERS,
  `${narrowCharacters.toFixed(2)} characters across ${narrow.content}px at ${full.advance.toFixed(4)}px each`,
);
console.log(
  `narrowed capacity: ${narrowCharacters.toFixed(2)} characters across ${narrow.content}px`,
);
// AND THE OTHER DIRECTION, which is what stops a mistyped number passing as a
// success: a column of 40 characters would satisfy the line above and be a
// worse surface than the one being fixed.
check(
  'and has not collapsed into a ribbon',
  narrowCharacters > MAX_CHARACTERS - 5,
  `${narrowCharacters.toFixed(2)} characters`,
);
// The advance is a property of the face, not of the box: if these two
// measurements disagree, one of the two pages was not measuring prose.
check(
  'the same face was measured in both states',
  Math.abs(narrow.advance - full.advance) < 0.35,
  `${full.advance.toFixed(4)}px full-pane vs ${narrow.advance.toFixed(4)}px narrowed`,
);
await narrowPage.screenshot({ path: `${outDir}/view-width-narrow.png` });
console.log(`${outDir}/view-width-narrow.png`);

// ONE FLAG, ONE PROMISE: the other two views the operator named must land on
// the identical rectangle. Measured rather than assumed -- the cap is keyed to
// the CURRENT view, so a name left out of the predicate is a view that quietly
// stays full-pane.
const perView = { Response: narrow.boxWidth };
for (const view of ['prs', 'agents']) {
  await openView(narrowPage, view);
  const seen = await narrowPage.evaluate(
    () => document.querySelector('[data-detail-body]').getBoundingClientRect().width,
  );
  perView[view] = seen;
  check(
    `narrowed, the ${view} view is the same rectangle the response view is`,
    Math.abs(seen - narrow.boxWidth) < 1,
    `${seen}px against the response view's ${narrow.boxWidth}px`,
  );
}
console.log('narrowed body width per view:', JSON.stringify(perView));
await narrowPage.screenshot({ path: `${outDir}/view-width-narrow-agents.png` });
console.log(`${outDir}/view-width-narrow-agents.png`);
await narrowPage.close();

/* ── 3: A MAXIMUM IS NOT A FLOOR ─────────────────────────────────────────── */

// 560px is a DESKTOP window one pixel-class above the phone breakpoint
// (`SIDEBAR_MIN + DETAIL_MIN`), so the detail pane there is near vam's
// narrowest legal one; 390px is the phone. At both, every maximum in this
// feature is wider than the pane, so the capped body must be the very same
// rectangle as the uncapped one.
for (const [label, viewport] of [
  ['a narrow desktop pane', { width: 560, height: 800 }],
  ['the phone', { width: 390, height: 844 }],
]) {
  const widths = [];
  const phone = viewport.width < 500;
  for (const narrowed of [false, true]) {
    const small = await browser.newPage({ viewport });
    small.on('pageerror', (err) => console.error('PAGE ERROR:', err));
    await openDemo(small, narrowed, phone);
    if (!phone) {
      await small.locator(`[data-session-row="${DEMO_SESSION}"]`).first().click();
      await small.waitForTimeout(200);
    }
    widths.push(
      await small.evaluate(
        () => document.querySelector('[data-detail-body]').getBoundingClientRect().width,
      ),
    );
    if (narrowed) {
      const name = phone ? 'view-width-phone' : 'view-width-narrow-pane';
      await small.screenshot({ path: `${outDir}/${name}.png` });
      console.log(`${outDir}/${name}.png`);
    }
    await small.close();
  }
  console.log(`${label}: full ${widths[0]}px, narrowed ${widths[1]}px`);
  check(
    `at ${label} the cap changes no rectangle — a maximum never becomes a floor`,
    Math.abs(widths[0] - widths[1]) < 0.5 && widths[0] > 0,
    `full ${widths[0]}px, narrowed ${widths[1]}px`,
  );
}

/* ── 4: THE TERMINAL'S COLUMN COUNT ──────────────────────────────────────── */

const term = await browser.newPage({ viewport: { width: 1600, height: 900 } });
term.on('pageerror', (err) => console.error('PAGE ERROR:', err));

/**
 * A complete `PreloadSourceApi` stub whose `resize` RECORDS what it was asked.
 * Merely DEFINING `window.api` takes `App.tsx` off the `?demo=1` fixture and
 * onto `createSourceFromPreload(api)`, so it has to be complete or the page
 * reddens before a check runs -- the note `terminal-ime-shots.mjs` left and
 * `terminal-chrome-shots.mjs` repeats.
 */
await term.addInitScript(
  ({ session, branch }) => {
    const SCREEN = Array.from(
      { length: 120 },
      (_, i) => `${String(i).padStart(3, '0')}  $ this line is composed at the width tmux was told`,
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
          name: 'vam-atlas-width-a1b2c3',
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
  { session: STUB_SESSION, branch: STUB_BRANCH },
);

async function openTerminal(size, narrowed) {
  await term.addInitScript(
    ([px, value]) => {
      globalThis.localStorage.setItem(
        'vam.prefs.v1',
        JSON.stringify({ terminalFontSize: px, narrowViews: value }),
      );
    },
    [size, narrowed],
  );
  await term.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await term.waitForSelector('[data-tab-strip]');
  await term.locator(`[data-session-row="${STUB_SESSION}"]`).first().click();
  await term.locator('[data-view="terminal"]').click();
  await term.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
  // The measurement is debounced, and it is the thing being read back.
  await term.waitForTimeout(450);
}

/**
 * The advance the screen is REALLY drawn at, the box vam really divided, and
 * the column count vam really asked for.
 *
 * The probe goes inside the `<pre>` for the reason `terminal-chrome-shots.mjs`
 * gives: reading the ruler alone would make this file self-consistent and
 * blind, because a size put on one element and not the other keeps vam's own
 * arithmetic agreeing with itself while every line on screen is composed for
 * the wrong width.
 */
const readTerminal = () =>
  term.evaluate(() => {
    const tab = document.querySelector('[data-terminal]');
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
    const px = (value) => Number.parseFloat(value) || 0;
    const asked = globalThis.window.__resized.at(-1) ?? null;
    return {
      tabWidth: tab.getBoundingClientRect().width,
      paneWidth: tab.parentElement.getBoundingClientRect().width,
      content: pane.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
      drawn,
      columns: asked === null ? null : asked.columns,
    };
  });

const terminalReport = [];
for (const size of SIZES) {
  await openTerminal(size, true);
  const narrowed = await readTerminal();
  terminalReport.push({ size, narrowed: narrowed.columns, content: narrowed.content });
  // THE WHOLE CLAIM OF WRITING THE CAP IN `ch`: "narrowed" means the SAME
  // column count at every size. A pixel maximum would mean 78 columns here and
  // 59 there, which is one setting silently meaning four different things.
  check(
    `narrowed, vam asks tmux for exactly ${MAX_CHARACTERS} columns at ${size}px`,
    narrowed.columns === MAX_CHARACTERS,
    `vam asked for ${narrowed.columns}; the box is ${narrowed.content}px at ${narrowed.drawn}px per cell`,
  );
  check(
    `and the cap really bound at ${size}px rather than the pane being small`,
    narrowed.tabWidth < narrowed.paneWidth - 100,
    `tab ${narrowed.tabWidth}px in a ${narrowed.paneWidth}px pane`,
  );
}

for (const size of SIZES) {
  await openTerminal(size, false);
  const wide = await readTerminal();
  const want = Math.floor(wide.content / wide.drawn);
  const row = terminalReport.find((entry) => entry.size === size);
  row.full = wide.columns;
  // The unchanged half: full-pane is still the box over the measured advance,
  // which is what shipped. Without this, "narrowed" could be the only state
  // that works.
  check(
    `full-pane, vam still asks for the ${want} columns that fit at ${size}px`,
    wide.columns === want,
    `vam asked for ${wide.columns} over a ${wide.content}px box at ${wide.drawn}px per cell`,
  );
  check(
    `and full-pane is wider than narrowed at ${size}px`,
    wide.columns > MAX_CHARACTERS,
    `${wide.columns} columns full-pane against ${row.narrowed} narrowed`,
  );
  if (size === 12.5) {
    await term.screenshot({ path: `${outDir}/view-width-terminal-full.png` });
    console.log(`${outDir}/view-width-terminal-full.png`);
  }
}
console.log('terminal columns per size:', JSON.stringify(terminalReport));

await openTerminal(12.5, true);
await term.screenshot({ path: `${outDir}/view-width-terminal-narrow.png` });
console.log(`${outDir}/view-width-terminal-narrow.png`);
await term.close();

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} view-width guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('view width guards: all assertions passed');
