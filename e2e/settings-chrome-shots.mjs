/**
 * The settings overlay's own chrome, in an engine that lays out and paints.
 *
 * THE CARDS RESTRUCTURE (`settings/sections.ts`, `settings/primitives.tsx`)
 * changed what this file has to measure without changing why: it turned the
 * six-tab, one-panel-visible overlay this file was written against into ten
 * cards, ALL MOUNTED AND OPEN AT ONCE, each foldable on its own and some
 * carrying their own Advanced disclosure. Every item below still holds; what
 * moved is HOW each one has to query the page, now that "the panel on
 * screen" is no longer one element `document.querySelector` can find by
 * asking what is not `hidden` — that query now answers "the first of ten",
 * not "the one you navigated to".
 *
 *  - ITEM 1 (S2, then superseded by the cards restructure). `SectionStrip`
 *    carried `<span className="hidden sm:inline">` around every label, so
 *    below 640px the narrow nav WAS the icon rail its own doc comment argued
 *    cannot work. The restructure's own `SectionStrip` goes further than the
 *    fix that shipped for this: it never wraps at all now (a single
 *    horizontally-scrolling row, `sections.ts`'s own note on why a wrap grid
 *    stopped being viable at ten sections), so there is no width at which
 *    the label hides or a row count changes underfoot. What is asserted here
 *    is the COMPUTED ACCESSIBLE NAME at narrow widths, on the element the
 *    keyboard actually lands on, and that the strip stays the one row its
 *    own doc comment promises.
 *  - ITEM 3 (operator report). "The button in the Remote section of settings
 *    has the same colour as the background, so it doesn't look like a button."
 *    `PairingPanel.ACTION_BUTTON` had no resting fill at all: it painted
 *    whatever was behind it and was marked only by a `border-line` outline,
 *    which measures 1.12:1 against the `bg-panel` it sits on. Asserted as
 *    COMPUTED PAINT in both themes — an opaque fill, distinct from the
 *    surface, a boundary that reaches WCAG 1.4.11's 3:1, and a hover that
 *    moves further from the surface rather than back into it.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/settings-chrome-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** WCAG relative luminance, over an `rgb(...)` triple. */
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The sections whose NAME this file asserts, spelled once, all ten of them
 * now — read as the contract `sections.ts` fixes rather than re-derived from
 * whatever the page happens to draw. This file still runs against the BUILT
 * bundle rather than importing the source, so a stale copy of this table
 * reddens against the real DOM instead of asserting against itself.
 */
const SECTIONS = [
  ['interface', 'Interface'],
  ['terminal', 'Terminal'],
  ['window', 'Window & Sidebar'],
  ['agents', 'Agents'],
  ['behaviour', 'Behaviour'],
  ['notifications', 'Notifications'],
  ['integrations', 'Integrations'],
  ['remote', 'Remote'],
  ['keyboard', 'Keyboard'],
  ['update', 'Update'],
];

const browser = await chromium.launch();

/** A page with the demo fixture loaded and the settings overlay open. */
async function openSettings(width, height = 844) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  return page;
}

/**
 * Which nav item the accessible name `label` resolves to, or null.
 *
 * NOT `getByRole` ANY MORE. A nav item is a plain `button` now (`aria-current`
 * replaced `role="tab"`/`aria-selected` — `SettingsOverlay.tsx`'s own note on
 * why), and every card's own header is ALSO a `button` named for its section
 * ("Keyboard" the nav item, "Keyboard" the card header) — so
 * `getByRole('button', { name: label })` finds two and Playwright's strict
 * mode refuses both. The nav item's own hook, `data-settings-nav-item`, is
 * unambiguous where the accessible-name computation is not.
 */
async function namedTab(page, label) {
  const matches = await page.evaluate(
    (wanted) =>
      [...document.querySelectorAll('[data-settings-nav-item]')]
        .filter((el) => (el.textContent ?? '').trim() === wanted)
        .map((el) => el.getAttribute('data-settings-nav-item')),
    label,
  );
  return matches.length === 1 ? matches[0] : null;
}

// ---------------------------------------------------------------- ITEM 1.
// The name, at every width the strip is the nav at.

/**
 * THE NARROWEST WIDTH THAT STILL HAS A SETTINGS OVERLAY WORTH MEASURING.
 *
 * `SIDEBAR_MIN + DETAIL_MIN` (200 + 320) is the narrowest window the desktop
 * layout can draw two columns in; one pixel under it is the phone shell
 * (`phone/viewport.ts`, `PHONE_MAX_WIDTH = 519`). At the operator's request
 * the phone draws ONE settings section and no nav at all, so every assertion
 * in this file about the section strip, a keyboard walk across sections, or
 * the Keyboard section's chord column is a desktop assertion -- it used to
 * run at 320 and 390, where none of those exist any more.
 *
 * Spelled rather than imported because this file runs against the BUILT
 * bundle, at the real breakpoint rather than a guess at where it falls.
 */
const NARROWEST_DESKTOP = 520;

/** Below `md` the strip is the nav — one width is enough to prove the strip
 *  never wraps and never hides a label, since it is the same single
 *  scrolling row at every width under 768px; `NARROWEST_DESKTOP` is the one
 *  worth a screenshot too. */
const STRIP_WIDTHS = [NARROWEST_DESKTOP, 600, 767];

for (const width of STRIP_WIDTHS) {
  const page = await openSettings(width);
  const orientation = await page
    .locator('[data-settings-nav]')
    .getAttribute('aria-orientation');
  if (orientation !== 'horizontal') {
    throw new Error(
      `${width}px: the nav is ${JSON.stringify(orientation)}, so this is not the narrow strip and the width table is wrong`,
    );
  }

  const names = [];
  for (const [id, label] of SECTIONS) {
    const resolved = await namedTab(page, label);
    names.push(`${label}->${resolved}`);
    if (resolved === null) {
      throw new Error(
        `${width}px: no tab has the accessible name ${JSON.stringify(label)} — the narrow nav is an unnamed icon rail`,
      );
    }
    if (resolved !== id) {
      throw new Error(
        `${width}px: the name ${JSON.stringify(label)} lands on ${resolved}, not on ${id}`,
      );
    }
  }

  // A label that is present but clipped INSIDE ITS OWN BUTTON is a label the
  // operator cannot read even by scrolling to it, and `overflow: hidden`
  // hides that from every name computation.
  const geometry = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-settings-nav-item]')];
    return items.map((el) => ({
      id: el.getAttribute('data-settings-nav-item'),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      top: Math.round(el.getBoundingClientRect().top),
    }));
  });
  for (const item of geometry) {
    if (item.scrollW > item.clientW + 1) {
      throw new Error(
        `${width}px: ${item.id} is clipped — ${item.scrollW}px of content in a ${item.clientW}px box`,
      );
    }
  }

  // ONE ROW, ALWAYS — the property `SectionStrip`'s own doc comment argues
  // for over a wrap grid tied to a section count that has already gone
  // stale twice. Ten items on ten different `top`s would be ten rows; this
  // strip holds them on one regardless of how many sections `sections.ts`
  // ever grows to.
  const rows = new Set(geometry.map((item) => item.top)).size;
  console.log(`${width}px: ${names.join(' ')} — one row of ${geometry.length} sections`);
  if (rows !== 1) {
    throw new Error(
      `${width}px: the strip laid out on ${rows} row(s) over ${geometry.length} sections — it was meant to never wrap`,
    );
  }

  // AND THE ROW STAYS SHORT REGARDLESS OF HOW MANY SECTIONS SCROLL PAST IN
  // IT. A single-row strip cannot blow the vertical budget a wrapping one
  // used to risk, but a switch back to wrapping would, so this is the guard
  // that would catch it.
  const navHeight = await page.evaluate(() =>
    Math.round(document.querySelector('[data-settings-nav]')?.getBoundingClientRect().height ?? 0),
  );
  const share = navHeight / 844;
  console.log(`  nav is ${navHeight}px, ${Math.round(share * 100)}% of the viewport`);
  if (navHeight === 0) {
    throw new Error(`${width}px: the nav measured 0px, so this budget is about nothing`);
  }
  if (share > 0.1) {
    throw new Error(`${width}px: the section nav takes ${Math.round(share * 100)}% of the screen`);
  }

  // SIDEWAYS IS THE POINT, NOT THE FAILURE, for the strip as a whole — but
  // only if the last section is actually reachable by the one scroll gesture
  // this row offers. Scrolled to explicitly rather than trusted from the
  // strip's own `overflow-x-auto`, the same way a card's own scrollport is
  // measured in `settings-panels-shots.mjs`.
  const last = SECTIONS[SECTIONS.length - 1];
  await page
    .locator(`[data-settings-nav-item="${last[0]}"]`)
    .scrollIntoViewIfNeeded();
  const reachable = await page.evaluate(
    (id) => {
      const strip = document.querySelector('[data-settings-nav]');
      const item = document.querySelector(`[data-settings-nav-item="${id}"]`);
      if (strip === null || item === null) return false;
      const s = strip.getBoundingClientRect();
      const i = item.getBoundingClientRect();
      return i.left >= s.left - 1 && i.right <= s.right + 1;
    },
    last[0],
  );
  if (!reachable) {
    throw new Error(`${width}px: ${last[1]}, the last section, cannot be scrolled into the strip`);
  }

  if (width === NARROWEST_DESKTOP) {
    await page.screenshot({ path: `${outDir}/settings-nav-narrow.png` });
  }
  await page.close();
}

