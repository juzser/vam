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
  // THREE PATHS, NOT ONE, AND TWO LEVELS DEEP ON PURPOSE. The tab draws a
  // TREE now, and a listing of one top-level file has no directory row, no
  // depth and nothing to expand -- every tree check below would pass against
  // a component that could not draw a directory at all.
  const files = new Map([
    [ENV_PATH, { content: 'A=1\n', rev: 0 }],
    ['/work/demo/src/index.ts', { content: 'export const a = 1\n', rev: 0 }],
    ['/work/demo/src/lib/util.ts', { content: 'export const b = 2\n', rev: 0 }],
  ]);
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
        // width only a stub can reach, because every OTHER guard runs against
        // `?demo=1`, which has neither a terminal nor a file bridge and so
        // has only ever drawn three. (`files-markdown-shots.mjs` stubs the
        // same five for the same reason, and measures the toolbar controls
        // this file does not know about.) The `6rem`/`66px` corner
        // reservations were fitted to that three-icon pill and were silently
        // 22-50px short everywhere else. Nothing here opens the Terminal tab.
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

/** One tree row, by the absolute path it carries. */
const treeRow = (path) => page.locator(`[data-files-row-path="${path}"]`);
/** Every visible row's path, in draw order. */
const treePaths = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-files-row]')].map((el) =>
      el.getAttribute('data-files-row-path'),
    ),
  );
/** The path the tree's keyboard cursor is on, as Chromium reports focus. */
const focusedRow = () =>
  page.evaluate(
    () => document.activeElement?.getAttribute('data-files-row-path') ?? null,
  );

/**
 * THE CORNER, IN THE STATE THE TAB OPENS IN — before a file is picked.
 *
 * This is where the reservation was nearly lost. The tree's clearance is the
 * height of the header row above it, and that row holds the open file's path
 * and its Save button: WITH a file open it comes to 26px, WITHOUT one it
 * comes to 16px, and the pill reaches 30px into this tab either way. So a
 * check that only ever measured the tab with a file open would pass on an
 * accidental 2px while the state a pane actually LANDS in -- nothing open --
 * had its first tree row 8px under the icons. Measured, both, with the
 * reservation deliberately removed. `cornerReserveHeight` is what makes the
 * row 34px in both states, and this is the half of the guard that says so.
 */
const emptyCorner = await page.evaluate(() => {
  const r = (sel) => {
    const e = document.querySelector(sel);
    if (e === null) return null;
    const b = e.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
  };
  return { overlay: r('[data-view-overlay]'), tree: r('[data-files-tree]') };
});
check(
  'with NO file open — the state the tab lands in — the tree still clears the view pill',
  emptyCorner.tree !== null &&
    emptyCorner.overlay !== null &&
    emptyCorner.tree.top >= emptyCorner.overlay.bottom,
  `tree top ${emptyCorner.tree?.top}, pill bottom ${emptyCorner.overlay?.bottom}`,
);

await treeRow('/work/demo/.env').click();
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
    tree: r('[data-files-tree]'),
    editorColumn: r('[data-files-editor-column]'),
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

/**
 * AND THE TREE, WHICH IS THE CORNER NOW.
 *
 * The other two checks above are HORIZONTAL, and horizontal is all the
 * reservation used to be, because everything this tab drew was a full-width
 * row that could be pushed left. The tree is a COLUMN AT THE RIGHT-HAND EDGE:
 * no amount of right-hand padding moves it out from under the pill, and the
 * only thing that clears it is starting BELOW the pill. That is what
 * `DetailPanel.tsx`'s `cornerReserveHeight` buys, worn by the header row as a
 * minimum height -- and it is worth stating plainly that it could not be left
 * to the header row's own natural height: measured, that came to ~26px
 * against a pill reaching 30px into this tab's box, so the tree's top row
 * would have sat under the pill by a margin small enough that only its first
 * row's top pixels were buried. That is exactly the shape of the Save
 * button's own 18px bug -- clickable at the centre, buried at the edge --
 * which is why this is a rectangle and not a click.
 */
