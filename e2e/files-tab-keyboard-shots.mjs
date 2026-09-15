/**
 * THE FILES TAB'S KEYBOARD MODEL, MEASURED AS FOCUS -- which is the one thing
 * jsdom and happy-dom cannot see: neither lays out a real page, neither
 * implements `:focus-visible`, and `document.activeElement` in either is not
 * the browser's own answer to "who owns the keyboard right now". `test/panels/
 * DetailPanel.files-tab.test.tsx` already proves the REFUSAL VOCABULARY and
 * the DIRTY-STATE BOOKKEEPING against a fake bridge in happy-dom; this file's
 * job is the three things that are true only once Chromium has actually
 * painted and focused something:
 *
 *  1. THE EDITOR IS A REAL FOURTH INSERT SCOPE. `keyboard/focus-scope.ts`'s
 *     whole contract is that the cursor mode is derived from
 *     `document.activeElement`'s own ancestry, live, in a real DOM -- and the
 *     status chip that reports it (`mode-truth-shots.mjs`'s own subject) is
 *     the most direct proof there is that the mark actually landed on the
 *     element Chromium focused, not merely on the JSX that built it.
 *
 *  2. `changed-on-disk` STILL READS AS THE OPERATOR'S OWN EDIT, on screen,
 *     after a real save round-trip runs through a real click.
 *
 *  3. CLOSING WARNS. `beforeunload` is a real browser event with no analogue
 *     in either unit environment; dispatching a genuine (synthetic, but real)
 *     `beforeunload` and reading `defaultPrevented` back is the only way to
 *     prove vam actually asked the page to arm it.
 *
 * THE BRIDGE IS A STUB, injected with `page.addInitScript` -- the same
 * technique `settings-chrome-shots.mjs` already uses for `window.api.remote`.
 * IT MUST BE A COMPLETE ONE, not `files` alone: `App.tsx`'s own top-level
 * switch is `globalThis.window?.api !== undefined ? <DesktopCanvas ...>` --
 * merely DEFINING `window.api` (whatever it carries) takes the app off the
 * `?demo=1` fixture entirely and onto `createSourceFromPreload(api)`, which
 * calls `api.describe()`/`api.load()` for real. A `files`-only stub was tried
 * first here and reddened the whole page with "e.describe is not a
 * function" before a single Files-tab check ever ran -- so the stub below is
 * a full, minimal `PreloadSourceApi` (every capability false, one project,
 * one session) alongside `files`, which is what actually exercises
 * `Canvas.tsx`'s `filesTab` flag (`window.api?.files !== undefined`, with NO
 * `source.kind` gate -- see that flag's own comment for why that omission is
 * safe) the way the real desktop app would set it.
 *
 * Falsified by hand, three ways, each named in the task that built this file:
 *   - remove `insertScopeMark`/`insertStopMark` from the editor's `<textarea>`
 *     in `FilesTab.tsx` -- "the editor keeps focus while typing" reddens,
 *     because the mode chip stops reading Insert.
 *   - in `FilesTab.tsx`'s `saveFile`, fold `changed-on-disk` into the SAME
 *     branch as a real success (drop the `error.code === 'changed-on-disk'`
 *     check) -- "a conflict still shows the operator's own edit" reddens.
 *   - delete the `beforeunload` effect in `FilesTab.tsx` -- "closing warns
 *     while a buffer is dirty" reddens.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/files-tab-keyboard-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** A demo session with no open question, same one `composer-bar-shots.mjs` uses. */
const PLAIN_SESSION = 'crosscheck-2';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/**
 * A COMPLETE `PreloadSourceApi` stub -- one project, one session, every
 * capability false -- plus `files`, an in-memory filesystem defined ENTIRELY
 * inside the page so the conflict scenario below (a save whose baseline no
 * longer matches) can mutate real in-page state between calls. `files`'s own
 * refusals are worded and shaped exactly like `main/files/ipc.ts`'s, because
 * a stub that answers differently from the real channel would be testing a
 * fiction. See this file's own header for why the OTHER members exist at
 * all: this is what `DesktopCanvas` needs to render anything rather than
 * crash on `api.describe()`.
 */
