/**
 * WHICH CARD A SETTING IS IN, and whether it is ON SCREEN there.
 *
 * Operator, translated: "these are Orca's appearance settings; see what vam
 * can do and add it. Split into clear, separate sections." The cards
 * restructure (`settings/sections.ts`, `settings/primitives.tsx`) turned the
 * old six-tab overlay into ten cards, all mounted at once, each foldable on
 * its own and some carrying an Advanced disclosure for their rarely-touched
 * rows. `test/settings/behaviour-section.test.tsx` and its siblings hold the
 * shape of the tree; this file holds the three claims a browser has to make
 * that a unit suite cannot:
 *
 *  1. EVERY ROW LIVES IN EXACTLY ONE CARD. A control asserted only where it
 *     now lives would pass while a half-finished move also left it drawn in
 *     its old home — so every row here is checked BOTH ways: present once in
 *     the whole document, and that one copy's nearest `[data-settings-panel]`
 *     ancestor is the card this file says it belongs to.
 *  2. OPEN IS PAINT, NOT JUST MARKUP. All ten cards are always mounted
 *     (`primitives.tsx`'s `SettingsCard` hides with the plain `hidden`
 *     attribute rather than unmounting), so `document.querySelector` finds
 *     every row whether or not an operator can see it. What jsdom cannot
 *     report is the RECTANGLE: a row behind a closed Advanced disclosure is
 *     zero pixels tall until that disclosure opens, and a row in an always
 *     -open card is painted the moment the dialog opens, with no click at
 *     all — the two defaults `card-collapse.ts` documents, read here as
 *     paint rather than as the state that produces it.
 *  3. THE NAV REALLY REACHES ITS CARD. Ten destinations now, jump links
 *     rather than tabs (`SettingsOverlay.tsx`'s own header: "the nav is jump
 *     links now, not tabs") — clicking one has to move the SAME card's own
 *     header to the top of the scrollport, not merely flip `aria-current`.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/settings-panels-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
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

/** The nav's own order — hard-coded in `sections.ts`, read here as the
 *  contract rather than re-derived from whatever the page happens to draw. */
