/**
 * THE PROVIDER MARK ON A SIDEBAR ROW, MEASURED ON THE PAINT.
 *
 * vam has two sources now, and the operator's ask was one sentence: "there
 * needs to be an icon before each session to tell the providers apart in the
 * sidebar." Every word of it is a question a unit environment cannot answer,
 * and one of them is a question the unit test was already answering WRONGLY:
 *
 *  - "BEFORE". `SessionList.provider-mark.test.tsx` asserts DOM order with
 *    `compareDocumentPosition`, and that is a proxy. It was falsified
 *    deliberately: adding `order-last` to the mark's wrapper moves the painted
 *    glyph to the far side of what it leads and leaves the DOM untouched, and
 *    the whole unit file stayed green. Only two rectangles answer "before", so
 *    that is what is compared here, on every row on screen.
 *
 *    WHAT IT IS BEFORE HAS CHANGED. The operator moved the mark: "in the
 *    sidebar, put the provider glyph before the branch name, under the session
 *    name." So the mark's right edge is compared with the BRANCH's left edge,
 *    and -- the half no DOM test can see at all -- its top against the
 *    title's bottom, because "under" is a fact about two lines and `order-last`
 *    could have put it after the title while leaving it on the title's line.
 *    The title line is separately required to hold no mark at all.
 *  - "TELL THEM APART". Two marks that both resolve to the same glyph satisfy
 *    every "a mark is present" assertion ever written. So each register's mark
 *    is RASTERISED and reduced to an occupancy signature, and the three are
 *    required to be three different pictures, each with real ink in it. That
 *    also catches the failure this repo has shipped twice: a Tailwind class
 *    naming a token that does not exist emits no rule at all, silently -- and
 *    a glyph on the wrong ink, or on none, is not a thing a class list knows.
 *  - NOT BY COLOUR. The computed `color` of every mark on screen has to be
 *    the SAME, which is the only way to prove the shape is carrying the whole
 *    signal. An operator who cannot rely on hue is the reason; `status-mark.tsx`
 *    already holds this line for the five statuses.
 *  - WHAT IT COSTS THE LINE IT IS ON. The bill is measured rather than
 *    asserted -- the painted box at the 200px sidebar minimum, with the lane
 *    and with it taken away -- because a number in a comment is not a
 *    measurement, and this repo has a lesson about exactly that. It is the
 *    BRANCH's box now: the mark left the title line, so the title pays
 *    nothing, and that is asserted too rather than assumed.
 *  - THE INKS MATCH. A Simple Icons outline fills its 24-unit viewBox and a
 *    lucide glyph keeps about two units of margin inside its own, so the same
 *    `size` paints two different amounts of ink. `SessionList.tsx`'s
 *    `HEADING_GLYPH_PX` records that exact inversion shipping once: every
 *    number was the number somebody chose and the picture was still wrong,
 *    because the eye reads the ink and not the box.
 *  - A SOURCE VAM DOES NOT KNOW still paints something. The demo fixture's
 *    third project is an `orca` one, which is in no table here, so the neutral
 *    register is on screen for free rather than needing to be arranged.
 *
 * THE CODEX CASE IS DRIVEN, NOT ASSUMED. The demo fixture has three sources
 * and none of them is `codex`, which is the operator's actual pair. Rather
 * than edit a fixture that every other guard counts rows in, one page rewrites
 * the served bundle's `orca` literal to `codex` -- the trick
 * `e2e/branch-overlap.spec.ts` already uses on this fixture -- and then PROVES
 * the rewrite landed by requiring a `codex` row on screen before it measures
 * anything. A rewrite that missed fails loudly instead of measuring `orca` and
 * calling it Codex.
 *
 * `?demo=1`, always: vam is public, and every real session on this machine is
 * somebody's work.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/provider-mark-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** `PROVIDER_LANE_PX` in `SessionList.tsx`. Copied, because a guard cannot
 *  import a TypeScript module -- and pinned by being measured on every row
 *  below, so a change to the constant that forgot this file fails here. Ten
 *  since the mark moved to the meta line, where it leads a 10px `GitBranch`
 *  rather than following a 14px status lane. */
const LANE = 10;
/** The meta line's `gap-1` between the provider mark and the branch glyph,
 *  which is the other half of what the BRANCH now pays. It was `gap-1.5`
 *  beside the status mark, and the title was paying it. */
