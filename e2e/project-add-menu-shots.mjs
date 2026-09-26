/**
 * THE PROJECT ROW'S OWN `+`, RESTORED BESIDE ITS MENU TRIGGER, AND THE
 * MENU'S OWN CHORDS — the operator's reversal of pull request 371's
 * consolidation. `sidebar-tree-shots.mjs` already re-derives the DOM shape
 * (no `new-session` menu item, one `+` per heading); this file measures the
 * PAINT `sidebar-tree-shots.mjs` cannot: the button's own rectangle (and its
 * 44px phone floor), the tooltip that opens on focus rather than a native
 * `title`, and the menu item chip's actual position relative to its row,
 * in both themes and at both a desktop width and 390px — the operator's own
 * ask. Every claim below is a rectangle or a token, never a class string.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/project-add-menu-shots.mjs http://localhost:PORT docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5529';
const outDir = process.argv[3] ?? 'docs/ui';

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

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 860 },
  { name: '390', width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-project-heading][data-project-id="factory"]');

  for (const theme of ['dark', 'light']) {
    const where = `${theme}/${viewport.name}`;
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('light', t === 'light');
    }, theme);
    // Blurred, not carried over: the previous theme's iteration can leave
    // the menu trigger focused (a real focus ring), which this theme's own
    // "before" shot has no business showing.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);

    // REVEALED BY HOVER, exactly as the component gates it -- Playwright's
    // `.hover()` dispatches a real pointer event regardless of the viewport
    // width, which is how this suite already measures hover-revealed
    // controls at 390px elsewhere (the phone floor is a CSS `min-`, not a
    // touch-only code path).
    const heading = page.locator('[data-project-heading][data-project-id="factory"]');
    await heading.hover();

    const add = page.locator('[data-new-session-in-project="factory"]');
    const addBox = await add.boundingBox();
    check(`${where}: the project row's + paints on screen`, addBox !== null && addBox.width > 0 && addBox.height > 0, JSON.stringify(addBox));
    if (viewport.name === '390' && addBox !== null) {
      check(
        `${where}: the + clears the 44px phone floor`,
        addBox.width >= 44 && addBox.height >= 44,
        JSON.stringify(addBox),
      );
    }

    await page.screenshot({
      path: `${outDir}/project-row-add-${theme}-${viewport.name}.png`,
      clip: {
        x: 0,
        y: Math.max(0, (addBox?.y ?? 0) - 40),
        width: viewport.width,
        height: 120,
      },
    });

    // THE TOOLTIP, OPENED ON FOCUS -- never a native `title`, which a
    // keyboard user could never open (`ShortcutTip.tsx`).
    await add.focus();
    await page.waitForSelector('[role="tooltip"]', { timeout: 5_000 });
    const tip = page.locator('[role="tooltip"]').first();
    const tipText = (await tip.textContent()) ?? '';
    const tipChip = await tip.locator('[data-tip-keys]').count();
    // THE DEMO REFUSES EVERY WRITE (`App.tsx`'s own header comment), so
    // `newSessionDecline` is never `null` under `?demo=1` -- every project's
    // tooltip honestly shows the refusal sentence instead of "New session",
    // and carries no chord while it does (`ShortcutTip`'s own `action={…
    // undefined}` branch, `SessionList.tsx`). That IS the property worth
    // proving here: a non-empty tip either way, and a chord ONLY alongside
    // the "new session" label, never alongside a refusal.
    check(
      `${where}: the tooltip says something, and a chord rides only with the "new session" label`,
      tipText.trim().length > 0 &&
        (tipChip > 0) === tipText.toLowerCase().includes('new session'),
      JSON.stringify({ tipText, tipChip }),
    );
    check(`${where}: the button carries no native title`, (await add.getAttribute('title')) === null);
    await page.keyboard.press('Escape');

    // THE MENU -- no `new-session` item, and the one item with a bound
    // chord (`new-worktree`, `Mod-Shift-w`) prints it, right-aligned; an
    // unbound item (`remove`) prints nothing.
    await page.locator('[data-project-menu="factory"]').click();
    await page.waitForSelector('[data-project-menu-panel="factory"]');
    const menu = await page.evaluate(() => {
      const rowsOf = (name) => {
        const item = document.querySelector(
          `[data-project-menu-panel="factory"] [data-project-menu-item="${name}"]`,
        );
        if (item === null) return null;
        const chip = item.querySelector('[data-inline-chord]');
        const itemBox = item.getBoundingClientRect();
        const chipBox = chip?.getBoundingClientRect() ?? null;
        return {
          present: true,
          chordText: chip?.textContent ?? null,
          chordPainted: chipBox !== null && chipBox.width > 0 && chipBox.height > 0,
          // FLUSH AGAINST THE RIGHT PADDING, not merely "past the midpoint"
          // -- a wide chord (the Windows spelling) can start left of the
          // row's own midpoint while still sitting hard against its right
          // edge, which a midpoint test would misread as centred rather
          // than right-aligned.
          rightAligned: chipBox !== null && itemBox.right - chipBox.right <= 10,
        };
      };
      return {
        hasNewSession:
          document.querySelector(
            '[data-project-menu-panel="factory"] [data-project-menu-item="new-session"]',
          ) !== null,
        worktree: rowsOf('new-worktree'),
        remove: rowsOf('remove'),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    check(`${where}: New session is no longer a menu item`, menu.hasNewSession === false);
    check(
      `${where}: New worktree carries its bound chord in the DOM`,
      typeof menu.worktree?.chordText === 'string' && menu.worktree.chordText.length > 0,
      JSON.stringify(menu.worktree),
    );
    // PAINTED AND RIGHT-ALIGNED ON A DESKTOP ROW; SUPPRESSED ON THE PHONE
    // SHELL BY DESIGN -- `[data-phone-shell] [data-inline-chord] { display:
    // none }` (`styles.css`), the same rule that hides the search control's
    // `/` and the restore strip's chord: a touchscreen cannot press a
    // chord, and the item's own words still say what it does.
    if (viewport.name === 'desktop') {
      check(
        `${where}: New worktree's chord paints, right-aligned`,
        menu.worktree?.chordPainted === true && menu.worktree?.rightAligned === true,
        JSON.stringify(menu.worktree),
      );
    } else {
      check(
        `${where}: New worktree's chord is suppressed, not merely invisible by accident`,
        menu.worktree?.chordPainted === false,
        JSON.stringify(menu.worktree),
      );
    }
    check(
      `${where}: Remove (unbound) shows no chord`,
      menu.remove?.chordText === null,
      JSON.stringify(menu.remove),
    );
    check(`${where}: no horizontal overflow`, menu.overflow === false);

    await page.screenshot({
      path: `${outDir}/project-row-menu-chords-${theme}-${viewport.name}.png`,
      clip: { x: 0, y: 0, width: viewport.width, height: Math.min(viewport.height, 420) },
    });

    await page.keyboard.press('Escape');
  }

  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