const EXPECTED_NAV = [
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

/**
 * One row this restructure placed: its own selector, the card it now lives
 * in, and whether that card's own Advanced disclosure has to be open first.
 *
 * NAMED BY SELECTOR, NEVER BY CAPTION — a label is prose and gets reworded;
 * the `data-*` hook a row's control carries is the row.
 */
const ROWS = [
  // INTERFACE — the app's own paint, split out of the old Appearance panel.
  ['the colour templates', '[data-palette-template]', 'interface', false],
  ['the colour swatches', '[data-palette-swatch]', 'interface', true],
  ['out text', 'input[aria-label="out text size"]', 'interface', false],

  // TERMINAL — split out of Appearance too: typography and the theme lists
  // stay open by default, the colour grid/opacity/streaming switch moved
  // behind Terminal's own Advanced (the streaming switch coming from
  // Behaviour, not from Appearance).
  ['terminal text', '[data-terminal-size-option]', 'terminal', false],
  ['the terminal colours', '[data-terminal-swatch]', 'terminal', true],
  ['terminal background opacity', '[data-terminal-opacity]', 'terminal', true],
  ['the streaming terminal switch', '[data-switch="streaming-terminal"]', 'terminal', true],

  // WINDOW & SIDEBAR — new section; its first tenant moved from Behaviour.
  // The sidebar-appearance and status-bar rows are this section's SECOND PR,
  // landing where `settings.window.hint`'s own comment already named them.
  ['view width', '[data-switch="narrow-views"]', 'window', false],
  ['sidebar appearance', '[data-sidebar-appearance-option]', 'window', false],
  ['status bar usage mode', '[data-usage-display-mode-option]', 'window', false],
  ['show Claude usage', '[data-switch="claude-usage"]', 'window', false],
  ['show Codex usage', '[data-switch="codex-usage"]', 'window', false],

  // AGENTS — renamed from Sessions, and gained the ADHD skill card that used
  // to sit in Behaviour. Keep-awake/auto-tab-titles/permissions/default-agent
  // are this section's own second PR. Agent permissions is NOT in this sweep
  // — a security review found its own gate needs to be `isDesktopShell()`
  // (`window.api` presence), not viewport width, so it never draws in THIS
  // browser harness (no bridge) at all; the dedicated check right after this
  // sweep asserts that absence explicitly rather than let the row silently
  // read as "0 matches, trivially inside its own card".
  ['the ADHD skill card', '[data-settings-block="adhd-skill"]', 'agents', false],
  ['keep computer awake', '[data-keep-awake-option]', 'agents', false],
  ['auto tab titles', '[data-switch="auto-tab-titles"]', 'agents', false],
  ['default agent', '[data-default-agent-option]', 'agents', false],

  // BEHAVIOUR — smaller, not gone: focus view stays, and the file editor's
  // own two rows (moved from Appearance) join it as a "Files" sub-group.
  ['focus view', '[data-switch="focus-view"]', 'behaviour', false],
  ['file editor colours', '[data-switch="editor-highlight"]', 'behaviour', false],
  ['file editor indent', 'input[aria-label="editor indent"]', 'behaviour', false],

  // NOTIFICATIONS — unchanged; kept in the sweep so a half-finished
  // restructure that dragged this section along too would still be caught.
  ['desktop notifications', '[data-switch="notify-waiting"]', 'notifications', false],
  ['the delivery check', '[data-settings-block="notify-test"]', 'notifications', false],
];

/** The fewest labelled rows each card in `ROWS` may draw, corpus rather than
 *  paint — a floor measured against the real build (4/8/1/4/4/2 today), each
 *  left a little headroom below the measured count rather than pinned to it. */
const ROW_FLOOR = {
  interface: 3,
  terminal: 6,
  window: 4,
  agents: 6,
  behaviour: 3,
  notifications: 2,
};

const browser = await chromium.launch();

/** A page with the demo fixture loaded and the settings overlay open. */
async function openSettings(width = 1100, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  return page;
}

/**
 * Where a selector's matches ARE, measured rather than counted: how many are
 * in the document at all, how many have a box a person could point at, and —
 * for the ones that exist — which card each sits inside.
 *
 * `getBoundingClientRect` on an element inside a `hidden` subtree is all
 * zeroes, which is the whole distinction this file is about — "in the tree"
 * and "on the screen" are two different facts and a unit environment can
 * only report the first.
 */
function painted(page, selector) {
  return page.evaluate((sel) => {
    const all = [...document.querySelectorAll(sel)];
    const boxes = all.map((el) => el.getBoundingClientRect());
    return {
      inTree: all.length,
      onScreen: boxes.filter((b) => b.width > 0 && b.height > 0).length,
      homes: all.map((el) => el.closest('[data-settings-panel]')?.getAttribute('data-settings-panel') ?? null),
    };
  }, selector);
}

console.log('=== the nav, in the order sections.ts fixes');
{
  const page = await openSettings();

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-settings-nav-item]')].map((el) => ({
      id: el.getAttribute('data-settings-nav-item'),
      name: (el.textContent ?? '').trim(),
    })),
  );
  console.log(`  nav: ${ids.map((e) => e.id).join(', ')}`);
  check(
    'ten sections, in the order sections.ts fixes, each named for itself',
    ids.length === EXPECTED_NAV.length &&
      EXPECTED_NAV.every(([id, name], i) => ids[i]?.id === id && ids[i]?.name === name),
    JSON.stringify(ids),
  );

  // EVERY CARD IS ALREADY MOUNTED — the whole premise the rest of this file
  // measures against. `[data-settings-panel]` exists once per section
  // whether or not its card is open.
  const panels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-settings-panel]')].map((el) => el.getAttribute('data-settings-panel')),
  );
  check(
    'all ten cards are mounted at once — this is the all-cards-visible model, not tabs',
    EXPECTED_NAV.every(([id]) => panels.includes(id)) && panels.length === EXPECTED_NAV.length,
    panels.join(', '),
  );
  await page.close();
}

