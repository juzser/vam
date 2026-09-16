/**
 * THE SIDEBAR AS A TREE, AND ITS STATUS MARKS, MEASURED ON THE REAL PAINT.
 *
 * Everything here is a question happy-dom cannot answer, and most of it is a
 * question the unit tests are not even allowed to ask:
 *
 *  - WHERE THE THREE LEVELS ACTUALLY SIT. `SessionList.tree.test.tsx` asserts
 *    that a container declares `paddingLeft: SIDEBAR_STEP`. Whether that puts
 *    the group heading, the project heading and the session row on three
 *    distinct left edges is a layout question, and happy-dom lays nothing out.
 *    The operator's complaint was about the picture, so the picture is what is
 *    measured: three `getBoundingClientRect().left`s, a rung apart.
 *  - WHETHER THE LANE HOLDS. Five statuses in a 14px box is a promise about
 *    boxes, and a box is a browser's answer. A mark that sized itself would
 *    shift every title beside it each time an agent asked a question.
 *  - WHETHER EVERY SPINNER IS AT THE SAME ANGLE. This one cannot be asked of
 *    a unit environment at all: `Element.getAnimations()` exists in no such
 *    environment, and the phase of a CSS animation is a fact about the
 *    document timeline. A row that mounts LATE is the only way to catch the
 *    defect -- all of them mounting together are trivially in step -- so the
 *    check collapses a project, waits for the clock to reach a known point in
 *    the turn, expands it, and asks the freshly mounted spinner where it
 *    thinks it is.
 *  - WHETHER REDUCED MOTION LEAVES A BROKEN RING. The running mark has two
 *    bodies and a media query picks one; a media query is the cascade, not
 *    the class list, and this repo has already shipped a selector that matched
 *    nothing behind a green content scan.
 *  - WHETHER THE BELL EVER STOPS. `animation-iteration-count: 2` is text in a
 *    stylesheet until something watches it run out.
 *
 * It also takes the screenshots that make the whole change reviewable as an
 * image, which is why it seeds two GROUPS: the demo fixture has none, and a
 * three-level tree with only two levels on screen proves nothing about the
 * third. They arrive the way a real one does, through `localStorage`.
 *
 * `?demo=1`, always: vam is public, and every real session on this machine is
 * somebody's work.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/sidebar-tree-shots.mjs http://localhost:5529 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5529';
const outDir = process.argv[3] ?? 'docs/ui';

/** `SIDEBAR_STEP` in `SessionList.tsx`. Copied, because a guard cannot import
 *  a TypeScript module -- and pinned by being measured three times below, so a
 *  change to the constant that forgot this file fails here loudly. */
const STEP = 10;
/** `MARK_LANE_PX` in `status-mark.tsx`, copied for the same reason. */
const LANE = 14;
/** `.vam-spin`'s own duration, which `SPIN_PERIOD_MS` also copies. */
const SPIN_PERIOD = 1100;

/**
 * Two groups, seeded the way a real one arrives.
 *
 * Keyed by SOURCE, because a group holds projects of one source (`prefs.ts`,
 * `StoredGroup`). The demo's three projects come from three different sources,
 * so two groups is the most the fixture can spell -- which is exactly enough:
 * one rule between them is what the separator has to draw, and the third
 * project stays ungrouped, which is the other case the indent has to answer.
 */
const PREFS = {
  groups: {
    factory: [{ id: 'g-build', name: 'build', projects: ['factory'] }],
    'claude-code': [{ id: 'g-notes', name: 'notes', projects: ['notes'] }],
  },
};

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

/** A page with the two groups already stored, so the sidebar has three levels
 *  to draw before its first render rather than after a reload. */
async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, ...options });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((prefs) => {
    window.localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
  }, PREFS);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]');
  return page;
}

const page = await open();

// ---------------------------------------------------------------- the levels

