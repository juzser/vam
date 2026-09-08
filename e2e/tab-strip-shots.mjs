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

await browser.close();
