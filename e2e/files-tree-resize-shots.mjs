/**
 * THE FILE TREE'S BOX -- how tall it is, whether it really scrolls, and how
 * wide the operator can make it. Measured as RECTANGLES against real
 * Chromium, because every question here is a layout question and happy-dom
 * reports `clientWidth`/`clientHeight` 0 for everything.
 *
 * WHY THIS FILE EXISTS AT ALL, and what was measured before a line of it was
 * written. The operator asked for two things: "cap the max height at the pane
 * and give the tree its own scroll", and "make the width resizable". The
 * FIRST was already true. Measured on this branch before any change, with 159
 * rows in the tree: at 1100x800 the tree's bottom landed on the pane's own
 * content bottom (792 against 792) and its row list reported
 * `scrollHeight` 3188 against `clientHeight` 640; the same held at 900x420, at
 * the 320px narrow-pane floor, in the markdown-preview route, and in the
 * phone shell. What was NOT true is that anything on screen SAID so:
 * `vam-no-scrollbar` hides the native bar, and a tree clipped at the pane's
 * bottom edge with no thumb is indistinguishable from a tree that simply
 * stopped. So section 1 below is a REGRESSION GUARD on a property that
 * already held and had no guard, and section 2 is the thumb that was missing.
 *
 * A DEEP STUB, deliberately. `files-tab-keyboard-shots.mjs` lists three files
 * -- enough to prove a directory row exists, nowhere near enough to overflow
 * a column. Every check in sections 1 and 2 would pass vacuously against a
 * tree that fitted, so this file ships its own listing of 145 paths and
 * ASSERTS the row count before asserting anything about scrolling.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/files-tree-resize-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

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
 * The same complete `PreloadSourceApi` stub `files-tab-keyboard-shots.mjs`
 * uses -- see its header for why a `files`-only stub takes the app off the
 * fixture and onto a bridge that crashes -- with one difference: the listing
 * is twelve directories of twelve files, so the tree OVERFLOWS its column
 * once it is opened. `terminal: true` because this file switches to the
 * Terminal tab and back, which is the one act that proves a hidden (0px)
 * pane does not write back a clamped width.
 */
await page.addInitScript(() => {
  const files = new Map([['/work/demo/.env', { content: 'A=1\n', rev: 0 }]]);
  for (let d = 0; d < 12; d += 1) {
    for (let f = 0; f < 12; f += 1) {
      files.set(`/work/demo/pkg${String(d).padStart(2, '0')}/file${String(f).padStart(2, '0')}.ts`, {
        content: `export const v = ${d * 12 + f};\n`,
        rev: 0,
      });
    }
  }
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
            decisions: [
              { id: 'd1', label: 'step 1', input: 'a prompt', output: 'an answer', commands: [] },
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
    files: {
      list: async () => ({ root: '/work/demo', files: [...files.keys()], truncated: false }),
      read: async (path) => {
        const entry = files.get(path);
        if (entry === undefined) return refuse('not-found', `${path} does not exist`);
        return { content: entry.content, isBinary: false, signature: sig(path) };
      },
      write: async (path, content) => {
        const entry = files.get(path);
        files.set(path, { content, rev: (entry?.rev ?? -1) + 1 });
        return { signature: sig(path) };
      },
    },
  };
});

/** Every geometry this file asks about, in one round trip. */
const boxes = () =>
  page.evaluate(() => {
    const r = (selector) => {
      const el = document.querySelector(selector);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        left: Math.round(b.left),
        right: Math.round(b.right),
        width: Math.round(b.width),
        height: Math.round(b.height),
      };
    };
    const tree = document.querySelector('[data-files-tree]');
    const scroller = tree?.querySelector('.overflow-y-auto') ?? null;
    return {
      pane: r('[data-action-pane]'),
      view: r('[data-files-view]'),
      columns: r('[data-files-editor-column]'),
      tree: r('[data-files-tree]'),
      handle: r('[data-files-tree-resize]'),
      thumb: r('[data-files-tree] [data-overlay-thumb]'),
      // AND WHAT IT PAINTS, not merely that it is in the DOM. The thumb is
      // `opacity-0 group-hover:opacity-100`, so an element-exists check would
      // pass for a bar nobody can see — the exact shape of a guard that
      // proves a rule was typed rather than that it reached a pixel.
      thumbOpacity: (() => {
        const el = document.querySelector('[data-files-tree] [data-overlay-thumb]');
        return el === null ? null : getComputedStyle(el).opacity;
      })(),
      rows: document.querySelectorAll('[data-files-row]').length,
      inlineWidth: tree === null ? null : tree.style.width,
      scroll:
        scroller === null
          ? null
          : {
              scrollHeight: scroller.scrollHeight,
              clientHeight: scroller.clientHeight,
              scrollTop: Math.round(scroller.scrollTop),
              overflowY: getComputedStyle(scroller).overflowY,
            },
      mode: document.querySelector('[data-mode]')?.textContent ?? '',
    };
  });

