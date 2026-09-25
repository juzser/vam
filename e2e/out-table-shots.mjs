/**
 * A TABLE IN AN AGENT'S ANSWER, MEASURED AT THE TWO WIDTHS IT IS READ AT.
 *
 * Operator, translated: "tables in the out response need slightly larger
 * padding, and word wrap". The second half of that is a LAYOUT claim and
 * nothing else in this repo could make it: `out`'s table used to be
 * `w-max` -- sized to its own content -- so a cell never had a reason to
 * break a line and the scroller around it took every table sideways,
 * including a table of three sentences that would have fitted the pane with
 * room to spare.
 *
 * WHAT ONLY A REAL BROWSER CAN ANSWER, and therefore what this file is for:
 *
 *  1. WHETHER A CELL REALLY WRAPPED. happy-dom lays nothing out: every cell
 *     there is 0px tall whether it holds one word or forty. "The cell grew to
 *     more than one line" is a height compared against a cell KNOWN to hold
 *     one line -- the tiny table at the end of the fixture, same font and same
 *     padding -- rather than against a number that would freeze one machine's
 *     font metrics into a constant.
 *  2. WHETHER THE TABLE STILL FITS ITS PANE. `width: auto` hands the sizing to
 *     the CSS table algorithm, which is the whole fix and is also exactly the
 *     kind of thing a class-name assertion cannot see: `w-max` and no width at
 *     all produce the SAME DOM and two completely different pictures.
 *  3. WHAT THE SCROLLER IS STILL FOR. A column holding a token with no break
 *     opportunity in it -- a hash, a bare id -- cannot be narrowed by wrapping,
 *     so the table is wider than the pane and the existing `overflow-x-auto`
 *     takes it. `vam-no-scrollbar` HIDES that scrollbar, so "it scrolls" is
 *     `scrollWidth` against `clientWidth` and never a picture: this repo has
 *     already once reported a working, capped, scrolling column as a missing
 *     cap because the bar it looked for was hidden.
 *  4. WHETHER ANY CELL BECAME A SLIVER. The CSS table algorithm never narrows
 *     a column below its own minimum content width -- the widest unbreakable
 *     run in it -- and that is the floor this rendering relies on instead of a
 *     floor of its own. A floor that stopped holding (a `table-fixed`, a fixed
 *     width, a column count the algorithm gives up on) shows up as a cell whose
 *     content is WIDER THAN THE CELL, which is `scrollWidth` on every cell in
 *     the fixture and is unmeasurable anywhere else.
 *  5. AND AT 390px. The phone shell is chosen by `matchMedia` alone
 *     (`phone/viewport.ts`), so a second page at 390 is the real phone
 *     rendering of the same answer -- and a block that sizes itself is exactly
 *     the kind of change that has passed a fully green desktop gate in this
 *     repo and arrived broken on a phone.
 *
 * WHY ITS OWN PAGE RATHER THAN MORE OF `out-links-shots.mjs`, which is the
 * other guard that drives `OUT_MARKDOWN` through a stub. That file measures
 * the link pill's RECTANGLES at one viewport, against a recorded width from
 * the rendering it replaced; this one has to resize the window to two
 * different widths and re-measure, which would move every rectangle it
 * records. `files-markdown-shots.mjs` split from `files-tab-keyboard-shots.mjs`
 * for the same reason and says so in its own header: separable claims get
 * their own page.
 *
 * WHY IT IS NOT `?demo=1`: the demo fixture's answers contain no table, and
 * adding one to it would change the transcript every other demo-driven guard
 * counts turns and rows in. A SYNTHETIC stub satisfies the rule the demo
 * protects -- no real path, session id or transcript reaches a public repo --
 * completely: every string below is invented and nothing at all is read off
 * the machine that runs this.
 *
 *   node e2e/out-table-shots.mjs http://localhost:5520 e2e/test-results
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'tbl-1';

/**
 * THE WINDOW THAT PRODUCES THE DEFAULT PANE. The detail pane fills everything
 * to the sidebar's right (`prefs/panes.ts`), so the 408px this rendering is
 * designed against is a window of `DEFAULT_PANES.sidebar + DEFAULT_PANES.detail`
 * = 264 + 408. The pane's own width is asserted below rather than assumed --
 * the arithmetic is the reason for the number, not the evidence for it.
 */