check(
  'the tree column really is drawn, and at the right-hand edge of the pane',
  pillBox.tree !== null &&
    pillBox.editorColumn !== null &&
    pillBox.tree.left >= pillBox.editorColumn.right,
  `tree ${JSON.stringify(pillBox.tree)}, editor column ${JSON.stringify(pillBox.editorColumn)}`,
);
check(
  'the tree starts entirely below the view pill — nothing in it is under the icons',
  pillBox.tree !== null && pillBox.overlay !== null && pillBox.tree.top >= pillBox.overlay.bottom,
  `tree top ${pillBox.tree?.top}, pill bottom ${pillBox.overlay?.bottom}`,
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


// ---------------------------------------------------------------------------
// 4b. THE HIGHLIGHT OVERLAY IS THE THIRD COLUMN, AND IT IS MEASURED LIKE ONE.
//
// The colours are painted on a `<pre>` BEHIND a transparent-text textarea,
// which means the same characters are laid out twice and the operator's caret
// is in the copy they cannot see. That illusion survives exactly as long as
// every one of these holds -- identical face, size, line-height and padding
// box; the same height over the same 60 lines; the same top; no wrapping; and
// both axes of scroll carried across. Every one of them is a LAYOUT fact, and
// happy-dom (which the unit suite runs in) lays none of it out: the unit test
// can prove the overlay holds the right TEXT and nothing more.
//
// One measured quirk is asserted rather than papered over: a `<pre>` gives the
// final `\n` of its text no line box and a `<textarea>` does, so `FilesTab`
// appends one newline to the overlay when the file ends in one. Without that
// the two columns differ by exactly one line's height -- 18px here -- which is
// what the equal-scrollHeight check below would have caught.

await editor.click();
await editor.fill(`${Array.from({ length: LINES }, (_, i) => `A_${i + 1}=value ${i + 1}`).join('\n')}\n`);
await page.waitForFunction(
  (n) => (document.querySelector('[data-files-gutter]')?.textContent ?? '').endsWith(`\n${n + 1}`),
  LINES,
  { timeout: 3_000 },
);

const layers = await page.evaluate(() => {
  const area = document.querySelector('[data-files-editor]');
  const over = document.querySelector('[data-files-highlight]');
  const gutter = document.querySelector('[data-files-gutter]');
  if (area === null || over === null || gutter === null) return null;
  const as = getComputedStyle(area);
  const os = getComputedStyle(over);
  const gs = getComputedStyle(gutter);
  const box = (el) => {
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width) };
  };
  const same = (prop) => as[prop] === os[prop];
  return {
    areaScrollHeight: area.scrollHeight,
    overScrollHeight: over.scrollHeight,
    gutterScrollHeight: gutter.scrollHeight,
    areaBox: box(area),
    overBox: box(over),
    gutterTop: box(gutter).top,
    // Every property that decides where a glyph lands.
    sameFont: same('fontFamily') && same('fontSize') && same('fontWeight'),
    sameMetrics: same('lineHeight') && same('letterSpacing') && same('wordSpacing'),
    samePadding:
      as.paddingTop === os.paddingTop &&
      as.paddingLeft === os.paddingLeft &&
      as.paddingRight === os.paddingRight &&
      as.paddingBottom === os.paddingBottom,
    sameBorder: as.borderWidth === os.borderWidth,
    sameWrap: same('whiteSpace') && same('tabSize'),
    sameScale: as.zoom === os.zoom && as.transform === os.transform,
    // And the same face as the GUTTER, which the pre-existing check holds for
    // the textarea -- three columns, one line box.
    gutterSameMetrics: gs.lineHeight === os.lineHeight && gs.fontSize === os.fontSize,
    overlayText: over.textContent,
    areaValue: area.value,
    // `text-transparent` on the textarea is what lets the overlay show, and a
    // caret that went transparent with it would be an editor with no cursor.
    areaColour: as.color,
    caret: as.caretColor,
  };
});

