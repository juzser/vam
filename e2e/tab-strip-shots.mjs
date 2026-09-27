/**
 * The tab strip's paint: a close control that is either visible or
 * unreachable, an active tab that says so in more than one channel, and a `+`
 * that sits next to the last tab.
 *
 * Audit F4 (S2, accessibility): `data-tab-close` is `opacity-0 …
 * group-hover:opacity-100`. Tab reached it; focused, it measured `opacity: 0`,
 * `outline: none`, `boxShadow: none` — a focused control with no visible
 * indication anywhere on screen (WCAG 2.4.7). And `opacity: 0` removes no
 * pointer events, so every inactive tab carried a 15x17 invisible close
 * target for any pointer that cannot hover. This project had already
 * diagnosed and fixed that exact pattern on the sidebar row; the new strip
 * reintroduced it on the primary navigation surface.
 *
 * Plus three operator requests measured here because they are paint:
 *  - the focused tab wears a different opacity AND an accent border-bottom,
 *    with the inactive tabs' text held above 4.5:1 while dimmed;
 *  - the `+` sits next to the last tab rather than at the far right;
 *  - a resting tab draws NO status mark and a busy one draws the sidebar's own
 *    glyph (sections 8-10): the status dot every tab wore is gone, the row is
 *    still 36px, and an unsent draft puts a named pencil after the title;
 *  - every tab carries its PROVIDER glyph between that mark and the title,
 *    and no tab carries a session icon any more ("put the provider glyph
 *    after the indicator, on the tab name. Remove the session icon from the
 *    tab"). Both halves are measured, because a guard that only looked for
 *    the new glyph would stay green with the old one still beside it.
 *
 * WHY A REAL BROWSER: `opacity`, `pointer-events`, `:focus-visible` and a
 * computed contrast ratio are all resolved styles over Tailwind utilities
 * that only exist in a built stylesheet. A unit test can read the class
 * attribute back, which is how a rule that matched nothing once passed
 * review here.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/tab-strip-shots.mjs http://localhost:5521 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5521';
const outDir = process.argv[3] ?? 'docs/ui';

// PINNED TO `needs-you`, DELIBERATELY, ON EVERY PAGE THIS FILE OPENS. The
// demo fixture's sessions carry no `createdAt`, so `Created` (the shipped
// default since the sort-by-created feature) orders them alphabetically by
// id instead of `needs-you`'s order -- which this whole file was measured
// against, including which project is "on screen at first paint" with no
// explicit row click. Same seam `split-panes-shots.mjs` and
// `view-width-shots.mjs` pin it with.
function pinSortByNeedsYou(target) {
  return target.addInitScript(() => {
    globalThis.localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({
        viewOptions: { groupBy: 'project', sortBy: 'needs-you' },
        sortByMigrated: true,
      }),
    );
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await pinSortByNeedsYou(page);
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.locator('[data-session-row="crosscheck-2"]').click();
await page.keyboard.press('Escape');
// AND `Control+[`, WHICH IS THE WAY OUT OF THE COMPOSER NOW. Escape typed in
// the prompt box is the agent's interrupt since the composer-escape change, so
// it no longer releases the keyboard. Escape stays first, because it is still
// what closes an overlay; `Mod-[` folds Ctrl and Cmd, and is a no-op anywhere
// but in that box.
await page.keyboard.press('Control+[');
await page.waitForTimeout(250);
const tabCount = await page.locator('[data-session-tab]').count();
console.log(`tabs open: ${tabCount}`);
if (tabCount < 2) throw new Error('need at least two tabs to compare an active one against');

// --- 1. THE CLOSE CONTROL: invisible and unhittable, or visible.
const hidden = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[data-session-tab]')].find(
    (el) => el.getAttribute('data-active') === 'false',
  );
  const close = tab.querySelector('[data-tab-close]');
  const cs = getComputedStyle(close);
  const r = close.getBoundingClientRect();
  return {
    opacity: Number.parseFloat(cs.opacity),
    pointerEvents: cs.pointerEvents,
    hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName ?? null,
    isTheButton:
      document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === close,
  };
});
console.log('inactive tab close control at rest:', JSON.stringify(hidden));
if (hidden.opacity > 0.01 && hidden.pointerEvents === 'none') {
  throw new Error('the close control is visible but inert, which is the opposite mistake');
}
if (hidden.opacity <= 0.01 && hidden.isTheButton) {
  throw new Error(
    'an invisible close control is still the top element at its own centre — a pointer ' +
      'that cannot hover (touch, pen) closes a session by aiming at a tab.',
  );
}

// --- 2. FOCUS MUST SHOW. Tab to it and measure what a sighted keyboard user
//        has to go on: WCAG 2.4.7 is satisfied by SOMETHING, not by nothing.
const focused = await page.evaluate(() => {
  const close = document.querySelector('[data-session-tab] [data-tab-close]');
  close.focus();
  const cs = getComputedStyle(close);
  return {
    isActiveElement: document.activeElement === close,
    opacity: Number.parseFloat(cs.opacity),
    outline: cs.outlineStyle === 'none' ? null : `${cs.outlineStyle} ${cs.outlineWidth}`,
    boxShadow: cs.boxShadow === 'none' ? null : cs.boxShadow,
  };
});
console.log('close control while focused:', JSON.stringify(focused));
if (!focused.isActiveElement) throw new Error('the close control cannot take focus at all');
/**
 * OPACITY FIRST, and the falsification is why. Written as "no opacity AND no
 * outline AND no shadow", this check survived deleting the focus reveal:
 * Chromium still reports the UA's `outline: auto 1px` on the button, so the
 * guard read an outline and passed. But `opacity` applies to the element AND
 * everything it paints, outline and ring included — an outline at opacity 0
 * is an outline nobody can see, which is the whole of audit F4. So opacity is
 * the first condition, not one of three alternatives.
 */