await page.addInitScript(() => {
  const ENV_PATH = '/work/demo/.env';
  const files = new Map([[ENV_PATH, { content: 'A=1\n', rev: 0 }]]);
  const sig = (path) => {
    const entry = files.get(path);
    return { size: entry.content.length, mtimeMs: entry.rev, sha256: `rev-${entry.rev}` };
  };
  const refuse = (code, message) => Promise.reject({ kind: 'refused', code, message });
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
        // TRUE ON PURPOSE, and it is the whole point of this stub's shape:
        // with it, the view pill carries all FIVE icons (Response, PRs,
        // Terminal, Agents, Files) -- the widest the corner ever gets, and a
        // width NO OTHER web guard can reach, because they all run against
        // `?demo=1`, which has neither a terminal nor a file bridge and so
        // has only ever drawn three. The `6rem`/`66px` corner reservations
        // were fitted to that three-icon pill and were silently 22-50px short
        // everywhere else. Nothing here opens the Terminal tab.
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
            id: 'crosscheck-2',
            title: 'stub session',
            icon: null,
            epic: null,
            branch: null,
            status: 'waiting',
            runningAgents: 0,
            activity: null,
            age: '2m',
            // ONE REAL TURN, with a first line long enough to reach the
            // corner. The Response tab's pinned prompt bubble is the OTHER
            // half of the corner reservation (`DetailPanel.tsx`'s
            // `cornerOverhang`), and `narrow-pane-overlay-shots.mjs` can only
            // ever measure it at THREE icons -- it runs against `?demo=1`,
            // which has neither a terminal nor a file bridge. Without a turn
            // here, the five-icon case of that half would ship unguarded.
            // TEN of them, not one: the bubble only lands in the pill's
            // corner once the column OVERFLOWS and the newest turn pins to
            // its top. With a single turn the bubble sits well below the
            // pill, every check below passes without touching it, and the
            // guard says so rather than banking the free green -- which is
            // what the `reaches` check exists to refuse.
            decisions: Array.from({ length: 10 }, (_, i) => ({
              id: `d${i + 1}`,
              label: `step ${i + 1}`,
              input:
                `Turn ${i + 1}: rewrite the corner reservation so it follows the view pill ` +
                'instead of a constant fitted to three icons, and prove it at the widest ' +
                'pill there is.',
              // LONG, and the last one longest: the `in` bubble is
              // `position: sticky` and only pins to the column's top once its
              // own turn is tall enough to still be on screen when the column
              // is scrolled to its end. A short turn leaves the bubble
              // hundreds of pixels below the pill, where nothing can collide
              // and every check below would pass for the wrong reason.
              output: Array.from(
                { length: i === 9 ? 80 : 6 },
                (_, line) => `output line ${line + 1} for turn ${i + 1}`,
              ).join('\n'),
              commands: [],
            })),
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
    files: {
      list: async () => ({ root: '/work/demo', files: [...files.keys()], truncated: false }),
      read: async (path) => {
        const entry = files.get(path);
        if (entry === undefined) return refuse('not-found', `${path} does not exist`);
        return { content: entry.content, isBinary: false, signature: sig(path) };
      },
      write: async (path, content, baseSignature) => {
        const entry = files.get(path);
        const current = entry === undefined ? null : sig(path);
        const matches =
          (current === null && baseSignature === null) ||
          (current !== null && baseSignature !== null && current.sha256 === baseSignature.sha256);
        if (!matches) {
          return refuse('changed-on-disk', `${path} changed under you`);
        }
        const rev = (entry?.rev ?? -1) + 1;
        files.set(path, { content, rev });
        return { signature: sig(path) };
      },
    },
  };
  // Stands in for "an agent (or the operator, elsewhere) wrote this file
  // between the operator's own read and their own next save" — the exact
  // race `content.ts`'s own header describes. Called directly from the test,
  // at a moment IT chooses, rather than folded into `write` itself: the
  // conflict has to land BETWEEN two of the operator's own saves, not inside
  // one of them.
  globalThis.window.__agentEditNow = () => {
    const entry = files.get(ENV_PATH);
    files.set(ENV_PATH, { content: `${entry.content}\n# an agent wrote this`, rev: entry.rev + 1 });
  };
});