const META_GAP = 4;
/** `SIDEBAR_MIN` in `prefs/panes.ts`. The window width that produces it is
 *  520 -- `SIDEBAR_MIN + DETAIL_MIN` -- for the reason `branch-overlap.spec.ts`
 *  states in full: one pixel narrower and there is no sidebar at all. */
const SIDEBAR_MIN_WINDOW = 520;

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

const browser = await chromium.launch();

/** The neutral box's own picture, taken on the demo page and read again on the
 *  Codex page, which has no unknown source left to compare against. */
let neutralSignature = null;

/**
 * A page on the demo, optionally with every `orca` source renamed to `codex`
 * in the served bytes.
 *
 * The rewrite is applied to whatever module carries the literal rather than to
 * a named chunk: `vite build` hashes its chunk names, so anchoring on one would
 * be anchoring on a build artefact. Whether it landed is not trusted -- the
 * caller asserts a `codex` row exists.
 */
async function open({ width, height, asCodex = false }) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  if (asCodex) {
    await page.route('**/*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      // ONLY THE `source` FIELD. The fixture's prose names Orca in several of
      // its answers, and rewriting those would change text other guards read.
      // Three quote styles because which one survives is the bundler's choice
      // and not ours -- today's `vite build` emits backticks.
      const next = body
        .replaceAll('source:`orca`', 'source:`codex`')
        .replaceAll('source:"orca"', 'source:"codex"')
        .replaceAll("source:'orca'", "source:'codex'");
      if (next === body) {
        await route.fulfill({ response });
        return;
      }
      await route.fulfill({ response, body: next, headers: response.headers() });
    });
  }
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]');
  return page;
}

/** Every row's rectangles and the ink they are drawn in, in one pass. */
const rowFacts = (page, scope = '') =>
  page.evaluate((prefix) => {
    const rect = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
    };
    return [...document.querySelectorAll(`${prefix}[data-session-row]`)].map((row) => {
      const mark = row.querySelector('[data-row-source]');
      const title = row.querySelector('[data-row-title]');
      const branch = row.querySelector('[data-session-branch]');
      // The box the TITLE has: its own line, less whatever precedes it. The
      // title element is content-sized until it runs out of space, so its own
      // width says nothing for a title that still fits -- which is every
      // title in this fixture, and is how a first version of this guard
      // measured the lane's cost as zero and was believed.
      const titleLine = title?.parentElement ?? null;
      // The same question for the BRANCH, which is what the lane costs now
      // that it leads the meta line. The mark's own parent is the box that
      // holds them both -- the branch cell on the desktop, the whole meta
      // line on the phone -- so one expression serves both rows.
      const branchCell = mark?.parentElement ?? null;
      return {
        id: row.getAttribute('data-session-row'),
        source: mark?.getAttribute('data-row-source') ?? null,
        register: mark?.getAttribute('data-source-mark') ?? null,
        hidden: mark?.getAttribute('aria-hidden') ?? null,
        // The property, not a proxy: a decorative mark contributes no text to
        // the row's accessible name. Reading the WHOLE row for the source id
        // would be a different and wrong question -- `factory-sse-1` has the
        // word "factory" in its own title.
        announces: (mark?.textContent ?? '').trim(),
        drew: mark?.querySelector('svg') !== null && mark?.querySelector('svg') !== undefined,
        colour: mark === null ? null : getComputedStyle(mark).color,
        // The ink of the line the mark rides, so "it takes the line's own
        // colour" is a comparison and not an assumption. `GitBranch` beside
        // it inherits the same value.
        lineColour: branchCell === null ? null : getComputedStyle(branchCell).color,
        mark: rect(mark),
        title: rect(title),
        branch: rect(branch),
        // Drawn only for a row that HAS a branch -- a glyph beside an absence
        // would be a mark spent on nothing -- so it also sorts the rows into
        // the two shapes the meta line really has.
        branchGlyph: rect(row.querySelector('svg.lucide-git-branch')),
        room:
          titleLine === null || title === null
            ? null
            : titleLine.getBoundingClientRect().right - title.getBoundingClientRect().left,
        branchRoom:
          branchCell === null || branch === null
            ? null
            : branchCell.getBoundingClientRect().right - branch.getBoundingClientRect().left,
      };
    });
  }, scope);

