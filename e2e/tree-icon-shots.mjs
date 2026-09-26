/**
 * THE COLOURED ICONS, MEASURED AS PAINT — at all three levels, in both themes.
 *
 * Everything here is a question a unit test is not allowed to answer, and two
 * of them are questions this repo has already been wrong about:
 *
 *  - WHETHER THE TONE CLASS RESOLVES TO ANYTHING. `text-icon-teal` in a class
 *    attribute proves a rule was TYPED. Whether `--color-icon-teal` exists in
 *    the built stylesheet, and whether the cascade lands it on the glyph, is a
 *    question about a browser. A selector that matched nothing has shipped
 *    here before behind a green content scan, so each tone is compared against
 *    a probe element painted with the token itself: if the token were missing
 *    they would both be `rgb(0, 0, 0)`, so the probe's own colour is asserted
 *    to differ from the ink the surrounding text uses.
 *  - WHETHER THE LIGHT THEME REALLY REMAPS THEM. The two blocks in
 *    `styles.css` are text until something switches `html.light` and looks.
 *    The same tone is measured in both themes and has to come out DIFFERENT,
 *    and to clear WCAG 1.4.11's 3:1 against the surface actually behind it in
 *    each -- which is a stronger claim than the unit guard's, because that one
 *    reads the grounds it was told about and this one reads the ground that is
 *    really there.
 *  - WHERE THE GLYPH'S BOX FALLS. A control can be half-buried and still take
 *    every click aimed at its centre, so the icon's rectangle is measured
 *    against the heading's and against the name beside it rather than clicked.
 *  - WHETHER A REFUSAL IS ON SCREEN. `toneRefusal` returning a sentence is a
 *    fact about a function; that the sentence has a box with a non-zero height
 *    in the open panel is a fact about the DOM, and it is the one that decides
 *    whether an operator ever reads it.
 *
 * AND THE BACKWARD COMPATIBILITY, AS PAINT. Icons written before glyphs
 * existed are still in the store and must still work, so the `notes` project
 * is seeded with a bare 🌙 and a heading drawing it in a real browser is the
 * evidence that no migration was needed.
 *
 * IT WAS TWO LEVELS OF THAT UNTIL THE SESSION ICON WAS REMOVED. `factory-sse-1`'s
 * 🔨 was read off its TAB -- the sidebar row had given up drawing one long
 * before, and then the tab did too ("remove the session icon from the tab",
 * with the provider glyph taking the slot). That left a picker writing to a
 * key nothing read, so the operator removed the picker as well.
 *
 * WHICH TURNS THE SESSION HALF OF THIS FILE INTO A DIFFERENT CLAIM, and a
 * better one than the absence it was. `PREFS` still seeds an `icons` key --
 * the exact bytes an operator who used the feature still has in their
 * browser -- and what is asserted is that a real vam LOADS that store and
 * draws nothing from it. Not "the key is absent", which any empty store would
 * satisfy: a stored value from that day is ignored rather than migrated, and
 * the rest of the document parses around it, which is what the project
 * assertions beside it prove. The project half is otherwise unchanged and
 * still carries the migration claim.
 *
 * `?demo=1`, always: vam is public, and every real session on this machine is
 * somebody's work.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/tree-icon-shots.mjs http://localhost:5529 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5529';
const outDir = process.argv[3] ?? 'docs/ui';

/**
 * The store an operator would have after using the picker, seeded the way a
 * real one arrives.
 *
 * ONE GROUP, because the demo fixture has none and a three-level tree with two
 * levels on screen proves nothing about the third (the same reason
 * `sidebar-tree-shots.mjs` seeds its own). Keyed by SOURCE at every level,
 * which is how `prefs.ts` keys all four buckets.
 *
 * TWO OF THE SEEDS ARE DELIBERATELY THE OLD KIND, and they are the load-bearing
 * half of this file. `factory-sse-1` keeps the 🔨 the fixture wrote, and the
 * `notes` project is given a bare emoji, so the tree on screen holds both kinds
 * at once and the panel has a target to refuse a colour for. A run seeded only
 * with glyphs would prove the new path and say nothing about the store every
 * operator already has.
 */