await page.goto(origin, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${PLAIN_SESSION}"]`).first().click();
await page.waitForSelector('[data-view="files"]', { timeout: 5_000 });

// ---------------------------------------------------------------------------
// 0b. AND NEITHER WOULD THE PROMPT BUBBLE'S FIRST LINE.
//
// The prompt bubble reserves its corner with a floated spacer, and the
// invariant `narrow-pane-overlay-shots.mjs` holds over it is two-sided: the
// spacer must start at or before the pill's left edge (or it is not what
// keeps the line clear) and no more than 48px before it (or that width is
// taken out of the first line for nothing). That guard can only ever measure
// it at THREE icons -- it runs against `?demo=1`, which has neither a
// terminal nor a file bridge -- and the old fitted `66px` passes at three and
// fails at five. This checks the same two-sided invariant at five.
//
// WHAT THIS DOES NOT CHECK, so it is not read for more than it is: whether
// the pill VERTICALLY overlaps the bubble. That needs the newest turn pinned
// to the column's top, which is a scroll-position property of the fixture,
// not of the reservation -- `narrow-pane-overlay-shots.mjs` owns it, samples
// real glyph pixels for it, and refuses its own run as vacuous if the two
// ever stop meeting. The width is the dimension that goes wrong with the
// icon count, and the width is what is measured here.

await page.waitForSelector('[data-column-turn][data-turn-newest] [data-detail-corner-reserve]', {
  timeout: 5_000,
});
const corner = await page.evaluate(() => {
  const pill = document.querySelector('[data-view-tabs]');
  const spacer = document.querySelector(
    '[data-column-turn][data-turn-newest] [data-detail-corner-reserve]',
  );
  const bubble = document.querySelector(
    '[data-column-turn][data-turn-newest] [data-detail-scroll="in"]',
  );
  if (pill === null || spacer === null || bubble === null) return null;
  const p = pill.getBoundingClientRect();
  const s = spacer.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  return {
    slack: Math.round(p.left - s.left),
    spacerWidth: Math.round(s.width),
    bubbleRight: Math.round(b.right),
  };
});
check(
  'the prompt bubble really does draw a corner reservation to measure',
  corner !== null && corner.spacerWidth > 0,
  JSON.stringify(corner),
);
check(
  'the prompt reservation starts at or before the five-icon pill, never inside it',
  corner !== null && corner.slack >= 0,
  `it starts ${-(corner?.slack ?? 0)}px INSIDE the pill (width ${corner?.spacerWidth})`,
);
check(
  'and no more than 48px before it — over-reserving costs the first line too',
  corner !== null && corner.slack <= 48,
  `it runs ${corner?.slack}px past the pill's left edge (width ${corner?.spacerWidth})`,
);
await page.locator('[data-view="files"]').click();
await page.waitForSelector('[data-files-row]', { timeout: 5_000 });
await page.locator('[data-files-row]').first().click();
await page.waitForSelector('[data-files-editor]', { timeout: 5_000 });

// ---------------------------------------------------------------------------
// 0. NOTHING THIS TAB DRAWS ENDS UP UNDER THE VIEW PILL.
//
// ASSERTED AS A RECTANGLE, NEVER AS A CLICK, and that distinction is the
// finding this check was written for: the Save button really did sit 18px
// under the pill, and `page.locator('[data-files-save]').click()` passed the
// whole way through anyway -- Playwright clicks an element's CENTRE, the
// centre was still clear, and `elementFromPoint` there returned the button.
// A control can be half-buried and perfectly clickable, so the only honest
// question is where its box is.

const pillBox = await page.evaluate(() => {
  const r = (sel) => {
    const e = document.querySelector(sel);
    if (e === null) return null;
    const b = e.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) };
  };
  return {
    overlay: r('[data-view-overlay]'),
    save: r('[data-files-save]'),
    path: r('[data-files-path]'),
    icons: document.querySelectorAll('[data-view-overlay] [data-view]').length,
  };
});
check(
  'the pill really is carrying all five view icons — the widest case',
  pillBox.icons === 5,
  `it carries ${pillBox.icons}`,
);
check(
  'the Save button clears the view pill entirely, not just at its centre',
  pillBox.save !== null && pillBox.overlay !== null && pillBox.save.right <= pillBox.overlay.left,
  `save ends at ${pillBox.save?.right}, pill starts at ${pillBox.overlay?.left}`,
);
check(
  'and so does the file path beside it',
  pillBox.path !== null && pillBox.overlay !== null && pillBox.path.right <= pillBox.overlay.left,
  `path ends at ${pillBox.path?.right}, pill starts at ${pillBox.overlay?.left}`,
);