const DESKTOP_WINDOW = 672;
const DETAIL_PANE = 408;
/** iPhone 12/13/14/15 portrait, the same figure `playwright.phone.config.ts` names. */
const PHONE_WINDOW = 390;

/** The padding the operator asked to be stepped up, and what it was: `px-2
 *  py-1` = 8px/4px. Read off `getComputedStyle`, so a class that stopped
 *  resolving to anything reads as the old number rather than as a pass. */
const WANT_PAD_X = 10;
const WANT_PAD_Y = 6;

const browser = await chromium.launch();

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`ok    ${label}`);
    return;
  }
  failures.push(label);
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/**
 * ONE ANSWER CARRYING THE FOUR SHAPES A TABLE ARRIVES IN, in this order --
 * every check below addresses a table by its index here.
 *
 *  0 PROSE   three columns of sentences. The operator's own case: it must wrap
 *            into the pane and must not scroll sideways.
 *  1 TOKEN   a path (which breaks after a `/` on its own) beside a token with
 *            no break opportunity in it at all. Nothing can wrap that column
 *            narrower, so the scroller takes the table -- and the PANE must
 *            not move a pixel.
 *  2 WIDE    six columns. Whatever this does, no cell may end up narrower than
 *            the content it holds.
 *  3 TINY    one line in every cell: the reference height the wrapping claims
 *            above are measured against.
 */
const ANSWER = [
  // A sentence of ordinary prose first, and not only for realism: the type
  // scale below is a RATIO against the body text around the table, which is
  // the only form of that claim that holds at every setting of the operator's
  // reading-size stepper. Without a paragraph there is nothing to be a rung
  // under.
  'Here is what each step does, and what it left behind.',
  '',
  '| Step | What it does | Why it is there |',
  '| --- | --- | --- |',
  '| parse | Reads the transcript and turns every line of it into a record the pane can draw | Because a string on disk is not a turn anybody can read |',
  '| render | Draws those records into the column, newest answer first | The operator reads the newest answer first and scrolls back |',
  '',
  '| File | Digest |',
  '| --- | --- |',
  '| src/renderer/panels/out-markdown.tsx | 9f2c1ab7d4e60351bb9a77cfe10d2a4455ef88129f2c1ab7d4e60351bb9a77cf |',
  '| e2e/run-web-guards.mjs | 41ab0092cc73e5d1f8a6b3ee0c9d77415a2b334441ab0092cc73e5d1f8a6b3ee |',
  '',
  '| Step | Owner | State | Opened | Closed | Result |',
  '| --- | --- | --- | --- | --- | --- |',
  '| parse | coder | done | 10:02 | 10:04 | ok |',
  '| render | tester | running | 10:04 | — | pending |',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
].join('\n');

const PROSE = 0;
const TOKEN = 1;
const WIDE = 2;
const TINY = 3;

/** The one stub both pages share: one project, one session, one answer. */
async function open(viewport, isMobile) {
  const page = await browser.newPage({
    viewport,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: 2,
  });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
  });
  await page.addInitScript((answer) => {
    const unavailable = () =>
      Promise.resolve({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
      });
    globalThis.window.api = {
      describe: async () => ({
        id: 'stub',
        label: 'Stub',
        capabilities: {
          liveUpdates: false,
          recordPrompt: false,
          deliverPrompt: false,
          promptAttachments: false,
          slashCommands: false,
          renameSession: false,
          closeSession: false,
          createSession: false,
          governance: false,
          pullRequests: false,
          terminal: false,
          agentRoster: false,
          resumeSession: false,
        },
        declines: {},
        viewerScope: 'operator',
      }),
      load: async () => [
        {
          id: 'p1',
          name: 'stub project',
          sessions: [
            {
              id: 'tbl-1',
              title: 'stub session',
              icon: null,
              epic: null,
              branch: null,
              status: 'waiting',
              runningAgents: 0,
              activity: null,
              age: '2m',
              decisions: [
                {
                  id: 'd1',
                  label: 'step 1',
                  input: 'Lay the steps out in a table.',
                  output: answer,
                  commands: [],
                },
              ],
            },
          ],
        },
      ],
      subscribe: () => () => {},
      recordPrompt: async () => {},
      renameSession: async () => {},
      closeSession: async () => {},
      createSession: async () => {},
      createSessionIn: async () => {},
      pickImageAttachment: async () => null,
      history: async () => unavailable(),
      agentWork: async () => unavailable(),
      applyWaivers: async () => {},
      transitionLesson: async () => {},
      usage: { get: async () => ({ kind: 'unavailable' }) },
      link: { open: async (url) => ({ ok: true, url }) },
    };
  }, ANSWER);
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForSelector(`[data-session-row="${SESSION}"]`, { timeout: 15_000 });
  await page.locator(`[data-session-row="${SESSION}"]`).first().click();
  await page.waitForSelector('[data-out-body] table', { timeout: 15_000 });
  return page;
}