if (focused.opacity < 0.99) {
  throw new Error(
    `a focused control at opacity ${focused.opacity}: whatever ring or outline it claims ` +
      `(${focused.outline ?? 'none'} / ${focused.boxShadow ?? 'none'}) is painted at that ` +
      `opacity too, so nothing is on screen (WCAG 2.4.7).`,
  );
}
if (focused.outline === null && focused.boxShadow === null) {
  throw new Error('a focused control with neither an outline nor a ring (WCAG 2.4.7)');
}

// --- 2b. THE SIDEBAR ROW'S OWN `×`, which is where this project first
//         diagnosed the pattern and where it was still live. Same mechanism,
//         same fix, so the same measurement.
const row = await page.evaluate(() => {
  // The row's `×` is a SIBLING of `[data-session-row]`, not a child (it is
  // positioned against the row's group wrapper), so it is found by its label
  // and told apart from the tab's own `×` by that label's suffix.
  const el = [...document.querySelectorAll("button[aria-label^='close ']")].find(
    (b) => !(b.getAttribute('aria-label') ?? '').endsWith(' tab'),
  );
  if (el === undefined) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    opacity: Number.parseFloat(cs.opacity),
    pointerEvents: cs.pointerEvents,
    isTheButton: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el,
  };
});
console.log('sidebar row close control at rest:', JSON.stringify(row));
if (row === null) throw new Error('no sidebar row close control to measure');
if (row.opacity <= 0.01 && row.isTheButton) {
  throw new Error('the sidebar row keeps an invisible close target under the pointer');
}

// --- 3. THE ACTIVE TAB SAYS SO IN MORE THAN ONE CHANNEL, and the dimmed
//        neighbours stay legible.
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const marks = await page.evaluate(() => {
  const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const read = (el) => {
    const cs = getComputedStyle(el);
    const title = el.querySelector('[data-tab-select]');
    return {
      active: el.getAttribute('data-active') === 'true',
      opacity: Number.parseFloat(cs.opacity),
      borderBottom: `${cs.borderBottomStyle} ${cs.borderBottomWidth} ${cs.borderBottomColor}`,
      borderColour: parse(cs.borderBottomColor),
      alpha: Number.parseFloat((cs.borderBottomColor.match(/[\d.]+\)$/) ?? ['1'])[0]) || 1,
      background: cs.backgroundColor,
      ink: parse(getComputedStyle(title).color),
      ground: parse(getComputedStyle(el.closest('[data-tab-strip-row]')).backgroundColor.includes('rgba(0, 0, 0, 0)') ? getComputedStyle(document.body).backgroundColor : getComputedStyle(el.closest('[data-tab-strip-row]')).backgroundColor),
    };
  };
  return [...document.querySelectorAll('[data-session-tab]')].map(read);
});
const active = marks.find((m) => m.active);
const idle = marks.find((m) => !m.active);
console.log('active tab:', JSON.stringify(active));
console.log('an inactive tab:', JSON.stringify(idle));
if (active === undefined || idle === undefined) throw new Error('no active/inactive pair to compare');
if (active.opacity <= idle.opacity) {
  throw new Error(
    `the focused tab is not a different opacity from the others (${active.opacity} vs ${idle.opacity})`,
  );
}
if (!active.borderBottom.startsWith('solid') || Number.parseFloat(active.borderBottom.split(' ')[1]) < 1) {
  throw new Error(`the active tab has no border-bottom: ${active.borderBottom}`);
}
if (active.borderBottom === idle.borderBottom) {
  throw new Error('the active tab and its neighbours draw the same bottom border');
}
// The dimmed title has to survive its dimming. Composited over the strip's
// own ground, because that is what a reader actually sees.
const blended = idle.ink.map((c, i) => c * idle.opacity + idle.ground[i] * (1 - idle.opacity));
const ratio =
  (Math.max(luminance(blended), luminance(idle.ground)) + 0.05) /
  (Math.min(luminance(blended), luminance(idle.ground)) + 0.05);
console.log(`dimmed tab title contrast: ${ratio.toFixed(2)}:1`);
if (ratio < 4.5) {
  throw new Error(`dimming pushed an inactive tab's title to ${ratio.toFixed(2)}:1, under 4.5:1`);
}

// --- 4. THE `+` SITS NEXT TO THE LAST TAB.
const gap = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[data-session-tab]')];
  const last = tabs[tabs.length - 1].getBoundingClientRect();
  const plus = document.querySelector('[data-tab-new]').getBoundingClientRect();
  const row = document.querySelector('[data-tab-strip-row]').getBoundingClientRect();
  return { after: plus.x - last.right, fromRowEnd: row.right - plus.right };
});
console.log(`the + sits ${Math.round(gap.after)}px after the last tab, ${Math.round(gap.fromRowEnd)}px from the row's end`);
if (gap.after < 0 || gap.after > 24) {
  throw new Error(`the + is ${Math.round(gap.after)}px from the last tab, not beside it`);
}

// --- 5. TWO PANES, TWO ACTIVE TABS, ONE KEYBOARD. Since PR 268 took the ring
//        off the pane, nothing said which pane the next keystroke goes to.
//        The active tab of an UNFOCUSED pane must not wear the mark of the
//        one that has it.
await page.screenshot({ path: `${outDir}/tab-strip-marks.png` });
console.log(`${outDir}/tab-strip-marks.png`);