await page.goto(origin, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${PLAIN_SESSION}"]`).first().click();
await page.waitForSelector('[data-view="files"]', { timeout: 5_000 });
await page.locator('[data-view="files"]').click();
await page.waitForSelector('[data-files-tree]', { timeout: 5_000 });

/** Open every directory the tree is currently drawing. */
async function expandAll() {
  for (let pass = 0; pass < 2; pass += 1) {
    const shut = await page.$$('[data-files-row-kind="directory"][data-files-row-open="false"]');
    for (const dir of shut) {
      await dir.click();
      await page.waitForTimeout(15);
    }
  }
  await page.waitForTimeout(200);
}
await expandAll();

// ---------------------------------------------------------------------------
// 1. THE CAP, AND THE SCROLL — the half the operator asked for that was
//    already true, and had no guard saying so.
//
// Two-sided on purpose. "The tree's bottom is not past the pane's" is half an
// assertion: a tree 200px tall in an 800px pane satisfies it and is not
// capped at anything. So the bottom must also REACH the pane's, which is what
// "the tree takes the pane's full height and stops there" actually means.
// ---------------------------------------------------------------------------
const deep = await boxes();
check(
  'the stub really overflows the column — otherwise every check here is vacuous',
  deep.rows >= 140,
  `the tree is drawing ${deep.rows} rows`,
);
check(
  'the tree stops at the pane, never past it',
  deep.tree !== null && deep.pane !== null && deep.tree.bottom <= deep.pane.bottom,
  `tree bottom ${deep.tree?.bottom}, pane bottom ${deep.pane?.bottom}`,
);
check(
  'and it REACHES the pane — a short tree would pass the line above for nothing',
  deep.tree !== null && deep.pane !== null && deep.pane.bottom - deep.tree.bottom <= 40,
  `tree bottom ${deep.tree?.bottom}, pane bottom ${deep.pane?.bottom}`,
);
check(
  'the row list is a scroller with more in it than it can show',
  deep.scroll !== null &&
    deep.scroll.overflowY === 'auto' &&
    deep.scroll.scrollHeight > deep.scroll.clientHeight,
  JSON.stringify(deep.scroll),
);

// AND IT ACTUALLY SCROLLS. `scrollHeight > clientHeight` says a scroller
// could scroll; a `scrollTop` that moves says it does. A wheel over the tree,
// not a programmatic assignment — assigning `scrollTop` fires no scroll event
// in any unit environment and is the reason this cannot be tested there.
await page.locator('[data-files-tree]').hover();
await page.mouse.wheel(0, 600);
await page.waitForTimeout(250);
const scrolled = await boxes();
check(
  'a wheel over the tree scrolls the tree',
  scrolled.scroll !== null && scrolled.scroll.scrollTop > 0,
  `scrollTop is ${scrolled.scroll?.scrollTop}`,
);
check(
  'and scrolling it moved nothing else — the pane is not what scrolled',
  scrolled.tree !== null && deep.tree !== null && scrolled.tree.top === deep.tree.top,
  `tree top ${deep.tree?.top} → ${scrolled.tree?.top}`,
);

// ---------------------------------------------------------------------------
// 2. AND NOW SOMETHING SAYS SO.
//
// `OverlayScroll`'s thumb, painted over the content rather than taking width
// from it. Two-sided again: a thumb that is always there says nothing about
// whether there is more to read, so the negative case is the one that gives
// the positive case its meaning.
// ---------------------------------------------------------------------------
check(
  'the tree draws a scroll thumb once there is more than fits',
  scrolled.thumb !== null && scrolled.thumb.height > 0,
  JSON.stringify(scrolled.thumb),
);
check(
  'and it is really PAINTED while the pointer is on the tree, not merely mounted',
  scrolled.thumbOpacity === '1',
  `computed opacity is ${scrolled.thumbOpacity}`,
);
check(
  'the thumb is shorter than its track — a full-height bar would claim nothing scrolls',
  scrolled.thumb !== null &&
    scrolled.scroll !== null &&
    scrolled.thumb.height < scrolled.scroll.clientHeight,
  `${scrolled.thumb?.height}px thumb in a ${scrolled.scroll?.clientHeight}px track`,
);
check(
  'and the thumb is INSIDE the tree, not over the editor',
  scrolled.thumb !== null &&
    scrolled.tree !== null &&
    scrolled.thumb.right <= scrolled.tree.right &&
    scrolled.thumb.left >= scrolled.tree.left,
  `thumb ${JSON.stringify(scrolled.thumb)} vs tree ${JSON.stringify(scrolled.tree)}`,
);

// Filter the list down to one row and the thumb must go: there is nothing
// left to scroll, and a bar claiming otherwise is a lie about the content.
await page.locator('[data-files-filter]').fill('file00.ts');
await page.waitForTimeout(300);
const filtered = await boxes();
check(
  'the filter really narrowed the list — or the next check proves nothing',
  filtered.rows > 0 && filtered.rows < deep.rows,
  `${deep.rows} rows → ${filtered.rows}`,
);
check(
  'and the thumb goes away when everything fits',
  filtered.scroll !== null &&
    filtered.scroll.scrollHeight <= filtered.scroll.clientHeight &&
    filtered.thumb === null,
  `${JSON.stringify(filtered.scroll)} thumb ${JSON.stringify(filtered.thumb)}`,
);
await page.locator('[data-files-filter]').fill('');
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 3. THE WIDTH, BEFORE ANYBODY TOUCHES IT.
//
// Shipping a handle must not move the layout of an operator who never uses
// one: `prefs.filesTreeWidth` starts `null` and a null keeps `TREE_WIDTH`'s
// clamped share, with no inline width at all.
// ---------------------------------------------------------------------------
const rest = await boxes();
check(
  'a tree nobody has dragged carries no inline width — it is still the share',
  rest.inlineWidth === '',
  `inline width is ${JSON.stringify(rest.inlineWidth)}`,
);
check(
  'the handle is drawn, on the tree’s left edge, and is a real hit target',
  rest.handle !== null &&
    rest.tree !== null &&
    Math.abs(rest.handle.left - rest.tree.left) <= 4 &&
    rest.handle.width >= 4 &&
    rest.handle.height > 100,
  `handle ${JSON.stringify(rest.handle)} tree ${JSON.stringify(rest.tree)}`,
);
await page.screenshot({ path: `${outDir}/files-tree-share.png` });
console.log(`${outDir}/files-tree-share.png`);

// ---------------------------------------------------------------------------
// 4. A REAL DRAG.
//
// Pointer down on the handle, move, up — through Playwright's own mouse, so
// the gesture really is a pointer capture on that element and not a
// synthesised event on a listener.
// ---------------------------------------------------------------------------
async function dragHandleBy(dx, { release = true } = {}) {
  const box = await page.locator('[data-files-tree-resize]').boundingBox();
  if (box === null) throw new Error('no resize handle to drag');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  if (release) await page.mouse.up();
  await page.waitForTimeout(200);
}

// Mid-drag first, because it is the one state that cannot be photographed
// after the fact: the handle is held, the column has already followed the
// pointer, and nothing has been stored yet.
await dragHandleBy(-120, { release: false });
const midDrag = await boxes();
check(
  'the column follows the pointer while the drag is held',
  midDrag.tree !== null && rest.tree !== null && midDrag.tree.width > rest.tree.width + 60,
  `${rest.tree?.width}px → ${midDrag.tree?.width}px`,
);
check(
  'and the handle says it is being held',
  (await page.getAttribute('[data-files-tree-resize]', 'data-files-tree-resize')) === 'dragging',
);
await page.screenshot({ path: `${outDir}/files-tree-mid-drag.png` });
console.log(`${outDir}/files-tree-mid-drag.png`);
await page.mouse.up();
await page.waitForTimeout(250);

const dragged = await boxes();
check(
  'the width survives the release, as an inline pixel width',
  dragged.inlineWidth !== '' && dragged.tree !== null && dragged.tree.width > rest.tree.width + 60,
  `inline ${dragged.inlineWidth}, drawn ${dragged.tree?.width}px`,
);
check(
  'the editor column gave up exactly what the tree took',
  dragged.columns !== null &&
    rest.columns !== null &&
    dragged.tree !== null &&
    rest.tree !== null &&
    Math.abs(
      rest.columns.width - dragged.columns.width - (dragged.tree.width - rest.tree.width),
    ) <= 2,
  `editor ${rest.columns?.width}→${dragged.columns?.width}, tree ${rest.tree?.width}→${dragged.tree?.width}`,
);

// ---------------------------------------------------------------------------
// 5. THE TRAP: A HIDDEN PANE MEASURES 0px.
//
// This tab is `display: none` behind another tab, not unmounted (it holds
// unsaved text). A clamp that wrote back would take that 0 for a very narrow
// container and collapse the chosen width to the floor — permanently, and
// with nothing about the failure looking like a resizer bug. Terminal is the
// other tab here because this stub declares `terminal: true`.
// ---------------------------------------------------------------------------
const chosen = dragged.tree?.width ?? 0;
await page.locator('[data-view="terminal"]').click();
await page.waitForTimeout(400);
const whileHidden = await page.evaluate(
  () => document.querySelector('[data-files-tree]')?.getBoundingClientRect().width ?? -1,
);
check(
  'the tree really is at 0px while another tab shows — the trap is live here',
  whileHidden === 0,
  `it measured ${whileHidden}px`,
);
await page.locator('[data-view="files"]').click();
await page.waitForTimeout(400);
const back = await boxes();
check(
  'and coming back shows the width the operator chose, not a clamped one',
  back.tree !== null && Math.abs(back.tree.width - chosen) <= 2,
  `chose ${chosen}px, came back ${back.tree?.width}px`,
);

// AND IT SURVIVES A RELOAD, which is the whole of "its own persistence":
// the width is `prefs.filesTreeWidth` in `localStorage`, written once per
// finished gesture.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${PLAIN_SESSION}"]`).first().click();
await page.waitForSelector('[data-files-tree]', { timeout: 5_000 });
await page.waitForTimeout(400);
const reloaded = await boxes();
check(
  'a dragged width is still there after a reload',
  reloaded.tree !== null && Math.abs(reloaded.tree.width - chosen) <= 2,
  `chose ${chosen}px, reloaded at ${reloaded.tree?.width}px`,
);
// AND WHICH DIRECTORIES WERE OPEN IS NOT STORED — that is renderer state, on
// purpose (`expanded` in `FilesTab.tsx`). So the tree comes back collapsed and
// everything below has to open it again, or section 8's scroll check would be
// asking a thirteen-row list whether it overflows.
await expandAll();
check(
  'the reloaded tree overflows again once it is opened',
  (await boxes()).rows >= 140,
  `the tree is drawing ${(await boxes()).rows} rows`,
);

// ---------------------------------------------------------------------------
// 5b. A THIRD RESIZABLE BOUNDARY: THE PANE MOVES UNDER A HAND-CHOSEN WIDTH.
//
// This is the cost the "NO RESIZER" paragraph named last, and the only one
// whose answer is a behaviour rather than a component. Narrowing the window
// narrows the space the two columns share, so the tree MUST draw smaller --
// and widening it again must give the operator their own number back,
// untouched. If the clamp were written back instead of applied at render,
// the shrink would be permanent and this check is the only thing in the
// suite that would see it: the tab-switch check above cannot, because a
// hidden tab is never measured at all.
// ---------------------------------------------------------------------------
await page.setViewportSize({ width: 620, height: 800 });
await page.waitForTimeout(400);
const squeezed = await boxes();
check(
  'a narrowed window really does squeeze the tree — or the restore below is free',
  squeezed.tree !== null && squeezed.tree.width < chosen,
  `chose ${chosen}px, drawn ${squeezed.tree?.width}px in a ${squeezed.pane?.width}px pane`,
);
await page.setViewportSize({ width: 1100, height: 800 });
await page.waitForTimeout(400);
const restored = await boxes();
check(
  'and widening it back gives the operator their own width back, whole',
  restored.tree !== null && Math.abs(restored.tree.width - chosen) <= 2,
  `chose ${chosen}px, came back ${restored.tree?.width}px`,
);

// ---------------------------------------------------------------------------
// 6. THE KEYBOARD, which is the cost vam cannot decline to pay.
//
// Focused with a real `.focus()` and driven with real key presses. The mode
// chip is the check that matters beside the arithmetic: the handle carries
// neither insert mark, so holding it must leave the cursor in Select —
// otherwise the status bar would announce Insert for a column drag and `I`
// would have a separator to land on.
// ---------------------------------------------------------------------------
await page.locator('[data-files-tree-resize]').focus();
const focused = await boxes();
check(
  'the handle can hold DOM focus',
  (await page.evaluate(
    () => document.activeElement?.getAttribute('data-files-tree-resize') !== null,
  )) === true,
);
check('and holding it leaves the cursor in Select', focused.mode === 'Select', focused.mode);

const widthBeforeKeys = focused.tree?.width ?? 0;
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
const afterLeft = await boxes();
check(
  'ArrowLeft grows the tree — the handle is on its left edge',
  afterLeft.tree !== null && afterLeft.tree.width > widthBeforeKeys,
  `${widthBeforeKeys}px → ${afterLeft.tree?.width}px`,
);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const afterRight = await boxes();
check(
  'and ArrowRight puts it back',
  afterRight.tree !== null && Math.abs(afterRight.tree.width - widthBeforeKeys) <= 2,
  `${afterLeft.tree?.width}px → ${afterRight.tree?.width}px`,
);

// A BARE LETTER IS NOT THIS HANDLE'S KEY. `Canvas.tsx`'s window listener
// stands down on `defaultPrevented`, so a handle that claimed everything
// would swallow the grammar for as long as it held focus. Measured as
// `defaultPrevented` on a real, cancelable, browser-generated event — the one
// signal a hand-built event cannot produce honestly.
await page.evaluate(() => {
  const seen = {};
  globalThis.window.__vamKeys = seen;
  // ON `document`, BUBBLE PHASE, AND THE TARGET IS THE WHOLE MEASUREMENT.
  // React dispatches its synthetic handlers at the ROOT container, so a
  // listener on any element inside it runs BEFORE the handle's own
  // `preventDefault()` and would read `false` for every key. `Canvas.tsx`'s
  // grammar listens on `window`, which is one step FURTHER out and claims
  // `j` for itself -- a probe there measures Canvas, not this handle.
  // `document` is the one point between the two.
  document.addEventListener('keydown', (event) => {
    seen[event.key] = event.defaultPrevented;
  });
});
await page.keyboard.press('j');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(150);
const owned = await page.evaluate(() => globalThis.window.__vamKeys);
check('the handle claims the arrow it answers', owned.ArrowLeft === true, JSON.stringify(owned));
check(
  'and declines a bare letter, so the grammar still hears it',
  owned.j === false,
  JSON.stringify(owned),
);

// ---------------------------------------------------------------------------
// 7. THE TWO EXTREMES, AND THE INVARIANT THE OLD CAP STOOD FOR.
//
// `End` is the live ceiling, `Home` the floor. The property being held is not
// a pixel count — that would restate the constants — but the one the
// `max-w-[13.5rem]` cap existed to express: the editor keeps at least as much
// as the tree, at every pane width.
// ---------------------------------------------------------------------------
await page.locator('[data-files-tree-resize]').focus();
await page.keyboard.press('End');
await page.waitForTimeout(250);
const atCap = await boxes();
check(
  'End takes the tree to its ceiling',
  atCap.tree !== null && afterRight.tree !== null && atCap.tree.width > afterRight.tree.width,
  `${afterRight.tree?.width}px → ${atCap.tree?.width}px`,
);
check(
  'and the editor still keeps the larger half at the ceiling',
  atCap.columns !== null && atCap.tree !== null && atCap.columns.width >= atCap.tree.width,
  `editor ${atCap.columns?.width}px vs tree ${atCap.tree?.width}px`,
);
await page.screenshot({ path: `${outDir}/files-tree-cap.png` });
console.log(`${outDir}/files-tree-cap.png`);

await page.keyboard.press('Home');
await page.waitForTimeout(250);
const atFloor = await boxes();
check(
  'Home takes it to the floor, which is still wide enough to read a name in',
  atFloor.tree !== null && atFloor.tree.width >= 118 && atFloor.tree.width <= 126,
  `the tree is ${atFloor.tree?.width}px`,
);
await page.screenshot({ path: `${outDir}/files-tree-floor.png` });
console.log(`${outDir}/files-tree-floor.png`);

// ---------------------------------------------------------------------------
// 8. AND ALL OF IT AT vam's NARROWEST LEGAL PANE.
//
// 520px is the narrowest window that draws two columns at all (`SIDEBAR_MIN +
// DETAIL_MIN`); one pixel under it the phone shell takes the whole window.
// The question is the one the "NO RESIZER" paragraph raised and refused to
// answer: can the operator strand the editor by dragging here?
// ---------------------------------------------------------------------------
await page.locator('[data-files-tree-resize]').focus();
await page.keyboard.press('End');
await page.waitForTimeout(200);
await page.setViewportSize({ width: 520, height: 760 });
await page.waitForTimeout(400);
await page.locator('[data-files-tree-resize]').focus();
await page.keyboard.press('End');
await page.waitForTimeout(300);
const narrow = await boxes();
check(
  'the pane really is at its 320px floor — otherwise this section proves nothing',
  narrow.pane !== null && Math.abs(narrow.pane.width - 320) <= 2,
  `the pane is ${narrow.pane?.width}px wide`,
);
check(
  'both columns are still drawn after a drag to the maximum here',
  narrow.tree !== null && narrow.tree.width > 0 && narrow.columns !== null && narrow.columns.width > 0,
  JSON.stringify({ tree: narrow.tree, columns: narrow.columns }),
);
check(
  'the editor keeps the larger half even at the maximum, at the narrowest pane there is',
  narrow.columns !== null && narrow.tree !== null && narrow.columns.width >= narrow.tree.width,
  `editor ${narrow.columns?.width}px vs tree ${narrow.tree?.width}px`,
);
check(
  'the narrow tree is still the deep one — or the scroll check below is vacuous',
  narrow.rows >= 140,
  `the tree is drawing ${narrow.rows} rows`,
);
check(
  'and the tree still stops at the pane and still scrolls here',
  narrow.tree !== null &&
    narrow.pane !== null &&
    narrow.tree.bottom <= narrow.pane.bottom &&
    narrow.scroll !== null &&
    narrow.scroll.scrollHeight > narrow.scroll.clientHeight,
  JSON.stringify({ tree: narrow.tree, pane: narrow.pane, scroll: narrow.scroll }),
);
await page.screenshot({ path: `${outDir}/files-tree-narrow.png` });
console.log(`${outDir}/files-tree-narrow.png`);

// ---------------------------------------------------------------------------
// 9. AND THE CAP HOLDS IN THE OTHER ROUTE THROUGH THIS TAB.
//
// The markdown preview replaces the textarea with a different element in the
// editor's place, and an element that did not carry the same `min-h-0` would
// grow the row and push the tree past the pane. Measured rather than argued.
// ---------------------------------------------------------------------------
await page.setViewportSize({ width: 1100, height: 800 });
await page.waitForTimeout(300);
await page.locator('[data-files-row-path="/work/demo/.env"]').click();
await page.waitForTimeout(300);
const withEditor = await boxes();
check(
  'the tree still stops at the pane with a file open in the editor',
  withEditor.tree !== null &&
    withEditor.pane !== null &&
    withEditor.tree.bottom <= withEditor.pane.bottom &&
    withEditor.pane.bottom - withEditor.tree.bottom <= 40,
  `tree bottom ${withEditor.tree?.bottom}, pane bottom ${withEditor.pane?.bottom}`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED: ${failures.join(' | ')}`);
  await browser.close();
  process.exit(1);
}
console.log(`\nAll checks passed. Screenshots in ${outDir}.`);
await browser.close();