/** Every rectangle the checks need, read in one pass off the real layout. */
function readTables() {
  const round = (n) => Math.round(n * 100) / 100;
  const body = document.querySelector('[data-out-body]');
  const pane = document.querySelector('[data-detail-pane]');
  const para = document.querySelector('[data-out-body] p');
  /**
   * THE NARROWEST A CELL'S OWN CONTENT CAN BE WITHOUT A WORD BEING CUT —
   * asked of the engine, by laying the cell's content out again at
   * `width: min-content`. Three readings were tried before this one and the
   * first two stayed GREEN under the `table-fixed` mutation this check exists
   * to catch:
   *
   *  - `scrollWidth` on a `<td>`: Chromium answers the padding box for a box
   *    whose overflow is `visible`, so content spilling out of a cell is
   *    invisible to it.
   *  - the widest LINE BOX, off a range over the cell's contents: nothing ever
   *    spills, because `DetailPanel.tsx`'s answer column carries `break-words`
   *    (`overflow-wrap: break-word`) and every descendant inherits it. A cell
   *    squeezed below a whole word does not overflow — it CUTS THE WORD.
   *  - the widest whitespace-delimited TOKEN, measured with a range: this one
   *    reddens on the mutation, and also reddens on a correct rendering, which
   *    is worse than useless. `src/renderer/panels/out-markdown.tsx` is one
   *    token and four legal break opportunities; a column that folds it after
   *    a `/` has cut nothing. Only UAX #14 knows where a line may break, and
   *    the engine is the only copy of UAX #14 in the building.
   *
   * `min-content` IS that answer, and it is the same number the table
   * algorithm itself sizes a column against. `break-word` (unlike `anywhere`)
   * leaves intrinsic sizing alone, so this floor is the widest UNBREAKABLE run
   * in the cell — which is exactly the floor `out-markdown.tsx` says it relies
   * on instead of a `min-width` of its own.
   */
  const contentFloor = (el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    probe.style.top = '0';
    probe.style.width = 'min-content';
    for (const prop of [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'letterSpacing',
      'wordSpacing',
      'overflowWrap',
      'wordBreak',
      'whiteSpace',
      'textTransform',
    ]) {
      probe.style[prop] = cs[prop];
    }
    for (const child of el.childNodes) probe.appendChild(child.cloneNode(true));
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  };
  const cell = (el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const padX = Number.parseFloat(cs.paddingLeft);
    return {
      tag: el.tagName,
      width: round(b.width),
      height: round(b.height),
      // The sliver signal: a floor wider than the room the cell leaves for it.
      // The table algorithm is supposed to make this impossible.
      floor: round(contentFloor(el)),
      room: round(el.clientWidth - padX - Number.parseFloat(cs.paddingRight)),
      clientWidth: el.clientWidth,
      padX,
      padY: Number.parseFloat(cs.paddingTop),
      fontSize: Number.parseFloat(cs.fontSize),
      text: (el.textContent ?? '').slice(0, 24),
    };
  };
  return {
    bodyWidth: round(body.getBoundingClientRect().width),
    bodyScroll: { client: body.clientWidth, scroll: body.scrollWidth },
    paneWidth: pane === null ? null : round(pane.getBoundingClientRect().width),
    page: {
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    },
    proseFont: para === null ? null : Number.parseFloat(getComputedStyle(para).fontSize),
    tables: [...document.querySelectorAll('[data-out-body] table')].map((table) => {
      const wrap = table.parentElement;
      return {
        columns: table.querySelectorAll('tr')[0].children.length,
        width: round(table.getBoundingClientRect().width),
        fontSize: Number.parseFloat(getComputedStyle(table).fontSize),
        wrap: {
          client: wrap.clientWidth,
          scroll: wrap.scrollWidth,
          overflowX: getComputedStyle(wrap).overflowX,
        },
        cells: [...table.querySelectorAll('th,td')].map(cell),
      };
    }),
  };
}