const NOW = new Date().toISOString();
const PREFS = {
  groups: {
    factory: [{ id: 'g-build', name: 'build', icon: 'lucide:boxes:teal', projects: ['factory'] }],
  },
  projectIcons: {
    factory: { factory: { icon: 'lucide:server:orange', at: NOW } },
    orca: { vam: { icon: 'lucide:code:purple', at: NOW } },
    'claude-code': { notes: { icon: '🌙', at: NOW } },
  },
  // A RETIRED KEY, SEEDED ON PURPOSE. Session icons are gone; `parsePrefs` no
  // longer looks for this. It stays so the sweep below is over a store that
  // really holds one, rather than over an empty one that would pass for free.
  icons: {
    factory: {
      'crosscheck-2': { icon: 'lucide:flask-conical:pink', at: NOW },
      'dogfood-4': { icon: 'lucide:package:yellow', at: NOW },
    },
  },
};

/** Tone → where it was seeded, for the per-level assertions below. */
const SEEDED = [
  { level: 'group', selector: '[data-group-icon="g-build"]', glyph: 'boxes', tone: 'teal' },
  {
    level: 'project',
    selector: '[data-project-icon="factory"]',
    glyph: 'server',
    tone: 'orange',
  },
  { level: 'project', selector: '[data-project-icon="vam"]', glyph: 'code', tone: 'purple' },
  // `notes` is not here on purpose: it carries an emoji, and is asserted as
  // one below rather than as a glyph that failed to appear.
  //
  // AND NEITHER IS THE SESSION LEVEL, WHICH NO LONGER EXISTS. It was
  // `[data-session-icon="crosscheck-2"]`, a `flask-conical` in `pink`, read
  // off the TAB -- the last surface drawing a session's icon once the sidebar
  // row had dropped it. The tab lost it, then the picker went with it, so
  // there is no such glyph and no `data-session-icon` in any DOM to measure.
  // The entry is removed rather than left to fail as "the glyph is drawn:
  // drew null", its seed STAYS in `PREFS` above, and the absence is asserted
  // below -- a RETIRED key that reaches no surface is the claim now.
  //
  // WHAT THAT COSTS THIS FILE, stated rather than glossed: `pink` is no
  // longer measured in either theme, and the tone questions at the top are
  // answered at the group and project levels only. The PROPERTIES survive --
  // a tone that resolves, a light theme that remaps, ink that clears 3:1 --
  // because each is a property of the token and the cascade, shared by all
  // eight tones and all three levels. The session level's own store
  // round-trip is pinned in unit space instead, through the picker that still
  // reads it (`test/canvas/Canvas.keyboard.test.tsx`).
];

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
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.addInitScript((prefs) => {
  window.localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}, PREFS);
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');

// TWO TABS OPEN, and the reason has inverted: it used to be "so a session's
// own icon is on screen at all", since the strip was the one surface that
// drew the chain. It is now so that the strip HAS tabs for the absence check
// to be about -- both of these sessions carry a stored icon (🔨 from the
// fixture, a pink flask from `PREFS`), so "nothing draws a session icon" is a
// claim with a corpus behind it rather than a sweep over an empty strip.
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.locator('[data-session-row="crosscheck-2"]').click();
await page.keyboard.press('Escape');
await page.keyboard.press('Control+[');
await page.waitForTimeout(250);