// ---------------------------------------------------------------------------
// 1. THE EDITOR IS A REAL INSERT SCOPE — the mode chip, not a class name.

const editor = page.locator('[data-files-editor]');
await editor.click();
await page.waitForFunction(
  () => document.activeElement?.matches('[data-files-editor]') ?? false,
  null,
  { timeout: 3_000 },
);
check(
  'the editor actually holds DOM focus after a click',
  await page.evaluate(() => document.activeElement?.matches('[data-files-editor]') ?? false),
);
const modeWhileEditing = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check(
  'the mode chip reads Insert while the editor has focus — the fourth insert scope',
  modeWhileEditing === 'Insert',
  `it reads ${modeWhileEditing}`,
);
await page.screenshot({ path: `${outDir}/files-tab-editor-insert.png` });
console.log(`${outDir}/files-tab-editor-insert.png`);

// A bare letter must land IN the box.
await editor.press('End');
await page.keyboard.type('j');
const afterBareKey = await editor.inputValue();
check(
  'a bare letter typed in the editor lands in the editor',
  afterBareKey === 'A=1\nj',
  `editor reads ${JSON.stringify(afterBareKey)}`,
);

/**
 * `Mod-d` IS THE ONE `isSelectOnly` CHORD IN THE WHOLE TABLE
 * (`keyboard/chords.ts`'s own `isSelectOnly`) — the sharpest lever there is
 * for "did the insert scope actually register". `Canvas.tsx`'s handler reads
 * the cursor mode off `document.activeElement` at the moment the key
 * arrives: with the mark intact it reads Insert and returns BEFORE doing
 * anything, including `setStatus` — so whatever the status bar already said
 * is untouched. With the mark REMOVED, the same keystroke resolves as
 * `scrollHalf`, finds no transcript column behind the Files tab, and calls
 * `setStatus('nothing to scroll — this pane is not showing a transcript')` --
 * a status line the correct behaviour never produces at all, which is the
 * one thing that is safe to assert changed or did not, in either case.
 */
const statusBefore = await page.evaluate(() => document.querySelector('[data-status]')?.textContent ?? '');
await page.keyboard.press('Control+d');
const statusAfter = await page.evaluate(() => document.querySelector('[data-status]')?.textContent ?? '');
check(
  'Mod-d (the one select-only chord) is silently declined, not fired as scrollHalf',
  statusAfter === statusBefore,
  `status went from ${JSON.stringify(statusBefore)} to ${JSON.stringify(statusAfter)}`,
);
check(
  'and the editor keeps focus throughout',
  await page.evaluate(() => document.activeElement?.matches('[data-files-editor]') ?? false),
);

// Leave the way the composer's own Mod-[ does, and confirm Select comes back.
await page.keyboard.press('Control+[');
await page.waitForFunction(
  () => (document.querySelector('[data-mode]')?.textContent ?? '') === 'Select',
  null,
  { timeout: 3_000 },
).catch(() => {});
const modeAfterLeave = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check('Mod-[ hands the keyboard back to Select', modeAfterLeave === 'Select', `it reads ${modeAfterLeave}`);
check(
  'and the unsaved text is still in the box — leaving is not discarding',
  (await editor.inputValue()) === 'A=1\nj',
);