console.log('\n=== every row lives in exactly one card, painted or not by its own defaults');
{
  const page = await openSettings();

  for (const [what, selector, home, advanced] of ROWS) {
    const seen = await painted(page, selector);
    if (seen.inTree === 0) {
      throw new Error(`${what} (${selector}) is nowhere in the overlay at all`);
    }
    // NOT EVERY SELECTOR IS ONE ELEMENT — a template picker matches one
    // button per template, a colour grid one swatch per token — so the
    // claim a half-finished move would break is not "exactly one match" but
    // "every match is under the same card": a row moved in full lands wholly
    // in its new home, and one still drawn in the old home too shows up as a
    // second, different, entry in `homes`.
    check(
      `${what}: every match (${seen.inTree}) is inside ${home}, none left behind`,
      seen.homes.every((h) => h === home),
      JSON.stringify(seen),
    );
    // THE TWO DEFAULTS card-collapse.ts DOCUMENTS, READ AS PAINT: a card
    // starts open, so a row not behind Advanced is on screen the moment the
    // dialog opens — no click anywhere. Advanced starts closed, so a row
    // behind it is mounted but zero-sized until its own disclosure opens.
    if (advanced) {
      check(`${what}: behind Advanced, so closed by default has no box yet`, seen.onScreen === 0);
    } else {
      check(
        `${what}: not behind Advanced, so its card being open by default already paints it`,
        seen.onScreen === seen.inTree,
      );
    }
  }

  // AGENT PERMISSIONS, SEPARATELY, PROVING AN ABSENCE RATHER THAN LEAVING ONE
  // UNPROVEN. This browser has no `window.api` (`vite preview` serves the
  // pure web build, no Electron preload) — the same state a paired device
  // over Tailscale is in at ANY viewport width, which is exactly the gap a
  // security review found: an earlier version of this gate checked viewport
  // width instead, so a paired browser at desktop width saw this row and
  // could set Yolo in its own localStorage. `isDesktopShell()` now reads
  // `window.api` presence, so the row (and its confirmation) must be
  // ZERO matches here, not merely "0, and nobody checked".
  {
    const permissionsRow = await page.evaluate(
      () => document.querySelectorAll('[data-agent-permissions-option]').length,
    );
    check(
      'agent permissions: absent in this browser harness (no window.api) — the desktop-only gate',
      permissionsRow === 0,
      `found ${permissionsRow}`,
    );
  }

  console.log('\n=== each card draws its own corpus of labelled rows');
  for (const [id, floor] of Object.entries(ROW_FLOOR)) {
    const rows = await page.evaluate(
      (sectionId) => document.querySelectorAll(`[data-settings-panel="${sectionId}"] [data-settings-rows] h4`).length,
      id,
    );
    console.log(`  [${id}] ${rows} labelled row(s)`);
    if (rows < floor) {
      throw new Error(`the ${id} card drew ${rows} rows, fewer than the ${floor}-row floor — this sweep is about nothing`);
    }
  }

  await page.close();
}

console.log('\n=== each Advanced disclosure opens its own rows and nobody else\'s');
{
  const page = await openSettings();
  const advancedHomes = [...new Set(ROWS.filter(([, , , advanced]) => advanced).map(([, , home]) => home))];

  for (const home of advancedHomes) {
    await page.locator(`[data-settings-advanced="${home}"]`).click();
    await page.waitForTimeout(120);

    for (const [what, selector, rowHome, advanced] of ROWS) {
      if (!advanced) continue;
      const seen = await painted(page, selector);
      // ACCUMULATING, NOT REPLACING — opening a second card's Advanced does
      // not fold the first one back up (`AdvancedDisclosure`'s own state is
      // keyed per section), so every disclosure opened so far stays painted.
      const shouldBePainted = advancedHomes.slice(0, advancedHomes.indexOf(home) + 1).includes(rowHome);
      check(
        `after opening ${home}'s Advanced: ${what} (home ${rowHome}) is ${shouldBePainted ? 'painted' : 'still closed'}`,
        (seen.onScreen > 0) === shouldBePainted,
        JSON.stringify(seen),
      );
    }
  }
  await page.close();
}

