/**
 * THE SHORTCUT SYMBOLS, AS CHROMIUM REALLY PAINTS THEM — on both platforms.
 *
 * The operator, translated: "show shortcut keys in settings and in the
 * tooltips as symbols — `Mod` should show the ⌘ icon if macOS. On Windows show
 * `Ctrl`." `chordSymbols` does that, and `test/keyboard/chord-symbols.test.ts`
 * holds the strings it returns.
 *
 * ── WHY A REAL BROWSER, FOR A FUNCTION THAT RETURNS A STRING ──────────────
 *
 *  1. A GLYPH THAT RENDERS AS A TOFU BOX PASSES EVERY UNIT TEST. `⌘` in a
 *     `textContent` assertion is four bytes either way; whether the face in
 *     front of the operator has a glyph for it is a question only a font stack
 *     can answer, and the answer is a WIDTH. The notdef box every engine
 *     substitutes has one advance, and an unassigned plane-16 code point is
 *     guaranteed to produce it — so the glyphs are measured against that.
 *
 *  2. THE PLATFORM IS READ AT RUNTIME, WHICH IS A PROPERTY OF THE BUNDLE.
 *     `build:web` is served over Tailscale to whatever machine picks it up, so
 *     ONE bundle has to paint ⌘ for a Mac and `Ctrl` for a PC. Nothing in a
 *     unit run proves that survives a build: a constant folded at build time
 *     would be invisible to every test in this repo and wrong on half the
 *     machines vam is served to. Here the page is loaded twice, with
 *     `navigator.platform` overridden before any module runs, and the SHIPPED
 *     bundle is asked both questions.
 *
 *  3. THE SETTINGS SLOT IS A RECTANGLE. The floor under the two key columns is
 *     a constant sized for the widest chord, and the symbols moved that number
 *     in both directions — ⇧⌘[ is three characters, `Ctrl+Shift+[` is twelve,
 *     one MORE than the token the column was last sized for. Whether the ink
 *     still fits the box, on one line, is a layout fact; happy-dom measures no
 *     text at all.
 *
 * THE TOFU CHECK RUNS FOR THE HOST'S OWN BRANCH, and that is deliberate rather
 * than lazy: the Apple glyphs are only ever painted on an Apple machine, so
 * whether ubuntu has a face for ⎋ is a question about a screen no operator
 * will ever see. Both branches are asserted as TEXT everywhere; the host's is
 * additionally asserted as INK.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/chord-symbol-shots.mjs http://localhost:5527 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5527';
const outDir = process.argv[3] ?? 'docs/ui';

/** What each platform reports, and what it must then paint. */
const PLATFORMS = [
  {
    name: 'mac',
    platform: 'MacIntel',
    /** `palette` holds `Mod-k`; `newProject` holds `Mod-Shift-p`. */
    palette: '⌘ K',
    newProject: '⇧ ⌘ P',
    /** `pickView:1`, a real Control chord on every platform. */
    pickView: '⌃ ⌥ 1',
    /** Apple's own set, plus the named keys this sheet draws. */
    glyphs: ['⌘', '⇧', '⌥', '⌃', '⏎', '⎋', '⇥'],
    native: process.platform === 'darwin',
  },
  {
    name: 'pc',
    platform: 'Win32',
    palette: 'Ctrl+K',
    newProject: 'Ctrl+Shift+P',
    pickView: 'Ctrl+Alt+1',
    glyphs: [],
    native: process.platform !== 'darwin',
  },
];

const browser = await chromium.launch();
const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/** Wait for `condition` to hold in the page, up to two seconds. */
async function settle(page, condition, label) {
  try {
    await page.waitForFunction(condition, undefined, { timeout: 2_000 });
    return true;
  } catch {
    check(label, false, 'never became true');
    return false;
  }
}