await page.keyboard.press('z');
await page.keyboard.press('v');
await page.waitForTimeout(300);
const panes = await page.locator('[data-split-pane]').count();
if (panes !== 2) throw new Error(`expected a split of 2 panes, drew ${panes}`);
const accents = await page.evaluate(() =>
  [...document.querySelectorAll('[data-split-pane]')].map((pane) => {
    const tab = pane.querySelector('[data-session-tab][data-active="true"]');
    return {
      focused: pane.getAttribute('data-split-focused') === 'true',
      accent: tab === null ? null : getComputedStyle(tab).borderBottomColor,
    };
  }),
);
console.log('active-tab accents by pane:', JSON.stringify(accents));
const withTabs = accents.filter((a) => a.accent !== null);
if (withTabs.length === 2) {
  const focusedAccent = withTabs.find((a) => a.focused)?.accent;
  const otherAccent = withTabs.find((a) => !a.focused)?.accent;
  if (focusedAccent === otherAccent) {
    throw new Error(
      `both panes' active tabs draw the same accent (${focusedAccent}) — nothing says which ` +
        `pane the keyboard is in.`,
    );
  }
}

await page.screenshot({ path: `${outDir}/tab-strip-two-panes.png` });
console.log(`${outDir}/tab-strip-two-panes.png`);
console.log(`${outDir}/tab-strip-marks.png`);

/**
 * --- 6-8. THE OVERFLOWING STRIP, on a page of its own.
 *
 * HOW OVERFLOW IS PRODUCED: a narrow window, not a fixture. The demo's
 * `factory` project, the one on screen at first paint, has three sessions --
 * ~433px of tabs now that two of them wear a 12px mark; at a 620px viewport
 * the pane's strip is ~310px wide, so the last tab is off its end. 620 is
 * deliberately above `PHONE_MAX_WIDTH` (519) — under it this would be
 * measuring the phone shell, which draws no strip. And every check below is
 * preceded by `scrollWidth > clientWidth`: a strip that fits sits at 0 and
 * passes every position assertion trivially.
 */
const narrow = await browser.newPage({ viewport: { width: 620, height: 620 } });
narrow.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await pinSortByNeedsYou(narrow);
await narrow.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await narrow.waitForSelector('[data-session-tab]');
await narrow.waitForTimeout(250);

const slack = await narrow.evaluate(() => {
  const s = document.querySelector('[data-tab-strip]');
  return { scrollWidth: s.scrollWidth, clientWidth: s.clientWidth, tabs: s.querySelectorAll('[data-session-tab]').length };
});
console.log(`narrow strip: ${slack.tabs} tabs, ${slack.scrollWidth}px of them in ${slack.clientWidth}px`);
if (slack.scrollWidth <= slack.clientWidth + 1) {
  throw new Error(
    `the strip did not overflow at this viewport (${slack.scrollWidth} <= ${slack.clientWidth}); ` +
      `every check below would pass on a strip that never had to scroll.`,
  );
}

/** Where the active tab sits relative to the box that is supposed to show it. */
const readActive = () =>
  narrow.evaluate(() => {
    const s = document.querySelector('[data-tab-strip]');
    const tab = s.querySelector('[data-session-tab][data-active="true"]');
    if (tab === null) return null;
    const sr = s.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    return {
      title: tab.querySelector('[data-tab-select]').textContent,
      scrollLeft: s.scrollLeft,
      leftOfView: sr.left - tr.left,
      rightOfView: tr.right - sr.right,
    };
  });

// --- 6. WALK TO THE LAST TAB: `l` is next-tab, two presses from the first of
//        three lands furthest into the overflow.
await narrow.keyboard.press('l');
await narrow.keyboard.press('l');
await narrow.waitForTimeout(250);
const onLast = await readActive();
console.log('active tab after two l:', JSON.stringify(onLast));
if (onLast === null) throw new Error('no active tab in the narrow strip');
if (onLast.scrollLeft <= 0) {
  throw new Error(
    `the strip never scrolled (scrollLeft ${onLast.scrollLeft}) while the active tab moved ` +
      `into the overflow — the operator's only cue for which session is on screen is off it.`,
  );
}
// One pixel of tolerance for sub-pixel layout and no more.
if (onLast.leftOfView > 1 || onLast.rightOfView > 1) {
  throw new Error(
    `the active tab is outside the strip's own box (${Math.round(onLast.leftOfView)}px past its ` +
      `left, ${Math.round(onLast.rightOfView)}px past its right)`,
  );
}
await narrow.screenshot({ path: `${outDir}/tab-strip-overflow.png` });
console.log(`${outDir}/tab-strip-overflow.png`);

// --- 6b. A HELD POINTER PINS THE STRIP: scrolling out from under a
//         stationary pointer moves the target of the click being made.
await narrow.keyboard.press('h');
await narrow.keyboard.press('h');
await narrow.waitForTimeout(200);
const atStart = await readActive();
if (atStart.scrollLeft !== 0) throw new Error(`expected the strip back at 0, got ${atStart.scrollLeft}`);
const stripBox = await narrow.locator('[data-tab-strip]').boundingBox();
await narrow.mouse.move(stripBox.x + 12, stripBox.y + stripBox.height / 2);
await narrow.mouse.down();
await narrow.keyboard.press('l');
await narrow.keyboard.press('l');
await narrow.waitForTimeout(200);
const held = await readActive();
console.log('active tab while a pointer is held:', JSON.stringify(held));
if (held.scrollLeft !== 0) {
  throw new Error(
    `the strip moved ${held.scrollLeft}px under a pointer that was still down — the click in ` +
      `progress would land on a different tab than the one aimed at.`,
  );
}
await narrow.mouse.up();
await narrow.waitForTimeout(200);