// The keyboard path, at the narrowest width the app ships a shell for. The
// nav is one tab stop with a roving `tabIndex`, so "the tab order reaches each
// section" means: Tab arrives on a NAMED item, and the arrows walk the rest
// without ever landing on an anonymous one — and mark it `aria-current`, the
// jump-link pattern's own way of saying "you are here" now that activating an
// item no longer swaps which single panel is visible (every card stays
// mounted; `settings-panels-shots.mjs` holds the geometry this produces).
{
  const page = await openSettings(NARROWEST_DESKTOP);
  const reached = [];
  for (const [id, label] of SECTIONS) {
    const active = await page.evaluate(() => ({
      id: document.activeElement?.getAttribute('data-settings-nav-item') ?? null,
      // A NATIVE `<button>` carries no explicit `role` attribute — its role
      // is implicit, which is the whole point of using one instead of a
      // `div role="tab"`. `tagName` is what proves it is really a button and
      // not, say, a `div` the keyboard merely landed on.
      tag: document.activeElement?.tagName ?? null,
      current: document.activeElement?.getAttribute('aria-current') ?? null,
    }));
    if (active.tag !== 'BUTTON' || active.id !== id) {
      throw new Error(
        `${NARROWEST_DESKTOP}px: the keyboard is on ${JSON.stringify(active.id)} (a ${active.tag}), expected the ${id} nav item`,
      );
    }
    if (active.current !== 'true') {
      throw new Error(`${NARROWEST_DESKTOP}px: ${id} has the keyboard but is not marked aria-current`);
    }
    const named = await namedTab(page, label);
    if (named !== id) {
      throw new Error(
        `${NARROWEST_DESKTOP}px: the focused ${id} item does not answer to the name ${JSON.stringify(label)} (it is ${named})`,
      );
    }
    reached.push(label);
    await page.keyboard.press('ArrowRight');
  }
  console.log(`${NARROWEST_DESKTOP}px: the keyboard reached ${reached.join(', ')}, each by name`);
  await page.close();
}

// The wide rail, which was never the defect — asserted so a fix to the strip
// cannot quietly cost the rail its names.
{
  const page = await openSettings(1100, 800);
  for (const [id, label] of SECTIONS) {
    if ((await namedTab(page, label)) !== id) {
      throw new Error(`1100px: the rail's ${id} tab is not named ${JSON.stringify(label)}`);
    }
  }
  console.log(`1100px: the rail names all ${SECTIONS.length} sections checked here`);
  await page.close();
}

// ---------------------------------------------------------------- ITEM 4.
// THE SHORTCUT COLUMN, MEASURED WHERE THE CHORD IS ACTUALLY LAID OUT.
//
// The operator: "increase the width of the shortcut column in settings". The
// column was 68px, sized when the widest thing in it was `gt`. `Mod-Shift-[` /
// `]` and `Mod-Alt-[` / `]` arrived with the pane-stepping work and nothing
// resized the column they landed in. Measured here, on the shipped bundle,
// before the fix:
//
//   Mod-Shift-]   50.58px of ink over 2 lines   scrollHeight 36 / client 24
//   Mod-Shift-[   43.36px of ink over 3 lines   scrollHeight 54 / client 24
//
// The slot is 26px tall and does not scroll, so those chords were not tight --
// they were WRAPPED AND CUT, and what an operator saw of `Mod-Shift-[` was its
// first line and nothing else.
//
// THIS CANNOT BE A UNIT TEST. happy-dom lays nothing out and measures no text,
// so `scrollHeight` there is 0 and `getClientRects()` is empty: the wrap that
// did the cutting is invisible to the entire unit suite. What is asserted is
// the RANGE over the chord's own text -- its widest painted line, and how many
// lines there are -- against the slot's content box, in a real engine.
{
  for (const theme of ['dark', 'light']) {
    // The wide form and the narrow one where the section strip wraps two by
    // two: the column has to survive both. The narrow one is
    // `NARROWEST_DESKTOP`, not 390 -- 390 is the phone shell, which draws no
    // Keyboard section for this to measure.
    for (const width of [1100, NARROWEST_DESKTOP]) {
      const page = await openSettings(width, 800);
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('light', t === 'light');
      }, theme);
      await page.locator('[data-settings-nav-item="keyboard"]').click();
      await page.waitForSelector('[data-binding-slot]', { timeout: 5_000 });

      const slots = await page.evaluate(() => {
        // `ChordGlyphs` (`ShortcutTip.tsx`) now paints a slot's chord as
        // several sibling nodes — a `font-sans` span per Apple glyph
        // segment, plain text beside it — rather than the one flat string
        // this range held when this measurement was written. A `Range`
        // gives back one rect PER NODE'S OWN fragment, so a chord that never
        // wraps at all reports several rects: one physical line read as
        // several. Grouped by `top`, which recovers the count "how many
        // lines" always meant — same-line fragments differ by at most ~1px
        // (the sans span's own ascent against the mono text beside it,
        // measured live), a real wrap by a full line-height (14-15px at
        // this size), so a 4px tolerance tells the two apart without being
        // tuned to either font.
        const visualLines = (rects) => {
          const groups = [];
          for (const rect of rects) {
            const group = groups.find((g) => Math.abs(g.top - rect.top) < 4);
            if (group === undefined) {
              groups.push({ top: rect.top, rects: [rect] });
            } else {
              group.rects.push(rect);
            }
          }
          return groups.map((g) => ({
            width:
              Math.max(...g.rects.map((r) => r.right)) - Math.min(...g.rects.map((r) => r.left)),
          }));
        };
        const rows = [];
        for (const slot of document.querySelectorAll('[data-binding-slot]')) {
          const kbd = slot.querySelector('[data-settings-keys]');
          // An empty slot draws a `+` and no chord; it is not a claim about
          // width and is counted out rather than measured as zero.
          if (kbd === null) continue;
          const range = document.createRange();
          range.selectNodeContents(kbd);
          const boxLines = visualLines([...range.getClientRects()]);
          rows.push({
            keys: (kbd.textContent ?? '').trim(),
            inkW: Math.max(...boxLines.map((l) => l.width), 0),
            lines: boxLines.length,
            innerW: slot.clientWidth,
            scrollW: slot.scrollWidth,
            scrollH: slot.scrollHeight,
            clientH: slot.clientHeight,
          });
        }
        return rows;
      });

      // A CORPUS THAT IS NOT THERE MAKES EVERY LINE BELOW VACUOUS. The
      // shortcut section draws sixty-odd bound chords; anything near zero
      // means the section did not open and this measured an empty list.
      if (slots.length < 40) {
        throw new Error(
          `${theme} ${width}px: only ${slots.length} bound chord(s) on screen — the shortcut list did not render`,
        );
      }
      const wrapped = slots.filter((s) => s.lines > 1);
      const clipped = slots.filter((s) => s.scrollH > s.clientH + 1);
      // Sideways rather than downwards: with `whitespace-nowrap` a chord that
      // does not fit runs off the end of a box that cannot scroll, and only
      // `scrollWidth` sees it. Comparing the ink to `clientWidth` would not —
      // that box includes the slot's own padding.
      const spilling = slots.filter((s) => s.scrollW > s.innerW + 1);
      const widest = slots.reduce((a, b) => (a.inkW >= b.inkW ? a : b));
      console.log(
        `${theme} ${width}px: ${slots.length} chords, widest ${widest.keys} at ${widest.inkW.toFixed(2)}px in a ${widest.innerW}px box`,
      );
      // THE KEY IS THE ONE THING THAT MAY NOT CLIP. Three ways it can, and
      // each is a different symptom of the same defect: a second line the 26px
      // box cannot show, content taller than the box, and ink wider than it.
      if (wrapped.length > 0) {
        throw new Error(
          `${theme} ${width}px: ${wrapped.length} chord(s) wrap onto more than one line in a 26px slot — ${JSON.stringify(wrapped.slice(0, 3))}`,
        );
      }
      if (clipped.length > 0) {
        throw new Error(
          `${theme} ${width}px: ${clipped.length} chord(s) are cut by their own box — ${JSON.stringify(clipped.slice(0, 3))}`,
        );
      }
      if (spilling.length > 0) {
        throw new Error(
          `${theme} ${width}px: ${spilling.length} chord(s) are wider than the box that holds them — ${JSON.stringify(spilling.slice(0, 3))}`,
        );
      }
      // And the label is what yields, not the key: it must still be marked to
      // truncate, or a long label would push the key columns off their x.
      const labelTruncates = await page.evaluate(() =>
        [...document.querySelectorAll('[data-binding-label]')].every((el) =>
          el.className.includes('truncate'),
        ),
      );
      if (!labelTruncates) {
        throw new Error(`${theme} ${width}px: a binding label is not marked to truncate`);
      }
      if (theme === 'dark' && width === 1100) {
        await page.screenshot({ path: `${outDir}/settings-shortcut-column-after.png` });
        console.log(`${outDir}/settings-shortcut-column-after.png`);
      }
      await page.close();
    }
  }
}