/** Every check that is the same at both widths. */
function measure(where, m) {
  check(`${where}: the answer drew all four tables`, m.tables.length === 4, JSON.stringify(m.tables.map((t) => t.columns)));
  if (m.tables.length !== 4) return;

  // -------------------------------------------------------------------------
  // 1. NOTHING IN THE ANSWER IS WIDER THAN THE PANE IT IS DRAWN IN.
  //
  // The reason the table was `w-max` inside a scroller in the first place: a
  // block with no width of its own lets the widest line in somebody else's
  // text decide how wide this pane is. Dropping `w-max` must not give that
  // back, so it is asserted here rather than reasoned about -- at the page,
  // at the answer's own column, and at every table's scroller.
  check(
    `${where}: the page itself does not scroll sideways`,
    m.page.scroll <= m.page.client,
    JSON.stringify(m.page),
  );
  check(
    `${where}: the answer's column does not scroll sideways`,
    m.bodyScroll.scroll <= m.bodyScroll.client + 1,
    JSON.stringify(m.bodyScroll),
  );
  const wide = m.tables.filter((t) => t.wrap.client > m.bodyScroll.client + 1);
  check(
    `${where}: no table's box is wider than the answer's column`,
    wide.length === 0,
    JSON.stringify(wide.map((t) => [t.columns, t.wrap.client])),
  );
  const unscrollable = m.tables.filter((t) => t.wrap.overflowX !== 'auto');
  check(
    `${where}: every table keeps a scroller of its own for what cannot fit`,
    unscrollable.length === 0,
    JSON.stringify(unscrollable.map((t) => t.wrap.overflowX)),
  );

  // -------------------------------------------------------------------------
  // 2. THE OPERATOR'S CASE: A TABLE OF PROSE WRAPS INTO THE PANE.
  //
  // Both halves are needed and neither implies the other. A table can fit the
  // pane by being narrow (nothing to wrap) and it can wrap while still being
  // wider than the pane; what was asked for is the pair.
  const prose = m.tables[PROSE];
  const oneLine = m.tables[TINY].cells[2].height;
  check(
    `${where}: a table of sentences does not scroll sideways`,
    prose.wrap.scroll <= prose.wrap.client + 1,
    `scroll ${prose.wrap.scroll} vs client ${prose.wrap.client}`,
  );
  check(
    `${where}: and it is no wider than the column it is drawn in`,
    prose.width <= m.bodyWidth + 1,
    `table ${prose.width} vs body ${m.bodyWidth}`,
  );
  // THE PAINT, NOT THE DECLARATION. `white-space` and `w-max` both leave the
  // same text in the same DOM; only the height says a line ever broke. The
  // reference is a cell of the same font and the same padding that holds one
  // line -- so this survives a machine whose glyphs are narrower.
  const sentence = prose.cells[4];
  check(
    `${where}: a sentence in a cell really breaks into lines`,
    sentence.height >= oneLine * 2 - 1,
    `cell ${sentence.height} vs one line ${oneLine} — ${sentence.text}`,
  );

  // -------------------------------------------------------------------------
  // 3. A TOKEN THAT CANNOT BE BROKEN IS THE SCROLLER'S JOB, AND ONLY ITS JOB.
  //
  // `vam-no-scrollbar` hides the bar, so this is the pair of numbers and never
  // a picture. The claim is not "it scrolls" on its own -- it is that the
  // overflow stayed INSIDE the table's own box while it did.
  const token = m.tables[TOKEN];
  check(
    `${where}: a column holding an unbreakable token scrolls rather than fitting`,
    token.wrap.scroll > token.wrap.client,
    `scroll ${token.wrap.scroll} vs client ${token.wrap.client}`,
  );
  check(
    `${where}: and the pane is exactly as wide as it was without it`,
    token.wrap.client <= m.bodyScroll.client + 1 && m.page.scroll <= m.page.client,
    JSON.stringify({ wrap: token.wrap.client, body: m.bodyScroll.client, page: m.page }),
  );

  // -------------------------------------------------------------------------
  // 4. NO CELL IS A SLIVER, IN ANY OF THE FOUR TABLES.
  //
  // The floor this rendering relies on is the CSS table algorithm's own: a
  // column is never narrower than the widest unbreakable run inside it. A cell
  // whose content is wider than the cell is that floor having stopped holding
  // -- which is what a `table-fixed`, a fixed width or a `min-width` fighting
  // the algorithm would produce, and what six columns at 390px would produce
  // if anything here divided the pane up equally.
  const cut = m.tables.flatMap((t, i) =>
    t.cells
      .filter((c) => c.floor > c.room + 1)
      .map((c) => `table ${i} ${c.tag} "${c.text}" floor ${c.floor} > room ${c.room}`),
  );
  check(
    `${where}: no cell is narrower than its own content can go without cutting a word`,
    cut.length === 0,
    JSON.stringify(cut),
  );

  // -------------------------------------------------------------------------
  // 5. THE PADDING THE OPERATOR ASKED FOR, ON BOTH KINDS OF CELL.
  //
  // Computed, not declared: a utility that stopped resolving reads back here
  // as the old 8/4 rather than as a pass.
  const pads = m.tables.flatMap((t) => t.cells.map((c) => `${c.tag}:${c.padX}/${c.padY}`));
  const wrongPad = [...new Set(pads)].filter((p) => !p.endsWith(`:${WANT_PAD_X}/${WANT_PAD_Y}`));
  check(
    `${where}: every cell, header and body alike, carries the stepped-up padding`,
    wrongPad.length === 0,
    JSON.stringify([...new Set(pads)]),
  );

  // -------------------------------------------------------------------------
  // 6. AND THE TYPE SCALE IS UNTOUCHED.
  //
  // A ratio, not a pixel: the pane's reading size is the operator's own
  // stepper, so 11.5-over-12 is the only form of this claim that is true at
  // every setting of it. `test/panels/out-font-size.test.tsx` holds the same
  // rung in the DOM; this holds it in the paint, beside a change that had
  // every reason to disturb it.
  const ratio = m.tables[PROSE].fontSize / m.proseFont;
  check(
    `${where}: a table still reads one rung under the prose around it`,
    Math.abs(ratio - 0.958) < 0.005,
    `${m.tables[PROSE].fontSize} / ${m.proseFont} = ${ratio}`,
  );
}