console.log('\n=== the nav really reaches its card');
{
  const page = await openSettings();
  const homes = [...new Set(ROWS.map(([, , home]) => home))];

  for (const home of homes) {
    await page.locator(`[data-settings-nav-item="${home}"]`).click();
    await page.waitForTimeout(120);

    const current = await page.evaluate(() =>
      [...document.querySelectorAll('[data-settings-nav-item]')]
        .filter((el) => el.getAttribute('aria-current') === 'true')
        .map((el) => el.getAttribute('data-settings-nav-item')),
    );
    check(`clicking ${home}'s nav item marks it, and only it, current`, current.length === 1 && current[0] === home, current.join(','));

    const geometry = await page.evaluate((id) => {
      const port = document.querySelector('[data-settings-scroll]');
      const card = document.querySelector(`[data-settings-panel="${id}"]`);
      if (port === null || card === null) return null;
      return { portTop: port.getBoundingClientRect().top, cardTop: card.getBoundingClientRect().top };
    }, home);
    if (geometry === null) {
      throw new Error(`${home}'s card or the scrollport is missing from the dialog`);
    }
    // `scrollIntoView({ block: 'start' })` aligns the card's own top edge
    // with the scrollport's — a click that left the operator scrolled
    // somewhere else entirely is the defect a single-panel model could never
    // have (there was nowhere else to be scrolled to).
    check(
      `clicking ${home}'s nav item scrolls its own card to the top of the scrollport`,
      Math.abs(geometry.cardTop - geometry.portTop) <= 2,
      JSON.stringify(geometry),
    );
  }

  // THE NAV ITSELF, for the before/after in the pull request. Cropped to the
  // rail so all ten destinations are legible at the width GitHub renders an
  // image at.
  const rail = page.locator('[data-settings-nav]');
  await rail.screenshot({ path: `${outDir}/settings-nav-sections.png` });
  console.log(`${outDir}/settings-nav-sections.png`);
  await page.close();
}

// ---------------------------------------------------------------------------
// THE ADHD SKILL CARD -- what replaced the concise-output switch, in both
// states an operator can find it in, dark and light.
//
// Operator, translated: "turn Concise output in Settings into a card [an
// Orca screenshot]. Talk about the ADHD skill" -- and the design decision
// that followed: install the REAL `ayghri/i-have-adhd` skill, rather than
// typing vam's own wording of it into a session's first prompt. See
// `src/renderer/settings/AdhdSkillCard.tsx`'s own header for the whole
// argument. MOVED HERE FROM BEHAVIOUR TO AGENTS by the cards restructure --
// still not behind any Advanced disclosure, so no fold to open before it is
// on screen.
//
// A BROWSER TAB HAS NO PRELOAD, so `window.api.adhdSkill` does not exist
// here on its own -- the same fact `settings-chrome-shots.mjs` already works
// around for `RemotePanel`. Stubbed the same way: `addInitScript` installs a
// fake bridge BEFORE the page's own script runs, answering a fixed status so
// this guard never touches a real `~/.claude` or `~/.agents` on the machine
// running it.
console.log('\n=== the ADHD skill card, not installed and installed, dark and light');
{
  const NOT_INSTALLED = {
    overall: 'not-installed',
    agents: [
      { agent: 'claude', state: 'not-installed', dir: '~/.claude/skills/i-have-adhd' },
      { agent: 'codex', state: 'not-installed', dir: '~/.agents/skills/i-have-adhd' },
    ],
  };
  const INSTALLED = {
    overall: 'installed',
    agents: [
      { agent: 'claude', state: 'installed', dir: '~/.claude/skills/i-have-adhd' },
      { agent: 'codex', state: 'installed', dir: '~/.agents/skills/i-have-adhd' },
    ],
  };

  async function shootCard(status, slug) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
    await page.addInitScript((fixedStatus) => {
      const answer = () => Promise.resolve(fixedStatus);
      globalThis.window.api = {
        ...(globalThis.window.api ?? {}),
        adhdSkill: { status: answer, install: answer, remove: answer },
        clipboard: { writeText: async () => true },
        link: { open: async () => true },
      };
    }, status);
    await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
    await page.locator('button[aria-label="settings"]').first().click();
    await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
    await page.locator('[data-settings-nav-item="agents"]').click();
    await page.waitForSelector('[data-settings-block="adhd-skill"]', { timeout: 5_000 });
    await page.waitForSelector(`[data-adhd-skill-pill="${status.overall}"]`, { timeout: 5_000 });

    const box = await page
      .locator('[data-settings-block="adhd-skill"]')
      .evaluate((el) => el.getBoundingClientRect());
    if (box.height === 0) {
      throw new Error(`the ADHD skill card (${slug}) has no height`);
    }
    const install = await page.locator('[data-adhd-skill-install]').count();
    if (install !== 1) {
      throw new Error(`the ADHD skill card (${slug}) drew ${install} Install/Reinstall buttons`);
    }
    const agents = await page.locator('[data-adhd-skill-agent]').count();
    if (agents !== 2) {
      throw new Error(`the ADHD skill card (${slug}) drew ${agents} agent coverage chips, not 2`);
    }

    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('light', t === 'light');
      }, theme);
      await page.waitForTimeout(120);
      await page.locator('[data-settings-block="adhd-skill"]').scrollIntoViewIfNeeded();
      await page.locator('[data-settings-block="adhd-skill"]').screenshot({
        path: `${outDir}/settings-adhd-skill-${slug}-${theme}.png`,
      });
      console.log(`${outDir}/settings-adhd-skill-${slug}-${theme}.png`);
    }
    await page.close();
  }

  await shootCard(NOT_INSTALLED, 'not-installed');
  await shootCard(INSTALLED, 'installed');
}