// --- 7. A VERTICAL WHEEL SCROLLS A HORIZONTAL-ONLY STRIP. Without it an
//        ordinary mouse cannot reach an overflowed tab at all: the strip
//        draws no scrollbar to drag. Put back to its start by hand, not by
//        another key walk — the wheel is what is under test, and a start
//        position inherited from the section above is not a known one.
await narrow.evaluate(() => {
  document.querySelector('[data-tab-strip]').scrollLeft = 0;
});
const beforeWheel = await narrow.evaluate(() => document.querySelector('[data-tab-strip]').scrollLeft);
if (beforeWheel !== 0) throw new Error(`could not put the strip back at 0 (${beforeWheel})`);
await narrow.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
await narrow.mouse.wheel(0, 200);
await narrow.waitForTimeout(250);
const afterWheel = await narrow.evaluate(() => document.querySelector('[data-tab-strip]').scrollLeft);
console.log(`wheel over the strip: scrollLeft ${beforeWheel} -> ${afterWheel}`);
if (afterWheel <= beforeWheel) {
  throw new Error(
    `a vertical wheel over the strip moved it from ${beforeWheel} to ${afterWheel}: a ` +
      `horizontal-only scroller that ignores deltaY cannot be scrolled by a normal mouse.`,
  );
}

/**
 * --- 8. A BUSY TAB DRAWS ITS MARK, A RESTING TAB DRAWS NONE, and the row
 *        does not move.
 *
 * The operator: "if a tab is idle (not running, not waiting for you, ...)
 * there is no need to show the dot on the tab. A tab should only show
 * certain indicators." The 6px status dot every tab wore is gone. What is
 * measured now is the paint of what replaced it (`TAB_MARK_LANE_PX` in
 * `Canvas.tsx`, `prefs/tab-indicators.ts`):
 *  - a running tab draws the sidebar's spinner and a waiting tab its bell,
 *    each at least the 12px lane, painted on top at its own centre, with the
 *    glyph's ink above 3:1 against the strip once the tab is dimmed;
 *  - a done tab draws NO status mark, because `done` ships off;
 *  - the strip's row is the 36px it was before the dot went (measured on
 *    main before this change: `[data-tab-strip-row]` 36, every tab 35), so
 *    swapping a 6px dot for a 12px lane moved nothing vertically.
 * The idle half of the rule is section 9, on the strip that has an idle tab.
 */
// BACK TO THE FIRST TAB BY THE SIDEBAR — the other route that changes which
// tab is active, and the one that carries no key repeat to lean on. It puts
// the strip in a known place (its start) for the measurement and the shot.
// The last session FIRST, so the click that follows is guaranteed to change
// which tab is active whatever the sections above left behind: an assertion
// about a strip following a click that selected the tab already active is an
// assertion about nothing.
await narrow.locator('[data-session-row="dogfood-4"]').click();
await narrow.waitForTimeout(250);
const toLastBySidebar = await readActive();
console.log('active tab after a sidebar click on the last session:', JSON.stringify(toLastBySidebar));
if (toLastBySidebar.scrollLeft <= 0 || toLastBySidebar.rightOfView > 1) {
  throw new Error(
    `a sidebar click landed on a tab in the overflow and the strip stayed put (scrollLeft ` +
      `${toLastBySidebar.scrollLeft}, ${Math.round(toLastBySidebar.rightOfView)}px past its right edge)`,
  );
}
await narrow.locator('[data-session-row="factory-sse-1"]').click();
await narrow.waitForTimeout(250);
const bySidebar = await readActive();
console.log('active tab after a sidebar click back to the first:', JSON.stringify(bySidebar));
if (!bySidebar.title.includes('factory-sse-1')) {
  throw new Error(`a sidebar click did not make its session the active tab (${bySidebar.title})`);
}
if (bySidebar.scrollLeft !== 0 || bySidebar.leftOfView > 1 || bySidebar.rightOfView > 1) {
  throw new Error(
    `the strip did not follow a sidebar click back to the first tab (scrollLeft ` +
      `${bySidebar.scrollLeft}, ${Math.round(bySidebar.leftOfView)}px past its left edge)`,
  );
}

// Off the strip: a hovered tab is at full opacity, and the DIMMED one is the
// point of the measurement.
await narrow.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + 300);
await narrow.waitForTimeout(150);
/**
 * Every tab as the browser paints it, for whichever project is active: its
 * status (off the tab itself now, not off a dot), its box, every
 * `data-tab-mark` it draws with the glyph's painted ink, and the PROVIDER
 * glyph that now stands between the mark and the title.
 *
 * The provider is read separately from `marks` rather than folded into them
 * because it is not an indicator and must not be counted as one: the status
 * checks below ask "exactly one status mark" and "the idle tab draws none",
 * and a provider wearing a `data-tab-mark` would have quietly joined those
 * sums. Same fields, so `checkStatusMark`'s measurements can be reused on it.
 */