/**
 * What one element actually PUTS ON SCREEN: the bounding box of its ink, how
 * many pixels of it there are, and a coarse occupancy signature.
 *
 * The signature is an 8x8 grid over the ink's own bounding box, `#` where a
 * cell holds ink and `.` where it does not. Coarse on purpose: two glyphs that
 * differ only in anti-aliasing must not read as different pictures, and two
 * that differ in SHAPE must. The ground is read from the nearest ancestor that
 * paints an opaque fill, because a threshold against `rgba(0,0,0,0)` is a
 * number with no meaning -- the same helper `sidebar-tree-shots.mjs` installs,
 * for the same reason.
 */
async function inkOf(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    let ground = null;
    for (let node = el; node !== null; node = node.parentElement) {
      const parts = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (parts !== undefined && (parts.length < 4 || parts[3] > 0)) {
        ground = parts.slice(0, 3);
        break;
      }
    }
    return { x: r.x, y: r.y, w: r.width, h: r.height, ground };
  }, selector);
  if (box === null || box.ground === null) return null;
  const margin = 3;
  const clip = {
    x: Math.floor(box.x) - margin,
    y: Math.floor(box.y) - margin,
    width: Math.ceil(box.w) + margin * 2,
    height: Math.ceil(box.h) + margin * 2,
  };
  const shot = await page.screenshot({ clip });
  return page.evaluate(
    async ({ b64, w, h, ground }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, w, h).data;
      const on = [];
      let minX = w;
      let maxX = -1;
      let minY = h;
      let maxY = -1;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          const away = Math.max(
            Math.abs(d[i] - ground[0]),
            Math.abs(d[i + 1] - ground[1]),
            Math.abs(d[i + 2] - ground[2]),
          );
          // Anti-aliased edges sit a few steps off the ground; a stroke sits
          // far off it. 24 is well above the first and well below the second
          // on both themes' surfaces.
          if (away > 24) {
            on.push([x, y]);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return { w: 0, h: 0, px: 0, sig: '' };
      const iw = maxX - minX + 1;
      const ih = maxY - minY + 1;
      const cells = new Array(64).fill(0);
      for (const [x, y] of on) {
        const cx = Math.min(7, Math.floor(((x - minX) / iw) * 8));
        const cy = Math.min(7, Math.floor(((y - minY) / ih) * 8));
        cells[cy * 8 + cx] += 1;
      }
      return {
        w: iw,
        h: ih,
        px: on.length,
        // A cell counts as inked only once it holds more than a stray
        // anti-aliasing pixel, so the signature is about the drawing.
        sig: cells.map((n) => (n > 1 ? '#' : '.')).join(''),
      };
    },
    { b64: shot.toString('base64'), w: clip.width, h: clip.height, ground: box.ground },
  );
}