check('the overlay is actually drawn for a .env file', layers !== null, 'no [data-files-highlight]');
check(
  'the overlay and the textarea render the same face at the same size',
  layers?.sameFont === true,
  JSON.stringify(layers),
);
check(
  'and the same line-height, letter-spacing and word-spacing',
  layers?.sameMetrics === true,
  JSON.stringify(layers),
);
check(
  'and the same padding box — a pixel of padding is a permanent offset on every line',
  layers?.samePadding === true && layers?.sameBorder === true,
  JSON.stringify(layers),
);
check(
  'and the same wrapping and tab-size, so neither can break a line the other does not',
  layers?.sameWrap === true && layers?.sameScale === true,
  JSON.stringify(layers),
);
check(
  'so 60 lines occupy the same height in the overlay as in the text',
  layers !== null && Math.abs(layers.overScrollHeight - layers.areaScrollHeight) <= 1,
  `overlay ${layers?.overScrollHeight}px vs editor ${layers?.areaScrollHeight}px`,
);
check(
  'and the gutter is still the same height as both — three columns, one line box',
  layers !== null && Math.abs(layers.gutterScrollHeight - layers.areaScrollHeight) <= 1,
  `gutter ${layers?.gutterScrollHeight}px vs editor ${layers?.areaScrollHeight}px`,
);
check(
  'the two layers start at the same point, to the pixel',
  layers !== null &&
    layers.overBox.top === layers.areaBox.top &&
    layers.overBox.left === layers.areaBox.left &&
    layers.overBox.width === layers.areaBox.width,
  `overlay ${JSON.stringify(layers?.overBox)} vs editor ${JSON.stringify(layers?.areaBox)}`,
);
check(
  'and the gutter is level with them',
  layers !== null && Math.abs(layers.gutterTop - layers.areaBox.top) <= 1,
  `gutter top ${layers?.gutterTop} vs editor top ${layers?.areaBox.top}`,
);
check(
  'the overlay holds the file’s own text, plus only the one newline a <pre> drops',
  layers !== null && layers.overlayText === `${layers.areaValue}\n`,
  `overlay ${JSON.stringify(layers?.overlayText?.slice(-40))} vs value ${JSON.stringify(layers?.areaValue?.slice(-40))}`,
);
check(
  'the text under the overlay is transparent and its caret is NOT',
  layers !== null &&
    layers.areaColour === 'rgba(0, 0, 0, 0)' &&
    layers.caret !== 'rgba(0, 0, 0, 0)' &&
    layers.caret !== layers.areaColour,
  `colour ${layers?.areaColour}, caret ${layers?.caret}`,
);

// THE COLOURS ARE REALLY PAINTED, and they are really different from each
// other. A stylesheet that defined none of these tokens would leave every run
// the same inherited ink, every check above would still pass, and the whole
// feature would be invisible -- which is the shape `a-content-scan-proves-the-
// rule-was-typed` warns about. So this measures the PAINT, per token kind.
const painted = await page.evaluate(() => {
  const runs = [...document.querySelectorAll('[data-files-highlight] span')];
  const byClass = new Map();
  for (const run of runs) {
    const key = run.className || 'plain';
    if (!byClass.has(key)) byClass.set(key, getComputedStyle(run).color);
  }
  return Object.fromEntries(byClass);
});
check(
  'the overlay paints at least two distinct colours — a key is not its value',
  new Set(Object.values(painted)).size >= 2,
  JSON.stringify(painted),
);
check(
  'and the keyword colour is a real token rather than the inherited ink',
  painted['text-syn-keyword'] !== undefined && painted['text-syn-keyword'] !== painted.plain,
  JSON.stringify(painted),
);

// BOTH AXES OF SCROLL. The vertical one the gutter already proves; the
// HORIZONTAL one is the overlay's alone, because the gutter has no long lines
// and never scrolls sideways. An overlay that tracked only `scrollTop` would
// look perfect until the first line wider than the pane.
await editor.fill(`LONG=${'x'.repeat(4_000)}\nSHORT=1\n`);
const overlayWrap = await page.evaluate(() => {
  const area = document.querySelector('[data-files-editor]');
  const over = document.querySelector('[data-files-highlight]');
  if (area === null || over === null) return null;
  return {
    areaScrollWidth: area.scrollWidth,
    overScrollWidth: over.scrollWidth,
    clientWidth: area.clientWidth,
    sameHeight: Math.abs(over.scrollHeight - area.scrollHeight) <= 1,
  };
});
check(
  'a 4,000-character line makes the overlay scroll sideways too, rather than wrap',
  overlayWrap !== null &&
    overlayWrap.overScrollWidth > overlayWrap.clientWidth &&
    // The textarea's own scrollWidth excludes its padding-right in Chromium
    // and the `<pre>`'s does not, so the two differ by exactly that padding.
    // The property that matters is that neither WRAPPED, which is the height.
    overlayWrap.sameHeight,
  JSON.stringify(overlayWrap),
);