const levels = await page.evaluate(() => {
  const left = (sel) => {
    const el = document.querySelector(sel);
    return el === null ? null : Math.round(el.getBoundingClientRect().left);
  };
  return {
    groups: document.querySelectorAll('[data-group-heading]').length,
    // The BOXES, not the text: the box is what the focused row's slab and its
    // cursor stripe are drawn against, and it is the edge the eye follows.
    //
    // THE THREE MEASURED ARE THE THREE ON SCREEN. `[data-project-rows]` is
    // deliberately not one of them: it is the padded container, so its own
    // border box sits at its parent's content edge and only its CHILDREN move
    // -- reading its `left` would report the project's indent twice and the
    // session's not at all.
    group: left('[data-group-heading]'),
    project: left('[data-project-heading][data-project-id="factory"]'),
    row: left('[data-session-row="crosscheck-2"]'),
    // A project belonging to no group: the demo's `vam`, which no seeded group
    // claims. It has no parent on screen, so it sits at the group's own edge.
    ungrouped: left('[data-project-heading][data-project-id="vam"]'),
    ungroupedRow: left('[data-session-row="vam-build-1"]'),
  };
});
console.log('level edges:', JSON.stringify(levels));

check(
  'the seeded groups actually drew, so this file is looking at three levels',
  levels.groups === 2,
  `${levels.groups} group headings on screen`,
);
check(
  'a grouped project sits exactly one step inside its group',
  levels.project - levels.group === STEP,
  `group ${levels.group}, project ${levels.project}`,
);
check(
  'its rows sit exactly one step inside it -- the step that used to be SMALLER',
  levels.row - levels.project === STEP,
  `project ${levels.project}, row ${levels.row}`,
);
check(
  'so the three levels are three distinct edges, evenly spaced',
  levels.project - levels.group === levels.row - levels.project &&
    levels.group < levels.project &&
    levels.project < levels.row,
  JSON.stringify(levels),
);
check(
  'a project with no group above it stays at the top level',
  levels.ungrouped === levels.group,
  `ungrouped ${levels.ungrouped}, group ${levels.group}`,
);
check(
  'and its rows are still one step inside IT, so depth is what indents',
  levels.ungroupedRow - levels.ungrouped === STEP,
  `ungrouped ${levels.ungrouped}, its row ${levels.ungroupedRow}`,
);

// The register that separates the two captions, read off the PAINT. A content
// scan proves `uppercase` was typed; `text-transform` is what a reader sees.
const register = await page.evaluate(() => {
  const styleOf = (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return { transform: cs.textTransform, spacing: cs.letterSpacing, text: el.textContent.trim() };
  };
  const nameIn = (sel) => {
    const heading = document.querySelector(sel);
    const spans = [...(heading?.querySelectorAll('span') ?? [])];
    const name = spans.find((s) => s.textContent.trim().length > 1 && s.querySelector('svg') === null);
    if (name === undefined) return null;
    const cs = getComputedStyle(name);
    return { transform: cs.textTransform, spacing: cs.letterSpacing, text: name.textContent.trim() };
  };
  return {
    group: nameIn('[data-group-heading]'),
    project: nameIn('[data-project-heading][data-project-id="factory"]'),
    row: styleOf('[data-session-row="crosscheck-2"] [data-row-title]'),
  };
});
console.log('type register:', JSON.stringify(register));
check(
  'the group heading still shouts, which is what makes it the level above',
  register.group?.transform === 'uppercase' && register.group?.spacing !== 'normal',
  JSON.stringify(register.group),
);
check(
  'the project heading does not -- it is written the way its directory is',
  register.project?.transform === 'none' && register.project?.spacing === 'normal',
  JSON.stringify(register.project),
);

// The rule above a group, which is the boundary the list's own even gaps could
// not draw. Measured as a painted border rather than as a class.
const rules = await page.evaluate(() =>
  [...document.querySelectorAll('[data-group-heading]')].map((heading) => {
    const li = heading.closest('li');
    const cs = getComputedStyle(li);
    return {
      group: heading.getAttribute('data-group-id'),
      width: Number.parseFloat(cs.borderTopWidth),
      colour: cs.borderTopColor,
      pad: Number.parseFloat(cs.paddingTop),
      first: li.previousElementSibling === null,
    };
  }),
);
console.log('group rules:', JSON.stringify(rules));
check(
  'the group that follows something is separated by a painted rule and space',
  rules.some((r) => !r.first && r.width > 0 && r.pad > 0),
  JSON.stringify(rules),
);
check(
  'the first thing in the list draws none -- the chrome above it already has one',
  rules.every((r) => !r.first || r.width === 0),
  JSON.stringify(rules),
);

// ----------------------------------------------------------------- the marks