// ══════════════════════════════════════════ the desktop, three registers at once
{
  const page = await open({ width: 1280, height: 860 });
  const rows = await rowFacts(page);

  // THE CORPUS, BEFORE ANY CLAIM ABOUT IT. Every check below walks `rows`, and
  // a walk over an empty list passes silently -- which is the failure mode
  // this repo has a standing lesson about.
  check('the demo drew session rows at all', rows.length > 0, `${rows.length} rows`);
  const registers = [...new Set(rows.map((r) => r.register))].sort();
  check(
    'all three registers are on screen, so none of them is asserted vacuously',
    registers.join(',') === 'brand,native,neutral',
    registers.join(','),
  );

  for (const row of rows) {
    check(
      `${row.id}: the mark is PAINTED before the branch name, not merely before it in the DOM`,
      row.mark !== null && row.branch !== null && row.mark.r <= row.branch.l + 0.5,
      row.mark === null ? 'no mark' : `mark right ${row.mark.r}, branch left ${row.branch.l}`,
    );
    // "UNDER THE SESSION NAME", the other half of the operator's sentence and
    // the half a DOM-order test cannot see at all: the mark is on the line
    // BELOW the title, not merely later in the markup. Rectangles, because
    // the move is a move in paint -- and because `order-last` could have put
    // it after the title while leaving it on the title's own line.
    check(
      `${row.id}: and it is painted BELOW the title, on the meta line`,
      row.mark !== null && row.title !== null && row.mark.t >= row.title.b - 0.5,
      row.mark === null ? 'no mark' : `mark top ${row.mark.t}, title bottom ${row.title.b}`,
    );
    check(
      `${row.id}: its lane is exactly ${LANE}px, whatever answered`,
      row.mark !== null && Math.round(row.mark.w) === LANE,
      row.mark === null ? 'no mark' : `${row.mark.w}px`,
    );
    check(
      `${row.id}: the mark is decorative, so a reader is not told the provider on every row`,
      row.hidden === 'true' && row.announces === '',
      `aria-hidden=${row.hidden}, text ${JSON.stringify(row.announces)}`,
    );
  }

  /**
   * THE COLUMN DOES NOT RIPPLE -- read within each of the two shapes the meta
   * line has, because it genuinely has two and one number over both would be
   * a check nobody could satisfy. A row whose source reports no branch draws
   * no branch GLYPH (a mark beside an absence is a mark spent on nothing), so
   * its name starts the lane plus one gap past the mark; a row with one
   * starts a glyph and a second gap further. What must not vary is the
   * distance WITHIN each group.
   *
   * THIS IS THE CHECK THAT CAUGHT THE SHRINKING GLYPH. It came back
   * [14, 28, 26]: an `<svg>` is a flex item with an auto basis, so `GitBranch`
   * was being squeezed to 8x10 on the tightest rows -- before the provider
   * lane existed, and worse with it. `flex-none` in `SessionList.tsx` is the
   * fix, and these two numbers are what hold it.
   */
  for (const [label, group] of [
    ['with a branch glyph', rows.filter((r) => r.branchGlyph !== null)],
    ['with no branch to name', rows.filter((r) => r.branchGlyph === null)],
  ]) {
    const lefts = [...new Set(group.map((r) => Math.round(r.branch.l - r.mark.l)))];
    check(
      `every row ${label} starts its branch name the same distance past its lane`,
      group.length > 0 && lefts.length === 1,
      `${group.length} rows, offsets ${JSON.stringify(lefts)}`,
    );
  }
  // And the glyph is the square it was drawn as. A `flex-none` that came off
  // would show up above as a rippling column and here as the reason.
  const squashed = rows
    .filter((r) => r.branchGlyph !== null && Math.round(r.branchGlyph.w) !== 10)
    .map((r) => `${r.id} ${r.branchGlyph.w}x${r.branchGlyph.h}`);
  check(
    'the branch glyph is 10x10 on every row, not squeezed narrow by a tight line',
    squashed.length === 0,
    JSON.stringify(squashed),
  );
  // AND THE TITLE LINE IS CLEAR OF IT. The mark used to sit between the
  // status mark and the title; drawing it in both places would satisfy every
  // check above and give the operator two glyphs a row.
  const onTitleLine = await page.evaluate(() =>
    [...document.querySelectorAll('[data-row-title]')].filter(
      (title) => title.parentElement?.querySelector('[data-row-source]') !== null,
    ).length,
  );
  check(
    'no title line still carries a provider mark',
    onTitleLine === 0,
    `${onTitleLine} of ${rows.length} rows`,
  );

  const colours = [...new Set(rows.map((r) => r.colour))];
  check(
    'every mark is drawn in ONE ink, so hue carries none of the signal',
    colours.length === 1 && /^rgba?\(\s*\d/.test(colours[0] ?? ''),
    JSON.stringify(colours),
  );

  /**
   * AND IT IS THE META LINE'S OWN INK, which is a different claim from the
   * one this block used to make and is made differently.
   *
   * On the title line the mark carried `text-ink-faint` of its own, and what
   * had to be proved was that the CLASS emitted a rule at all -- this repo
   * has shipped a Tailwind v4 class naming a missing token twice, silently,
   * so a probe took `var(--color-ink-faint)` and the mark's colour was
   * required to equal it and to differ from what it would have inherited.
   *
   * On the meta line the mark has NO colour class: it inherits, deliberately,
   * so that it and the `GitBranch` four pixels away are one grey rather than
   * two. There is therefore no class here to be missing, and the honest check
   * is the property that replaced it -- the mark's computed colour is the
   * line's, exactly. A stray `text-*` reintroduced on the lane would break
   * this, which is the regression the old check was really guarding against.
   * The line's own ink is measured, composited with its `opacity-[0.82]`, by
   * `sidebar-tree-shots.mjs`, and held above 4.5:1 on the worst row.
   */
  const ink = await page.evaluate(() => {
    // A row that HAS a branch: the glyph is suppressed for a null one (a mark
    // spent on an absence), and four of the demo's rows are null. Picking the
    // first mark on screen would compare against a glyph that is not there
    // and read as a failure of the ink rather than of the choice of row.
    const marks = [...document.querySelectorAll('[data-row-source]')];
    const withGlyph =
      marks.find((m) => m.parentElement.querySelector('svg.lucide-git-branch') !== null) ?? null;
    const mark = withGlyph ?? marks[0];
    const glyph = mark.parentElement.querySelector('svg.lucide-git-branch');
    return {
      foundABranchRow: withGlyph !== null,
      mark: getComputedStyle(mark).color,
      line: getComputedStyle(mark.parentElement).color,
      branchGlyph: glyph === null ? null : getComputedStyle(glyph).color,
    };
  });
  console.log(`  ink: ${JSON.stringify(ink)}`);
  check(
    'the mark is painted in the meta line’s own ink, with no colour class of its own',
    ink.mark === ink.line && /^rgba?\(\s*\d/.test(ink.mark),
    JSON.stringify(ink),
  );
  check(
    'so the provider glyph and the branch glyph beside it are one grey, not two',
    ink.foundABranchRow && ink.branchGlyph === ink.mark,
    ink.foundABranchRow
      ? JSON.stringify(ink)
      : 'no row on screen reports a branch, so this compared nothing',
  );
  check(
    'and every mark on screen still agrees on that ink',
    [...new Set(rows.map((r) => r.lineColour))].length === 1,
    JSON.stringify([...new Set(rows.map((r) => r.lineColour))]),
  );

  // ------------------------------------------------ three registers, three pictures
  const sample = (register) => rows.find((r) => r.register === register);
  const inks = {};
  for (const register of ['brand', 'native', 'neutral']) {
    const row = sample(register);
    inks[register] = row === undefined ? null : await inkOf(page, `[data-session-row="${row.id}"] [data-row-source]`);
    console.log(`  ${register} (${row?.source}): ${JSON.stringify(inks[register])}`);
  }
  for (const [register, ink] of Object.entries(inks)) {
    check(
      `the ${register} register puts real ink on screen`,
      ink !== null && ink.px > 12 && ink.w > 4 && ink.h > 4,
      JSON.stringify(ink),
    );
  }
  const sigs = Object.values(inks).map((i) => i?.sig ?? '');
  check(
    'the three registers are three DIFFERENT pictures, not one glyph three times',
    new Set(sigs).size === 3,
    sigs.map((s) => s.slice(0, 16)).join(' | '),
  );

  // ------------------------------------------------------------------ the inks match
  // The claim `SourceMark` makes when it takes a pixel off a brand path. A
  // brand mark two pixels taller than its neighbours is the `HEADING_GLYPH_PX`
  // inversion again: every number chosen deliberately, the picture still wrong.
  // ONE PIXEL, not "about the same". Two was the tolerance first written here
  // and it was exactly the slack the defect fits in: dropping the
  // compensation puts the brand mark at 12px of ink against the lucide
  // glyph's 10, which is a difference of two and would have passed. Measured
  // today: brand 11, native 10.
  const tall = Math.max(inks.brand.h, inks.native.h);
  const short = Math.min(inks.brand.h, inks.native.h);
  check(
    'the brand mark and the lucide one paint the same amount of ink, within one pixel',
    tall - short <= 1,
    `brand ${inks.brand.h}px tall, native ${inks.native.h}px`,
  );
  // Carried to the Codex page below: a mark that fell back to the neutral box
  // is only visible as a defect against the neutral box's own picture, and
  // that page has no unknown source left on it to compare with.
  neutralSignature = inks.neutral.sig;

  await page.locator('[data-sidebar-pane]').screenshot({ path: `${outDir}/provider-marks-sidebar.png` });
  await page.close();
}

// ══════════════════════════════════════ what it costs the BRANCH at SIDEBAR_MIN
/**
 * The bill moved with the mark, and so did this block.
 *
 * It measured what the lane took from the TITLE, because the lane sat on the
 * title's line: 18px at the 200px minimum, about three characters of a name
 * that was already truncating. The operator has moved the mark down to the
 * meta line, so the title pays nothing now and the BRANCH pays instead --
 * which is a smaller bill against a line that had two things on it rather
 * than four. Both halves are measured here: what the branch lost, and that
 * the title really got it back.
 */
{
  const page = await open({ width: SIDEBAR_MIN_WINDOW, height: 860 });
  const before = await rowFacts(page);
  check(
    'the sidebar is at its 200px floor, so this is the worst case and not a comfortable one',
    before.length > 0 &&
      (await page.evaluate(
        () => Math.round(document.querySelector('[data-sidebar-pane]')?.getBoundingClientRect().width ?? 0),
      )) === 200,
    `${before.length} rows`,
  );

  // How much of the meta line the mark and its gap occupy, read BEFORE the
  // lane is taken away -- afterwards there is nothing left to measure.
  const ornament = await page.evaluate(() => {
    const mark = document.querySelector('[data-row-source]');
    if (mark === null) return null;
    const cell = mark.parentElement.getBoundingClientRect();
    return Math.round(mark.getBoundingClientRect().right - cell.left);
  });

  // The lane taken away, gap and all: `display: none` removes a flex item, and
  // removing a flex item removes the gap beside it -- so this is the WHOLE
  // bill, not the lane alone.
  await page.addStyleTag({ content: '[data-row-source] { display: none !important; }' });
  const after = await rowFacts(page);

  // THE BILL IS THE ROOM THE BRANCH HAS, not the box it currently fills. The
  // same trap the title version of this check recorded: a demo name short
  // enough to fit has a content width that does not move when the lane goes,
  // and a guard reading THOSE would report a cost of zero and be believed.
  const costs = before
    .map((row, i) => (row.branchRoom === null ? null : Math.round(after[i].branchRoom - row.branchRoom)))
    .filter((n) => n !== null);
  const cost = [...new Set(costs)];
  console.log(`  room for the branch, with the mark: ${JSON.stringify(before.map((r) => (r.branchRoom === null ? null : Math.round(r.branchRoom))))}`);
  console.log(`  room for the branch, without it:    ${JSON.stringify(after.map((r) => (r.branchRoom === null ? null : Math.round(r.branchRoom))))}`);
  check(
    'the mark is measured on every row, so the cost below is not a cost of nothing',
    costs.length === before.length,
    `${costs.length} of ${before.length} rows`,
  );
  check(
    'the mark costs every branch name the same width -- the lane plus one gap and nothing else',
    cost.length === 1 && cost[0] === LANE + META_GAP,
    `${JSON.stringify(cost)}px (expected ${LANE + META_GAP})`,
  );
  /**
   * AND THE TITLE GOT ITS LINE BACK, held at a number rather than admired.
   *
   * 125px, which is what it was before the mark was ever drawn on that line;
   * the paired version measured 107. The floor below is not a design claim --
   * it is a REGRESSION BAR with a measurement behind it: the next ornament
   * somebody puts on the title line has to come and argue with this number
   * instead of quietly taking the rest of the name. 100 is the round number
   * the paired layout was already close to, and it is kept rather than raised
   * to 118 so that this reads as the same bar the ornament has to clear, not
   * a new one drawn around today's paint.
   */
  check(
    'the title still has a usable line at the sidebar minimum',
    before.every((row) => row.room >= 100),
    JSON.stringify(before.map((r) => Math.round(r.room))),
  );
  check(
    'hiding the lane does not move the title at all, because it is not on the title’s line',
    before.every((row, i) => Math.round(after[i].room) === Math.round(row.room)),
    'hiding the lane moved the title, so the lane is still on the title line: ' +
      `${JSON.stringify(before.map((r) => Math.round(r.room)))} vs ${JSON.stringify(after.map((r) => Math.round(r.room)))}`,
  );
  // And the shape of the meta line has not inverted: the branch name is still
  // the biggest thing on it, not a remainder after a mark and a glyph.
  check(
    'the meta line still gives the branch more room than its ornament takes',
    ornament !== null && before.every((row) => row.branchRoom > ornament),
    `ornament ${ornament}px, branch ${Math.round(before[0]?.branchRoom ?? 0)}px`,
  );
  await page.close();
}

// ══════════════════════════════════════════ the operator's own pair: Claude and Codex
{
  const page = await open({ width: 1280, height: 860, asCodex: true });
  const rows = await rowFacts(page);
  const codex = rows.filter((r) => r.source === 'codex');
  const claude = rows.filter((r) => r.source === 'claude-code');
  // PROVE THE REWRITE LANDED. Without this the two checks below would be
  // measuring `orca` and calling it Codex.
  check(
    'a Codex row is really on screen, so the pair below is the operator’s own',
    codex.length > 0 && claude.length > 0,
    `${codex.length} codex, ${claude.length} claude-code`,
  );
  check(
    'Codex takes vam’s own glyph -- not a borrowed OpenAI mark and not a blank',
    codex.every((r) => r.register === 'native' && r.drew),
    JSON.stringify(codex.map((r) => r.register)),
  );
  const codexInk = await inkOf(page, `[data-session-row="${codex[0]?.id}"] [data-row-source]`);
  const claudeInk = await inkOf(page, `[data-session-row="${claude[0]?.id}"] [data-row-source]`);
  console.log(`  codex ${JSON.stringify(codexInk)}\n  claude ${JSON.stringify(claudeInk)}`);
  check(
    'the two sources the operator actually has paint two different pictures',
    codexInk !== null && claudeInk !== null && codexInk.sig !== claudeInk.sig && codexInk.px > 12,
    `${codexInk?.sig.slice(0, 16)} vs ${claudeInk?.sig.slice(0, 16)}`,
  );
  // AND CODEX HAS A MARK OF ITS OWN, rather than having quietly fallen back
  // to the box every unknown source gets. Against the Claude burst alone that
  // fallback is invisible -- the two still differ -- which is exactly how it
  // survived the first version of this guard.
  check(
    'and Codex is not silently wearing the neutral box every unknown source gets',
    neutralSignature !== null && codexInk !== null && codexInk.sig !== neutralSignature,
    `${codexInk?.sig.slice(0, 16)} vs neutral ${String(neutralSignature).slice(0, 16)}`,
  );
  await page.locator('[data-sidebar-pane]').screenshot({ path: `${outDir}/provider-marks-claude-codex.png` });
  await page.close();
}

// ══════════════════════════════════════════════════════════ the phone, at 390px
{
  const page = await open({ width: 390, height: 844 });
  await page.waitForSelector('[data-phone-shell] [data-session-row]');
  const rows = await rowFacts(page, '[data-phone-shell] ');
  check('the phone list drew rows', rows.length > 0, `${rows.length} rows`);
  for (const row of rows) {
    check(
      `${row.id}: the phone keeps the mark -- a provider is as true at 390px as at 1280`,
      row.mark !== null && row.drew && Math.round(row.mark.w) === LANE,
      row.mark === null ? 'no mark' : `${row.mark.w}px`,
    );
    // The phone draws its OWN meta line -- the status word, the age, then the
    // branch -- so the mark had to be moved there separately, and a desktop
    // that looked right proved nothing about this row.
    check(
      `${row.id}: and it is painted below the title, on the phone’s own meta line`,
      row.mark !== null && row.title !== null && row.mark.t >= row.title.b - 0.5,
      row.mark === null ? 'no mark' : `mark top ${row.mark.t}, title bottom ${row.title.b}`,
    );
    check(
      `${row.id}: and it opens that line, ahead of everything on it`,
      row.mark !== null && row.branch === null
        ? true
        : row.mark !== null && row.branch !== null && row.mark.r <= row.branch.l + 0.5,
      row.mark === null ? 'no mark' : `mark right ${row.mark.r}, branch left ${row.branch?.l}`,
    );
  }
  // The branch is the LAST segment of the phone's line and is drawn only when
  // the source reports one, so the order check above is vacuous on a row
  // without it. This is the corpus assertion that at least one row had one.
  check(
    'at least one phone row reports a branch, so the order check was about something',
    rows.some((r) => r.branch !== null),
    `${rows.filter((r) => r.branch !== null).length} of ${rows.length} rows`,
  );
  // The one thing extra width on a 390px row can break: a row that no longer
  // fits its column. `scrollWidth` past `clientWidth` is the browser saying so.
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll('[data-phone-shell] [data-session-row]')]
      .map((row) => ({ id: row.getAttribute('data-session-row'), over: row.scrollWidth - row.clientWidth }))
      .filter((r) => r.over > 0),
  );
  check(
    'no phone row overflows its column now that it carries one more mark',
    overflow.length === 0,
    JSON.stringify(overflow),
  );
  await page.locator('[data-phone-shell]').screenshot({ path: `${outDir}/provider-marks-phone.png` });
  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nprovider-mark-shots: all checks passed.');
