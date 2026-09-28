/**
 * WHICH SECTION A SETTING IS IN, and whether it is ON SCREEN there.
 *
 * Operator, translated: "these are Orca's appearance settings; see what vam
 * can do and add it. Split into clear, separate sections." The cards
 * restructure (`settings/sections.ts`, `settings/primitives.tsx`) first split
 * the old six-tab overlay into ten cards, all mounted at once. The
 * settings-views restructure (item C) MOVED IT BACK to one section on screen
 * at a time -- the operator's own later ask, "each section its own view, not
 * one long scroll" -- so `[data-settings-panel="id"]` is not in the tree at
 * all until that id's own nav item has been clicked; there is no `hidden`
 * sibling for it to be found beside any more.
 * `test/settings/behaviour-section.test.tsx` and its siblings hold the shape
 * of the tree; this file holds the three claims a browser has to make that a
 * unit suite cannot:
 *
 *  1. EVERY ROW LIVES IN EXACTLY ONE SECTION. Single-section-mount makes a
 *     row drawn in TWO sections at once impossible by construction -- but a
 *     row a half-finished move left in its OLD section and never added to
 *     the new one is not, and neither is one added to the new section
 *     without ever being removed from the old. So each row here is checked
 *     both ways: present, and painted, when its OWN section is open; absent
 *     when a DIFFERENT section (its onetime home, where this restructure has
 *     one on record) is open instead.
 *  2. OPEN IS PAINT, NOT JUST MARKUP, WITHIN A SECTION. A row behind a closed
 *     Advanced disclosure is mounted (`primitives.tsx`'s `AdvancedDisclosure`
 *     hides with the plain `hidden` attribute rather than unmounting) but
 *     zero pixels tall until that disclosure opens -- jsdom cannot report
 *     that RECTANGLE at all, which is what a real engine is for here.
 *  3. THE NAV REALLY REACHES ITS SECTION. Clicking a nav item has to replace
 *     the document's own section subtree with THAT section's, and reset the
 *     one scrollport this dialog owns back to its own top -- not merely flip
 *     `aria-current`.
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
 *  contract rather than re-derived from whatever the page happens to draw.
 *  `skills` (item D) is not here: this file runs against a plain browser
 *  bundle with no `window.api` bridge, and Skills hides wherever that
 *  bridge is absent (`isDesktopOnlySection`). */
const EXPECTED_NAV = [
  ['interface', 'Interface'],
  ['stats', 'Stats & Usage'],
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
 * One row this restructure placed: its own selector, the section it now
 * lives in, and whether that section's own Advanced disclosure has to be
 * open first.
 *
 * NAMED BY SELECTOR, NEVER BY CAPTION — a label is prose and gets reworded;
 * the `data-*` hook a row's control carries is the row.
 */
const ROWS = [
  // INTERFACE — the app's own paint, split out of the old Appearance panel.
  ['the colour templates', '[data-palette-template]', 'interface', false],
  // EXCLUDES THE PANE-DIVIDER SWATCH (settings step 2A): `[data-palette-
  // swatch]` now also matches ONE row homed in `terminal`, not `interface`
  // -- see that row just below, in the terminal group. Without the
  // `:not(...)` here this entry's own "every match is under the same
  // section" check would fail the moment that row existed, which is the
  // whole pattern this file's own header already documents for a
  // multi-match selector; this is just the first row to actually split
  // across two.
  ['the colour swatches', '[data-palette-swatch]:not([data-palette-swatch="--vam-pane-divider"])', 'interface', true],
  ['out text', 'input[aria-label="out text size"]', 'interface', false],

  // TERMINAL — split out of Appearance too: typography and the theme lists
  // stay open by default, the colour grid/opacity/streaming switch moved
  // behind Terminal's own Advanced (the streaming switch coming from
  // Behaviour, not from Appearance).
  ['terminal text', '[data-terminal-size-option]', 'terminal', false],
  ['terminal font family', '[data-font-family-select="terminal font family"]', 'terminal', false],
  ['the terminal preview', '[data-terminal-preview]', 'terminal', false],
  ['the terminal colours', '[data-terminal-swatch]', 'terminal', true],
  ['terminal background opacity', '[data-terminal-opacity]', 'terminal', true],
  ['the streaming terminal switch', '[data-switch="streaming-terminal"]', 'terminal', true],
  // THE PANE-DIVIDER COLOUR (settings step 2A). Rides the SAME
  // `[data-palette-swatch]` selector the Interface grid's own swatches use
  // (`PANE_DIVIDER_TOKEN`'s own comment in `prefs.ts` says why), drawn here
  // instead behind Terminal's own Advanced -- deliberately its own row, not
  // folded into "the colour swatches" above, because that row's home is
  // `interface` and this one's is not.
  ['the pane-divider colour swatch', '[data-palette-swatch="--vam-pane-divider"]', 'terminal', true],

  // WINDOW & SIDEBAR — new section; its first tenant moved from Behaviour.
  // The sidebar-appearance and status-bar rows are this section's SECOND PR,
  // landing where `settings.window.hint`'s own comment already named them.
  ['view width', '[data-switch="narrow-views"]', 'window', false],
  ['sidebar appearance', '[data-sidebar-appearance-option]', 'window', false],
  ['status bar usage mode', '[data-usage-display-mode-option]', 'window', false],
  ['show Claude usage', '[data-switch="claude-usage"]', 'window', false],
  ['show Codex usage', '[data-switch="codex-usage"]', 'window', false],

  // AGENTS — renamed from Sessions, and gained the ADHD skill card that used
  // to sit in Behaviour, then LEFT AGAIN for its own "Skills" section
  // (settings-views restructure, item D). Keep-awake/auto-tab-titles/
  // permissions/default-agent are this section's own second PR. Agent
  // permissions is NOT in this sweep — a security review found its own gate
  // needs to be `isDesktopShell()` (`window.api` presence), not viewport
  // width, so it never draws in THIS browser harness (no bridge) at all; the
  // dedicated check right after this sweep asserts that absence explicitly
  // rather than let the row silently read as "0 matches, trivially inside
  // its own section".
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

/** The fewest labelled rows each section in `ROWS` may draw, corpus rather
 *  than paint — a floor measured against the real build, each left a little
 *  headroom below the measured count rather than pinned to it. */
const ROW_FLOOR = {
  interface: 3,
  terminal: 6,
  window: 4,
  agents: 2,
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
 * for the ones that exist — which section each sits inside.
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
    'eleven sections reachable in this browser, in the order sections.ts fixes, each named for itself',
    ids.length === EXPECTED_NAV.length &&
      EXPECTED_NAV.every(([id, name], i) => ids[i]?.id === id && ids[i]?.name === name),
    JSON.stringify(ids),
  );

  // ONLY THE OPEN SECTION IS MOUNTED — the settings-views restructure (item
  // C) replaced the cards restructure's all-mounted model with this one.
  // Landing here is the first open of a fresh page (no `localStorage` yet
  // for `readLastSection` to fall back to), so it must be the FIRST section
  // in the nav's own order, and it must be the ONLY `[data-settings-panel]`
  // in the document.
  const panels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-settings-panel]')].map((el) => el.getAttribute('data-settings-panel')),
  );
  check(
    'exactly one section is mounted on a fresh open — the single-section-view model, not all-cards',
    panels.length === 1 && panels[0] === EXPECTED_NAV[0][0],
    panels.join(', '),
  );
  await page.close();
}