// Driven the way an operator drives it: a real horizontal wheel over the text,
// not an assignment to `scrollLeft`.
await editor.click();
await page.mouse.wheel(600, 0);
await page.waitForFunction(
  () => (document.querySelector('[data-files-highlight]')?.scrollLeft ?? 0) > 0,
  null,
  { timeout: 3_000 },
).catch(() => {});
const carried = await page.evaluate(() => ({
  area: document.querySelector('[data-files-editor]')?.scrollLeft ?? -1,
  over: document.querySelector('[data-files-highlight]')?.scrollLeft ?? -1,
}));
check(
  'and a sideways scroll carries the colours with the text, to the pixel',
  carried.area > 0 && carried.area === carried.over,
  `editor at ${carried.area}, overlay at ${carried.over}`,
);

// AND THE VERTICAL AXIS, driven by a real wheel over the text.
await editor.fill(Array.from({ length: 400 }, (_, i) => `K_${i + 1}=v`).join('\n'));
await editor.click();
await page.mouse.wheel(0, 900);
await page.waitForFunction(
  () => (document.querySelector('[data-files-editor]')?.scrollTop ?? 0) > 0,
  null,
  { timeout: 3_000 },
);
const carriedDown = await page.evaluate(() => ({
  area: document.querySelector('[data-files-editor]')?.scrollTop ?? -1,
  over: document.querySelector('[data-files-highlight]')?.scrollTop ?? -1,
  gutter: document.querySelector('[data-files-gutter]')?.scrollTop ?? -1,
}));
check(
  'a real wheel scroll carries BOTH the numbers and the colours with the text',
  carriedDown.area > 0 &&
    Math.abs(carriedDown.area - carriedDown.over) <= 1 &&
    Math.abs(carriedDown.area - carriedDown.gutter) <= 1,
  JSON.stringify(carriedDown),
);
await page.screenshot({ path: `${outDir}/files-tab-highlight.png` });
console.log(`${outDir}/files-tab-highlight.png`);

// ---------------------------------------------------------------------------
// 4c. FORMAT, AND THE UNDO THAT MAKES IT SAFE TO PRESS.
//
// The unit suite proves the formatter's answers and the tab's three branches.
// What only a real browser can answer is whether `Mod-Shift-f` and `Mod-z`
// reach the editor AT ALL: both are chords, both pass through `normalizeKey`,
// and `Mod-z` is deliberately NOT swallowed unless there is a format to undo
// -- a `preventDefault` decided from a handler's return value, on a cancelable
// event, which is the one thing `key-truth-shots.mjs` exists to say cannot be
// measured with a hand-built event.

await treeRow('/work/demo/.env').click();
await editor.click();
const BEFORE = 'A=1\n\n\n\n# a note   \nB=2\n';
await editor.fill(BEFORE);
await page.keyboard.press('Control+Shift+KeyF');
await page.waitForFunction(
  () => (document.querySelector('[data-files-editor]')?.value ?? '') === 'A=1\n\n# a note\nB=2\n',
  null,
  { timeout: 3_000 },
).catch(() => {});
check(
  'Mod-Shift-f formats the open file from the keyboard',
  (await editor.inputValue()) === 'A=1\n\n# a note\nB=2\n',
  JSON.stringify(await editor.inputValue()),
);
check(
  'and says so, with the way back out of it on screen',
  (await page.locator('[data-files-note]').textContent())?.includes('Mod-z') === true &&
    (await page.locator('[data-files-format-undo]').count()) === 1,
);
await page.keyboard.press('Control+KeyZ');
await page.waitForFunction(
  (want) => (document.querySelector('[data-files-editor]')?.value ?? '') === want,
  BEFORE,
  { timeout: 3_000 },
).catch(() => {});
check(
  'and Mod-z puts the file back exactly as it was, in a real browser',
  (await editor.inputValue()) === BEFORE,
  JSON.stringify(await editor.inputValue()),
);