const readTabs = () =>
  narrow.evaluate(() => {
    const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const STATUS_MARKS = ['running', 'waiting', 'failed', 'done'];
    return [...document.querySelectorAll('[data-session-tab]')].map((tab) => {
      const r = tab.getBoundingClientRect();
      const sr = tab.closest('[data-tab-strip]').getBoundingClientRect();
      const row = tab.closest('[data-tab-strip-row]');
      const rowGround = getComputedStyle(row).backgroundColor;
      const ground = parse(
        rowGround.startsWith('rgba(0, 0, 0, 0') ? getComputedStyle(document.body).backgroundColor : rowGround,
      );
      const select = tab.querySelector('[data-tab-select]');
      const title = select.getBoundingClientRect();
      const read = (mark, id) => {
        const b = mark.getBoundingClientRect();
        // The glyph whose ink is painted: for the spinner that is the
        // turning body, not the ring `prefers-reduced-motion` would swap in.
        const svg = mark.querySelector('svg:not([data-mark-motion="rest"])');
        const rest = mark.querySelector('[data-mark-motion="rest"]');
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return {
          id,
          status: STATUS_MARKS.includes(id),
          glyph: svg === null ? null : [...svg.classList].find((c) => /^lucide-./.test(c)) ?? null,
          restHidden: rest === null ? null : getComputedStyle(rest).display === 'none',
          width: b.width,
          height: b.height,
          ink: svg === null ? null : parse(getComputedStyle(svg).color),
          // Where it sits against the title, in px: negative is before it.
          fromTitle: b.left - title.right,
          visible: b.left >= sr.left - 0.5 && b.right <= sr.right + 0.5,
          onTop: hit !== null && mark.contains(hit),
          ariaHidden: mark.getAttribute('aria-hidden'),
          name: mark.getAttribute('aria-label'),
        };
      };
      const marks = [...tab.querySelectorAll('[data-tab-mark]')].map((mark) =>
        read(mark, mark.getAttribute('data-tab-mark')),
      );
      const providerEl = tab.querySelector('[data-tab-source]');
      const provider =
        providerEl === null
          ? null
          : {
              ...read(providerEl, providerEl.getAttribute('data-tab-source')),
              register: providerEl.getAttribute('data-source-mark'),
              // Inside the select button the glyph would go into a long
              // title's ellipsis; a sibling cannot.
              insideTitle: select.contains(providerEl),
            };
      return {
        title: tab.querySelector('[data-tab-select]').textContent.trim(),
        active: tab.getAttribute('data-active') === 'true',
        status: tab.getAttribute('data-tab-status'),
        opacity: Number.parseFloat(getComputedStyle(tab).opacity),
        ground,
        width: r.width,
        height: r.height,
        rowHeight: row.getBoundingClientRect().height,
        // The title's own line box, which every mark has to fit inside: a
        // mark taller than the line is a mark that moves the row.
        lineHeight: Number.parseFloat(getComputedStyle(select).lineHeight),
        // How far the title starts from the tab's left edge: the padding
        // plus whatever is drawn before it. A reserved empty lane would show
        // up here as an idle tab with the same offset as a marked one.
        titleOffset: title.left - r.left,
        // What the tab OPENS with. A resting tab may open with its provider
        // glyph -- a constant of the tab, which the operator asked to be
        // there -- and with nothing else: a status dot put back, or a lane
        // reserved for a mark it is not wearing, is the clutter they asked to
        // be rid of, and both would show up here.
        opensWith:
          tab.firstElementChild === select
            ? 'title'
            : tab.firstElementChild?.hasAttribute('data-tab-source') === true
              ? 'provider'
              : (tab.firstElementChild?.getAttribute('data-tab-mark') ?? 'something else'),
        marks,
        provider,
      };
    });
  });

/** The 36px row measured on main before the dot went, and the lane the
 *  mark is drawn in -- the one constant this guard copies from the source. */
const ROW_HEIGHT_PX = 36;
const LANE_PX = 12;

/** 3:1 is WCAG 1.4.11: the mark is a graphical object carrying information,
 *  not text. Composited over the strip's ground at the tab's own opacity --
 *  the pixel a reader actually gets. */
function markContrast(mark, tab) {
  const blended = mark.ink.map((c, i) => c * tab.opacity + tab.ground[i] * (1 - tab.opacity));
  return (
    (Math.max(luminance(blended), luminance(tab.ground)) + 0.05) /
    (Math.min(luminance(blended), luminance(tab.ground)) + 0.05)
  );
}

/** Every check a drawn status mark owes, whichever strip it is on. */
function checkStatusMark(tab, expectGlyph) {
  const statusMarks = tab.marks.filter((m) => m.status);
  if (statusMarks.length !== 1 || statusMarks[0].id !== tab.status) {
    throw new Error(
      `the ${tab.status} tab "${tab.title}" draws ${JSON.stringify(statusMarks.map((m) => m.id))} ` +
        `for its status, not exactly one ${tab.status} mark`,
    );
  }
  const mark = statusMarks[0];
  if (mark.glyph !== expectGlyph) {
    throw new Error(`the ${tab.status} mark draws ${mark.glyph}, not the sidebar's ${expectGlyph}`);
  }
  if (mark.width < LANE_PX - 0.5 || mark.height < LANE_PX - 0.5) {
    throw new Error(`a ${mark.width}x${mark.height} ${tab.status} mark is under its ${LANE_PX}px lane`);
  }
  if (mark.height > tab.lineHeight + 0.5) {
    throw new Error(
      `a ${mark.height}px ${tab.status} mark is taller than the title's ${tab.lineHeight}px line — ` +
        'it is not sized for the tab, and it is what would move the row',
    );
  }
  if (mark.fromTitle >= 0) {
    throw new Error(`the ${tab.status} mark sits after the title (${mark.fromTitle}px), not before it`);
  }
  if (mark.ariaHidden !== 'true') {
    throw new Error(`the ${tab.status} mark is not aria-hidden: one per tab would read every status first`);
  }
  if (mark.visible && !mark.onTop) {
    throw new Error(`the ${tab.status} mark is not the element painted at its own centre`);
  }
  if (mark.ink === null) throw new Error(`the ${tab.status} mark has no painted glyph to measure`);
  const ratio = markContrast(mark, tab);
  console.log(
    `${tab.active ? 'active' : 'dimmed'} ${tab.status} mark: ${mark.glyph}, ${mark.width}x${mark.height}, ` +
      `contrast ${ratio.toFixed(2)}:1 at opacity ${tab.opacity}`,
  );
  if (ratio < 3) {
    throw new Error(
      `the ${tab.status} mark lands at ${ratio.toFixed(2)}:1 against the strip once dimmed, ` +
        `under the 3:1 floor for a non-text indicator`,
    );
  }
}