console.log('\n=== every row lives in exactly one section, painted or not by its own defaults');
{
  const page = await openSettings();

  /** Every home `ROWS` names, each visited once, in nav order — so a check
   *  that a row is ABSENT from a section that is not its home never has to
   *  guess whether that section has even been rendered yet in this page. */
  const homes = [...new Set(ROWS.map(([, , home]) => home))];

  for (const home of homes) {
    await page.locator(`[data-settings-nav-item="${home}"]`).click();
    await page.waitForTimeout(150);

    for (const [what, selector, rowHome, advanced] of ROWS) {
      const seen = await painted(page, selector);
      if (rowHome === home) {
        // THIS ROW'S OWN SECTION IS OPEN. Present, once, inside it.
        if (seen.inTree === 0) {
          throw new Error(`${what} (${selector}) is nowhere in the ${home} section, though it is open`);
        }
        check(
          `${what}: every match (${seen.inTree}) is inside ${home}, none stray`,
          seen.homes.every((h) => h === home),
          JSON.stringify(seen),
        );
        // THE TWO DEFAULTS card-collapse.ts DOCUMENTS, READ AS PAINT: a
        // section starts open, so a row not behind Advanced is on screen
        // the moment its section mounts — no click anywhere. Advanced
        // starts closed, so a row behind it is mounted but zero-sized until
        // its own disclosure opens.
        if (advanced) {
          check(`${what}: behind Advanced, so closed by default has no box yet`, seen.onScreen === 0);
        } else {
          check(
            `${what}: not behind Advanced, so its section being open by default already paints it`,
            seen.onScreen === seen.inTree,
          );
        }
      } else {
        // A DIFFERENT SECTION IS OPEN. Single-section-mount's own claim: this
        // row's whole subtree is not in the document at all right now — the
        // property that makes "left behind in its old home" impossible by
        // construction, checked rather than assumed.
        check(`${what}: not in the tree while ${home} (not its home, ${rowHome} is) is open`, seen.inTree === 0, JSON.stringify(seen));
      }
    }
  }

  console.log('\n=== each section draws its own corpus of labelled rows');
  for (const [id, floor] of Object.entries(ROW_FLOOR)) {
    await page.locator(`[data-settings-nav-item="${id}"]`).click();
    await page.waitForTimeout(150);
    const rows = await page.evaluate(
      (sectionId) => document.querySelectorAll(`[data-settings-panel="${sectionId}"] [data-settings-rows] h4`).length,
      id,
    );
    console.log(`  [${id}] ${rows} labelled row(s)`);
    if (rows < floor) {
      throw new Error(`the ${id} section drew ${rows} rows, fewer than the ${floor}-row floor — this sweep is about nothing`);
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
  // ZERO matches here, not merely "0, and nobody checked". The Agents nav
  // item is already open from the `ROW_FLOOR` loop above.
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

  await page.close();
}

console.log("\n=== each Advanced disclosure opens its own section's rows and nobody else's");
{
  const page = await openSettings();
  const advancedRows = ROWS.filter(([, , , advanced]) => advanced);
  const advancedHomes = [...new Set(advancedRows.map(([, , home]) => home))];

  for (const home of advancedHomes) {
    await page.locator(`[data-settings-nav-item="${home}"]`).click();
    await page.waitForTimeout(150);
    await page.locator(`[data-settings-advanced="${home}"]`).click();
    await page.waitForTimeout(120);

    for (const [what, selector, rowHome, advanced] of advancedRows) {
      if (rowHome !== home) continue;
      const seen = await painted(page, selector);
      check(`after opening ${home}'s Advanced: ${what} is painted`, seen.onScreen > 0, JSON.stringify(seen));
    }
  }
  await page.close();
}

console.log('\n=== the nav really reaches its section');
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
      const section = document.querySelector(`[data-settings-panel="${id}"]`);
      if (port === null || section === null) return null;
      return {
        portTop: port.getBoundingClientRect().top,
        // THE SCROLLPORT'S OWN TOP PADDING (`px-5 py-4`, `SettingsOverlay.tsx`)
        // -- a freshly mounted section sitting AT `scrollTop: 0` still starts
        // this far below the scrollport's own border edge, so it is added to
        // `portTop` below rather than left for a fixed tolerance to absorb,
        // the same reason a `top: 16px` box is not read as "not at the top"
        // of a `padding: 16px` container.
        portPaddingTop: Number.parseFloat(getComputedStyle(port).paddingTop),
        sectionTop: section.getBoundingClientRect().top,
      };
    }, home);
    if (geometry === null) {
      throw new Error(`${home}'s section or the scrollport is missing from the dialog`);
    }
    // THE ONE SCROLLPORT RESETS TO ITS OWN TOP on every section change
    // (`SettingsOverlay.tsx`'s own effect keyed on `section`) — a freshly
    // mounted section starting anywhere else is the defect a single-section
    // model could produce that a scrollspy over an always-mounted page never
    // could (there was nowhere else for a BRAND NEW subtree to have scrolled
    // to).
    check(
      `clicking ${home}'s nav item mounts its section at the top of the scrollport`,
      Math.abs(geometry.sectionTop - (geometry.portTop + geometry.portPaddingTop)) <= 2,
      JSON.stringify(geometry),
    );
  }

  // THE NAV ITSELF, for the before/after in the pull request. Cropped to the
  // rail so all reachable destinations are legible at the width GitHub
  // renders an image at.
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
// argument. MOVED FROM BEHAVIOUR TO AGENTS by the cards restructure, then
// out of Agents entirely into its own "Skills" nav section (settings-views
// restructure, item D) -- still not behind any Advanced disclosure, so no
// fold to open before it is on screen, and it is the DESKTOP-ONLY nav item
// (`isDesktopOnlySection`), reachable only once a bridge exists at all.
//
// A BROWSER TAB HAS NO PRELOAD, so `window.api.adhdSkill` does not exist
// here on its own -- the same fact `settings-chrome-shots.mjs` already works
// around for `RemotePanel`. Stubbed the same way: `addInitScript` installs a
// fake bridge BEFORE the page's own script runs, answering a fixed status so
// this guard never touches a real `~/.claude` or `~/.agents` on the machine
// running it, and installing it is what makes the desktop-only nav item
// reachable at all in this otherwise bridge-less browser.
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
    // Skills is desktop-only (`isDesktopOnlySection`) and reachable in this
    // browser only because the bridge above was stubbed before this page's
    // own script ran.
    await page.locator('[data-settings-nav-item="skills"]').click();
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
// AND EACH SECTION IS INSIDE THE BOX THAT SCROLLS.
//
// The overlay fills the whole window (`inset-0`, settings-views restructure
// item A) with one scrolling child (`[data-settings-scroll]`) that now holds
// the CURRENT section alone rather than all sections end to end. A section
// whose rows overflow sideways is clipped rather than reachable by the one
// scroll gesture this dialog offers. Measured at the narrowest width the
// desktop shell still draws a nav at, where the section strip (not the rail)
// takes a row out of the same viewport -- Agents, for the widest row of
// controls any section in `ROWS` draws (the provider picker, the chord
// glyphs).
console.log('\n=== a section fits the scrollport, sideways, at the narrowest desktop width');
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
  '\nsettings panels: one section mounted at a time, each row painted in its own section and only once its own fold is open.',
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in settings-panels-shots.mjs`);
  process.exit(1);
}