// ---------------------------------------------------------------------------
// 2. `changed-on-disk` STILL SHOWS THE OPERATOR'S OWN EDIT.

await editor.click();
await editor.fill('A=1\nj');
await page.locator('[data-files-save]').click();
await page.waitForFunction(
  () => document.querySelector('[data-files-save]')?.getAttribute('data-files-save-state') === 'idle',
  null,
  { timeout: 5_000 },
);

// An agent writes the file between this save and the operator's next one.
await page.evaluate(() => {
  globalThis.window.__agentEditNow();
});
await editor.click();
await editor.fill('A=OPERATORS-OWN-EDIT');
await page.locator('[data-files-save]').click();
await page.waitForSelector('[data-files-conflict]', { timeout: 5_000 });
const conflictText = await page.locator('[data-files-conflict]').innerText();
check('a changed-on-disk save shows the conflict banner', conflictText.includes('changed on disk'), conflictText);
const editorDuringConflict = await editor.inputValue();
check(
  'and the operator\'s own edit is still in the box — never silently overwritten or reverted',
  editorDuringConflict === 'A=OPERATORS-OWN-EDIT',
  `editor reads ${JSON.stringify(editorDuringConflict)}`,
);
check(
  'and the dirty mark is still shown — a real success would have cleared it',
  (await page.locator('[data-files-dirty]').count()) > 0,
);
await page.screenshot({ path: `${outDir}/files-tab-conflict.png` });
console.log(`${outDir}/files-tab-conflict.png`);

// Reload is the one explicit, labelled way to give the edit up.
await page.locator('[data-files-reload]').click();
await page.waitForFunction(
  () => document.querySelector('[data-files-conflict]') === null,
  null,
  { timeout: 5_000 },
);
const reloaded = await editor.inputValue();
check(
  'Reload replaces the buffer with what is actually on disk, only once asked',
  reloaded.includes('an agent wrote this'),
  `editor reads ${JSON.stringify(reloaded)}`,
);

// ---------------------------------------------------------------------------
// 3. CLOSING WARNS WHILE A BUFFER IS DIRTY.

const beforeUnloadPrevented = () =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

check(
  'no warning is armed with nothing dirty (just reloaded, matches disk)',
  (await beforeUnloadPrevented()) === false,
);

await editor.click();
await editor.fill('A=UNSAVED-ON-CLOSE');
const armedWhileDirty = await beforeUnloadPrevented();
check('closing warns the moment a buffer is dirty', armedWhileDirty === true, `defaultPrevented was ${armedWhileDirty}`);

await page.locator('[data-files-save]').click();
await page.waitForFunction(
  () => document.querySelector('[data-files-save]')?.getAttribute('data-files-save-state') === 'idle',
  null,
  { timeout: 5_000 },
).catch(() => {});
const disarmedAfterSave = await beforeUnloadPrevented();
check('and the warning stands down once the save actually lands', disarmedAfterSave === false);

// ---------------------------------------------------------------------------
// 4. THE LINE-NUMBER GUTTER IS ACTUALLY LEVEL WITH THE TEXT.
//
// The unit suite proves the gutter holds the RIGHT NUMBERS and that the sync
// handler carries the offset. Neither is the property that breaks in front of
// an operator: two columns can hold perfectly correct content and still drift
// apart, because drift is a LAYOUT fact -- a different line-height, a
// different font fallback, one box padded where the other is not, or a
// textarea that soft-wraps one long line into two rows while the gutter
// numbers it once. happy-dom lays none of that out and would pass every one
// of those bugs. Chromium is the only witness.

await editor.click();
const LINES = 60;
await editor.fill(Array.from({ length: LINES }, (_, i) => `line ${i + 1}`).join('\n'));
await page.waitForFunction(
  (n) => (document.querySelector('[data-files-gutter]')?.textContent ?? '').endsWith(`\n${n}`),
  LINES,
  { timeout: 3_000 },
);