// AND THE HALF THE SHIPPED TABLES CANNOT REACH.
//
// The floor holds every chord `buildBindingSheet` produces, so a corpus made
// only of those would pass with `whitespace-nowrap` deleted and the slot's
// growth taken away — the two things that exist for a chord LONGER than the
// floor. A capture has no length bound: `normalizeKey` answers
// `Mod-Alt-<event.key>`, and `event.key` is whatever the keyboard reports.
// So one is planted, through the same `localStorage` an override really
// lives in, and asked the same questions.
//
// THIS LOOP USED TO RUN AT 320 AND USED TO FALSIFY `whitespace-nowrap`. IT NO
// LONGER FALSIFIES IT, AND SAYING SO IS THE POINT OF THIS PARAGRAPH.
//
// What was true: deleting `whitespace-nowrap` from `SLOT_BOX` changed nothing
// at 1100 or 390 -- both have room, the `max-content` track takes it, the
// chord sits on one line either way -- but at 320 the PANEL ran out of width,
// the slot fell back to 154px against 166px of chord, and without the class
// the chord wrapped onto a second line a 26px box cannot show. So 320 was in
// this list because it was the width where deleting the class went red.
//
// What changed: 320 is the PHONE now. At the operator's request the phone
// draws one settings section and no Keyboard tab at all
// (`settings/sections.ts`, `PHONE_SECTIONS`), so there is no chord column
// there to measure. `NARROWEST_DESKTOP` is the narrowest width this section
// can be reached at, and the mutation was RE-RUN there rather than assumed:
//
//   with and without the class, 520px: Mod-Alt-AudioVolumeDown,
//   166.17px of ink in a 182px box, 1 line -- identical.
//
// The track is `max-content`, so the slot grows with the chord until the panel
// runs out, and at 520 the panel does not run out for any chord a keyboard
// reports. Lengthening the plant does not restore the squeeze: measured at
// `Mod-Alt-LaunchMediaPlayer`, 180.63px of ink in a 197px box, still one line.
//
// So: the class is KEPT, because it is correct and costs nothing, and the
// claim that this loop protects it is RETIRED rather than left standing. What
// the loop still proves is the rest -- that a planted override really lands,
// that the chord is one line at both widths, and that it stays inside the box
// that clips. Anyone who wants the class falsifiable again needs a surface
// narrower than 520 that still draws a chord column, and there is none.
for (const width of [1100, NARROWEST_DESKTOP]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(() => {
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({ keyBindings: { rename: ['Mod-Alt-AudioVolumeDown'] } }),
    );
  });
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="keyboard"]').click();
  await page.waitForSelector('[data-binding-slot]', { timeout: 5_000 });

  const planted = await page.evaluate(() => {
    // Same regrouping as the ITEM 4 loop above, and the same reason:
    // `ChordGlyphs` paints this chord (`⌥ ⌘ AudioVolumeDown`, two Mac glyph
    // segments) as several sibling nodes, so a `Range` over it now reports
    // one rect per node — grouped back into physical lines by `top`.
    const visualLines = (rects) => {
      const groups = [];
      for (const rect of rects) {
        const group = groups.find((g) => Math.abs(g.top - rect.top) < 4);
        if (group === undefined) {
          groups.push({ top: rect.top, rects: [rect] });
        } else {
          group.rects.push(rect);
        }
      }
      return groups.map((g) => ({
        left: Math.min(...g.rects.map((r) => r.left)),
        right: Math.max(...g.rects.map((r) => r.right)),
        width: Math.max(...g.rects.map((r) => r.right)) - Math.min(...g.rects.map((r) => r.left)),
      }));
    };
    const slot = document.querySelector('[data-binding-slot="rename:0"]');
    if (slot === null) return null;
    const kbd = slot.querySelector('[data-settings-keys]');
    if (kbd === null) return null;
    const range = document.createRange();
    range.selectNodeContents(kbd);
    const boxLines = visualLines([...range.getClientRects()]);
    // The nearest ancestor that actually clips — the scrolling panel, not the
    // slot. A chord that overflows its slot is fine; a chord that overflows
    // THIS is cut off the screen.
    let clipper = slot.parentElement;
    while (clipper !== null && clipper !== document.body) {
      const cs = getComputedStyle(clipper);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') break;
      clipper = clipper.parentElement;
    }
    return {
      keys: (kbd.textContent ?? '').trim(),
      lines: boxLines.length,
      inkW: Math.max(...boxLines.map((l) => l.width), 0),
      inkRight: Math.max(...boxLines.map((l) => l.right), 0),
      innerW: slot.clientWidth,
      scrollH: slot.scrollHeight,
      clientH: slot.clientHeight,
      clipRight: clipper === null ? null : clipper.getBoundingClientRect().right,
    };
  });
  // The plant not landing would make every line below vacuous — a slot
  // showing `r` passes all of them and proves nothing.
  //
  // THE PLANT IS A TOKEN AND THE SLOT PAINTS A KEYSTROKE. `Mod-Alt-<key>` is
  // what `normalizeKey` stores and what goes into prefs; what a slot draws is
  // `chordSymbols` of it — ⌥ ⌘ AudioVolumeDown on a Mac, Ctrl+Alt+AudioVolumeDown
  // off one. The symbols shorten the MODIFIERS and not the key name, which is
  // where all of this chord's length lives, so it is still the longest thing
  // this column is ever asked to hold.
  const wanted = await page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? '⌥ ⌘ AudioVolumeDown'
      : 'Ctrl+Alt+AudioVolumeDown',
  );
  if (planted === null || planted.keys !== wanted) {
    throw new Error(
      `${width}px: the long-chord override did not reach the editor: ${JSON.stringify(planted)} — this check measured nothing`,
    );
  }
  console.log(
    `planted ${width}px: ${planted.keys} at ${planted.inkW.toFixed(2)}px in a ${planted.innerW}px box, ${planted.lines} line(s)`,
  );
  // ONE LINE, ALWAYS. Whether the slot grew to hold the chord or the chord
  // runs off a slot that could not grow, the whole of it is on one line and
  // therefore readable. A second line in a 26px box is the defect.
  if (planted.lines > 1) {
    throw new Error(`${width}px: a captured chord wrapped: ${JSON.stringify(planted)}`);
  }
  if (planted.scrollH > planted.clientH + 1) {
    throw new Error(
      `${width}px: a captured chord is taller than its own box: ${JSON.stringify(planted)}`,
    );
  }
  // Overflowing the SLOT is allowed and is the design; overflowing the panel
  // that clips is the chord going off the screen.
  if (planted.clipRight === null || planted.inkRight > planted.clipRight) {
    throw new Error(
      `${width}px: a captured chord runs past the panel that clips it: ${JSON.stringify(planted)}`,
    );
  }
  if (width === 1100) {
    // Wide, there is room, so the slot is expected to have TAKEN it rather
    // than overflowed — the label column is what yields.
    if (planted.innerW < planted.inkW) {
      throw new Error(
        `1100px: the slot did not grow for a long chord: ${JSON.stringify(planted)}`,
      );
    }
    await page.screenshot({ path: `${outDir}/settings-shortcut-column-long-chord.png` });
    console.log(`${outDir}/settings-shortcut-column-long-chord.png`);
  }
  await page.close();
}