const marks = await page.evaluate(() =>
  [...document.querySelectorAll('[data-session-row] [data-status-mark]')].map((mark) => {
    const box = mark.getBoundingClientRect();
    const glyph = mark.querySelector('svg:not([data-mark-motion="rest"])');
    return {
      status: mark.getAttribute('data-status-mark'),
      w: Math.round(box.width),
      h: Math.round(box.height),
      glyph: glyph === null ? 'dot' : [...glyph.classList].find((c) => c.startsWith('lucide-')),
      // The row's own accessible text says the status too: the mark is the
      // only place a desktop row carries it at all.
      said: mark.textContent.trim(),
    };
  }),
);
console.log('status marks:', JSON.stringify(marks));

check(
  'every status the model has is on screen, so the screenshot shows all five',
  new Set(marks.map((m) => m.status)).size === 5,
  JSON.stringify([...new Set(marks.map((m) => m.status))]),
);
check(
  'every mark paints the same fixed lane, whatever its status',
  marks.length > 0 && marks.every((m) => m.w === LANE && m.h === LANE),
  JSON.stringify(marks.filter((m) => m.w !== LANE || m.h !== LANE)),
);
check(
  'each status draws its own glyph',
  marks.every((m) =>
    ({
      running: 'lucide-loader-circle',
      waiting: 'lucide-bell',
      done: 'lucide-check',
      failed: 'lucide-triangle-alert',
      idle: 'dot',
    })[m.status] === m.glyph,
  ),
  JSON.stringify(marks.map((m) => [m.status, m.glyph])),
);
check(
  'and says its status in words, for a reader who sees no shape',
  marks.every((m) => m.said === m.status),
  JSON.stringify(marks.map((m) => [m.status, m.said])),
);

// A row whose source cannot name a branch draws neither glyph nor dash; a row
// that has one draws both. Both halves, or "nothing is drawn" would pass on a
// build that lost the whole line.
const branches = await page.evaluate(() =>
  [...document.querySelectorAll('[data-session-row]')].map((row) => {
    const cell = row.querySelector('[data-session-branch]');
    return {
      id: row.getAttribute('data-session-row'),
      // `sr-only` text is clipped to a 1px box but still in `textContent`; the
      // visible name is what the head and tail spans hold.
      name: [...row.querySelectorAll('[data-branch-head], [data-branch-tail]')]
        .map((s) => s.textContent)
        .join(''),
      dash: (cell?.textContent ?? '').includes('—'),
      glyph: row.querySelector('.lucide-git-branch') !== null,
    };
  }),
);
console.log('branch cells:', JSON.stringify(branches));
check(
  'a row with no branch draws no glyph and no dash',
  branches.filter((b) => b.name === '').length > 0 &&
    branches.every((b) => b.name !== '' || (!b.dash && !b.glyph)),
  JSON.stringify(branches.filter((b) => b.name === '')),
);
check(
  'a row with a branch still draws both',
  branches.filter((b) => b.name !== '').length > 0 &&
    branches.every((b) => b.name === '' || b.glyph),
  JSON.stringify(branches.filter((b) => b.name !== '')),
);

// THE ONE MEASUREMENT `token-contrast.test.ts` CANNOT MAKE. That guard parses
// the stylesheet and compares two declarations, so it reads `--vam-ink-faint`
// and stays green however far an `opacity` on the element dims the paint. The
// age and the branch are dimmed exactly that way (see `SessionList.tsx`), so
// the accessibility floor for this row can only be checked HERE, against
// composited pixels: the alpha is applied by hand over the nearest ancestor
// that actually paints, which is what the compositor does.
const metaInk = await page.evaluate(() => {
  const channels = (value) => {
    const parts = value.match(/[\d.]+/g);
    return parts === null ? null : parts.map(Number);
  };
  // EVERY row, not the first one. A selected row is filled with a lighter
  // surface than a resting one, so the first match is not the worst case and a
  // check that reads only it would pass while the row an operator is actually
  // looking at fails.
  return [...document.querySelectorAll('[data-row-meta-line]')].map((el) => {
    const cs = getComputedStyle(el);
    // `rgba(0, 0, 0, 0)` is NOT a ground. Taking a transparent background for
    // black is how a contrast check reports a comfortable pass over nothing.
    let ground = null;
    for (let node = el; node !== null; node = node.parentElement) {
      const bg = channels(getComputedStyle(node).backgroundColor);
      if (bg !== null && (bg.length < 4 || bg[3] > 0)) {
        ground = bg.slice(0, 3);
        break;
      }
    }
    const fg = channels(cs.color);
    return { fg: fg === null ? null : fg.slice(0, 3), alpha: Number(cs.opacity), ground };
  });
});
// The corpus is part of the assertion: "no row failed" over zero rows is the
// same sentence as "every row passed", and only one of them is worth having.
check(
  'the dimmed age and branch were found, and every one has a ground that paints',
  metaInk.length > 1 &&
    metaInk.every(
      (row) => row.fg !== null && row.ground !== null && row.alpha > 0 && row.alpha < 1,
    ),
  JSON.stringify(metaInk),
);
{
  const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratios = metaInk.map((row) => {
    const painted = row.fg.map((c, i) => row.alpha * c + (1 - row.alpha) * row.ground[i]);
    const a = lum(painted);
    const b = lum(row.ground);
    return {
      painted: `rgb(${painted.map(Math.round).join(', ')})`,
      ground: `rgb(${row.ground.join(', ')})`,
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    };
  });
  const worst = ratios.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
  console.log(`meta ink, ${ratios.length} rows composited; worst ${JSON.stringify(worst)}`);
  check(
    'and what the compositor really paints clears WCAG 1.4.3 on the WORST row',
    worst.ratio >= 4.5,
    `worst ${worst.ratio.toFixed(2)}:1, ${worst.painted} on ${worst.ground}`,
  );
}