const box = await page.evaluate(() => {
  const gutter = document.querySelector('[data-files-gutter]');
  const area = document.querySelector('[data-files-editor]');
  if (gutter === null || area === null) return null;
  const gs = getComputedStyle(gutter);
  const as = getComputedStyle(area);
  return {
    gutterScrollHeight: gutter.scrollHeight,
    areaScrollHeight: area.scrollHeight,
    gutterTop: gutter.getBoundingClientRect().top,
    areaTop: area.getBoundingClientRect().top,
    sameLineHeight: gs.lineHeight === as.lineHeight,
    sameFont: gs.fontFamily === as.fontFamily && gs.fontSize === as.fontSize,
    areaWhiteSpace: as.whiteSpace,
  };
});

check('the gutter and the editor render the same line height', box?.sameLineHeight === true,
  JSON.stringify(box));
check('and the same monospace face at the same size', box?.sameFont === true, JSON.stringify(box));
check(
  'so 60 numbered lines occupy the same height in both columns',
  box !== null && Math.abs(box.gutterScrollHeight - box.areaScrollHeight) <= 1,
  `gutter ${box?.gutterScrollHeight}px vs editor ${box?.areaScrollHeight}px`,
);
check(
  'and both columns start at the same y — a one-off padding difference is a permanent one-line drift',
  box !== null && Math.abs(box.gutterTop - box.areaTop) <= 1,
  `gutter top ${box?.gutterTop} vs editor top ${box?.areaTop}`,
);

// THE WRAP. One line far wider than the pane: the editor must scroll
// sideways, not fold the line into a second row the gutter cannot number.
await editor.fill(`${'x'.repeat(4_000)}\nsecond`);
const wrap = await page.evaluate(() => {
  const area = document.querySelector('[data-files-editor]');
  const gutter = document.querySelector('[data-files-gutter]');
  if (area === null || gutter === null) return null;
  return {
    scrollWidth: area.scrollWidth,
    clientWidth: area.clientWidth,
    gutterText: gutter.textContent ?? '',
    sameHeight: Math.abs(gutter.scrollHeight - area.scrollHeight) <= 1,
  };
});
check(
  'a 4,000-character line scrolls sideways rather than wrapping',
  wrap !== null && wrap.scrollWidth > wrap.clientWidth,
  `scrollWidth ${wrap?.scrollWidth} vs clientWidth ${wrap?.clientWidth}`,
);
check(
  'and it is still numbered as exactly two lines',
  wrap?.gutterText === '1\n2',
  `gutter reads ${JSON.stringify(wrap?.gutterText)}`,
);
check(
  'so the two columns are still the same height with a line that long',
  wrap?.sameHeight === true,
  JSON.stringify(wrap),
);

// THE SCROLL, driven the way an operator drives it: a real wheel over the
// text, not an assignment.
await editor.fill(Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join('\n'));
await editor.click();
await page.mouse.wheel(0, 900);
await page.waitForFunction(
  () => (document.querySelector('[data-files-editor]')?.scrollTop ?? 0) > 0,
  null,
  { timeout: 3_000 },
);
const scrolled = await page.evaluate(() => ({
  area: document.querySelector('[data-files-editor]')?.scrollTop ?? -1,
  gutter: document.querySelector('[data-files-gutter]')?.scrollTop ?? -1,
}));
check(
  'a real wheel scroll carries the numbers with the text',
  scrolled.area > 0 && Math.abs(scrolled.area - scrolled.gutter) <= 1,
  `editor at ${scrolled.area}, gutter at ${scrolled.gutter}`,
);
await page.screenshot({ path: `${outDir}/files-tab-gutter.png` });
console.log(`${outDir}/files-tab-gutter.png`);

// Leave the buffer clean so nothing is pending when the browser closes.
await page.locator('[data-files-save]').click();
await page
  .waitForFunction(
    () => document.querySelector('[data-files-save]')?.getAttribute('data-files-save-state') === 'idle',
    null,
    { timeout: 5_000 },
  )
  .catch(() => {});

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nfiles-tab-keyboard: every check passed.');