for (const each of PLATFORMS) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  // BEFORE ANY MODULE RUNS. `applePlatform()` reads `navigator.platform` at the
  // moment of a paint, so this has to be in place before React mounts — an
  // `evaluate` after `goto` would measure a screen painted for the host.
  await page.addInitScript((description) => {
    Object.defineProperty(navigator, 'platform', {
      value: description,
      configurable: true,
    });
  }, each.platform);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]');

  console.log(`\n── ${each.name} (navigator.platform = ${each.platform})`);
  const reads = await page.evaluate(() => navigator.platform);
  check(`${each.name}: the page reports the platform it was given`, reads === each.platform, reads);

  /* ── THE KEY SHEET ──────────────────────────────────────────────────── */
  await page.keyboard.press('?');
  const sheetOpen = await settle(
    page,
    () => document.querySelector('[data-key-sheet]') !== null,
    `${each.name}: the key sheet opens`,
  );

  if (sheetOpen) {
    const sheet = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('[data-key-sheet-keys]')];
      const boxes = chips.map((chip) => chip.getBoundingClientRect());
      return {
        count: chips.length,
        keys: chips.map((chip) => chip.textContent ?? ''),
        // PAINTED, not present: a chip with a zero box is a chord nobody can
        // read, and every assertion below would be green over one.
        unpainted: boxes.filter((box) => box.width <= 0 || box.height <= 0).length,
      };
    });
    console.log(`${each.name}: ${sheet.count} chords on the sheet`);
    // A CORPUS, OR EVERY LINE BELOW IS VACUOUS.
    check(
      `${each.name}: the sheet drew a real corpus of chords`,
      sheet.count > 40,
      `only ${sheet.count}`,
    );
    check(
      `${each.name}: every chord chip has a box`,
      sheet.unpainted === 0,
      `${sheet.unpainted} chips painted nothing`,
    );
    check(
      `${each.name}: no internal token reaches the sheet`,
      sheet.keys.every((keys) => !keys.includes('Mod-')),
      sheet.keys.filter((keys) => keys.includes('Mod-')).join(', '),
    );
    check(
      `${each.name}: the palette chord reads ${each.palette}`,
      sheet.keys.includes(each.palette),
      sheet.keys.join(' '),
    );
    check(
      `${each.name}: the new-project chord reads ${each.newProject}`,
      sheet.keys.includes(each.newProject),
      sheet.keys.join(' '),
    );
    // THE TRAP, MEASURED ON THE SCREEN: `Ctrl-Alt-1` is a real Control chord,
    // and on a Mac it must be ⌃⌥1 — never the command key.
    check(
      `${each.name}: the view chord reads ${each.pickView}`,
      sheet.keys.includes(each.pickView),
      sheet.keys.join(' '),
    );
    if (each.name === 'mac') {
      // `Ctrl-Alt-<digit>` is a REAL Control chord on every platform
      // (`CTRL_GESTURES`), so on a Mac it must wear ⌃ and never ⌘. `⌥⌘[` is
      // not a counter-example and must not be swept in: `Mod-Alt-[` really
      // does hold Option AND Command.
      const control = sheet.keys.filter((keys) => keys.includes('⌃'));
      check(
        'mac: a Control chord carries no ⌘',
        control.length > 0 && control.every((keys) => !keys.includes('⌘')),
        `${control.length} control chords: ${control.join(' ')}`,
      );
      // The vim keys are the family this rendering must NOT touch.
      check('mac: a prefix chord is untouched', sheet.keys.includes('gt'), sheet.keys.join(' '));
    }

    /* ── THE GLYPHS AS INK ────────────────────────────────────────────── */
    //
    // RASTERISED, NOT MEASURED — and the measured version of this check was
    // written first and was VACUOUS. In a monospace face every character has
    // the same advance, the notdef box included, so `measureText` returned
    // 7.22px for ⌘ and 7.22px for a code point no font on earth has: the
    // comparison could not fail. What tells them apart is the PICTURE. Every
    // engine draws one notdef box, so a glyph whose pixels are identical to
    // the guaranteed-notdef character's IS that box, and a glyph with no
    // pixels at all is the other way a face declines to draw one.
    if (each.native && each.glyphs.length > 0) {
      const ink = await page.evaluate((glyphs) => {
        const chip = document.querySelector('[data-key-sheet-keys]');
        const face = getComputedStyle(chip).font.replace(/\b\d+(\.\d+)?px\b/, '32px');
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const draw = (text) => {
          ctx.clearRect(0, 0, 64, 64);
          ctx.font = face;
          ctx.fillStyle = '#000';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, 8, 32);
          const pixels = ctx.getImageData(0, 0, 64, 64).data;
          let lit = 0;
          for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] > 8) lit += 1;
          }
          return { lit, bytes: [...pixels].join(',') };
        };
        // A PLANE-16 PRIVATE-USE CODE POINT: unassigned, and no font has a
        // glyph for it, so what it draws IS this engine's notdef box.
        const notdef = draw('\u{10FFFD}');
        return {
          face,
          notdefLit: notdef.lit,
          glyphs: glyphs.map((glyph) => {
            const drawn = draw(glyph);
            return { glyph, lit: drawn.lit, tofu: drawn.bytes === notdef.bytes };
          }),
        };
      }, each.glyphs);
      console.log(`${each.name}: face ${ink.face}, notdef box ${ink.notdefLit} lit pixels`);
      // The detector has to be able to FIND a tofu, or it proves nothing about
      // the glyphs it clears.
      check(
        `${each.name}: the notdef box is itself drawn`,
        ink.notdefLit > 0,
        'nothing to compare against',
      );
      for (const { glyph, lit, tofu } of ink.glyphs) {
        check(
          `${each.name}: ${glyph} has a real glyph (${lit} lit pixels)`,
          lit > 0 && !tofu,
          tofu ? 'the face drew the notdef box' : 'the face drew nothing at all',
        );
      }
    }

    await page.screenshot({ path: `${outDir}/chord-symbols-sheet-${each.name}.png` });
    console.log(`${outDir}/chord-symbols-sheet-${each.name}.png`);
    await page.keyboard.press('Escape');
    await settle(
      page,
      () => document.querySelector('[data-key-sheet]') === null,
      `${each.name}: the sheet closes again`,
    );
  }

  /* ── A TOOLTIP ──────────────────────────────────────────────────────── */
  // The sidebar's "new session" button names two chords, one of which carries
  // the command modifier. Hovered for real, because a tooltip is a portal and
  // exists in no DOM until something opens it.
  const newSession = page.locator('[aria-label="new session"]').first();
  if ((await newSession.count()) > 0) {
    await newSession.hover();
    const tipUp = await settle(
      page,
      () => document.querySelector('[role="tooltip"]') !== null,
      `${each.name}: the tooltip opens on hover`,
    );
    if (tipUp) {
      const tip = await page.evaluate(() => {
        const box = document.querySelector('[role="tooltip"]');
        const chip = box?.querySelector('[data-tip-keys]');
        const rect = chip?.getBoundingClientRect();
        return {
          text: box?.textContent ?? '',
          chip: chip?.textContent ?? '',
          painted: rect !== undefined && rect.width > 0 && rect.height > 0,
        };
      });
      console.log(`${each.name}: tooltip "${tip.text}"`);
      check(
        `${each.name}: the tooltip paints its chord`,
        tip.painted && tip.chip !== '',
        JSON.stringify(tip),
      );
      check(
        `${each.name}: and names it in symbols rather than tokens`,
        !tip.text.includes('Mod-'),
        tip.text,
      );
      await page.screenshot({ path: `${outDir}/chord-symbols-tooltip-${each.name}.png` });
      console.log(`${outDir}/chord-symbols-tooltip-${each.name}.png`);
    }
  }

  /* ── SETTINGS, AND THE COLUMN THE SYMBOLS RESIZED ───────────────────── */
  await page.keyboard.press('Escape');
  await page.keyboard.press(',');
  const settingsOpen = await settle(
    page,
    () => document.querySelector('[data-settings-overlay]') !== null,
    `${each.name}: the settings overlay opens`,
  );
  if (settingsOpen) {
    await page.locator('[data-settings-nav-item="keyboard"]').click();
    await page.waitForSelector('[data-binding-slot]', { timeout: 5_000 });
    const slots = await page.evaluate(() => {
      // `ChordGlyphs` paints a slot's chord as several sibling nodes now — a
      // `font-sans` span per Apple glyph segment, plain text beside it —
      // rather than the one flat string this range used to hold before the
      // Keyboard settings rows were routed through it too. A `Range` gives
      // back one rect PER NODE'S OWN fragment, so a chord that never wraps
      // at all now reports several rects: one physical line read as several.
      // Grouped by `top`, which recovers the count this measurement always
      // meant — same-line fragments differ by at most ~1px (the sans span's
      // own ascent against the mono text beside it, measured live), a real
      // wrap by a full line-height (14-15px at this size), so a 4px
      // tolerance tells the two apart without being tuned to either font.
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
          width: Math.max(...g.rects.map((r) => r.right)) - Math.min(...g.rects.map((r) => r.left)),
        }));
      };
      const rows = [];
      for (const slot of document.querySelectorAll('[data-binding-slot]')) {
        const kbd = slot.querySelector('[data-settings-keys]');
        if (kbd === null) continue;
        const range = document.createRange();
        range.selectNodeContents(kbd);
        const boxLines = visualLines([...range.getClientRects()]);
        rows.push({
          keys: (kbd.textContent ?? '').trim(),
          name: slot.getAttribute('aria-label') ?? '',
          inkW: Math.max(...boxLines.map((l) => l.width), 0),
          lines: boxLines.length,
          innerW: slot.clientWidth,
          scrollW: slot.scrollWidth,
          left: slot.getBoundingClientRect().left,
        });
      }
      return rows;
    });
    check(
      `${each.name}: the shortcut list drew a real corpus`,
      slots.length > 40,
      `only ${slots.length} slots`,
    );
    const widest = slots.reduce((a, b) => (a.inkW >= b.inkW ? a : b), { inkW: 0, keys: '' });
    console.log(
      `${each.name}: ${slots.length} slots, widest ${widest.keys} at ${widest.inkW.toFixed(2)}px in a ${widest.innerW}px box`,
    );
    check(
      `${each.name}: no slot spells a token`,
      slots.every((slot) => !slot.keys.includes('Mod-')),
      slots
        .filter((slot) => slot.keys.includes('Mod-'))
        .map((slot) => slot.keys)
        .join(', '),
    );
    // ONE LINE, AND INSIDE ITS BOX. The 26px slot cannot show a second line,
    // and `Ctrl+Shift+[` is the longest rendering in the shipped tables — the
    // one the floor was raised to 112px for.
    check(
      `${each.name}: every chord is on one line`,
      slots.every((slot) => slot.lines === 1),
      slots
        .filter((slot) => slot.lines !== 1)
        .map((slot) => slot.keys)
        .join(', '),
    );
    check(
      `${each.name}: no chord spills out of its slot`,
      slots.every((slot) => slot.scrollW <= slot.innerW + 1),
      slots
        .filter((slot) => slot.scrollW > slot.innerW + 1)
        .map((slot) => `${slot.keys} ${slot.scrollW}>${slot.innerW}`)
        .join(', '),
    );
    // AND THE COLUMN IS STILL A COLUMN: every first slot on one x. That is
    // what the floor buys, and the widest rendering is what could break it.
    const lefts = [...new Set(slots.map((slot) => Math.round(slot.left)))];
    check(
      `${each.name}: the key slots hold two x down the whole list`,
      lefts.length <= 2,
      `${lefts.length} distinct x: ${lefts.join(', ')}`,
    );
    // The accessible name carries the same rendering as the face.
    const named = slots.filter((slot) => slot.name.startsWith(`${slot.keys},`));
    check(
      `${each.name}: every slot announces what it paints`,
      named.length === slots.length,
      `${slots.length - named.length} slots announce something else`,
    );
    await page.screenshot({ path: `${outDir}/chord-symbols-settings-${each.name}.png` });
    console.log(`${outDir}/chord-symbols-settings-${each.name}.png`);
  }

  /* ── THE ROW ITSELF, AND THE REBINDING EDITOR BESIDE IT ──────────────
   *
   * #482 measured the key sheet's ⇧ against the Send key option and missed
   * this list: `BindingLine` (`SettingsOverlay.tsx`) painted `chordSymbols`
   * as a flat string inside a `font-mono` slot, so its own ⌘/⇧ never got the
   * sans-stack span every other chip did — the exact defect the operator
   * reported a second time ("they still aren't consistent"). Measured the
   * same way here, on both states the operator asked to recheck: the
   * ordinary list, and the rebinding editor mid-capture — arming ONE slot
   * swaps it for an input; its neighbours keep painting theirs, which is
   * what stays on screen while a rebind is in progress.
   */
  let keyboardRowGlyph = null;
  let keyboardRowGlyphArmed = null;
  if (settingsOpen && each.name === 'mac') {
    const glyphInSlot = async (id, glyph) =>
      page.evaluate(
        ({ rowId, target }) => {
          const glyphRect = (root, needle) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              const idx = node.textContent.indexOf(needle);
              if (idx !== -1) {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + 1);
                const rect = range.getBoundingClientRect();
                return {
                  fontFamily: getComputedStyle(node.parentElement).fontFamily,
                  height: rect.height,
                };
              }
            }
            return null;
          };
          const slot = document.querySelector(
            `[data-binding-slot="${rowId}:0"] [data-settings-keys]`,
          );
          return slot === null ? null : glyphRect(slot, target);
        },
        { rowId: id, target: glyph },
      );

    // `newProject` ships `Mod-Shift-p` — ⇧⌘P — so the SAME glyph (⇧) this
    // section compares below is what gets measured, rather than a different
    // Apple symbol whose glyph shape could account for its own sub-pixel
    // height difference.
    keyboardRowGlyph = await glyphInSlot('newProject', '⇧');
    // Arm a DIFFERENT row (`palette`) — the rebinding editor — and
    // re-measure `newProject`, which stays on screen, unarmed, right beside
    // it.
    await page.locator('[data-binding-slot="palette:0"]').click();
    const armed = await settle(
      page,
      () => document.querySelector('[data-binding-capture]') !== null,
      `${each.name}: the rebinding editor arms`,
    );
    if (armed) {
      keyboardRowGlyphArmed = await glyphInSlot('newProject', '⇧');
    }
    await page.keyboard.press('Escape');
    await settle(
      page,
      () => document.querySelector('[data-binding-capture]') === null,
      `${each.name}: the rebinding editor cancels`,
    );
  }

  /* ── THE SEND KEY OPTION'S ⇧, AGAINST A CHIP THAT SHARES IT ─────────────
   *
   * The operator's ask: the Shift/Command/Option/Control symbols must look
   * like the Send Key option EVERYWHERE, and a real Chromium measurement
   * (`docs/design/ref/send-key-reference.png` beside it) found why they did
   * not — `font-mono` (every other chip) draws a noticeably narrower ⌘/⇧
   * than `font-sans` (the Send key option's own ambient font) at the same
   * size. `ChordGlyphs` now wraps a Mac glyph segment in the sans stack
   * (`chords.ts`'s `chordSegments`, tagged `glyph: true`); this pins that a
   * ⇧ painted through it elsewhere is pixel-identical to the reference.
   *
   * NO SHIPPED TOOLTIP CARRIES A SHIFT-BOUND CHORD TO HOVER — every
   * `ShortcutTip` wired to a live action reaches for `o`, `Mod-n`,
   * `Ctrl-Alt-<digit>`, a bare letter or `Mod-w`, never a `Shift-` token, so
   * there is no `[data-tip-keys]` chip holding a ⇧ to measure. The key
   * sheet's own `⇧ ⌘ P` row (`newProject`) is the next best thing: the SAME
   * `ChordGlyphs` paints it, at the SAME `text-control` (12px) size the Send
   * key option uses, so the comparison needs no size-driven tolerance beyond
   * sub-pixel rounding.
   */
  if (each.name === 'mac') {
    // Settings is still open from the section above (still on "keyboard"),
    // and `?` typed into a modal does not reach the global listener.
    await page.keyboard.press('Escape');
    await settle(
      page,
      () => document.querySelector('[data-settings-overlay]') === null,
      `${each.name}: settings closes before the ⇧ comparison`,
    );
    await page.keyboard.press('?');
    const sheetForShift = await settle(
      page,
      () => document.querySelector('[data-key-sheet]') !== null,
      `${each.name}: the key sheet reopens for the ⇧ comparison`,
    );
    const sheetGlyph = sheetForShift
      ? await page.evaluate(() => {
          const glyphRect = (root, glyph) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              const idx = node.textContent.indexOf(glyph);
              if (idx !== -1) {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + 1);
                const rect = range.getBoundingClientRect();
                return {
                  fontFamily: getComputedStyle(node.parentElement).fontFamily,
                  height: rect.height,
                };
              }
            }
            return null;
          };
          const row = [...document.querySelectorAll('[data-key-sheet-keys]')].find((el) =>
            (el.textContent ?? '').includes('⇧'),
          );
          return row === undefined ? null : glyphRect(row, '⇧');
        })
      : null;
    await page.keyboard.press('Escape');
    await settle(
      page,
      () => document.querySelector('[data-key-sheet]') === null,
      `${each.name}: the sheet closes again`,
    );

    await page.keyboard.press(',');
    await settle(
      page,
      () => document.querySelector('[data-settings-overlay]') !== null,
      `${each.name}: settings reopens for the Send key comparison`,
    );
    await page.locator('[data-settings-nav-item="sessions"]').click();
    await page.waitForSelector('[data-submit-key-option="shift-enter"]', { timeout: 5_000 });
    const sendKeyGlyph = await page.evaluate(() => {
      const root = document.querySelector('[data-submit-key-option="shift-enter"]');
      if (root === null) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const idx = node.textContent.indexOf('⇧');
        if (idx !== -1) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + 1);
          const rect = range.getBoundingClientRect();
          return { fontFamily: getComputedStyle(node.parentElement).fontFamily, height: rect.height };
        }
      }
      return null;
    });

    check(
      `${each.name}: a chip’s ⇧ (key sheet) shares the Send key option’s computed font-family`,
      sheetGlyph !== null &&
        sendKeyGlyph !== null &&
        sheetGlyph.fontFamily === sendKeyGlyph.fontFamily,
      JSON.stringify({ sheetGlyph, sendKeyGlyph }),
    );
    check(
      `${each.name}: and paints within 1px of the Send key option’s own ⇧ height`,
      sheetGlyph !== null &&
        sendKeyGlyph !== null &&
        Math.abs(sheetGlyph.height - sendKeyGlyph.height) <= 1,
      JSON.stringify({ sheetGlyph, sendKeyGlyph }),
    );
    // THE KEYBOARD SETTINGS ROW, THE SAME TWO QUESTIONS — the operator's own
    // recheck, and the one comparison #482 never ran.
    check(
      `${each.name}: a Keyboard settings row’s ⇧ shares the Send key option’s computed font-family`,
      keyboardRowGlyph !== null &&
        sendKeyGlyph !== null &&
        keyboardRowGlyph.fontFamily === sendKeyGlyph.fontFamily,
      JSON.stringify({ keyboardRowGlyph, sendKeyGlyph }),
    );
    check(
      `${each.name}: and paints within 1px of the Send key option’s own ⇧ height`,
      keyboardRowGlyph !== null &&
        sendKeyGlyph !== null &&
        Math.abs(keyboardRowGlyph.height - sendKeyGlyph.height) <= 1,
      JSON.stringify({ keyboardRowGlyph, sendKeyGlyph }),
    );
    // AND STILL TRUE WITH THE REBINDING EDITOR OPEN BESIDE IT — arming a
    // neighbour's capture box must not be what makes this row's own glyph
    // correct or incorrect.
    check(
      `${each.name}: the row’s ⇧ still matches with the rebinding editor armed beside it`,
      keyboardRowGlyphArmed !== null &&
        sendKeyGlyph !== null &&
        keyboardRowGlyphArmed.fontFamily === sendKeyGlyph.fontFamily &&
        Math.abs(keyboardRowGlyphArmed.height - sendKeyGlyph.height) <= 1,
      JSON.stringify({ keyboardRowGlyphArmed, sendKeyGlyph }),
    );
  }

  /* ── TWO MORE TIGHT SITES, NOW THAT `ChordGlyphs` PAINTS FLAT ────────── */
  //
  // The Send key option's look replaced pull request 468's enlarged-modifier
  // one (`ShortcutTip.tsx`'s `ChordGlyphs`), and a shrink is the direction
  // that never clips — but "never" is a claim, not a measurement, and the
  // project menu's own "New worktree…" row and a command-palette row are
  // both a control sharing its line with a label rather than a box with room
  // to spare (`ShortcutTip.tsx`'s own distinction). A zero-size box here is a
  // chord painted nowhere; a box wider than its row is one running into the
  // label beside it. This used to measure the sidebar's own full-width
  // footer button, withdrawn once the per-project `+` and the Projects
  // header's own `+` made it redundant -- the project menu's chord row is
  // this file's replacement site for the identical property.
  await page.keyboard.press('Escape');
  await settle(
    page,
    () => document.querySelector('[data-settings-overlay]') === null,
    `${each.name}: settings closes again`,
  );

  // A REAL, AWAITED CLICK, NOT A SYNTHETIC `dispatchEvent` INSIDE ONE
  // `evaluate`: React 18 commits the menu's `openMenu` state on a microtask,
  // which a same-turn `dispatchEvent` + query races and loses. Crossing the
  // `await` boundary (as every other interaction in this file already does)
  // gives the browser's own microtask queue a turn to flush before the next
  // line reads the DOM.
  const projectId = await page.evaluate(
    () => document.querySelector('[data-project-heading]')?.getAttribute('data-project-id') ?? null,
  );
  let menuRow = null;
  if (projectId !== null) {
    await page.locator(`[data-project-menu="${projectId}"]`).click();
    await page.waitForSelector(`[data-project-menu-panel="${projectId}"]`, { timeout: 5_000 });
    menuRow = await page.evaluate((id) => {
      const item = document.querySelector(
        `[data-project-menu-panel="${id}"] [data-project-menu-item="new-worktree"]`,
      );
      const chip = item?.querySelector('[data-inline-chord]');
      if (item === null || chip === null || item === undefined || chip === undefined) {
        return null;
      }
      const itemBox = item.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      return {
        text: chip.textContent,
        painted: chipBox.width > 0 && chipBox.height > 0,
        // The chip has to be INSIDE the item it shares a line with, not
        // spilling past its right edge.
        insideItem: chipBox.right <= itemBox.right + 0.5,
        // FLUSH AGAINST THE RIGHT PADDING, not merely "past the midpoint" --
        // the Windows spelling (`Ctrl+Shift+W`) is wide enough on its own to
        // start left of the row's midpoint while still sitting hard against
        // the right edge, which a midpoint test would misread as centred.
        rightAligned: itemBox.right - chipBox.right <= 10,
      };
    }, projectId);
  }
  check(
    `${each.name}: the project menu's New worktree chip paints and fits its row, right-aligned`,
    menuRow !== null && menuRow.painted && menuRow.insideItem && menuRow.rightAligned,
    JSON.stringify(menuRow),
  );
  await page.keyboard.press('Escape');

  await page.keyboard.press('Meta+k');
  const paletteOpen = await settle(
    page,
    () => document.querySelector('[data-command-palette]') !== null,
    `${each.name}: the command palette opens`,
  );
  if (paletteOpen) {
    // Sessions is the default half of VS Code's own split (the operator's
    // ask: "searching sessions has no prefix; searching actions starts with
    // `/`") -- the settings row with its bound chord lives in the OTHER
    // half.
    await page.keyboard.type('/');
    await page.waitForSelector('[data-command-palette][data-palette-mode="actions"]', {
      timeout: 5_000,
    });
    await page.waitForSelector('[cmdk-item]', { timeout: 5_000 });
    const row = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-command-palette] [cmdk-item]')];
      const settingsItem = items.find((item) => /^settings/i.test(item.textContent ?? ''));
      const chip = settingsItem?.querySelector('span:last-child') ?? null;
      if (settingsItem === undefined || chip === null) return null;
      const rowBox = settingsItem.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      return {
        text: chip.textContent,
        painted: chipBox.width > 0 && chipBox.height > 0,
        insideRow: chipBox.right <= rowBox.right + 0.5 && chipBox.bottom <= rowBox.bottom + 0.5,
      };
    });
    check(
      `${each.name}: the palette's settings row prints its chord and fits the row`,
      row !== null && row.painted && row.insideRow,
      JSON.stringify(row),
    );
    await page.keyboard.press('Escape');
  }

  await page.close();
}

await browser.close();

if (failures.length > 0) {
  throw new Error(
    `${failures.length} chord-symbol guard(s) failed:\n  - ${failures.join('\n  - ')}`,
  );
}
console.log('\nchord-symbols: every assertion passed.');