// The same maths `pane-colour-shots.mjs` injects, for the same reason: a
// measured paint and a floor have to be compared by one parser.
await page.evaluate(() => {
  const chan = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const parts = (colour) => colour.match(/[\d.]+/g).map(Number);
  const lum = (colour) => {
    const [r, g, b] = parts(colour);
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  };
  window.vamIcon = {
    ratio: (a, b) => {
      const [x, y] = [lum(a), lum(b)];
      const [hi, lo] = x > y ? [x, y] : [y, x];
      return (hi + 0.05) / (lo + 0.05);
    },
    /** The nearest ancestor that actually paints something. A glyph's own box
     *  is transparent, so "what is behind it" is a walk, not a parent. */
    groundOf: (el) => {
      for (let node = el.parentElement; node !== null; node = node.parentElement) {
        const fill = getComputedStyle(node).backgroundColor;
        if (/^rgb\(\s*\d/.test(fill)) return fill;
      }
      return getComputedStyle(document.body).backgroundColor;
    },
    /** What `var(--vam-icon-<tone>)` resolves to right now, read off a real
     *  painted probe rather than off the stylesheet's text. */
    probe: (tone) => {
      const el = document.createElement('span');
      el.style.color = `var(--vam-icon-${tone})`;
      document.body.appendChild(el);
      const colour = getComputedStyle(el).color;
      el.remove();
      return colour;
    },
  };
});

const painted = {};
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('light', t === 'light');
  }, theme);
  await page.waitForTimeout(120);

  const measured = await page.evaluate((seeded) => {
    const out = [];
    for (const item of seeded) {
      const host = document.querySelector(item.selector);
      const glyph = host?.querySelector('[data-icon-glyph]') ?? null;
      out.push({
        ...item,
        found: glyph !== null,
        drew: glyph?.getAttribute('data-icon-glyph') ?? null,
        colour: glyph === null ? null : getComputedStyle(glyph).color,
        ground: glyph === null ? null : window.vamIcon.groundOf(glyph),
        token: window.vamIcon.probe(item.tone),
        // The ink of ordinary text in the same column, so "the tone resolved
        // to something" is a claim with a control: an unresolved custom
        // property leaves `color` inherited, which is this value.
        inherited: host === null ? null : getComputedStyle(host.parentElement ?? host).color,
      });
    }
    return out;
  }, SEEDED);

  for (const m of measured) {
    const where = `${theme}/${m.level}/${m.glyph}`;
    check(`${where}: the glyph is drawn`, m.found && m.drew === m.glyph, `drew ${m.drew}`);
    if (!m.found) continue;
    check(
      `${where}: painted with its own token, not with the inherited ink`,
      m.colour === m.token && m.colour !== m.inherited,
      `painted ${m.colour}, token ${m.token}, inherited ${m.inherited}`,
    );
    const r = await page.evaluate(
      ([a, b]) => window.vamIcon.ratio(a, b),
      [m.colour, m.ground],
    );
    check(
      `${where}: clears 3:1 on the surface really behind it`,
      r >= 3,
      `${r.toFixed(2)}:1 of ${m.colour} on ${m.ground}`,
    );
    console.log(`      ${where}: ${m.colour} on ${m.ground} = ${r.toFixed(2)}:1`);
    painted[`${theme}/${m.tone}`] = m.colour;
  }

  // THE ICON THAT WAS NEVER MIGRATED, still drawn: `notes` carries the bare
  // emoji the old picker stored, and a heading that draws it is the evidence
  // that no migration was needed.
  //
  // IT USED TO BE TWO, at two levels -- the fixture's own 🔨 on
  // `factory-sse-1` was read off that session's TAB. The session half is an
  // ABSENCE now, and deliberately not deleted: the retired key is still
  // seeded, and "no surface draws a session icon" is exactly what the operator
  // asked for and exactly the kind of thing that comes back by accident. The
  // `[data-session-icon]` sweep is over the whole document, so it also catches
  // the slot reappearing somewhere new.
  //
  // `tabs` is counted in the same pass so the sweep can prove it had something
  // to sweep: zero drawn icons on zero tabs is a green that measured nothing,
  // and this strip is exactly where the last one used to be.
  const emoji = await page.evaluate(() => {
    const at = (sel) => {
      const host = document.querySelector(sel);
      return {
        text: host === null ? null : host.textContent,
        // An emoji is TEXT and must stay text: an svg here would mean the
        // reader had decided it was a glyph after all.
        drewSvg: host !== null && host.querySelector('svg') !== null,
      };
    };
    return {
      sessionIcons: document.querySelectorAll('[data-session-icon]').length,
      tabs: document.querySelectorAll('[data-session-tab]').length,
      project: at('[data-project-icon="notes"]'),
    };
  });
  check(
    `${theme}: the strip is drawn at all, so the sweep below has a corpus`,
    emoji.tabs > 0,
    `${emoji.tabs} tabs`,
  );
  check(
    `${theme}: a retired \`icons\` key is ignored — nothing draws a session icon`,
    emoji.sessionIcons === 0,
    `${emoji.sessionIcons} drawn`,
  );
  check(
    `${theme}: a project icon stored as a bare emoji still draws, with no migration`,
    emoji.project.text === '🌙' && !emoji.project.drewSvg,
    `heading drew ${JSON.stringify(emoji.project)}`,
  );

  // The boxes. A glyph that overlaps the name it sits before is one an
  // operator reads through, and no click check can see it.
  const boxes = await page.evaluate(() => {
    const heading = document.querySelector('[data-project-heading][data-project-id="factory"]');
    const icon = heading?.querySelector('[data-project-icon="factory"]');
    const name = [...(heading?.children ?? [])].find((el) => el !== icon && el.textContent.trim());
    const r = (el) => (el === undefined || el === null ? null : el.getBoundingClientRect());
    const [h, i, n] = [r(heading), r(icon), r(name)];
    return h === null || i === null || n === null
      ? null
      : {
          insideHeading: i.left >= h.left - 0.5 && i.right <= h.right + 0.5,
          beforeName: i.right <= n.left + 0.5,
          box: [Math.round(i.width), Math.round(i.height)],
        };
  });
  check(`${theme}: the project glyph has a box`, boxes !== null, 'no heading, icon or name found');
  if (boxes !== null) {
    check(
      `${theme}: it sits inside its heading and before the name, not over it`,
      boxes.insideHeading && boxes.beforeName,
      JSON.stringify(boxes),
    );
    console.log(`      project icon box: ${boxes.box[0]}x${boxes.box[1]}`);
  }

  // The column is scrolled to the focused row, which puts the top project
  // half off screen. The picture is meant to show all three levels at once,
  // so it is wound back first -- and the same wind-back is what lets the
  // assertions above find every seeded heading.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 4 && el.querySelector('[data-project-heading]')) {
        el.scrollTop = 0;
      }
    }
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${outDir}/tree-icons-${theme}.png` });
}

// THE REMAP, stated as the difference it has to be. Same tone name, same
// stored value, two themes: if the light block were a copy of the dark one
// these would be equal and the light sidebar would be carrying a pale glyph
// on near-white.
for (const tone of ['teal', 'orange', 'purple']) {
  const [d, l] = [painted[`dark/${tone}`], painted[`light/${tone}`]];
  check(
    `the light theme remaps ${tone} rather than reproducing it`,
    d !== undefined && l !== undefined && d !== l,
    `dark ${d}, light ${l}`,
  );
}

await page.evaluate(() => document.documentElement.classList.remove('light'));

// ------------------------------------------------------------- the picker

/** Opens the project picker by its own control, which is the mouse route an
 *  operator has (no chord picks a PROJECT icon -- `SessionList.tsx`). */
async function openPicker(projectId) {
  await page.locator(`[data-project-icon="${projectId}"]`).click();
  await page.waitForSelector('[data-icon-picker]');
}

await openPicker('factory');
const offered = await page.evaluate(() => ({
  glyphs: document.querySelectorAll('[data-icon-choice]').length,
  tones: document.querySelectorAll('[data-icon-tone-swatch]').length,
  // The eager shell is on screen even while the 300kB emoji dataset is not.
  emojiHalf: document.querySelector('[data-icon-picker]').textContent.includes('icon'),
  refusal: document.querySelector('[data-icon-tone-refusal]') !== null,
  live: [...document.querySelectorAll('[data-icon-tone-swatch]')].every((b) => !b.disabled),
  // Every swatch really paints its own tone: eight identical circles would
  // pass a count and tell an operator nothing.
  fills: [
    ...new Set(
      [...document.querySelectorAll('[data-icon-tone-swatch] span')].map(
        (el) => getComputedStyle(el).backgroundColor,
      ),
    ),
  ].length,
}));
check('the picker offers both kinds', offered.glyphs === 24 && offered.tones === 8, JSON.stringify(offered));
check(
  'with a glyph chosen, every swatch is live and nothing is explained away',
  offered.live && !offered.refusal,
  JSON.stringify(offered),
);
check('the eight swatches paint eight different colours', offered.fills === 8, `${offered.fills} distinct fills`);

// THE PANEL GOT TALLER, AND A PANEL THAT RUNS OFF THE BOTTOM IS A CONTROL YOU
// CANNOT REACH. Two rows were added above a 380px emoji grid that was already
// the tallest thing in the app, so its box is measured against the viewport
// rather than assumed to still fit.
const fits = await page.evaluate(() => {
  const r = document.querySelector('[data-icon-picker]').getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight };
});
check(
  'the panel still fits on screen with both new rows in it',
  fits.top >= 0 && fits.bottom <= fits.viewport,
  JSON.stringify(fits),
);
console.log(`      picker box: ${fits.top}..${fits.bottom} of ${fits.viewport}px`);

// Waited for on purpose before the picture: the emoji half is lazy, and a
// screenshot of its Suspense shell would show a panel nobody ever sees for
// more than a frame. The box measured above is the LOADED panel's, since the
// fallback reserves the grid's own 380px.
await page.waitForSelector('[data-icon-picker] input');
await page.screenshot({ path: `${outDir}/tree-icons-picker-glyph.png` });
// The scrim, not Escape: the panel's own Escape listener is on its shell and
// only fires for keys typed INSIDE it (so the emoji search box can close the
// panel), and the pointer route out is a click outside.
//
// AT THE SCRIM'S CORNER, not at its centre, and that is not a nicety: the
// scrim is `inset-0`, so its own centre is BEHIND the panel, and a default
// click there is intercepted by the emoji grid. Aiming at the middle of a
// full-screen backdrop is a click that can never land.
await page
  .locator('[aria-label="close the icon panel"]')
  .click({ position: { x: 12, y: 12 } });
await page.waitForSelector('[data-icon-picker]', { state: 'detached' });

// THE OTHER KIND. `notes` carries the emoji it was seeded with, so this opens
// the panel on the case where the tone row can do nothing at all.
//
// Seeded rather than edited-and-reloaded, which is the version of this that
// did not work: `addInitScript` runs on EVERY navigation, so a reload put the
// original prefs back and the panel opened on a glyph while this block went on
// asserting a refusal. The store has to be right before the first load.
await openPicker('notes');
const refused = await page.evaluate(() => {
  const said = document.querySelector('[data-icon-tone-refusal]');
  const box = said?.getBoundingClientRect() ?? null;
  return {
    text: said?.textContent ?? null,
    // ON SCREEN, not merely in the DOM: a sentence in a zero-height box is a
    // sentence nobody reads.
    visible: box !== null && box.height > 0 && box.width > 0,
    disabled: [...document.querySelectorAll('[data-icon-tone-swatch]')].every((b) => b.disabled),
    titled: [...document.querySelectorAll('[data-icon-tone-swatch]')].every(
      (b) => (b.getAttribute('title') ?? '') === (said?.textContent ?? ''),
    ),
  };
});
check('an emoji gets a refusal that is drawn, not just disabled swatches', refused.visible, JSON.stringify(refused));
check('the refusal says what it is about', (refused.text ?? '').includes('emoji'), refused.text);
check('every swatch is refused, and carries the same reason', refused.disabled && refused.titled, JSON.stringify(refused));
await page.screenshot({ path: `${outDir}/tree-icons-picker-emoji.png` });

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nAll tree-icon checks passed. Screenshots in ${outDir}.`);