// THE REFUSAL, ALOUD AND BY NAME, on a file type vam will not format -- and
// with no overlay drawn for it either, which is the same decision seen twice.
await treeRow('/work/demo/src').click();
await page.waitForFunction(() => document.querySelectorAll('[data-files-row]').length > 2, null, {
  timeout: 3_000,
});
await treeRow('/work/demo/src/index.ts').click();
await page.waitForFunction(
  () => (document.querySelector('[data-files-editor]')?.value ?? '').startsWith('export'),
  null,
  { timeout: 3_000 },
);
check(
  'a .ts file gets no overlay — vam draws no colour it cannot prove',
  (await page.locator('[data-files-highlight]').count()) === 0,
);
await page.locator('[data-files-format]').click();
const refusal = (await page.locator('[data-files-note]').textContent()) ?? '';
check(
  'and pressing Format on it says so by name rather than doing nothing',
  refusal.includes('.ts') && refusal.includes('.json'),
  JSON.stringify(refusal),
);
check(
  'and the file itself is untouched by the refusal',
  (await editor.inputValue()) === 'export const a = 1\n',
  JSON.stringify(await editor.inputValue()),
);

// PUT THE TREE BACK AS THIS SECTION FOUND IT. Section 5 below walks the tree
// from its own starting shape and counts rows; leaving `src` expanded here
// moved its cursor two rows and reddened two of ITS checks, which is a state
// leak between sections rather than a bug in either. Shut the directory, and
// leave the keyboard where the next section expects to pick it up.
await treeRow('/work/demo/src').click();
await page.waitForFunction(
  () => document.querySelectorAll('[data-files-row]').length === 2,
  null,
  { timeout: 3_000 },
);
await treeRow('/work/demo/.env').click();

// ---------------------------------------------------------------------------
// 5. THE TREE'S OWN KEYBOARD, IN A REAL BROWSER.
//
// `test/panels/files-tree.test.ts` proves what each key DECIDES and
// `test/panels/DetailPanel.files-tab.test.tsx` proves the wiring reaches it.
// Neither can answer the two questions that only Chromium can:
//
//   * IS THE TREE REALLY OUTSIDE THE INSERT SCOPE? The cursor mode is derived
//     from `document.activeElement`'s own ancestry, live (`keyboard/
//     focus-scope.ts`), and the status chip is the app's own report of it. A
//     tree that accidentally sat inside an insert scope would make every bare
//     `j` here a character somewhere -- and happy-dom, which lays nothing out
//     and focuses anything, cannot tell the two apart.
//   * DOES FOCUS ACTUALLY LAND? `focusCursorRow` and `focusEditor` both
//     REPORT whether they landed, and a refusal is drawn when they do not.
//     Only a real browser can say whether a `<button>` with a roving
//     `tabIndex` took the keyboard.

await treeRow('/work/demo/.env').click();
await page.waitForFunction(
  () => document.activeElement?.hasAttribute('data-files-row') ?? false,
  null,
  { timeout: 3_000 },
);
check(
  'clicking a row puts the keyboard on that row',
  (await focusedRow()) === '/work/demo/.env',
  `focus is on ${await focusedRow()}`,
);
const modeOnTree = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check(
  'the mode chip reads Select with the keyboard in the tree — it is NOT an insert scope',
  modeOnTree === 'Select',
  `it reads ${modeOnTree}`,
);

// A bare `j` walks the tree. Two things are asserted about one keystroke: the
// cursor moved, AND the editor's text is untouched -- a `j` that had been
// swallowed as TEXT would have shown up there, and a `j` that had fallen
// through to the canvas grammar would have moved the session cursor instead.
const editorBeforeWalk = await editor.inputValue();
await page.keyboard.press('k');
check(
  'a bare k walks up to the directory above',
  (await focusedRow()) === '/work/demo/src',
  `focus is on ${await focusedRow()}`,
);
await page.keyboard.press('j');
check('and a bare j walks back down', (await focusedRow()) === '/work/demo/.env');
check(
  'and neither of them was typed into the open file',
  (await editor.inputValue()) === editorBeforeWalk,
);