// ---------------------------------------------------------------- ITEM 3.
// The Remote section's buttons, as paint.

/**
 * A pairing screen for the browser build, which has no preload bridge.
 *
 * This supplies STATE and nothing else: the component, its classes and the
 * stylesheet are the shipped ones, and every number below is read off the
 * element Chromium actually painted. Every value is invented — no address, no
 * device and no code here belongs to a real machine.
 */
const REMOTE_STUB = {
  view: {
    code: null,
    expiresAtMs: 0,
    burned: false,
    throttledUntilMs: 0,
    awaiting: null,
    pairedName: null,
  },
  devices: [],
  address: { kind: 'found', url: 'https://example-host.example-tailnet.ts.net:7777' },
  allowWrites: false,
  registry: null,
  serve: { enabled: false, lastError: null, timedOut: false, tailnetServeDisabledUrl: null },
  serverError: null,
  writesPreference: false,
  nowMs: 1_700_000_000_000,
};

{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((state) => {
    const answer = () => Promise.resolve(state);
    // `RemotePanel` reads `window.api.remote`; nothing else on this object is
    // read by the browser build, and the demo fixture is untouched.
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      remote: {
        state: answer,
        open: answer,
        approve: answer,
        deny: answer,
        remove: answer,
        revokeAll: answer,
        enableServe: answer,
        disableServe: answer,
        setWrites: answer,
      },
    };
  }, REMOTE_STUB);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="remote"]').click();
  await page.waitForSelector('[data-testid="pairing-panel"]', { timeout: 5_000 });

  const button = page.getByRole('button', { name: 'Enable phone access' });
  if ((await button.count()) !== 1) {
    throw new Error(
      'the pairing panel drew no "Enable phone access" button — the stub no longer reaches PairingPanel',
    );
  }

  /** The button's own paint, and the surface behind it, from the same frame. */
  const measure = () =>
    button.evaluate((el) => {
      const parse = (s) => {
        const n = (s.match(/[\d.]+/g) ?? []).map(Number);
        return { rgb: n.slice(0, 3), alpha: n.length > 3 ? n[3] : 1 };
      };
      const cs = getComputedStyle(el);
      // What is UNDER the button, asked of the document rather than guessed
      // from a token name: walk up until something paints an opaque fill.
      let behind = el.parentElement;
      let backdrop = 'rgba(0, 0, 0, 0)';
      while (behind !== null && parse(backdrop).alpha === 0) {
        backdrop = getComputedStyle(behind).backgroundColor;
        behind = behind.parentElement;
      }
      return {
        fill: parse(cs.backgroundColor),
        border: parse(cs.borderTopColor),
        borderWidth: Number.parseFloat(cs.borderTopWidth),
        behind: parse(backdrop),
      };
    });

  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('light', t === 'light');
    }, theme);
    await page.waitForTimeout(120);

    const rest = await measure();
    // Every ratio below is a claim about two PAINTED colours. A transparent
    // element has no colour, and comparing one is how a contrast assertion
    // becomes a tautology — so refuse before measuring, in both directions.
    if (rest.fill.alpha === 0) {
      throw new Error(
        `${theme}: the action button has no resting fill (${JSON.stringify(rest.fill)}) — it paints whatever is behind it`,
      );
    }
    if (rest.behind.alpha === 0) {
      throw new Error(`${theme}: nothing behind the button paints an opaque colour to compare with`);
    }
    if (rest.border.alpha === 0 || rest.borderWidth === 0) {
      throw new Error(`${theme}: the button has no drawn boundary`);
    }

    const fillVsBehind = ratio(rest.fill.rgb, rest.behind.rgb);
    const borderVsBehind = ratio(rest.border.rgb, rest.behind.rgb);
    console.log(
      `${theme}: action button fill ${JSON.stringify(rest.fill.rgb)} on ${JSON.stringify(rest.behind.rgb)} = ${fillVsBehind.toFixed(3)}:1, border ${borderVsBehind.toFixed(2)}:1`,
    );

    if (rest.fill.rgb.join(',') === rest.behind.rgb.join(',')) {
      throw new Error(
        `${theme}: the button's fill is the surface's own colour ${JSON.stringify(rest.fill.rgb)} — the operator's report exactly`,
      );
    }
    // WCAG 1.4.11: the visual information that identifies a control needs
    // 3:1. In this palette no surface token reaches 3:1 against `panel`, so
    // it is the BOUNDARY that has to carry it — which is what the fill alone
    // could never do and why both are asserted.
    if (borderVsBehind < 3) {
      throw new Error(
        `${theme}: the button's border is ${borderVsBehind.toFixed(2)}:1 against the panel, under the 3:1 of WCAG 1.4.11`,
      );
    }

    // Direction, not magnitude: PR #288's defect was a hover that moved the
    // control TOWARDS the surface and punched a hole in it. Measured as
    // distance from the surface's luminance, so it holds in both themes
    // without either one naming a colour.
    await button.hover();
    await page.waitForTimeout(120);
    const hover = await measure();
    if (hover.fill.alpha === 0) {
      throw new Error(`${theme}: the hover state removed the fill`);
    }
    const away = (m) => Math.abs(luminance(m.fill.rgb) - luminance(m.behind.rgb));
    console.log(
      `${theme}: hover fill ${JSON.stringify(hover.fill.rgb)}; distance from surface rest ${away(rest).toFixed(4)} -> hover ${away(hover).toFixed(4)}`,
    );
    if (away(hover) <= away(rest)) {
      throw new Error(
        `${theme}: hovering moves the button back towards the surface (${away(rest).toFixed(4)} -> ${away(hover).toFixed(4)}) instead of lifting it off`,
      );
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${outDir}/settings-remote-button-${theme}-after.png` });
  }
  await page.close();
}

// ---------------------------------------------------------------------------
// THE CASE LADDER, MEASURED AS PAINT.
//
// Operator: "the settings text is all lower case — the big headings should be
// upper case and the normal ones capitalised."
//
// THE CASE IS A CSS TRANSFORM, NOT A REWRITTEN STRING, and that choice is what
// makes this file the only place the change can be checked. The DOM keeps its
// canonical lower-case text, so `textContent` is unchanged, every unit
// assertion that quotes a label still holds, and the ACCESSIBLE NAME a screen
// reader receives stays a normal word rather than four capitals it may spell
// out. What changes is the paint -- and a class name in a `.tsx` file proves
// only that somebody typed it. This repo has shipped a stylesheet rule that
// matched nothing and passed review on exactly that evidence.
//
// SO EACH ELEMENT IS ASKED WHAT IT COMPUTED, and the corpus is asserted first:
// a sweep that found no headings would satisfy every "is uppercase" check
// below by having nothing to check.
console.log('\n=== the settings case ladder');
{
  const page = await openSettings(1100, 800);
  // ALL TEN SECTIONS, not the one that happens to be scrolled to. Every card
  // is mounted and open at once now (the cards restructure), so a ladder
  // checked on `interface` alone would have left `keyboard` -- the longest
  // list of words here -- in whatever case it was already in. The nav click
  // below is for the screenshot's own framing, not for visibility: every
  // panel this loop asks about is already on screen before it clicks anything.
  const sectionIds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-settings-nav-item]')].map((el) =>
      el.getAttribute('data-settings-nav-item'),
    ),
  );
  if (sectionIds.length < 10) {
    throw new Error(`the nav offers ${sectionIds.length} sections, so this sweep is about nothing`);
  }
  const seen = { headings: 0, labels: 0, hints: 0, controls: 0, descriptions: 0, properNames: 0 };
  /** Paragraphs that BEGIN with the product name, across the whole sweep. */
  let brandStarts = 0;
  for (const sectionId of sectionIds) {
  await page.locator(`[data-settings-nav-item="${sectionId}"]`).click();
  await page.waitForTimeout(150);
  const cased = await page.evaluate((id) => {
    const read = (el) => ({
      text: (el.textContent ?? '').trim().slice(0, 40),
      transform: getComputedStyle(el).textTransform,
    });
    // BY ID, NOT BY "NOT HIDDEN". All ten cards are mounted and open by
    // default now, so `:not([hidden])` would match the first of TEN and
    // report `interface`'s own words for every section this loop asks about
    // -- the cards restructure's whole reason this file needed a second look.
    // `getComputedStyle` still resolves correctly on a card folded behind its
    // own collapse or an Advanced disclosure (both just toggle `hidden`,
    // which affects layout and paint but not the computed value of a
    // property like `text-transform`), so scoping by id rather than by
    // visibility loses nothing this ladder is asking about.
    const panel = document.querySelector(`[data-settings-panel="${id}"]`);
    return {
      heading: [...(panel?.querySelectorAll('[data-settings-heading]') ?? [])].map(read),
      labels: [...(panel?.querySelectorAll('[data-settings-rows] h4') ?? [])].map(read),
      hints: [...(panel?.querySelectorAll('[data-settings-rows] p') ?? [])].map(read),
      descriptions: [...(panel?.querySelectorAll('[data-binding-label]') ?? [])].map((el) => ({
        ...read(el),
        first: getComputedStyle(el, '::first-letter').textTransform,
      })),
      // THE CONTROLS THEMSELVES, which are the bulk of the words on this
      // surface: theme choices, colour-template chips, swatch names, the focus
      // view switch. A ladder that stopped at the headings would leave a panel
      // whose every pressable word was still lower case.
      controls: [
        ...(panel?.querySelectorAll('[data-settings-rows] button, [data-settings-rows] span') ??
          []),
      ]
        .filter((el) => {
          // A DIRECT TEXT NODE, not `textContent`: the colour-template chips
          // wrap three preview discs in a `span`, so a wrapper test on
          // `querySelector` dropped them from the corpus entirely -- measured,
          // and they are five of the controls this is about.
          const own = [...el.childNodes].some(
            (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
          );
          if (!own) return false;
          // Sentences and shouted eyebrows are ranks of their own, checked
          // above. A UNIT is not a name either: `px` capitalised is `Px`.
          if (el.closest('p') !== null) return false;
          // A UNIT is not a name: `px` capitalised is `Px`. And a BINDING ROW
          // is a description -- "previous tab of this project — a ring, so it
          // never runs out" -- which takes sentence case; there are seventy of
          // them down one list and title-casing that is a wall of capitals.
          // Both are checked below, in the rank they belong to.
          //
          // AND A CHORD GLYPH IS NOT A NAME EITHER. `ChordGlyphs` (audit A22)
          // wraps a Mac modifier segment (⌘⇧⌥⌃, a named key) in its own
          // `<span class="font-sans">`, which is a `span` with a direct own
          // text node -- exactly this rank's own test for "is a control" --
          // so a symbol that has no case at all (`text-transform: capitalize`
          // does nothing to `⌘`) started showing up here as a "control named
          // none". `data-settings-keys` marks the chord chip these spans live
          // in, the same shape `data-settings-unit`/`data-verbatim` already
          // use to name a rank this sweep does not govern; the ITEM 4 block
          // above and `chord-symbol-shots.mjs` are what actually check this
          // rank.
          //
          // AND THE ADVANCED FOLD'S OWN TOGGLE IS NOT A SETTING'S CONTROL
          // EITHER. `AdvancedDisclosure` (the cards restructure) prints the
          // literal word "Advanced" -- chrome for a fold, the same rank as a
          // card's own header or the nav, neither of which this sweep governs
          // -- rather than a control a row draws for an operator to pick
          // between. `data-settings-advanced` marks the toggle itself, so
          // `closest` (which matches the element against itself too) is
          // enough with no wrapper needed.
          return (
            el.closest('[data-settings-unit]') === null &&
            el.closest('[data-binding-label]') === null &&
            el.closest('[data-verbatim]') === null &&
            el.closest('[data-settings-keys]') === null &&
            el.closest('[data-settings-advanced]') === null
          );
        })
        .map(read),
      // A PROPER NAME IS A RANK OF ITS OWN, and it is the one rank that must
      // NOT be transformed. `capitalize` uppercases the first letter of every
      // word and leaves the rest as authored, which is right for a control
      // named in prose (`dark`, `high contrast`) and wrong for a name its
      // author wrote: `vam Light` would paint `Vam Light`, and a scheme called
      // `iTerm` would paint `ITerm`. `data-verbatim` is the codebase's own
      // word for "somebody chose these letters" -- the Update section's
      // version line already carries it, for the product's own lower-case
      // name, and its exception is measured further down this file. The
      // terminal theme chips carry it for the same reason, and this rank
      // holds every one of them to the OPPOSITE rule -- `none`, never a
      // transform -- so the attribute buys a stricter check rather than an
      // exemption from one.
      properNames: [...(panel?.querySelectorAll('[data-verbatim]') ?? [])].map(read),
    };
  }, sectionId);
  console.log(`  [${sectionId}] heading: ${JSON.stringify(cased.heading)}`);
  console.log(`  [${sectionId}] labels: ${JSON.stringify(cased.labels.map((l) => l.text))}`);

  // THE CORPUS FIRST, in every one of the three ranks.
  if (cased.heading.length !== 1) {
    throw new Error(`expected one visible panel heading, found ${cased.heading.length}`);
  }
  // THE CORPUS IS COUNTED ACROSS THE SWEEP, not per panel, and that is not a
  // softening. `remote` draws its own chrome and has no `Block` rows at all,
  // so a per-panel floor is either wrong for that one or vacuous for it -- and
  // a vacuous floor is how a sweep comes to pass having examined nothing. The
  // totals are asserted once, after all four, against literals.
  seen.headings += cased.heading.length;
  seen.labels += cased.labels.length;
  seen.hints += cased.hints.length;
  seen.controls += cased.controls.length;
  seen.properNames += cased.properNames.length;

  // THE BIG HEADING SHOUTS. It is the one piece of text on this surface that
  // names where you are rather than what you are changing.
  for (const row of cased.heading) {
    if (row.transform !== 'uppercase') {
      throw new Error(
        `[${sectionId}] the panel heading ${JSON.stringify(row.text)} is ${row.transform}`,
      );
    }
    if (row.text.length === 0) {
      throw new Error('the panel heading is empty, so its case is about nothing');
    }
  }

  // A SETTING'S NAME IS CAPITALISED, never shouted: there are four or five of
  // them down one panel and a column of capitals is a column with no word
  // shapes left to scan by.
  for (const row of cased.labels) {
    if (row.transform !== 'capitalize') {
      throw new Error(
        `[${sectionId}] the setting label ${JSON.stringify(row.text)} is ${row.transform}`,
      );
    }
  }

  // EVERY CONTROL NAME IS CAPITALISED TOO. Corpus first, as above.
  console.log(`  [${sectionId}] controls: ${JSON.stringify(cased.controls.map((c) => c.text))}`);
  const shouted = cased.controls.filter((c) => c.transform !== 'capitalize');
  if (shouted.length > 0) {
    throw new Error(
      `[${sectionId}] control names not capitalised: ${JSON.stringify(shouted.map((c) => `${c.text}=${c.transform}`))}`,
    );
  }

  // AND A PROPER NAME IS PRINTED AS ITS AUTHOR WROTE IT. See the corpus above
  // for why this is a rule and not an exemption.
  if (cased.properNames.length > 0) {
    console.log(
      `  [${sectionId}] proper names: ${JSON.stringify(cased.properNames.map((c) => c.text))}`,
    );
  }
  const transformed = cased.properNames.filter((c) => c.transform !== 'none');
  if (transformed.length > 0) {
    throw new Error(
      `[${sectionId}] proper names are being transformed: ${JSON.stringify(transformed.map((c) => `${c.text}=${c.transform}`))}`,
    );
  }

  // A BINDING ROW IS A DESCRIPTION, in the same rank as a hint.
  const titled = cased.descriptions.filter(
    (d) => d.transform !== 'none' || d.first !== 'uppercase',
  );
  if (titled.length > 0) {
    throw new Error(
      `[${sectionId}] binding rows are not sentences: ${JSON.stringify(titled.slice(0, 3))}`,
    );
  }
  seen.descriptions += cased.descriptions.length;

  // AND A HINT IS A SENTENCE, so only its first letter moves. `capitalize`
  // here would give "System Follows What The Operating System Asks For",
  // which is the failure that looks most like the fix.
  for (const row of cased.hints) {
    if (row.transform !== 'none') {
      throw new Error(
        `[${sectionId}] the hint ${JSON.stringify(row.text)} is ${row.transform}, not a sentence`,
      );
    }
  }
  // EVERY PARAGRAPH ON THE PANEL, and the panel's OWN hint by name. That one
  // is the reason this check widened: it wore the sentence class and stayed
  // lower case, because `::first-letter` applies only to a BLOCK container and
  // it was a `<span>` -- while the identical class worked one row up, whose
  // parent is a flex container and whose children are therefore blockified.
  // The first corpus here stopped at `[data-settings-rows]` and could not see
  // the element that was wrong.
  const sentences = await page.evaluate((id) => {
    const panel = document.querySelector(`[data-settings-panel="${id}"]`);
    const own = panel?.querySelector('[data-settings-panel-hint]') ?? null;
    const all = [...(panel?.querySelectorAll('[data-settings-rows] p') ?? [])];
    const at = (el) =>
      el === null
        ? null
        : {
            text: (el.textContent ?? '').trim().slice(0, 28),
            first: getComputedStyle(el, '::first-letter').textTransform,
          };
    return {
      own: at(own),
      rows: all.filter((el) => !el.hasAttribute('data-verbatim')).map(at),
      verbatim: all.filter((el) => el.hasAttribute('data-verbatim')).map(at),
      // Every paragraph, whatever its opt-out, with the FULL text: the brand
      // check below is about what a line starts with, not about which bucket
      // somebody put it in.
      all: all.map((el) => ({
        text: (el.textContent ?? '').trim(),
        first: getComputedStyle(el, '::first-letter').textTransform,
      })),
    };
  }, sectionId);
  console.log(`  [${sectionId}] panel hint: ${JSON.stringify(sentences.own)}`);
  if (sentences.own === null) {
    throw new Error(`[${sectionId}] the panel draws no hint of its own`);
  }
  for (const row of [sentences.own, ...sentences.rows]) {
    if (row.first !== 'uppercase') {
      throw new Error(
        `[${sectionId}] ${JSON.stringify(row.text)} starts ${row.first}, not a sentence`,
      );
    }
  }

  // AND THE ONE EXCEPTION, MEASURED RATHER THAN TRUSTED. `data-verbatim` says
  // "somebody chose these letters" -- the product is `vam`, lower case, and
  // the Update section is the first copy here to begin with the name. Without
  // the opt-out it paints `Vam 0.1.0`, which every case assertion above was
  // green for: the transform WAS applied, correctly, to the wrong string.
  //
  // Both halves are checked. `none` proves the `:not()` reaches the element;
  // the painted first character proves the rule it is exempt from is the rule
  // that would otherwise have changed it -- a selector that matches nothing
  // reads exactly like a selector that works.
  for (const row of sentences.verbatim) {
    if (row.first !== 'none') {
      throw new Error(
        `[${sectionId}] the verbatim line ${JSON.stringify(row.text)} is still ${row.first}`,
      );
    }
    const head = row.text.slice(0, 1);
    if (head !== '' && head === head.toUpperCase() && head !== head.toLowerCase()) {
      throw new Error(
        `[${sectionId}] the verbatim line ${JSON.stringify(row.text)} starts upper case anyway`,
      );
    }
  }
  if (sectionId === 'update' && sentences.verbatim.length === 0) {
    throw new Error('the update section draws no verbatim line, so the exception is untested');
  }

  // AND THE PROPERTY ALL OF THAT EXISTS FOR: THE PRODUCT IS CALLED `vam`.
  //
  // The check above proves the opt-out WORKS where it is applied. It does not
  // prove it is applied where it is needed -- measured, by deleting
  // `data-verbatim` from the version line: the paragraph simply moved into the
  // other bucket, satisfied the uppercase rule there, and the screen went back
  // to reading `Vam 0.1.0` with every assertion green. So the real invariant
  // is stated directly, about the string rather than about the markup: a line
  // that begins with the product name must paint it the way the product is
  // spelled.
  const brandLines = sentences.all.filter((row) => /^vam\b/i.test(row.text));
  brandStarts += brandLines.length;
  const capitalisedBrand = brandLines.filter((row) => row.first !== 'none');
  if (capitalisedBrand.length > 0) {
    throw new Error(
      `[${sectionId}] the product name is capitalised in ${JSON.stringify(capitalisedBrand.map((r) => r.text.slice(0, 32)))}`,
    );
  }

  // THE HEADING NAMES THE SECTION THE NAV NAMES. Before this the nav said
  // "Appearance" and the panel beside it said "appearance" -- the same
  // destination, spelled two ways, one of them a raw id. By id again, for the
  // same reason as above: `:not([hidden])` would find `interface`'s own
  // heading here on every iteration once every card is open at once.
  const agree = await page.evaluate((id) => {
    const heading = document.querySelector(`[data-settings-panel="${id}"] [data-settings-heading]`);
    const tab = document.querySelector(`[data-settings-nav-item="${id}"]`);
    return {
      heading: (heading?.textContent ?? '').trim(),
      tab: (tab?.textContent ?? '').trim(),
    };
  }, sectionId);
  console.log(`  heading vs tab: ${JSON.stringify(agree)}`);
  if (agree.heading !== agree.tab || agree.heading === '') {
    throw new Error(`the panel heading ${JSON.stringify(agree.heading)} is not the tab's ${JSON.stringify(agree.tab)}`);
  }

  await page.screenshot({ path: `${outDir}/settings-case-${sectionId}.png` });
  console.log(`${outDir}/settings-case-${sectionId}.png`);
  }
  console.log(`  swept: ${JSON.stringify(seen)}, ${brandStarts} line(s) start with the product name`);
  // THE CORPUS FOR THE BRAND CHECK. Zero of them and the loop above is a loop
  // over nothing -- which is precisely how it would read on the day somebody
  // rewrote the Update copy to avoid the problem instead of fixing it.
  if (brandStarts === 0) {
    throw new Error('no settings line starts with the product name, so its case is untested');
  }
  // ONE HEADING PER SECTION, and enough rows and names across the four that a
  // panel which quietly stopped drawing them cannot pass this by drawing
  // nothing. Literals rather than `> 0`: that is the difference between a
  // corpus and a pulse.
  if (seen.headings !== sectionIds.length) {
    throw new Error(`${seen.headings} headings over ${sectionIds.length} sections`);
  }
  if (seen.descriptions < 50) {
    throw new Error(`the keyboard list drew ${seen.descriptions} rows, so its rank is untested`);
  }
  // `properNames` has a floor of its own for the reason every other rank here
  // does: "no proper name is transformed" over zero proper names is the same
  // sentence as "there are none", and the twelve terminal themes are exactly
  // the corpus that rule exists for. Floors measured against the real build
  // over all ten sections (30/35/61/18 today), each left headroom below the
  // measured count rather than pinned to it.
  if (seen.labels < 20 || seen.hints < 25 || seen.controls < 40 || seen.properNames < 14) {
    throw new Error(`the sweep found too little to be about the surface: ${JSON.stringify(seen)}`);
  }
  await page.close();
}