// ---------------------------------------------------------------------------
// THE DEFAULT DESKTOP PANE.

const desktop = await open({ width: DESKTOP_WINDOW, height: 800 }, false);
const deskM = await desktop.evaluate(readTables);
check(
  `at ${DESKTOP_WINDOW}px the detail pane really is the ${DETAIL_PANE}px default`,
  deskM.paneWidth !== null && Math.abs(deskM.paneWidth - DETAIL_PANE) <= 1,
  `pane ${deskM.paneWidth}`,
);
console.log(
  `      pane ${deskM.paneWidth}px, answer column ${deskM.bodyWidth}px, tables ${deskM.tables
    .map((t) => `${t.columns}col=${t.width}`)
    .join(' ')}`,
);
measure(`pane ${DETAIL_PANE}`, deskM);
await desktop.screenshot({ path: `${outDir}/out-tables-408.png` });
console.log(`${outDir}/out-tables-408.png`);
await desktop.close();

// ---------------------------------------------------------------------------
// THE PHONE. Same answer, same stub, a viewport `phone/viewport.ts`'s media
// query answers `true` to -- so this is the real phone shell and not a
// narrowed desktop one.

const phone = await open({ width: PHONE_WINDOW, height: 844 }, true);
const phoneM = await phone.evaluate(readTables);
check(
  `at ${PHONE_WINDOW}px the phone shell is what drew the answer`,
  phoneM.paneWidth === null,
  `a [data-detail-pane] of ${phoneM.paneWidth} means the desktop columns drew this`,
);
console.log(
  `      answer column ${phoneM.bodyWidth}px, tables ${phoneM.tables
    .map((t) => `${t.columns}col=${t.width}`)
    .join(' ')}`,
);
measure(`phone ${PHONE_WINDOW}`, phoneM);
await phone.screenshot({ path: `${outDir}/out-tables-390.png` });
console.log(`${outDir}/out-tables-390.png`);
await phone.close();

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall out-table checks passed');