// `l` opens the directory under the cursor, `h` shuts it -- the two keys the
// whole tree exists for.
await page.keyboard.press('k'); // back onto src/
await page.keyboard.press('l');
await page.waitForFunction(
  () => document.querySelectorAll('[data-files-row]').length > 2,
  null,
  { timeout: 3_000 },
);
check(
  'l opens the directory under the cursor, listing its own children',
  JSON.stringify(await treePaths()) ===
    JSON.stringify([
      '/work/demo/src',
      '/work/demo/src/lib',
      '/work/demo/src/index.ts',
      '/work/demo/.env',
    ]),
  JSON.stringify(await treePaths()),
);
await page.keyboard.press('l'); // step into it
check(
  'and pressing it again steps into the directory rather than opening it twice',
  (await focusedRow()) === '/work/demo/src/lib',
  `focus is on ${await focusedRow()}`,
);
await page.keyboard.press('h'); // back out to the parent
check('h steps back out to the parent', (await focusedRow()) === '/work/demo/src');
await page.keyboard.press('h'); // shut it
await page.waitForFunction(
  () => document.querySelectorAll('[data-files-row]').length === 2,
  null,
  { timeout: 3_000 },
);
check(
  'and h on an open directory shuts it again',
  JSON.stringify(await treePaths()) === JSON.stringify(['/work/demo/src', '/work/demo/.env']),
  JSON.stringify(await treePaths()),
);

await page.screenshot({ path: `${outDir}/files-tab-tree.png` });
console.log(`${outDir}/files-tab-tree.png`);

// Enter opens the file AND hands the keyboard to the editor -- the two halves
// of one act, which is why it is one key.
await page.keyboard.press('j');
await page.keyboard.press('Enter');
await page.waitForFunction(
  () => document.activeElement?.matches('[data-files-editor]') ?? false,
  null,
  { timeout: 3_000 },
);
check(
  'Enter on a file row opens it and puts the caret in the editor',
  await page.evaluate(() => document.activeElement?.matches('[data-files-editor]') ?? false),
);
const modeAfterEnter = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check('and the mode chip follows the keyboard into Insert', modeAfterEnter === 'Insert',
  `it reads ${modeAfterEnter}`);

/**
 * MOD-SHIFT-E, BOTH WAYS. One chord for one act -- "the other half of this
 * tab" -- rather than one per direction. This is the check to break when
 * falsifying: make either branch a no-op and the leg that used it reddens
 * while the other stays green, which is how a half-wired toggle would
 * otherwise ship.
 */
await page.keyboard.press('Control+Shift+E');
await page.waitForFunction(
  () => document.activeElement?.hasAttribute('data-files-row') ?? false,
  null,
  { timeout: 3_000 },
).catch(() => {});
check(
  'Mod-Shift-e takes the keyboard from the editor to the tree',
  (await focusedRow()) === '/work/demo/.env',
  `focus is on ${await focusedRow()}`,
);
await page.keyboard.press('Control+Shift+E');
await page.waitForFunction(
  () => document.activeElement?.matches('[data-files-editor]') ?? false,
  null,
  { timeout: 3_000 },
).catch(() => {});
check(
  'and Mod-Shift-e takes it straight back to the editor',
  await page.evaluate(() => document.activeElement?.matches('[data-files-editor]') ?? false),
);

// ---------------------------------------------------------------------------
// 6. AND ALL OF IT AT vam's NARROWEST LEGAL PANE.
//
// `prefs/panes.ts` floors the detail pane at `DETAIL_MIN` = 320px, and
// `SIDEBAR_MIN + DETAIL_MIN` = 520px is the narrowest window that can draw
// both columns at all (one pixel under it, `usePhoneViewport` hands the whole
// window to the phone shell instead). So 520px is exactly the floor, and it
// is the width at which a second column either fits or takes the editor's.
//
// The invariant asserted is NOT a pixel count -- that would be a restatement
// of `TREE_WIDTH` rather than a check on it -- but the two properties the
// clamp exists to hold: the tree is still wide enough to read a name in, and
// the editor still has the larger half of what is left.