// ---------------------------------------------------------------- ITEM 5.
// EVERY BUTTON ON THE SURFACE, AND HOW MANY SHAPES THEY COME IN.
//
// Operator: "review the UI of the buttons in settings." What a review needs
// first is a census, and this is it.
//
// WHAT THE REVIEW FOUND IS NOT WHAT THIS CAN SEE, and the distinction is worth
// keeping. The outlier was the Remote panel's actions -- an unconditional
// `min-h-[44px]`, the PHONE's touch floor, drawing 44px tall in a dialog where
// every other control is 28. This guard cannot reach them: the Remote panel
// needs `window.api.remote`, a preload bridge, so a browser draws the "no
// bridge" state instead. That one is held by a class assertion in
// `test/settings/pairing-panel.test.tsx`, which says so. What IS below is the
// rest of the surface -- 184 buttons of it over all ten sections now -- pinned
// so the next stray is loud.
//
// A CARD'S OWN HEADER AND AN ADVANCED FOLD'S TOGGLE ARE A DIFFERENT SHAPE OF
// CONTROL, and are excluded rather than forced into one of the ranks below
// (both carry `aria-expanded`, which nothing else on this surface does): a
// full-bleed disclosure row was never a candidate for "one of three pill
// heights" and pretending otherwise would be the vacuous version of this
// census, not a stricter one.
//
// THE RANKS ARE PINNED, NOT COUNTED. Three heights and one radius, each with
// a reason, and a fourth shape has to be argued for rather than merely typed.
// A "they should all match" assertion would be false -- a 24px stepper icon
// and a 26px keycap in a list of seventy are deliberate -- and a "count the
// distinct values" one would pass on any two wrongs.
console.log('\n=== the settings button census');
{
  const page = await openSettings(1100, 800);
  const sectionIds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-settings-nav-item]')].map((el) =>
      el.getAttribute('data-settings-nav-item'),
    ),
  );
  /** height -> what it is for. Anything else is a new rank, and reddens. */
  const RANKS = {
    24: 'a stepper icon, inside its own field',
    26: 'a key slot, in a list of seventy',
    28: 'everything else on this surface',
  };
  const seenRanks = new Map();
  const strays = [];
  let counted = 0;
  for (const sectionId of sectionIds) {
    await page.locator(`[data-settings-nav-item="${sectionId}"]`).click();
    await page.waitForTimeout(120);
    // OPEN EVERY ADVANCED FOLD THIS CARD HAS, before measuring. A closed
    // fold's own buttons (the colour grid's per-token resets, the bulk reset,
    // the streaming switch) sit in a `hidden` subtree, where
    // `getBoundingClientRect` reports all zeroes regardless of what is
    // actually drawn once opened -- not absence, just unmeasured, and this
    // census is about what IS painted.
    const advanced = page.locator(`[data-settings-advanced="${sectionId}"]`);
    if ((await advanced.count()) === 1 && (await advanced.getAttribute('aria-expanded')) !== 'true') {
      await advanced.click();
      await page.waitForTimeout(120);
    }
    const rows = await page.evaluate((id) => {
      const panel = document.querySelector(`[data-settings-panel="${id}"]`);
      return [...(panel?.querySelectorAll('button') ?? [])]
        // A DISCLOSURE HEADER IS A DIFFERENT SHAPE OF CONTROL, on purpose: a
        // card's own header (`SettingsCard`) and the Advanced fold's toggle
        // (`AdvancedDisclosure`) are full-bleed rows that open something,
        // not a rounded pill sized to a value -- the one shape this rank
        // ladder is about. Both carry `aria-expanded`, which nothing else on
        // this surface does, so it is what tells them apart here.
        .filter((el) => !el.hasAttribute('aria-expanded'))
        .map((el) => {
          const box = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            text: (el.textContent ?? '').trim().slice(0, 24) || (el.getAttribute('aria-label') ?? '?'),
            height: Math.round(box.height),
            radius: cs.borderTopLeftRadius,
          };
        });
    }, sectionId);
    for (const row of rows) {
      counted += 1;
      seenRanks.set(row.height, (seenRanks.get(row.height) ?? 0) + 1);
      if (RANKS[row.height] === undefined) {
        strays.push(`[${sectionId}] ${JSON.stringify(row.text)} is ${row.height}px`);
      }
      // ONE RADIUS. The surface carried two (4px and 6px) with no argument for
      // either, so the dominant one won and this is what keeps a third from
      // arriving unnoticed.
      if (row.radius !== '4px') {
        strays.push(`[${sectionId}] ${JSON.stringify(row.text)} has a ${row.radius} radius`);
      }
    }
  }
  console.log(`  ${counted} buttons, heights: ${JSON.stringify(Object.fromEntries(seenRanks))}`);
  // THE CORPUS FIRST. The keyboard section alone draws over a hundred, so a
  // sweep that found a handful found the wrong thing.
  if (counted < 100) {
    throw new Error(`the census found ${counted} buttons, so it is about nothing`);
  }
  if (strays.length > 0) {
    throw new Error(
      `${strays.length} button(s) outside the ranks:\n  - ${strays.slice(0, 8).join('\n  - ')}`,
    );
  }
  await page.close();
}