/**
 * WHICH AGENT RAN THIS TAB, measured where the session icon used to be.
 *
 * The operator asked for two things in one sentence -- "put the provider
 * glyph after the indicator, on the tab name. Remove the session icon from
 * the tab" -- and both halves are here, because a guard that only found the
 * new glyph would stay green with the old one still drawn beside it.
 *
 * "AFTER THE INDICATOR" AND "ON THE TAB NAME" ARE RECTANGLES. DOM order is a
 * proxy -- `order-last` moves a flex item and leaves the markup alone, which
 * is how the sidebar's own unit test was falsified once -- so the glyph's box
 * is compared with the status mark's and the title's. And it must be OUTSIDE
 * the title button: inside, a long title's `truncate` takes it into the
 * ellipsis, on exactly the tabs whose names are hardest to tell apart.
 */
function checkProvider(tab) {
  if (tab.provider === null) {
    throw new Error(
      `the ${tab.status} tab "${tab.title}" draws no provider glyph, on a fixture whose every ` +
        'project names a source',
    );
  }
  const mark = tab.provider;
  if (mark.insideTitle) {
    throw new Error('the provider glyph is inside the title button, where a long title clips it');
  }
  if (mark.fromTitle >= 0) {
    throw new Error(`the provider glyph sits after the title (${mark.fromTitle}px), not before it`);
  }
  const status = tab.marks.find((m) => m.status);
  if (status !== undefined && mark.fromTitle <= status.fromTitle) {
    throw new Error(
      'the provider glyph is drawn before the status mark, not after it: the operator asked for ' +
        `it "after the indicator" (provider ${mark.fromTitle}px from the title, status ${status.fromTitle})`,
    );
  }
  // THE LANE LESS ONE, for a brand mark, and that is `SourceMark`'s own
  // deliberate pixel: a Simple Icons path fills its 24-unit viewBox edge to
  // edge while a lucide glyph keeps about two units of margin inside its own,
  // so handed the same number the brand mark is the visibly heavier of the
  // two. Measured on this strip: 12x12 for `factory`'s lucide glyph, 11x11
  // for `claude-code`'s brand path. A floor of `LANE_PX` exactly would have
  // failed the register the operator actually uses most.
  if (mark.width < LANE_PX - 1.5 || mark.height > tab.lineHeight + 0.5) {
    throw new Error(
      `a ${mark.width}x${mark.height} provider glyph against a ${LANE_PX}px lane on a ` +
        `${tab.lineHeight}px line -- it is not sized for the tab`,
    );
  }
  if (mark.ariaHidden !== 'true' || mark.name !== null) {
    throw new Error(
      'the provider glyph is announced: one per tab reads the source aloud before every title',
    );
  }
  if (!['brand', 'native', 'neutral'].includes(mark.register)) {
    throw new Error(`the provider glyph records no register (data-source-mark=${mark.register})`);
  }
  if (mark.ink === null) throw new Error('the provider glyph has no painted svg to measure');
  const ratio = markContrast(mark, tab);
  console.log(
    `${tab.active ? 'active' : 'dimmed'} provider: ${mark.id} (${mark.register}), ` +
      `${mark.width}x${mark.height}, contrast ${ratio.toFixed(2)}:1 at opacity ${tab.opacity}`,
  );
  if (ratio < 3) {
    throw new Error(
      `the provider glyph lands at ${ratio.toFixed(2)}:1 against the strip once dimmed, under the ` +
        '3:1 floor for a non-text indicator',
    );
  }
}

/** AND THE SESSION ICON IS GONE, from every tab of every project on screen.
 *
 *  THE CORPUS IS THE TABS, not the icons, and that changed with the feature.
 *  The fixture used to seed emoji on five of its sessions, so a zero here was
 *  a zero against five real candidates; a session has no icon to seed now, so
 *  the only thing that makes this sweep non-vacuous is that there are tabs on
 *  screen to have drawn one. Counted rather than assumed -- a strip that
 *  failed to render would otherwise report "no session icons" and be right. */
async function checkNoSessionIcon(on) {
  const seen = await on.evaluate(() => ({
    drawn: document.querySelectorAll('[data-session-icon]').length,
    tabs: document.querySelectorAll('[data-session-tab]').length,
  }));
  if (seen.tabs === 0) {
    throw new Error('no tabs on screen, so the session-icon sweep below measured nothing');
  }
  if (seen.drawn > 0) {
    throw new Error(`${seen.drawn} of ${seen.tabs} tab(s) draw a session icon the operator removed`);
  }
}

const busy = await readTabs();
console.log('the factory strip:', JSON.stringify(busy.map((t) => ({ title: t.title, status: t.status, active: t.active, marks: t.marks.map((m) => m.id), provider: t.provider?.id ?? null }))));
if (busy.length < 2) throw new Error('need more than one tab to prove the inactive ones are marked');
if (busy.some((t) => t.status === null)) {
  throw new Error('a tab reports no status — `data-tab-status` has to live on the tab now that idle draws nothing');
}
if (!busy.some((t) => !t.active && t.opacity < 1)) {
  throw new Error(
    'every inactive tab measured at full opacity, so the contrast below was never checked ' +
      'against the dimming it exists to survive',
  );
}
const waitingTab = busy.find((t) => t.status === 'waiting');
const runningTab = busy.find((t) => t.status === 'running');
const doneTab = busy.find((t) => t.status === 'done');
if (waitingTab === undefined || runningTab === undefined || doneTab === undefined) {
  throw new Error(`this strip must hold a waiting, a running and a done tab; it holds ${busy.map((t) => t.status).join(', ')}`);
}
checkStatusMark(waitingTab, 'lucide-bell');
checkStatusMark(runningTab, 'lucide-loader-circle');
const spinner = runningTab.marks.find((m) => m.id === 'running');
if (spinner.restHidden !== true) {
  throw new Error('the spinner draws its reduced-motion ring alongside the turning arc — both bodies are on screen');
}
if (doneTab.marks.some((m) => m.status)) {
  throw new Error(
    `the done tab draws ${JSON.stringify(doneTab.marks.map((m) => m.id))}: \`done\` ships off, and a tick ` +
      'on every finished session is the grey dot again in a different shape',
  );
}
for (const tab of busy) {
  if (tab.rowHeight !== ROW_HEIGHT_PX) {
    throw new Error(`the strip's row is ${tab.rowHeight}px, not the ${ROW_HEIGHT_PX} it was before the dot went`);
  }
  checkProvider(tab);
}
await checkNoSessionIcon(narrow);
console.log(`the strip's row is ${busy[0].rowHeight}px; tabs are ${[...new Set(busy.map((t) => t.height))].join('/')}px`);
await narrow.screenshot({ path: `${outDir}/tab-strip-status-marks.png` });
console.log(`${outDir}/tab-strip-status-marks.png`);

