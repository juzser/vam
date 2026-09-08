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
 * Plus two operator requests measured here because they are paint:
 *  - the focused tab wears a different opacity AND an accent border-bottom,
 *    with the inactive tabs' text held above 4.5:1 while dimmed;
 *  - the `+` sits next to the last tab rather than at the far right.
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.locator('[data-session-row="crosscheck-2"]').click();
await page.keyboard.press('Escape');
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
 * largest project has three sessions, ~412px of tabs; at a 620px viewport the
 * pane's strip is ~310px wide, so the last tab is off its end. 620 is
 * deliberately above `PHONE_MAX_WIDTH` (519) — under it this would be
 * measuring the phone shell, which draws no strip. And every check below is
 * preceded by `scrollWidth > clientWidth`: a strip that fits sits at 0 and
 * passes every position assertion trivially.
 */
const narrow = await browser.newPage({ viewport: { width: 620, height: 620 } });
narrow.on('pageerror', (err) => console.error('PAGE ERROR:', err));
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
 * --- 8. EVERY TAB REPORTS ITS STATUS, and the mark survives the dimming.
 *
 * The status ink was applied only to the ACTIVE tab, so three of its four
 * statuses could never be seen. The dot is measured, not read off a class:
 * its box, its composited colour against the strip's ground at the inactive
 * tab's `opacity-85`, and that it is the element actually painted at its own
 * centre — an indicator hidden under a sibling is an indicator nobody sees.
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
/** Every tab's dot as the browser paints it, for whichever project is active. */
const readDots = () =>
  narrow.evaluate(() => {
    const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    return [...document.querySelectorAll('[data-session-tab]')].map((tab) => {
      const dot = tab.querySelector('[data-tab-status]');
      if (dot === null) return { status: null };
      const r = dot.getBoundingClientRect();
      const sr = tab.closest('[data-tab-strip]').getBoundingClientRect();
      const row = tab.closest('[data-tab-strip-row]');
      const rowGround = getComputedStyle(row).backgroundColor;
      const ground = rowGround.startsWith('rgba(0, 0, 0, 0')
        ? getComputedStyle(document.body).backgroundColor
        : rowGround;
      return {
        active: tab.getAttribute('data-active') === 'true',
        status: dot.getAttribute('data-tab-status'),
        opacity: Number.parseFloat(getComputedStyle(tab).opacity),
        colour: parse(getComputedStyle(dot).backgroundColor),
        ground: parse(ground),
        width: r.width,
        height: r.height,
        // Only meaningful for a dot the strip is showing: one scrolled past the
        // scroller's end is clipped, and `elementFromPoint` then answers about
        // the strip rather than about the dot.
        visible: r.left >= sr.left - 0.5 && r.right <= sr.right + 0.5,
        onTop: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === dot,
      };
    });
  });

const dots = await readDots();
console.log('status dots:', JSON.stringify(dots));
if (dots.length < 2) throw new Error('need more than one tab to prove the inactive ones are marked');
if (dots.some((d) => d.status === null)) {
  throw new Error('a tab carries no status mark — the strip is the densest status surface here');
}
const inactiveDots = dots.filter((d) => !d.active);
if (inactiveDots.length === 0) throw new Error('no inactive tab to measure the dimmed dot on');
if (!inactiveDots.some((d) => d.visible)) {
  throw new Error('no inactive dot was inside the strip to measure — the check saw nothing');
}
if (!inactiveDots.some((d) => d.opacity < 1)) {
  throw new Error(
    'every inactive tab measured at full opacity, so the contrast below was never checked ' +
      'against the dimming it exists to survive',
  );
}
for (const dot of inactiveDots) {
  if (dot.width < 4 || dot.height < 4) {
    throw new Error(`a ${dot.width}x${dot.height} status dot is not a mark anyone can see`);
  }
  if (dot.visible && !dot.onTop) {
    throw new Error('the status dot is not the element painted at its own centre');
  }
  // Composited over the strip's ground at the tab's own opacity — the pixel a
  // reader actually gets. 3:1 is WCAG 1.4.11: the dot is a graphical object
  // carrying information, not text.
  const blended = dot.colour.map((c, i) => c * dot.opacity + dot.ground[i] * (1 - dot.opacity));
  const dotRatio =
    (Math.max(luminance(blended), luminance(dot.ground)) + 0.05) /
    (Math.min(luminance(blended), luminance(dot.ground)) + 0.05);
  console.log(`dimmed ${dot.status} dot contrast: ${dotRatio.toFixed(2)}:1 (at opacity ${dot.opacity})`);
  if (dotRatio < 3) {
    throw new Error(
      `the ${dot.status} dot lands at ${dotRatio.toFixed(2)}:1 against the strip once dimmed, ` +
        `under the 3:1 floor for a non-text indicator`,
    );
  }
}
await narrow.screenshot({ path: `${outDir}/tab-strip-status-dots.png` });
console.log(`${outDir}/tab-strip-status-dots.png`);

// --- IDLE IS NOT WAITING, measured as pixels rather than as a class name.
//
// The source read every interactive row the CLI did not call `busy` as
// `waiting`, so the CLI's `idle` -- three of five rows on a real machine --
// wore the amber that means "the ball is with you". Every finished session
// went loud, which is the badge crying wolf. The `notes` project holds one of
// each, so one strip carries both dots and the two have to come back as two
// different colours: a unit test can only read the class back, and this
// codebase has shipped a rule that matched nothing before.
await narrow.locator('[data-session-row="notes-1"]').click();
await narrow.waitForTimeout(250);
await narrow.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + 300);
await narrow.waitForTimeout(150);
const quiet = await readDots();
console.log('the quiet project’s dots:', JSON.stringify(quiet));
const idleDot = quiet.find((d) => d.status === 'idle');
const waitingDot = quiet.find((d) => d.status === 'waiting');
if (idleDot === undefined || waitingDot === undefined) {
  throw new Error(
    `this strip must hold an idle tab and a waiting one to tell apart, it holds ` +
      `${quiet.map((d) => d.status).join(', ')}.`,
  );
}
if (idleDot.colour.join(',') === waitingDot.colour.join(',')) {
  throw new Error(
    `the idle dot and the waiting dot are both rgb(${idleDot.colour.join(', ')}) — an idle ` +
      'session is being painted as a demand, which is the amber meaning nothing.',
  );
}
const idleBlend = idleDot.colour.map(
  (c, i) => c * idleDot.opacity + idleDot.ground[i] * (1 - idleDot.opacity),
);
const idleRatio =
  (Math.max(luminance(idleBlend), luminance(idleDot.ground)) + 0.05) /
  (Math.min(luminance(idleBlend), luminance(idleDot.ground)) + 0.05);
console.log(`idle dot contrast: ${idleRatio.toFixed(2)}:1 (at opacity ${idleDot.opacity})`);
if (idleRatio < 3) {
  throw new Error(
    `the idle dot lands at ${idleRatio.toFixed(2)}:1 against the strip, under the 3:1 floor — ` +
      'a quiet status still has to be a visible one.',
  );
}
await narrow.screenshot({ path: `${outDir}/tab-strip-idle-vs-waiting.png` });
console.log(`${outDir}/tab-strip-idle-vs-waiting.png`);

await browser.close();