// ---------------------------------------------------------------- ITEM 6.
// A SWITCH THAT LOOKS LIKE ONE.
//
// Operator: "turn some of the settings buttons into a toggle UI." Focus view
// was already `role="switch"` with an `aria-checked` -- a switch to a screen
// reader and a bordered word to everybody else -- so the whole of this change
// is PAINT, and paint is the one thing a unit test cannot see. A `.tsx` file
// reading `left-[17px]` proves somebody typed it; this asks the browser where
// the knob actually is, in both states.
//
// AND WCAG 1.4.11, which is what a switch has instead of text contrast: the
// parts that carry the state -- the track's boundary against the panel, and
// the knob against its track -- have to clear 3:1, or the state is legible
// only to someone who already knows where to look.
//
// IT IS IN BEHAVIOUR NOW, WHICH IS WHY THIS BLOCK NAVIGATES. The overlay opens
// on Appearance, and focus view moved out of it with the look/behaviour split.
// Every panel stays MOUNTED, so the selector below kept matching -- and a
// Playwright `.click()` on an element inside a `hidden` subtree waits for
// visibility and times out, which is how this guard reported the move. The
// navigation is the fix and the timeout was the evidence; nothing else in this
// block changed.
console.log('\n=== the behaviour section’s switch');
{
  const page = await openSettings(1100, 800);
  await page.locator('[data-settings-nav-item="behaviour"]').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const chan = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const parts = (colour) => colour.match(/[\d.]+/g).map(Number);
    const opaque = (colour) => /^rgb\(\s*\d/.test(colour);
    const lum = (colour) => {
      const [r, g, b] = parts(colour);
      return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)];
      const [hi, lo] = x > y ? [x, y] : [y, x];
      return (hi + 0.05) / (lo + 0.05);
    };
    const ground = (el) => {
      let node = el?.parentElement ?? null;
      while (node !== null) {
        const colour = getComputedStyle(node).backgroundColor;
        if (opaque(colour)) return colour;
        node = node.parentElement;
      }
      return null;
    };
    window.vamSwitch = { opaque, ratio, ground };
  });

  const readSwitch = () =>
    page.evaluate(() => {
      const { opaque, ratio, ground } = window.vamSwitch;
      const control = document.querySelector('[data-switch="focus-view"]');
      if (control === null) return null;
      const track = control.querySelector('[data-switch-track]');
      const knob = control.querySelector('[data-switch-knob]');
      const box = control.getBoundingClientRect();
      const trackBox = track.getBoundingClientRect();
      const knobBox = knob.getBoundingClientRect();
      const trackFill = getComputedStyle(track).backgroundColor;
      const trackEdge = getComputedStyle(track).borderTopColor;
      const knobFill = getComputedStyle(knob).backgroundColor;
      return {
        checked: control.getAttribute('aria-checked'),
        word: (control.textContent ?? '').trim(),
        hit: { w: box.width, h: box.height },
        track: { w: trackBox.width, h: trackBox.height },
        knob: { w: knobBox.width, h: knobBox.height, at: knobBox.left - trackBox.left },
        opaque: opaque(trackFill) && opaque(trackEdge) && opaque(knobFill),
        edgeVsPanel: ratio(trackEdge, ground(track)),
        knobVsTrack: ratio(knobFill, trackFill),
      };
    });

  const off = await readSwitch();
  if (off === null) throw new Error('the behaviour section draws no switch at all');
  await page.locator('[data-switch="focus-view"]').click();
  await page.waitForTimeout(250);
  const on = await readSwitch();
  console.log(`  off: ${JSON.stringify(off)}`);
  console.log(`  on:  ${JSON.stringify(on)}`);

  if (off.checked !== 'false' || on.checked !== 'true') {
    throw new Error(`the switch did not change state: ${off.checked} -> ${on.checked}`);
  }
  // THE TRAVEL IS THE STATE. A knob that moved a pixel or two would satisfy
  // "it moved" while reading identical at arm's length, so the floor is a
  // whole knob's width.
  const travel = on.knob.at - off.knob.at;
  console.log(`  the knob travels ${Math.round(travel)}px in a ${Math.round(off.track.w)}px track`);
  if (travel < off.knob.w) {
    throw new Error(`the knob moved ${travel}px, less than its own ${off.knob.w}px width`);
  }
  if (off.track.w < 28 || off.track.h < 16 || off.knob.w < 10) {
    throw new Error(`the switch is drawn too small to read: ${JSON.stringify(off)}`);
  }
  // 24px is the desktop target floor this repo already holds elsewhere.
  if (off.hit.h < 24 || off.hit.w < 24) {
    throw new Error(`the switch answers across ${off.hit.w}x${off.hit.h}`);
  }
  for (const state of [off, on]) {
    if (!state.opaque) {
      throw new Error('a part of the switch paints nothing, so its contrast is unmeasured');
    }
    if (state.edgeVsPanel < 3) {
      throw new Error(`the track's edge is ${state.edgeVsPanel.toFixed(2)}:1 against the panel`);
    }
    if (state.knobVsTrack < 3) {
      throw new Error(`the knob is ${state.knobVsTrack.toFixed(2)}:1 against its track`);
    }
  }
  if (off.word === on.word) {
    throw new Error(`both states read "${off.word}", so the word says nothing`);
  }
  await page.screenshot({ path: `${outDir}/settings-switch.png` });
  console.log(`${outDir}/settings-switch.png`);
  await page.close();
}