await page.screenshot({ path: `${outDir}/sidebar-tree-levels.png` });
console.log(`${outDir}/sidebar-tree-levels.png`);
await page.locator('[data-sidebar-pane]').screenshot({ path: `${outDir}/sidebar-tree-column.png` });
console.log(`${outDir}/sidebar-tree-column.png`);

// The project menu, which is where the heading's `+` went.
await page.locator('[data-project-heading][data-project-id="factory"]').hover();
await page.locator('[data-project-menu="factory"]').click();
await page.waitForSelector('[data-project-menu-panel="factory"]');
const menu = await page.evaluate(() => ({
  items: [...document.querySelectorAll('[data-project-menu-panel] [role="menuitem"]')].map((i) =>
    i.getAttribute('data-project-menu-item'),
  ),
  focused: document.activeElement?.getAttribute('data-project-menu-item') ?? null,
  adds: document.querySelectorAll('[data-new-session-in-project]').length,
}));
console.log('project menu:', JSON.stringify(menu));
check('no `+` is left on any heading', menu.adds === 0, `${menu.adds} still drawn`);
check(
  'the add is the menu item the keyboard lands on, so `...` then Enter starts one',
  menu.items[0] === 'new-session' && menu.focused === 'new-session',
  JSON.stringify(menu),
);
await page.locator('[data-sidebar-pane]').screenshot({ path: `${outDir}/sidebar-tree-menu.png` });
console.log(`${outDir}/sidebar-tree-menu.png`);
await page.keyboard.press('Escape');

// --------------------------------------------------------------- the spinner

/**
 * ONE CLOCK, MEASURED ON A SPINNER THAT MOUNTED LATE.
 *
 * Collapsing the project unmounts its rows; expanding it mounts a brand new
 * `LoaderCircle`. A per-element animation start would put that one at angle 0
 * while every other running mark in the app is wherever the shared clock has
 * reached -- so the expand is timed to happen near the MIDDLE of a turn, where
 * "0" and "correct" are as far apart as they can be. The assertion is not
 * "some delay is set": it is that the mark's own phase agrees with
 * `Date.now() % period`, read in the same frame so no round trip can drift it.
 */