await page.setViewportSize({ width: 520, height: 760 });
await page.waitForTimeout(200);
const narrow = await page.evaluate(() => {
  const r = (sel) => {
    const e = document.querySelector(sel);
    if (e === null) return null;
    const b = e.getBoundingClientRect();
    return {
      left: Math.round(b.left),
      right: Math.round(b.right),
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      width: Math.round(b.width),
    };
  };
  return {
    pane: r('[data-action-pane]'),
    tree: r('[data-files-tree]'),
    editorColumn: r('[data-files-editor-column]'),
    editor: r('[data-files-editor]'),
    overlay: r('[data-view-overlay]'),
  };
});
check(
  'the pane really is at its 320px floor — otherwise this section proves nothing',
  narrow.pane !== null && Math.abs(narrow.pane.width - 320) <= 2,
  `the pane is ${narrow.pane?.width}px wide`,
);
check(
  'both columns are still drawn at the floor — neither is swapped out',
  narrow.tree !== null && narrow.tree.width > 0 && narrow.editor !== null && narrow.editor.width > 0,
  JSON.stringify(narrow),
);
check(
  'the tree is still wide enough to read a name in',
  narrow.tree !== null && narrow.tree.width >= 118,
  `the tree is ${narrow.tree?.width}px wide`,
);
check(
  'and the editor keeps the larger half — the tree is capped, never the other way round',
  narrow.editorColumn !== null &&
    narrow.tree !== null &&
    narrow.editorColumn.width >= narrow.tree.width,
  `editor column ${narrow.editorColumn?.width}px vs tree ${narrow.tree?.width}px`,
);
check(
  'and the tree still clears the view pill at the narrowest pane there is',
  narrow.tree !== null && narrow.overlay !== null && narrow.tree.top >= narrow.overlay.bottom,
  `tree top ${narrow.tree?.top}, pill bottom ${narrow.overlay?.bottom}`,
);
await page.screenshot({ path: `${outDir}/files-tab-narrow.png` });
console.log(`${outDir}/files-tab-narrow.png`);
await page.setViewportSize({ width: 1100, height: 800 });
await page.waitForTimeout(200);

// Leave the buffer clean so nothing is pending when the browser closes.
await page.locator('[data-files-save]').click();
await page
  .waitForFunction(
    () => document.querySelector('[data-files-save]')?.getAttribute('data-files-save-state') === 'idle',
    null,
    { timeout: 5_000 },
  )
  .catch(() => {});

// ---------------------------------------------------------------------------
// 7. THE PICTURE THE README USES.
//
// Taken LAST, from the same stub every check above ran against, so the image
// in the prose is the layout the guards actually hold rather than a hand-posed
// one: `docs/images/files-tab.png` is this shot, copied in. A short, plainly
// fictional `.env` and one directory opened, because a 400-line generated
// buffer and a single collapsed row illustrate neither half of what this tab
// now is.
await editor.click();
await editor.fill('API_URL=http://localhost:8787\nLOG_LEVEL=debug\n');
await page.locator('[data-files-save]').click();
await page
  .waitForFunction(
    () => document.querySelector('[data-files-save]')?.getAttribute('data-files-save-state') === 'idle',
    null,
    { timeout: 5_000 },
  )
  .catch(() => {});
await treeRow('/work/demo/src').click();
await page.waitForFunction(
  () => document.querySelectorAll('[data-files-row]').length > 2,
  null,
  { timeout: 3_000 },
);
await treeRow('/work/demo/src/lib').click();
await page.waitForFunction(
  () => document.querySelectorAll('[data-files-row]').length > 4,
  null,
  { timeout: 3_000 },
);
check(
  'the README picture really shows a nested tree beside the editor',
  (await treePaths()).length === 5 && (await editor.inputValue()).startsWith('API_URL='),
  JSON.stringify(await treePaths()),
);
await page.screenshot({ path: `${outDir}/files-tab-readme.png` });
console.log(`${outDir}/files-tab-readme.png`);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nfiles-tab-keyboard: every check passed.');