// ---------------------------------------------------------------- ITEM 7.
// THE INLINE ROW SPLIT, AS PAINT.
//
// Operator: "Orca's rows put the label and its muted description on the
// LEFT and the CONTROL on the RIGHT, on the same line." `primitives.tsx`'s
// `SettingsRow` answers with a `layout` prop and an `@container` split --
// this is the browser measurement that split was always going to need,
// since a class name is a claim about markup and a `@min-[440px]:flex-row`
// rule is a claim jsdom cannot see at all (it applies no stylesheet and
// resolves no container query).
//
// THREE CLAIMS, NONE OF THEM HELD BY `data-settings-row-layout` ALONE (that
// attribute is the CONTRACT `primitives.test.tsx` already holds; this is
// whether the CSS keyed to it actually paints):
//  1. WIDE, AN INLINE ROW'S LABEL AND CONTROL SHARE A LINE -- their boxes
//     overlap vertically, and the control sits to the label's right with a
//     real gap between them, not on top of it.
//  2. NARROW (520px, the desktop floor), THE SAME ROW FALLS BACK TO STACKED
//     -- the control's box is entirely BELOW the label's, not beside it,
//     which is the one thing the container query is FOR.
//  3. A `layout="stacked"` ROW (the Templates grid) never takes the inline
//     split, wide or narrow -- its own control is always under its label,
//     and it is drawn across the row's own full width rather than squeezed
//     into a right-hand column that was never given to it.
console.log("\n=== the inline row split (Orca's shape), as paint");
{
  /** The row wrapping a control, and whether it is a real box at all. */
  async function rowBoxes(page, controlSelector) {
    return page.evaluate((sel) => {
      const control = document.querySelector(sel);
      const row = control?.closest('[role="group"]') ?? null;
      const label = row?.querySelector('h4') ?? null;
      if (control === null || row === null || label === null) return null;
      return {
        layout: row.getAttribute('data-settings-row-layout'),
        row: row.getBoundingClientRect().toJSON(),
        label: label.getBoundingClientRect().toJSON(),
        control: control.getBoundingClientRect().toJSON(),
      };
    }, controlSelector);
  }

  /** Two boxes share a line: their vertical spans overlap by a real amount,
   *  not by a stray rounding pixel. */
  const overlapsVertically = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 8;

  for (const width of [1100, 520]) {
    const page = await openSettings(width, 900);
    await page.locator('[data-settings-nav-item="behaviour"]').click();
    await page.waitForTimeout(150);
    const focusView = await rowBoxes(page, '[data-switch="focus-view"]');
    if (focusView === null) {
      throw new Error(`${width}px: the focus view row is missing a label, a control, or its own group`);
    }
    if (focusView.layout !== 'inline') {
      throw new Error(`${width}px: the focus view row is not marked layout="inline": ${focusView.layout}`);
    }
    if (width === 1100) {
      console.log(
        `  ${width}px: label ${JSON.stringify(focusView.label)}, control ${JSON.stringify(focusView.control)}`,
      );
      if (!overlapsVertically(focusView.label, focusView.control)) {
        throw new Error(
          `${width}px: focus view's label and control do not share a line: ${JSON.stringify(focusView)}`,
        );
      }
      if (focusView.control.left <= focusView.label.right) {
        throw new Error(
          `${width}px: focus view's control (left ${focusView.control.left}) does not sit clear to the right of its label (right ${focusView.label.right})`,
        );
      }
      // RIGHT-ALIGNED, not merely to the right of the label -- Orca's own
      // shape puts the control at the row's own right edge.
      if (focusView.row.right - focusView.control.right > 4) {
        throw new Error(
          `${width}px: focus view's control sits ${(focusView.row.right - focusView.control.right).toFixed(1)}px short of the row's own right edge`,
        );
      }
    } else {
      // NARROW: the fallback. The control is entirely under the label now,
      // not beside it -- the one property a container query either has or
      // does not.
      if (overlapsVertically(focusView.label, focusView.control)) {
        throw new Error(
          `${width}px: focus view's label and control still share a line at the narrow floor: ${JSON.stringify(focusView)}`,
        );
      }
      if (focusView.control.top < focusView.label.bottom) {
        throw new Error(
          `${width}px: focus view's control (top ${focusView.control.top}) is not below its label (bottom ${focusView.label.bottom}) at the narrow floor`,
        );
      }
    }
    await page.close();
  }

  // AND A `layout="stacked"` ROW NEVER TAKES THE SPLIT, wide or narrow --
  // Templates is the row this file's own case-ladder sweep already reads
  // labels and controls off, so this reuses the same corpus rather than
  // inventing a second one.
  for (const width of [1100, 520]) {
    const page = await openSettings(width, 900);
    const templates = await rowBoxes(page, '[data-palette-template]');
    if (templates === null) {
      throw new Error(`${width}px: the templates row is missing a label, a control, or its own group`);
    }
    if (templates.layout !== 'stacked') {
      throw new Error(`${width}px: the templates row is not marked layout="stacked": ${templates.layout}`);
    }
    if (overlapsVertically(templates.label, templates.control)) {
      throw new Error(
        `${width}px: the templates row's control shares a line with its label -- a stacked row took the inline split: ${JSON.stringify(templates)}`,
      );
    }
    // WIDE, ACROSS THE ROW -- not squeezed into a column that was never
    // built for it. The first template chip's own left edge should still
    // sit at the row's own left edge (both flush), unlike an inline row's
    // control, which sits at the row's right edge instead.
    if (templates.control.left - templates.row.left > 4) {
      throw new Error(
        `${width}px: the templates grid starts ${(templates.control.left - templates.row.left).toFixed(1)}px in from the row's own left edge`,
      );
    }
    await page.close();
  }
  console.log(
    '  every inline row shares a line wide and stacks narrow; a stacked row never takes the split',
  );
}

await browser.close();
console.log('settings chrome: the narrow nav is named at every width, the Remote button paints, the case ladder holds, and the switch reads as one.');