// ---------------------------------------------------------------------------
// AND EACH CARD IS INSIDE THE BOX THAT SCROLLS.
//
// The overlay is `h-[min(600px,80vh)]` with one scrolling child
// (`[data-settings-scroll]`) that now holds all ten cards end to end rather
// than one panel at a time. A card whose rows overflow sideways is clipped
// rather than reachable by the one scroll gesture this dialog offers.
// Measured at the narrowest width the desktop shell still draws a nav at,
// where the section strip (not the rail) takes a row out of the same 600px
// -- Agents, for the widest row of controls any card in `ROWS` draws (the
// provider picker, the chord glyphs, the ADHD skill card's own buttons).
console.log('\n=== a card fits the scrollport, sideways, at the narrowest desktop width');
{
  const NARROWEST_DESKTOP = 520;
  const page = await openSettings(NARROWEST_DESKTOP, 844);
  await page.locator('[data-settings-nav-item="agents"]').click();
  await page.waitForTimeout(150);
  const fit = await page.evaluate(() => {
    const port = document.querySelector('[data-settings-scroll]');
    const panel = document.querySelector('[data-settings-panel="agents"]');
    if (port === null || panel === null) return null;
    const portBox = port.getBoundingClientRect();
    const rows = [...panel.querySelectorAll('[data-settings-rows] > *')].map((el) => {
      const box = el.getBoundingClientRect();
      return { top: Math.round(box.top), bottom: Math.round(box.bottom), h: Math.round(box.height) };
    });
    return {
      rows,
      portTop: Math.round(portBox.top),
      portBottom: Math.round(portBox.bottom),
      scrollH: port.scrollHeight,
      clientH: port.clientHeight,
      portWidth: Math.round(portBox.width),
      overflowX: port.scrollWidth - port.clientWidth,
    };
  });
  if (fit === null || fit.rows.length < 3) {
    throw new Error(`the agents panel drew ${fit?.rows.length ?? 0} rows at 520px`);
  }
  console.log(
    `  ${fit.rows.length} rows, ${fit.scrollH}px of content in a ${fit.clientH}px port (${fit.portWidth}px wide)`,
  );
  // ONE ROW OF EACH IS ENOUGH TO BE READ, which is the property a zero-height
  // row would fail while still being "present".
  const flat = fit.rows.filter((row) => row.h < 20);
  if (flat.length > 0) {
    throw new Error(`${flat.length} row(s) in the agents panel are under 20px tall`);
  }
  // SIDEWAYS IS THE FAILURE THAT HIDES. The port scrolls down on purpose --
  // that is what a settings dialog does -- but a row wider than it is a row
  // whose right-hand half no scroll gesture in this dialog reaches.
  if (fit.overflowX > 1) {
    throw new Error(
      `the agents panel is ${fit.overflowX}px wider than the scrollport at 520px — its right edge cannot be reached`,
    );
  }
  await page.screenshot({ path: `${outDir}/settings-agents-narrow.png` });
  console.log(`${outDir}/settings-agents-narrow.png`);
  await page.close();
}

await browser.close();
console.log(
  '\nsettings panels: ten cards, always mounted, each row painted in exactly one of them and only once its own fold is open.',
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in settings-panels-shots.mjs`);
  process.exit(1);
}