/**
 * --- 9. IDLE IS NOT WAITING, and idle is not ANYTHING: the resting tab.
 *
 * The source once read every interactive row the CLI did not call `busy` as
 * `waiting`, so the CLI's `idle` -- three of five rows on a real machine --
 * wore the amber that means "the ball is with you". That is still the thing
 * this section refuses. Now that a resting tab draws no mark at all, the
 * refusal is stronger than "a different colour": an idle session painted as a
 * demand would be a tab that grew a bell.
 *
 * AND NO LANE IS KEPT FOR THE MARK IT IS NOT WEARING. Measured as the
 * distance from the tab's left edge to its title: the idle tab's is the
 * marked tabs' less at least the lane, or the strip is reserving space and
 * the operator's "no need to show the dot" got them an invisible dot.
 *
 * The `notes` project holds one of each of idle, waiting, failed and running
 * on one strip, which is the picture the rule is about.
 */
await narrow.locator('[data-session-row="notes-1"]').click();
await narrow.waitForTimeout(250);
await narrow.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + 300);
await narrow.waitForTimeout(150);
const quiet = await readTabs();
console.log('the quiet project’s tabs:', JSON.stringify(quiet.map((t) => ({ title: t.title, status: t.status, active: t.active, titleOffset: Math.round(t.titleOffset), marks: t.marks.map((m) => m.id) }))));
const idleTab = quiet.find((t) => t.status === 'idle');
const quietWaiting = quiet.find((t) => t.status === 'waiting');
const quietFailed = quiet.find((t) => t.status === 'failed');
const quietRunning = quiet.find((t) => t.status === 'running');
if (idleTab === undefined || quietWaiting === undefined || quietFailed === undefined || quietRunning === undefined) {
  throw new Error(
    `this strip must hold an idle, a waiting, a failed and a running tab, it holds ` +
      `${quiet.map((t) => t.status).join(', ')}.`,
  );
}
const idleStatusMarks = idleTab.marks.filter((m) => m.status);
if (idleStatusMarks.length !== 0) {
  throw new Error(
    `the idle tab draws ${JSON.stringify(idleStatusMarks.map((m) => m.id))} — a resting session is being ` +
      'painted as something, and if that something is the bell it is the amber meaning nothing.',
  );
}
if (idleTab.marks.some((m) => m.id === 'draft')) {
  throw new Error('the idle tab shows a draft pencil before anything was typed into it');
}
if (idleTab.opensWith !== 'provider' && idleTab.opensWith !== 'title') {
  throw new Error(
    `the idle tab opens with ${idleTab.opensWith} — a dot put back, or a lane kept for a mark ` +
      'it is not wearing',
  );
}
// And the provider IS what it opens with on this strip, rather than the
// weaker "one of the two allowed things". `notes` is a `claude-code` project
// in the demo fixture, so a tab here without a provider glyph is the glyph
// having gone missing, not a sourceless model.
if (idleTab.opensWith !== 'provider') {
  throw new Error(
    'the idle tab of a project that HAS a source does not open with its provider glyph',
  );
}
checkStatusMark(quietWaiting, 'lucide-bell');
checkStatusMark(quietFailed, 'lucide-triangle-alert');
checkStatusMark(quietRunning, 'lucide-loader-circle');
// The provider on THIS strip too, the resting tab included: a glyph that only
// appeared beside a status mark would be a glyph most of a working day's tabs
// never draw.
for (const tab of quiet) checkProvider(tab);
await checkNoSessionIcon(narrow);
// Both tabs carry the provider glyph, so it cancels out of this difference:
// what stands between a tab's left edge and its title is the padding, the
// provider lane with its gap, and the status lane with ITS gap when there is
// one. Measured on this strip: 27px on the idle tab, 45 on the marked ones --
// `px-2.5` (10), the provider glyph (11 here, a brand path drawn one pixel
// inside its 12px lane) and the strip's `gap-1.5` (6), plus the status lane
// (12) and a second gap where a mark is drawn. (The session icon used to ride
// INSIDE the title button and was never part of this offset at all; the
// provider glyph that replaced it is a sibling and is.)
console.log(
  `title offsets: idle ${idleTab.titleOffset.toFixed(1)}px, running ${quietRunning.titleOffset.toFixed(1)}px, ` +
    `waiting ${quietWaiting.titleOffset.toFixed(1)}px`,
);
if (quietRunning.titleOffset - idleTab.titleOffset < LANE_PX) {
  throw new Error(
    `the idle tab's title starts only ${(quietRunning.titleOffset - idleTab.titleOffset).toFixed(1)}px ` +
      `earlier than the running tab's, less than the ${LANE_PX}px lane — the strip is reserving room ` +
      'for a mark the idle tab does not draw.',
  );
}
if (idleTab.rowHeight !== ROW_HEIGHT_PX || quietRunning.height !== idleTab.height) {
  throw new Error(
    `the resting tab and the busy one are ${idleTab.height} and ${quietRunning.height}px tall in a ` +
      `${idleTab.rowHeight}px row — the mark changed the row's geometry`,
  );
}
await narrow.screenshot({ path: `${outDir}/tab-strip-idle-vs-waiting.png` });
console.log(`${outDir}/tab-strip-idle-vs-waiting.png`);