await page.locator('[data-project-collapse="factory"]').click();
await page.waitForTimeout(150);
const spin = await page.evaluate(
  async ({ period }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // Sit here until the wall clock is mid-turn. A build with no shared clock
    // then reads ~0 against an expected ~550, which is half a revolution.
    while (Date.now() % period < period * 0.45 || Date.now() % period > period * 0.6) {
      await wait(5);
    }
    document.querySelector('[data-project-collapse="factory"]').click();
    // One frame, so React has committed and the animation has a start time.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const mark = document.querySelector(
      '[data-session-row="crosscheck-2"] [data-mark-motion="spin"]',
    );
    if (mark === null) return { error: 'the re-expanded project drew no spinning mark' };
    const anim = mark.getAnimations()[0];
    if (anim === undefined) return { error: 'the spinning mark is running no animation at all' };
    const timing = anim.effect.getTiming();
    // `currentTime` excludes the delay, so the phase the compositor draws is
    // current + |delay| into the turn, modulo one turn.
    const delay = Number(timing.delay ?? 0);
    const phase = ((Number(anim.currentTime) - delay) % period + period) % period;
    return { phase: Math.round(phase), clock: Date.now() % period, delay: Math.round(delay) };
  },
  { period: SPIN_PERIOD },
);
console.log('spinner phase:', JSON.stringify(spin));
if (spin.error !== undefined) {
  check('a re-expanded project spins', false, spin.error);
} else {
  const off = Math.min(
    Math.abs(spin.phase - spin.clock),
    SPIN_PERIOD - Math.abs(spin.phase - spin.clock),
  );
  check(
    'a spinner that mounts late joins the others at the angle the clock is at',
    off < 120,
    `phase ${spin.phase}ms, clock ${spin.clock}ms, ${off}ms apart`,
  );
  check(
    'which it does by carrying a negative delay, not by starting from zero',
    spin.delay < 0,
    `delay ${spin.delay}ms`,
  );
}

// ------------------------------------------------------------------ the bell

/**
 * IT RINGS ONCE. Both halves matter: a build whose `.vam-swing` rule was
 * deleted would sail through "it has stopped" while ringing never at all, so
 * the animation is caught RUNNING first -- on a bell that has just remounted,
 * for the same reason the spinner needed one.
 */
await page.locator('[data-project-collapse="notes"]').click();
await page.waitForTimeout(150);
await page.locator('[data-project-collapse="notes"]').click();
const bell = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await new Promise((r) => requestAnimationFrame(r));
  const mark = () => document.querySelector('[data-session-row="notes-2"] [data-mark-swing]');
  const running = (mark()?.getAnimations() ?? []).map((a) => a.playState);
  await wait(2600);
  const later = (mark()?.getAnimations() ?? []).map((a) => a.playState);
  return { running, later };
});
console.log('bell:', JSON.stringify(bell));
check(
  'the waiting bell rings when the wait arrives',
  bell.running.includes('running'),
  JSON.stringify(bell),
);
check(
  'and settles rather than ringing for as long as vam is open',
  // An empty list is the same fact as `finished`: a CSS animation with no
  // fill is released once it has ended, so either answer means it stopped.
  // The check above is what stops that from passing on a bell that never rang.
  bell.later.every((state) => state === 'finished'),
  JSON.stringify(bell.later),
);

await page.close();

// -------------------------------------------------------- reduced motion

/**
 * A STOPPED SPINNER MUST NOT BE A BROKEN RING.
 *
 * `LoaderCircle` is an arc with a bite out of it, so `animation: none` leaves
 * a ring that looks damaged. The running mark carries a second body -- a whole
 * circle -- and the media query swaps them. Which one is displayed is the
 * cascade's answer about a real node, which is the one thing a content scan of
 * `styles.css` can never give.
 */
const quiet = await open({ reducedMotion: 'reduce' });
const rested = await quiet.evaluate(() => {
  const mark = document.querySelector('[data-session-row="crosscheck-2"] [data-status-mark]');
  const body = (motion) => {
    const el = mark?.querySelector(`[data-mark-motion="${motion}"]`);
    if (el == null) return null;
    const box = el.getBoundingClientRect();
    return {
      display: getComputedStyle(el).display,
      w: Math.round(box.width),
      animations: el.getAnimations().length,
      gapped: [...el.classList].includes('lucide-loader-circle'),
    };
  };
  return { spin: body('spin'), rest: body('rest') };
});
console.log('with reduced motion:', JSON.stringify(rested));
check(
  'the gapped arc is not merely frozen, it is not drawn',
  rested.spin?.display === 'none' && rested.spin?.w === 0,
  JSON.stringify(rested.spin),
);
check(
  'a whole ring is drawn in its place, and it is not the arc',
  rested.rest !== null && rested.rest.display !== 'none' && rested.rest.w > 0 && !rested.rest.gapped,
  JSON.stringify(rested.rest),
);
check(
  'and nothing is animating it',
  rested.rest?.animations === 0,
  JSON.stringify(rested.rest),
);
await quiet
  .locator('[data-sidebar-pane]')
  .screenshot({ path: `${outDir}/sidebar-tree-reduced-motion.png` });
console.log(`${outDir}/sidebar-tree-reduced-motion.png`);
await quiet.close();

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nsidebar tree: all checks passed.');