/**
 * --- 10. THE DRAFT PENCIL: unsent text in a tab you are not looking at.
 *
 * Typed into the failed session's box, then the strip is clicked to another
 * tab -- which is the whole case: the draft is worth a mark exactly when the
 * operator has moved away from it. (`Mod-[` would CLEAR the draft, by the
 * composer's own rule; a tab click keeps it, and that is what is measured.)
 * The pencil rides AFTER the title, and unlike the status marks it carries a
 * name, because no other surface reads an unsent draft aloud.
 */
/** Type a draft into the failed session, then move to the idle tab by the
 *  strip. On whichever page: the assertions run on the narrow one and the
 *  documentation shot is taken on a wide one, below. */
async function draftOnTheFailedTab(on) {
  await on.locator('[data-session-row="notes-3"]').click();
  await on.waitForTimeout(200);
  await on.keyboard.press('Escape');
  await on.keyboard.press('Control+[');
  await on.keyboard.press('i');
  await on.keyboard.type('half a thought');
  await on.waitForTimeout(150);
  await on.locator('[data-session-tab][data-tab-status="idle"] [data-tab-select]').click();
  await on.waitForTimeout(250);
}
await draftOnTheFailedTab(narrow);
await narrow.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + 300);
await narrow.waitForTimeout(150);
const drafted = await readTabs();
const draftTab = drafted.find((t) => t.status === 'failed');
const pencil = draftTab?.marks.find((m) => m.id === 'draft');
console.log('the drafted tab:', JSON.stringify(draftTab?.marks));
if (pencil === undefined) {
  throw new Error('typing into a session and moving to another tab left no pencil on the tab that holds the draft');
}
if (pencil.glyph !== 'lucide-pencil') throw new Error(`the draft mark draws ${pencil.glyph}, not a pencil`);
if (pencil.fromTitle < 0) throw new Error(`the pencil sits before the title (${pencil.fromTitle}px), not after it`);
if (pencil.name !== 'unsent draft') throw new Error(`the pencil's accessible name is ${JSON.stringify(pencil.name)}`);
if (pencil.visible && !pencil.onTop) throw new Error('the pencil is not the element painted at its own centre');
if (drafted.filter((t) => t.marks.some((m) => m.id === 'draft')).length !== 1) {
  throw new Error('the pencil is on more than one tab, or the draft followed the pane rather than the session');
}
checkStatusMark(draftTab, 'lucide-triangle-alert');
const pencilRatio = markContrast(pencil, draftTab);
console.log(`the pencil: ${pencil.width}x${pencil.height}, contrast ${pencilRatio.toFixed(2)}:1 at opacity ${draftTab.opacity}`);
if (pencilRatio < 3) throw new Error(`the pencil lands at ${pencilRatio.toFixed(2)}:1 once dimmed, under 3:1`);
if (drafted.some((t) => t.rowHeight !== ROW_HEIGHT_PX)) {
  throw new Error('the pencil changed the row height');
}

// THE STRIP AS THE OPERATOR SEES IT, cropped to the row: an idle tab bare
// beside a waiting tab with its bell, a running tab spinning, and a failed
// tab with a pencil for the draft it holds. On a fresh WIDE page, at 2x, so
// every tab fits and nothing is clipped by the overflow the narrow page
// exists to produce; the split the first page made in section 5 would put
// two strips in the picture. `clip`, not a post-crop: `sips` ignores crop
// offsets on this machine. The width is the tabs plus the `+`, not the row,
// which runs to the pane's edge and is mostly ground.
const wide = await browser.newPage({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 2 });
wide.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await pinSortByNeedsYou(wide);
await wide.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await wide.waitForSelector('[data-tab-strip]');
await draftOnTheFailedTab(wide);
const shot = await wide.evaluate(() => {
  const row = document.querySelector('[data-tab-strip-row]').getBoundingClientRect();
  const plus = document.querySelector('[data-tab-new]').getBoundingClientRect();
  const tabs = [...document.querySelectorAll('[data-session-tab]')].map((t) => ({
    status: t.getAttribute('data-tab-status'),
    marks: [...t.querySelectorAll('[data-tab-mark]')].map((m) => m.getAttribute('data-tab-mark')),
    provider: t.querySelector('[data-tab-source]')?.getAttribute('data-tab-source') ?? null,
  }));
  return { x: row.x, y: row.y, width: plus.right - row.x + 8, height: row.height, tabs };
});
console.log('the documented strip:', JSON.stringify(shot.tabs));
// A BARE idle tab is one with no indicator at all now: the `icon` this used to
// forgive is off the list, so forgiving it would be forgiving something that
// can no longer be drawn. The provider glyph is not an indicator and is
// expected on every tab, which is asserted separately below.
if (!shot.tabs.some((t) => t.status === 'idle' && t.marks.length === 0) ||
    !shot.tabs.some((t) => t.marks.includes('draft'))) {
  throw new Error('the documentation shot does not hold a bare idle tab and a drafted one');
}
if (!shot.tabs.every((t) => t.provider !== null)) {
  throw new Error('the documentation shot has a tab with no provider glyph on it');
}
await wide.screenshot({
  path: `${outDir}/tab-indicators.png`,
  clip: { x: shot.x, y: shot.y, width: shot.width, height: shot.height },
});
console.log(`${outDir}/tab-indicators.png`);

await browser.close();
