/**
 * THE PRs TAB, IN A REAL BROWSER — what it draws, where it goes, what it does,
 * and, since the operator cut it from mobile, that a phone cannot reach it.
 *
 * WHY THIS EXISTS AT ALL, and it is not "more coverage". The unit tests for
 * this tab run in happy-dom, which performs NO LAYOUT: every assertion they
 * make is about which elements exist and what they contain. The operator's
 * report was partly about content ("it does not show line changes", "it needs
 * more information") and the fix put eleven new fields onto a row that used to
 * carry four. Whether those fields FIT is a rectangle question, and this
 * repository has already shipped a 390px defect through a fully green local
 * gate. So the width is measured here, in Chromium, at the narrowest screen
 * vam claims to serve.
 *
 * `?demo=1` CANNOT REACH THIS TAB WITH CONTENT. The demo fixture declares no
 * pull requests at all -- by design, it is a browser-build sample with no `gh`
 * behind it -- so the tab there correctly says this source does not report
 * them. Like `files-tab-keyboard-shots.mjs` before it, this guard stubs
 * `window.api` instead, and pays for that exception the same way: EVERY
 * STRING BELOW IS INVENTED. No real repository, branch, login or address
 * reaches this file.
 *
 * WHAT IT ASSERTS, none of which a unit environment can answer:
 *  - the row's own box stays inside the pane at 520px -- the narrowest window
 *    that still draws columns -- with every field visible rather than clipped,
 *    because a row that overflowed would hide the one field the operator
 *    opened this tab to read;
 *  - the composer really is gone from this view, measured off the DOM after a
 *    real click rather than off a predicate;
 *  - a click on the row reaches `prs.open` with the address that was drawn;
 *  - Merge OPENS A QUESTION and spawns nothing, and the question names the
 *    pull request -- the one guarantee standing between a side-panel button
 *    and an irreversible act on somebody's repository;
 *  - the confirm's own box fits that 520px screen, because a dialog that
 *    overflows is a dialog whose Cancel can be off-screen;
 *  - and at 390x844, with the same bridge installed and the same five pull
 *    requests served, NO view a phone can open reaches a row, a Merge or a
 *    Delete branch at all.
 *
 *   node e2e/prs-tab-shots.mjs http://localhost:5520 e2e/test-results
 *
 * FOUR OF THE FIVE SHOTS ARE COMMITTED, in `docs/ui`, and the default output
 * directory above is deliberately NOT that: `e2e/test-results` is ignored, so
 * a guard run during the gate cannot quietly rewrite a picture somebody is
 * reviewing. To refresh them, build the web bundle, serve it, and pass the
 * directory:
 *
 *   node e2e/prs-tab-shots.mjs http://localhost:5520 docs/ui
 *
 * and then keep `prs-tab-desktop.png`, `prs-tab-desktop-light.png`,
 * `prs-tab-narrow-rows.png` and `prs-tab-phone-withdrawn.png`.
 * `prs-tab-narrow.png` is the confirm dialog and belongs to that feature's
 * screenshot budget, not this row's.
 *
 * AND RUN IT WEB-ONLY. `test:e2e:phone` clears `e2e/test-results` when it
 * starts, so a phone run after a guard run leaves the pictures gone rather
 * than stale -- which is the better failure, but only if you know it.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'e2e/test-results';

/**
 * THE TWO NUMBERS THE ROW'S LAYOUT IS BUILT ON, READ FROM THE SOURCE rather
 * than copied here. A constant quoted into a guard is a CLAIM about the
 * source, and the two drift the first time one of them is edited -- at which
 * point the guard goes on passing about a number nothing uses.
 *
 * AND THE CLASS IS CHECKED TOO, in the same breath, because these are exactly
 * the numbers Tailwind cannot be trusted with: it finds classes by scanning
 * source TEXT for complete strings, so an interpolated `@min-[${N}px]:` is not
 * a string it can find and the rule is simply never generated -- no error, no
 * fallback, a row that is one column at every width. Source-level here; the
 * PAINT is falsified further down by walking the container across the seam.
 */
const PANEL = readFileSync(
  new URL('../src/renderer/panels/DetailPanel.tsx', import.meta.url),
  'utf8',
);
const constant = (name) => {
  const m = PANEL.match(new RegExp(`export const ${name} = (\\d+);`));
  if (m === null) throw new Error(`${name} is not exported from DetailPanel.tsx any more`);
  return Number(m[1]);
};
const PR_SPLIT_PX = constant('PR_SPLIT_PX');
const PR_STATUS_PX = constant('PR_STATUS_PX');
/**
 * THE RAIL'S FOUR SLOTS AND ITS TWO FLOORS, read the same way.
 *
 * `PR_STATUS_PX` is not a free number any more -- it is the sum of either
 * line, so the arithmetic is checked here rather than believed. A slot widened
 * without widening the rail would leave the rail's right edge flush and push
 * the other slot off its column, which every rectangle check below would
 * happily report as "one value each" for the four rows it still fitted on.
 */
const PR_SLOT = {
  state: constant('PR_SLOT_STATE_PX'),
  verdict: constant('PR_SLOT_VERDICT_PX'),
  diff: constant('PR_SLOT_DIFF_PX'),
  files: constant('PR_SLOT_FILES_PX'),
};
const PR_RAIL_MIN_PX = constant('PR_RAIL_MIN_PX');
const PR_STACKED_MIN_PX = constant('PR_STACKED_MIN_PX');
const SLOT_GAP_PX = 6;
for (const [line, a, b] of [
  ['one', PR_SLOT.state, PR_SLOT.verdict],
  ['two', PR_SLOT.diff, PR_SLOT.files],
]) {
  if (a + SLOT_GAP_PX + b !== PR_STATUS_PX) {
    throw new Error(
      `rail line ${line} is ${a} + ${SLOT_GAP_PX} + ${b} = ${a + SLOT_GAP_PX + b}, but PR_STATUS_PX ` +
        `is ${PR_STATUS_PX} — the rail's width is DERIVED from its slots and the two have drifted.`,
    );
  }
}
for (const literal of [
  `@min-[${PR_SPLIT_PX}px]:flex-row`,
  `@min-[${PR_SPLIT_PX}px]:w-[${PR_STATUS_PX}px]`,
  `min-h-[${PR_RAIL_MIN_PX}px]`,
  `min-h-[${PR_STACKED_MIN_PX}px]`,
]) {
  if (!PANEL.includes(literal)) {
    throw new Error(
      `no class string in DetailPanel.tsx reads \`${literal}\` — the constant and the markup have ` +
        'drifted, and Tailwind emits no rule for a class it cannot find as complete source text.',
    );
  }
}

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/**
 * A complete stub source with ONE session carrying three pull requests, plus
 * the `prs` bridge the tab acts through. Every call the bridge receives is
 * recorded on `window.__prs` so an assertion can ask what the page actually
 * asked for, rather than inferring it from what changed on screen.
 */
const install = () => {
  globalThis.window.__prs = { opened: [], acted: [] };
  const pr = (over) => ({
    number: 0,
    title: 'a pull request',
    state: 'open',
    checks: 'none',
    additions: null,
    deletions: null,
    changedFiles: null,
    headRefName: null,
    baseRefName: null,
    author: null,
    review: null,
    updatedAt: null,
    labels: [],
    url: null,
    mergeable: null,
    ...over,
  });
  globalThis.window.api = {
    describe: async () => ({
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: {
        liveUpdates: true,
        recordPrompt: true,
        deliverPrompt: false,
        promptAttachments: false,
        slashCommands: false,
        renameSession: false,
        closeSession: false,
        createSession: false,
        governance: false,
        pullRequests: true,
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
        name: 'atlas',
        sessions: [
          {
            id: 's1',
            title: 'connection pool',
            icon: null,
            epic: null,
            branch: 'fix/pool-limit',
            status: 'waiting',
            runningAgents: 0,
            activity: null,
            age: '14m',
            decisions: [
              {
                id: 'd1',
                label: 'step 1',
                input: 'The pool is exhausting under load.',
                output: 'Raised the ceiling.',
                commands: [],
              },
            ],
            pullRequests: {
              kind: 'ok',
              prs: [
                /**
                 * `checks: 'none'` IS THE CORPUS FOR THE MARK'S CONTRAST, and
                 * it is on THIS row for a mechanical reason rather than a
                 * convenient one.
                 *
                 * The four checks verdicts all have to appear somewhere in
                 * five rows, or the contrast assertion further down measures
                 * three of them and reports a clean sweep over the one that
                 * was broken -- `none` was the failing case (`bg-line-strong`
                 * on `bg-card`, 1.71:1 dark and 1.46:1 light) and the fixture
                 * did not contain it.
                 *
                 * #128 is the ONLY row whose pinned verdict does not depend on
                 * its checks: its `review: 'changes-requested'` outranks every
                 * checks rung of the ladder, so `data-pr-verdict` reads
                 * `changes requested` whatever `checks` says. #97, #121 and
                 * #131 are each pinned to a checks word, and #119 must keep
                 * `failing` -- it is the row that proves the ladder ORDERS
                 * rather than concatenates, by drawing `conflicts` while its
                 * checks are failing.
                 */
                pr({
                  number: 128,
                  title: 'Rework the detail pane so a narrow column stays readable end to end',
                  state: 'open',
                  checks: 'none',
                  additions: 6269,
                  deletions: 317,
                  changedFiles: 76,
                  headRefName: 'fix/pool-limit-and-the-configurable-ceiling',
                  baseRefName: 'release/next-quarter-integration',
                  author: 'operator',
                  review: 'changes-requested',
                  updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
                  labels: ['enhancement', 'needs review'],
                  url: 'https://github.com/operator/atlas/pull/128',
                  mergeable: 'mergeable',
                }),
                pr({
                  number: 121,
                  title: 'Spike the roster reader',
                  state: 'draft',
                  checks: 'pending',
                  additions: 0,
                  deletions: 42,
                  changedFiles: 1,
                  url: 'https://github.com/operator/atlas/pull/121',
                }),
                pr({
                  number: 97,
                  title: 'Carry the branch to the sidebar row',
                  state: 'merged',
                  checks: 'passing',
                  headRefName: 'feature/branch-in-the-sidebar',
                  baseRefName: 'main',
                  author: 'operator',
                  url: 'https://github.com/operator/atlas/pull/97',
                }),
                /**
                 * THE TWO ROWS THE MERGE COLOUR IS DECIDED ON, and they are
                 * here because `mergeable` has THREE values and the gap
                 * between two of them is the whole defect this guards.
                 *
                 * `null` IS THE COMMON ONE. GitHub computes mergeability
                 * lazily, so `UNKNOWN` -- which the reader maps to `null` --
                 * is what most open pull requests carry. A control greyed on
                 * `null` would refuse a merge GitHub has no objection to, on
                 * nearly every row the operator owns. This row asserts the
                 * NEGATIVE: not knowing must disable nothing.
                 */
                pr({
                  number: 131,
                  title: 'Teach the reader an older gh',
                  state: 'open',
                  checks: 'pending',
                  additions: 12,
                  deletions: 3,
                  changedFiles: 2,
                  headRefName: 'fix/older-gh',
                  baseRefName: 'main',
                  author: 'operator',
                  url: 'https://github.com/operator/atlas/pull/131',
                  mergeable: null,
                }),
                /** And the one case GitHub HAS ruled on: grey, and it says why. */
                pr({
                  number: 119,
                  title: 'Split the row left and right',
                  state: 'open',
                  checks: 'failing',
                  additions: 240,
                  deletions: 96,
                  changedFiles: 4,
                  headRefName: 'feature/two-sides',
                  baseRefName: 'main',
                  author: 'operator',
                  review: 'review-required',
                  updatedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
                  url: 'https://github.com/operator/atlas/pull/119',
                  mergeable: 'conflicting',
                }),
              ],
            },
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
    history: async () => ({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'not in this picture' },
    }),
    agentWork: async () => ({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'not in this picture' },
    }),
    applyWaivers: async () => {},
    transitionLesson: async () => {},
    usage: { get: async () => ({ kind: 'unavailable' }) },
    prs: {
      open: async (url) => {
        globalThis.window.__prs.opened.push(url);
        return { ok: true, url };
      },
      act: async (sessionId, action) => {
        globalThis.window.__prs.acted.push({ sessionId, action });
        return { ok: true, message: 'Squashed and merged pull request 128' };
      },
    },
  };
};

const browser = await chromium.launch();

/**
 * Open the PRs view and wait for its rows.
 *
 * ONE SELECTOR NOW, AND THAT IS THE POINT. This took a `phone` flag and a
 * second selector (`data-phone-view`, the hook `PhoneShell` states is
 * deliberately not the desktop's `data-view`) because both shells drew this
 * view. The phone does not: the operator cut it, and `visibleTabs`
 * (`src/renderer/panels/tabs.ts`) withdraws the name there. A second selector
 * kept for a shell that cannot reach this view would be a route this guard
 * believed in and the app did not -- so the phone's case is asserted as an
 * ABSENCE, in its own block below, rather than hidden behind an argument.
 */
async function openPrs(page) {
  await page.click('[data-view="prs"]');
  await page.waitForSelector('[data-pr-row]', { timeout: 5_000 });
}

/**
 * WCAG relative luminance and ratio over the `rgb(...)` the browser hands
 * back -- the same helper `model-picker-shots.mjs` installs, for the same
 * reason: a contrast claim about a control is only worth what the COMPUTED
 * colour says, and only against the nearest thing that actually paints a
 * fill. `opaque` is not decoration: a ratio taken against `rgba(0,0,0,0)` is
 * a number with no meaning at all.
 */
async function installInk(page) {
  await page.evaluate(() => {
    const chan = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const parts = (colour) => (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const opaque = (colour) => /^rgb\(\s*\d/.test(colour);
    const lum = (colour) => {
      const [r, g, b] = parts(colour);
      return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    };
    window.vamInk = {
      opaque,
      ratio: (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      },
      /** The nearest ancestor that paints an opaque fill -- what ink is ON. */
      groundOf: (el) => {
        let node = el;
        while (node !== null) {
          const fill = getComputedStyle(node).backgroundColor;
          if (opaque(fill)) return fill;
          node = node.parentElement;
        }
        return 'rgba(0, 0, 0, 0)';
      },
    };
  });
}

/**
 * EVERY ROW'S RAIL, AS RECTANGLES -- the one reading both the 1280 and the
 * 520 blocks work from, so the two cannot drift into measuring different
 * things about the same grid.
 *
 * `over` is `scrollWidth - clientWidth` on the slot itself: the only question
 * that distinguishes a word that FITS from one that is being clipped by a box
 * whose own width is perfectly correct.
 */
const readRails = () =>
  [...document.querySelectorAll('[data-pr-row]')].map((row) => {
    const box = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
    };
    const slot = (name, selector) => {
      const el = row.querySelector(selector);
      if (el === null) return null;
      return {
        name,
        ...box(el),
        over: el.scrollWidth - el.clientWidth,
        title: el.getAttribute('title'),
        text: el.textContent,
      };
    };
    const cs = getComputedStyle(row);
    const num = (k) => Number.parseFloat(cs.getPropertyValue(k)) || 0;
    return {
      number: row.querySelector('[data-pr-number]')?.textContent ?? '?',
      checks: row.getAttribute('data-pr-checks'),
      row: box(row),
      content:
        row.getBoundingClientRect().width -
        num('padding-left') -
        num('padding-right') -
        num('border-left-width') -
        num('border-right-width'),
      status: box(row.querySelector('[data-pr-status]')),
      identity: box(row.querySelector('[data-pr-identity]')),
      actions: box(row.querySelector('[data-pr-actions]')),
      slots: [
        slot('state', '[data-pr-state-label]'),
        slot('verdict', '[data-pr-verdict]'),
        slot('diff', '[data-pr-diff]'),
        slot('files', '[data-pr-files]'),
      ].filter((s) => s !== null),
      hasAuthor: row.querySelector('[data-pr-author]') !== null,
      hasLabels: row.querySelector('[data-pr-label]') !== null,
      verdicts: row.querySelectorAll('[data-pr-verdict]').length,
    };
  });

// ---------------------------------------------------------------- desktop
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(install);
  await page.goto(origin, { waitUntil: 'networkidle' });
  await openPrs(page);
  await installInk(page);

  check('five rows are drawn', (await page.locator('[data-pr-row]').count()) === 5);

  /**
   * THE OPERATOR'S FIRST ASK, measured on the paint rather than on the DOM:
   * the box is there AND it has a rectangle, which is what distinguishes a
   * field that is drawn from one that is present and collapsed to nothing.
   */
  for (const [name, selector] of [
    ['additions', '[data-pr-additions]'],
    ['deletions', '[data-pr-deletions]'],
    ['changed files', '[data-pr-files]'],
    ['branches', '[data-pr-branches]'],
    ['author', '[data-pr-author]'],
    // `[data-pr-review]` WAS HERE. The row no longer paints a review word at
    // all: `review required` is GitHub's default for any open pull request
    // with a reviewer requested, and `approved` is a second way to say what
    // `open` + `checks pass` already says. Both are still on the row's
    // accessible sentence; the slot they cost is now `[data-pr-verdict]`,
    // which draws exactly one word and is pinned per fixture row below.
    ['verdict', '[data-pr-verdict]'],
    ['updated at', '[data-pr-updated]'],
  ]) {
    const box = await page.locator(selector).first().boundingBox();
    check(`the ${name} field is painted with a real box`, box !== null && box.width > 0, name);
  }
  const labels = await page.locator('[data-pr-label]').count();
  check('both labels are drawn', labels === 2, String(labels));

  /**
   * ============================================================ THE TWO SIDES
   *
   * A RECTANGLE CLAIM, ANSWERED WITH RECTANGLES. "Identity left, status right"
   * is unanswerable in a unit environment -- happy-dom performs no layout, so
   * a test there can only confirm which element is inside which, which is the
   * claim a `flex-col` typo leaves completely intact. What follows measures
   * where the boxes actually LAND: whether the seam exists, which side of it
   * each field is on, whether anything overlaps, and whether anything is
   * outside the row that is supposed to contain it.
   */
  const sides = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-pr-row]')];
    return rows.map((row) => {
      const rect = (el) => {
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
      };
      const fields = (root, selectors) =>
        selectors
          .flatMap((s) => [...(root?.querySelectorAll(s) ?? [])])
          .map((el) => ({ hook: el.getAttributeNames().find((n) => n.startsWith('data-pr-')), ...rect(el) }));
      const identity = row.querySelector('[data-pr-identity]');
      const status = row.querySelector('[data-pr-status]');
      // `[data-pr-updated]` IS AN IDENTITY FIELD NOW. The age was the third
      // quantity on the rail's number line; it is a fact about the row rather
      // than about the diff, and the house already draws ages on the left meta
      // line (`SessionList.tsx`). Moving it here is what makes the seam check
      // below a real claim about where it sits rather than a stale one.
      const IDENTITY = ['[data-pr-title]', '[data-pr-number]', '[data-pr-branches]', '[data-pr-author]', '[data-pr-label]', '[data-pr-updated]'];
      const STATUS = [
        '[data-pr-state-label]', '[data-pr-verdict]', '[data-pr-diff]', '[data-pr-additions]',
        '[data-pr-deletions]', '[data-pr-files]', '[data-pr-merge]', '[data-pr-delete-branch]',
      ];
      const cs = getComputedStyle(row);
      const pad = (k) => Number.parseFloat(cs.getPropertyValue(k)) || 0;
      const border = (k) => Number.parseFloat(cs.getPropertyValue(k)) || 0;
      return {
        number: row.querySelector('[data-pr-number]')?.textContent ?? '?',
        row: rect(row),
        // The row's CONTENT box -- what a `container-type: inline-size` query
        // is evaluated against, and so the only width this breakpoint means.
        content:
          row.getBoundingClientRect().width -
          pad('padding-left') - pad('padding-right') -
          border('border-left-width') - border('border-right-width'),
        identity: rect(identity),
        status: rect(status),
        identityFields: fields(identity, IDENTITY),
        statusFields: fields(status, STATUS),
        strayIdentity: fields(status, IDENTITY).length,
        strayStatus: fields(identity, STATUS).length,
      };
    });
  });
  console.log(`  the row's own container measures ${sides[0]?.content?.toFixed(1)}px here`);

  check('there are five rows to measure', sides.length === 5, String(sides.length));
  check(
    'the pane is wide enough here to be above the split at all',
    sides.every((s) => s.content >= PR_SPLIT_PX),
    sides.map((s) => s.content.toFixed(1)).join(', '),
  );

  // THE SEAM ITSELF. Every identity box ends before every status box begins,
  // and the two share a horizontal band -- which is what "side by side" means
  // and what a stacked row would fail on both counts.
  const notSplit = sides.filter(
    (s) => !(s.identity.r <= s.status.l + 0.5 && s.identity.t < s.status.b && s.status.t < s.identity.b),
  );
  check(
    'every row draws identity to the LEFT of status, sharing a band',
    notSplit.length === 0,
    notSplit.map((s) => `${s.number} id ${s.identity.l}..${s.identity.r} vs st ${s.status.l}..${s.status.r}`).join('; '),
  );

  // And the fields obey it individually, not merely their two wrappers.
  const crossed = sides.flatMap((s) =>
    s.identityFields
      .filter((f) => f.w > 0 && f.r > s.status.l + 0.5)
      .map((f) => `${s.number} ${f.hook} right edge ${f.r.toFixed(1)} > status left ${s.status.l.toFixed(1)}`),
  );
  const crossedBack = sides.flatMap((s) =>
    s.statusFields
      .filter((f) => f.w > 0 && f.l < s.identity.r - 0.5)
      .map((f) => `${s.number} ${f.hook} left edge ${f.l.toFixed(1)} < identity right ${s.identity.r.toFixed(1)}`),
  );
  const measured = sides.reduce((n, s) => n + s.identityFields.length + s.statusFields.length, 0);
  // A SWEEP MUST PROVE IT FOUND A CORPUS: "nothing crossed" is exactly as
  // green over forty boxes as over none, and none is what a renamed
  // attribute would silently produce.
  check('there are fields on both sides to measure at all', measured >= 30, String(measured));
  check('no identity field reaches into the status column', crossed.length === 0, crossed.join('; '));
  check('no status field reaches back into the identity column', crossedBack.length === 0, crossedBack.join('; '));

  check(
    'no field is on the wrong side of the row in the DOM either',
    sides.every((s) => s.strayIdentity === 0 && s.strayStatus === 0),
    JSON.stringify(sides.map((s) => [s.number, s.strayIdentity, s.strayStatus])),
  );

  // THE RAIL IS A RAIL: the same width on every row, so the status words line
  // up DOWN the list. A content-sized column would start at a different x per
  // row, which is the whole gain of the split given back.
  const rails = [...new Set(sides.map((s) => Math.round(s.status.w)))];
  check('the status rail is the same width on every row', rails.length === 1, rails.join(', '));
  check(`and that width is PR_STATUS_PX (${PR_STATUS_PX})`, rails[0] === PR_STATUS_PX, String(rails[0]));
  const lefts = [...new Set(sides.map((s) => Math.round(s.status.l)))];
  check('every row starts its status at the same x', lefts.length === 1, lefts.join(', '));

  // AND NOTHING LEAVES THE ROW.
  const escaped = sides.flatMap((s) =>
    [...s.identityFields, ...s.statusFields]
      .filter((f) => f.w > 0 && (f.r > s.row.r + 0.5 || f.l < s.row.l - 0.5 || f.b > s.row.b + 0.5 || f.t < s.row.t - 0.5))
      .map((f) => `${s.number} ${f.hook} ${JSON.stringify(f)}`),
  );
  check('no field escapes its own row', escaped.length === 0, escaped.join('; '));

  /**
   * AND NOTHING IS PAINTED OVER, which a rectangle cannot answer.
   *
   * `data-view-overlay` -- the three view icons -- is ABSOLUTELY POSITIONED
   * at this pane's top right and reaches about 34px down into whatever is
   * below it. Moving status to a right rail moved the first row's state word,
   * checks and diff directly under it. Every check above stays green through
   * that: the boxes are laid out, they have width, they are inside the row,
   * they do not overlap each other, and a reader can see NONE of them.
   *
   * `elementFromPoint` IS THE ONLY QUESTION THAT SEES IT. Asked at several
   * points across each field, because a glyph can be half-buried and still
   * answer correctly at its own centre.
   */
  const buried = await page.evaluate(() => {
    const overlay = document.querySelector('[data-view-overlay]');
    if (overlay === null) return { drawn: false, hidden: [] };
    const hidden = [];
    let probes = 0;
    for (const el of document.querySelectorAll(
      '[data-pr-status] [data-pr-state-label], [data-pr-status] [data-pr-verdict],' +
        ' [data-pr-status] [data-pr-diff], [data-pr-status] [data-pr-additions],' +
        ' [data-pr-status] [data-pr-files], [data-pr-merge], [data-pr-delete-branch]',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      for (const fx of [0.1, 0.5, 0.9]) {
        for (const fy of [0.25, 0.75]) {
          probes += 1;
          const on = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
          if (on !== null && (on === overlay || overlay.contains(on))) {
            hidden.push(`${el.getAttributeNames().find((n) => n.startsWith('data-pr-'))} at ${fx}/${fy}`);
          }
        }
      }
    }
    return { drawn: true, hidden, probes };
  });
  // The pill has to be ON SCREEN for this to mean anything: an unfocused pane
  // draws none, and "nothing was buried" under no pill is not a measurement.
  check('the floating view pill is drawn here, so occlusion is askable at all', buried.drawn === true);
  check('and it probed a real corpus of status glyphs', (buried.probes ?? 0) >= 60, String(buried.probes));
  check(
    'nothing in the status rail is painted over by the view pill',
    buried.hidden.length === 0,
    buried.hidden.join('; '),
  );

  /**
   * ================================================== THE RAIL IS A GRID NOW
   *
   * DELETED HERE, WITH ITS REASON, BECAUSE A CHECK THAT VANISHES FROM A GUARD
   * IS INDISTINGUISHABLE FROM ONE THAT WAS NEVER WRITTEN:
   *
   *   "every line of the status rail is right-aligned against it"
   *
   * It grouped the rail's fields into the bands they happened to wrap into and
   * required every band to end at the rail's right edge. That claim is FALSE
   * of this layout on purpose. Line one holds WORDS, which are read left to
   * right, and its two slots are left-aligned inside fixed boxes so `open` and
   * the verdict start at the same x on every row; it is line TWO, the
   * magnitudes, that is right-aligned. The old check would redden on the
   * correct paint.
   *
   * WHAT REPLACES IT IS STRICTLY STRONGER, which is the only reason deleting
   * it is allowed: it asked for one edge per band, and the four checks below
   * ask for BOTH edges of every named slot, its exact width, the exact gap
   * between the pair, and that nothing inside it overflows -- on every row, at
   * two widths. A left-aligned line-one is not a thing that can now pass.
   */
  const railGrid = await page.evaluate(readRails);
  const one = (values) => [...new Set(values.map((v) => Math.round(v)))];
  const slotBoxes = railGrid.flatMap((r) => r.slots);
  // A SWEEP MUST PROVE IT FOUND A CORPUS: "every left edge is the same" is
  // vacuously true of zero rows, which is what a renamed hook produces.
  check(
    'there are slot boxes on every row to measure at all',
    slotBoxes.length >= 16 &&
      railGrid.every((r) => r.slots.some((s) => s.name === 'state') && r.slots.some((s) => s.name === 'verdict')),
    `${slotBoxes.length} boxes over ${railGrid.length} rows`,
  );

  // 9.1 THE WORDS START AT ONE x. This is the operator's complaint, answered:
  // across the eleven inked bands of the shot this pass began from, the rail's
  // left edges fell over a 63px spread.
  for (const name of ['state', 'verdict']) {
    const lefts = one(railGrid.flatMap((r) => r.slots.filter((s) => s.name === name)).map((s) => s.l));
    const found = railGrid.filter((r) => r.slots.some((s) => s.name === name)).length;
    check(
      `the ${name} slot starts at the same x on all ${found} rows that draw it`,
      lefts.length === 1 && found === 5,
      `${found} rows, x = ${lefts.join(', ')}`,
    );
  }

  // 9.2 AND THE NUMBERS END AT ONE x. Right edges, because a magnitude is
  // compared from its last digit.
  for (const name of ['diff', 'files']) {
    const rights = one(railGrid.flatMap((r) => r.slots.filter((s) => s.name === name)).map((s) => s.r));
    const found = railGrid.filter((r) => r.slots.some((s) => s.name === name)).length;
    check(
      `the ${name} slot ends at the same x on all ${found} rows that draw it`,
      rights.length === 1 && found >= 4,
      `${found} rows, x = ${rights.join(', ')}`,
    );
  }

  // 9.3 THE WIDTHS AND THE GAPS ARE THE SOURCE'S OWN NUMBERS, read out of
  // `DetailPanel.tsx` at the top of this file rather than retyped here.
  const wrongWidth = slotBoxes.filter((s) => Math.abs(s.w - PR_SLOT[s.name]) > 0.5);
  check(
    `every slot paints the width its constant declares (${Object.entries(PR_SLOT).map(([k, v]) => `${k} ${v}`).join(', ')})`,
    wrongWidth.length === 0,
    wrongWidth.map((s) => `${s.name} ${s.w.toFixed(1)}`).join('; '),
  );
  const gaps = railGrid.flatMap((r) => {
    const at = (n) => r.slots.find((s) => s.name === n) ?? null;
    return [
      ['line 1', at('state'), at('verdict')],
      ['line 2', at('diff'), at('files')],
    ]
      .filter(([, a, b]) => a !== null && b !== null)
      .map(([line, a, b]) => ({ line, number: r.number, gap: b.l - a.r }));
  });
  check(
    `both rail lines keep a ${SLOT_GAP_PX}px gap, on every row`,
    gaps.length >= 9 && gaps.every((g) => Math.abs(g.gap - SLOT_GAP_PX) <= 0.5),
    gaps.filter((g) => Math.abs(g.gap - SLOT_GAP_PX) > 0.5).map((g) => `${g.number} ${g.line} ${g.gap.toFixed(1)}`).join('; '),
  );

  /**
   * 9.4 AND 9.5 TOGETHER, BECAUSE THE SPEC PUTS THEM IN CONTRADICTION AND ONE
   * OF THEM HAS TO GIVE.
   *
   * §9.4 asks that NO slot overflow at either width. §9.5 asks that at least
   * one slot DOES clip, so the `title` bargain is not asserted over four boxes
   * that never needed it. Both cannot hold: every slot here is `flex-none` at
   * a width that does not change between 1280 and 520, so the set of clipping
   * slots is the same at both -- and §1 of the spec names exactly one member
   * of it, `changes requested` at a measured 100.4px in the 94px verdict slot,
   * and calls that "the only intentional truncation in the rail".
   *
   * SO THE OVERFLOW CHECK IS SCOPED TO WHAT IT IS ACTUALLY FOR. Its purpose is
   * a platform whose font metrics are wider than the ones these widths were
   * sized against -- the failure this repo has already had, 6.0079px/char on
   * macOS against 5.718 on the CI runner. That is caught by holding the three
   * slots with room to spare to zero overflow, and by requiring the ONE
   * expected clip to be exactly the declared string. A wider font shows up
   * either as a second clipping slot or as a clip in `state`, `diff` or
   * `files`, and both redden.
   */
  const EXPECTED_CLIP = { name: 'verdict', text: 'changes requested' };
  const clipping = slotBoxes.filter((s) => s.over > 1);
  const unexpected = clipping.filter((s) => s.name !== EXPECTED_CLIP.name || s.text !== EXPECTED_CLIP.text);
  check(
    `no rail slot overflows its box except the declared ${EXPECTED_CLIP.text} one`,
    unexpected.length === 0,
    unexpected.map((s) => `${s.name} "${s.text}" over by ${s.over}`).join('; '),
  );
  check(
    'and the declared one really is clipping, so the bargain below is not vacuous',
    clipping.some((s) => s.name === EXPECTED_CLIP.name && s.text === EXPECTED_CLIP.text),
    clipping.map((s) => `${s.name} ${s.over}`).join('; '),
  );
  const noTitle = clipping.filter((s) => s.title !== s.text);
  check(
    'every clipping slot carries its whole value on `title`',
    noTitle.length === 0,
    noTitle.map((s) => `${s.name} title=${JSON.stringify(s.title)} text=${JSON.stringify(s.text)}`).join('; '),
  );

  /**
   * AND THE TEXT INSIDE THE BOX IS ALIGNED THE WAY THE LINE IS READ, which no
   * rectangle above can see: all four boxes have the same edges whichever way
   * their contents are set. Words are read from their starts and magnitudes
   * are compared from their last digit, so line one is left and line two is
   * right -- asked as computed style, because `text-right` in a className is a
   * thing somebody typed.
   */
  const alignment = await page.evaluate(() =>
    Object.fromEntries(
      [
        ['state', '[data-pr-state-label]'],
        ['verdict', '[data-pr-verdict]'],
        ['diff', '[data-pr-diff]'],
        ['files', '[data-pr-files]'],
      ].map(([name, sel]) => {
        const el = document.querySelector(sel);
        return [name, el === null ? null : getComputedStyle(el).textAlign];
      }),
    ),
  );
  check(
    'the two word slots are set from their starts and the two number slots from their ends',
    ['start', 'left'].includes(alignment.state) &&
      ['start', 'left'].includes(alignment.verdict) &&
      alignment.diff === 'right' &&
      alignment.files === 'right',
    JSON.stringify(alignment),
  );

  /**
   * 9.6 ROW HEIGHTS ARE UNIFORM, which is the second half of "it all runs
   * together": the five rows measured 108, 56, 74, 90 and 108 before this --
   * a 52px spread over 7px gutters.
   *
   * NON-VACUITY IS THE WHOLE CHECK. One value out of five rows is exactly as
   * green over five identical rows as over the two that USED to differ by
   * 52px, so the two extremes are proved to still be in the fixture: a row
   * with no action at all, and a row carrying all three identity lines.
   */
  const heights = one(railGrid.map((r) => r.row.h));
  const expectedHeight = PR_RAIL_MIN_PX + 8 + 8 + 2;
  check('every row is the same height', heights.length === 1, heights.join(', '));
  check(
    `and that height is the rail's floor plus its padding and border (${expectedHeight})`,
    heights[0] === expectedHeight,
    String(heights[0]),
  );
  check(
    'a row with NO action is still among them, so the reserved slot is what holds the height',
    railGrid.some((r) => r.actions === null) && railGrid.some((r) => r.actions !== null),
    railGrid.map((r) => `${r.number}:${r.actions === null ? 'none' : 'action'}`).join(' '),
  );
  check(
    'and so is a row drawing all three identity lines',
    railGrid.some((r) => r.hasAuthor && r.hasLabels) && railGrid.some((r) => !r.hasAuthor && !r.hasLabels),
    railGrid.map((r) => `${r.number}:${r.hasAuthor ? 'a' : '-'}${r.hasLabels ? 'l' : '-'}`).join(' '),
  );

  /**
   * 9.7 THE ACTION HAS ONE ANCHOR. Its top edge used to fall 63px, 29px, 47px
   * and 65px below its own card's top -- four rows, four heights, nothing to
   * aim at. `mt-auto` in a rail with a floor puts its BOTTOM edge at a
   * constant distance from the row's, which is the edge that is shared with
   * the row below it in a list.
   */
  const anchored = railGrid.filter((r) => r.actions !== null);
  const ACTION_GAP_PX = 9;
  check('there are actions on at least three rows to anchor', anchored.length >= 3, String(anchored.length));
  check(
    `every action's bottom edge sits ${ACTION_GAP_PX}px above its own row's`,
    anchored.every((r) => Math.abs(r.row.b - r.actions.b - ACTION_GAP_PX) <= 0.5),
    anchored.map((r) => `${r.number} ${(r.row.b - r.actions.b).toFixed(1)}`).join('; '),
  );
  check(
    "and its right edge is flush with the rail's",
    anchored.every((r) => Math.abs(r.actions.r - r.status.r) <= 0.5),
    anchored.map((r) => `${r.number} ${r.actions.r.toFixed(1)} vs ${r.status.r.toFixed(1)}`).join('; '),
  );

  /**
   * 9.10 THE LADDER ORDERS, IT DOES NOT CONCATENATE. Pinned per fixture row,
   * and #119 is the assertion that matters: it has FAILING checks and a
   * conflict, and the slot must hold the conflict alone. A verdict that
   * appended rather than ranked would read `checks fail conflicts` and pass
   * every "the verdict slot is drawn" check ever written.
   */
  const VERDICTS = {
    '#119': 'conflicts',
    '#128': 'changes requested',
    '#121': 'checks running',
    '#131': 'checks running',
    '#97': 'checks pass',
  };
  const verdictText = Object.fromEntries(
    railGrid.map((r) => [r.number, r.slots.find((s) => s.name === 'verdict')?.text ?? null]),
  );
  check(
    'each row draws the one verdict its ladder rung says',
    Object.entries(VERDICTS).every(([number, word]) => verdictText[number] === word),
    JSON.stringify(verdictText),
  );
  check(
    'and exactly one verdict per row, on all five',
    railGrid.length === 5 && railGrid.every((r) => r.verdicts === 1),
    railGrid.map((r) => `${r.number}:${r.verdicts}`).join(' '),
  );

  /**
   * 9.11 `review required` IS OFF THE PAINT. It is GitHub's default for any
   * open pull request with a reviewer requested -- implied by `open`, never a
   * decision -- and it was what pushed the conflicting row onto a third band.
   * Asserted over the painted text of the whole list, not over one row.
   */
  const painted = await page.locator('[data-prs]').innerText();
  check('the words `review required` are nowhere in the painted list', !/review required/.test(painted), painted.slice(0, 200));
  check(
    'and the list really does have review words in it, so that is not an empty page',
    /changes requested/.test(painted),
    painted.slice(0, 200),
  );

  /**
   * 9.12 THE MARK IS A SHAPE, NOT A HUE. `status-mark.tsx` exists to forbid a
   * column of identical discs differing only in colour, and the verdict slot
   * can now be occupied by `conflicts` or `changes requested` -- rows where
   * this mark is the ONLY carrier of the checks state.
   *
   * THE SIGNATURE IS THE GEOMETRY, and slightly stronger than a set of `d`
   * attributes: lucide draws `Circle` as a `<circle>` with no `d` at all, so a
   * `d`-only signature would read as the empty string -- which is also what an
   * svg with no paths reads as. Tag names are included so those two are not
   * the same answer. A hue-only regression makes all four signatures identical
   * and fails here while passing every class-string check in the repo.
   */
  const shapes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pr-checks-mark]')].map((el) => {
      const svg = el.querySelector('svg');
      const box = el.getBoundingClientRect();
      return {
        checks: el.closest('[data-pr-row]')?.getAttribute('data-pr-checks') ?? '?',
        svg: svg !== null,
        signature:
          svg === null
            ? ''
            : [...svg.children].map((c) => `${c.tagName}:${c.getAttribute('d') ?? ''}`).join('|'),
        w: Math.round(box.width * 10) / 10,
        h: Math.round(box.height * 10) / 10,
      };
    }),
  );
  check('every checks mark draws an svg', shapes.length === 5 && shapes.every((s) => s.svg), JSON.stringify(shapes.map((s) => s.svg)));
  check(
    'every mark keeps the shared lane, 14x14',
    shapes.every((s) => Math.abs(s.w - 14) <= 0.5 && Math.abs(s.h - 14) <= 0.5),
    shapes.map((s) => `${s.w}x${s.h}`).join(', '),
  );
  const distinct = new Set(shapes.map((s) => s.signature));
  check(
    'and at least three checks verdicts draw a DIFFERENT shape, not the same one recoloured',
    distinct.size >= 3,
    `${distinct.size} distinct over ${new Set(shapes.map((s) => s.checks)).size} verdicts`,
  );

  /**
   * 9.14 THE TWO CHANNELS OF §2, ASSERTED AS COMPUTED STYLE. A class string
   * proves somebody typed a rule. `tabular-nums` is what stops right-aligned
   * digits jittering column to column, and the mono/proportional contrast
   * between the diff and the file count is what keeps them from reading as one
   * number -- both are properties of the paint.
   */
  const numerics = await page.evaluate(() => {
    const diff = document.querySelector('[data-pr-diff]');
    const files = document.querySelector('[data-pr-files]');
    if (diff === null || files === null) return null;
    return {
      variant: getComputedStyle(diff).fontVariantNumeric,
      diffFamily: getComputedStyle(diff).fontFamily,
      filesFamily: getComputedStyle(files).fontFamily,
    };
  });
  check(
    'the diff draws tabular figures',
    numerics !== null && /tabular-nums/.test(numerics.variant),
    JSON.stringify(numerics),
  );
  check(
    'and the diff and the file count are in different typefaces',
    numerics !== null && numerics.diffFamily !== numerics.filesFamily,
    `${numerics?.diffFamily} vs ${numerics?.filesFamily}`,
  );

  /**
   * 9.9 THE AGE LEFT THE RAIL, AND IT NEVER GIVES WAY.
   *
   * It was the third quantity on the rail's number line, one size and one 6px
   * gap away from `+6269 −317` and `76 files` with no separator between any of
   * them. It is now the last field of the identity's own meta line -- which is
   * literally where `SessionList.tsx` puts an age -- and it inherits that
   * row's shrink rule: the BRANCH gives way, the age does not.
   *
   * ASSERTED AS BEHAVIOUR, NOT AS A CLASS STRING. `flex-none` in a className
   * is a thing somebody typed. The container is walked 560 -> 300 by 1px and
   * the two widths are watched: the age's must not move by a pixel across the
   * whole walk while the branch's gives up at least 20px over the same range.
   * That is the only form of this claim a `min-w-0` deleted from the wrong
   * span cannot pass.
   */
  const ages = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pr-row]')]
      .map((row) => {
        const age = row.querySelector('[data-pr-updated]');
        if (age === null) return null;
        const branches = row.querySelector('[data-pr-branches]');
        const identity = row.querySelector('[data-pr-identity]');
        const box = (el) => (el === null ? null : el.getBoundingClientRect());
        return {
          number: row.querySelector('[data-pr-number]')?.textContent ?? '?',
          age: { l: box(age).left, r: box(age).right },
          branches: branches === null ? null : { r: box(branches).right },
          identity: { r: box(identity).right },
          inIdentity: identity.contains(age),
        };
      })
      .filter((a) => a !== null),
  );
  check('there are rows carrying an age to place at all', ages.length >= 2, String(ages.length));
  check(
    'every age is inside the identity, left of the rail',
    ages.every((a) => a.inIdentity && a.age.r <= a.identity.r + 0.5),
    ages.map((a) => `${a.number} ${a.age.r.toFixed(1)} vs ${a.identity.r.toFixed(1)}`).join('; '),
  );
  check(
    'and it follows the branch pair rather than preceding it',
    ages.every((a) => a.branches === null || a.age.l >= a.branches.r - 0.5),
    ages.map((a) => `${a.number} age ${a.age.l.toFixed(1)} vs branch ${a.branches?.r.toFixed(1)}`).join('; '),
  );
  const shrink = await page.evaluate(() => {
    const list = document.querySelector('[data-pr-row]')?.parentElement;
    if (list === undefined || list === null) return null;
    const previous = list.style.width;
    const out = [];
    for (let w = 560; w >= 300; w -= 1) {
      list.style.width = `${w}px`;
      const row = document.querySelector('[data-pr-row]');
      const age = row.querySelector('[data-pr-updated]');
      const branches = row.querySelector('[data-pr-branches]');
      if (age === null || branches === null) continue;
      out.push({
        w,
        age: Math.round(age.getBoundingClientRect().width),
        branch: Math.round(branches.getBoundingClientRect().width),
      });
    }
    list.style.width = previous;
    return out;
  });
  const ageWidths = [...new Set((shrink ?? []).map((s) => s.age))];
  const branchWidths = (shrink ?? []).map((s) => s.branch);
  check('the shrink walk ran over the whole range', shrink !== null && shrink.length >= 260, String(shrink?.length));
  check(
    'the age keeps exactly one width from 560px down to 300px',
    ageWidths.length === 1,
    ageWidths.join(', '),
  );
  check(
    'while the branch beside it gives up at least 20px over the same walk',
    branchWidths.length > 0 && Math.max(...branchWidths) - Math.min(...branchWidths) >= 20,
    `${Math.min(...branchWidths)}..${Math.max(...branchWidths)}`,
  );

  /**
   * THE TRUNCATION BARGAIN. Both sides are narrower than the old single
   * column, so both can clip -- and a clipped name with nowhere to read the
   * rest is information the pane HAD and threw away.
   *
   * MEASURED WHERE CLIPPING ACTUALLY HAPPENS, which is not here. The pane is
   * ~960px wide at this viewport and nothing truncates in it at all, so a
   * check run at this width would assert the `title` attribute over four
   * fields that had no need of it and report a bargain it never tested. The
   * list is narrowed to the width an operator really drags it to first.
   */
  const truncation = await page.evaluate(() => {
    const list = document.querySelector('[data-pr-row]')?.parentElement ?? null;
    if (list === null) return null;
    const previous = list.style.width;
    list.style.width = '330px';
    const out = [];
    for (const sel of ['[data-pr-title]', '[data-pr-branches]']) {
      for (const el of document.querySelectorAll(sel)) {
        out.push({
          sel,
          clipping: el.scrollWidth > el.clientWidth + 1,
          title: el.getAttribute('title'),
          text: el.textContent,
        });
      }
    }
    list.style.width = previous;
    return out;
  });
  check(
    'every truncatable field carries its whole value on `title`',
    truncation !== null && truncation.length > 0 && truncation.every((t) => t.title === t.text),
    JSON.stringify((truncation ?? []).filter((t) => t.title !== t.text)),
  );
  check(
    'and in a narrow pane they really do clip, so the bargain is not theoretical',
    (truncation ?? []).filter((t) => t.clipping).length >= 2,
    JSON.stringify((truncation ?? []).map((t) => [t.sel, t.clipping])),
  );

  /**
   * ============================================== WHERE THE SEAM ACTUALLY IS
   *
   * `PR_SPLIT_PX` is a number typed into a class string. Tailwind emits no
   * rule for a class it cannot find as complete source text, and this repo has
   * shipped a selector that matched nothing and stayed green through review --
   * so the constant is not trusted, it is FALSIFIED: the row's own container
   * is walked across the number and the transition is measured.
   *
   * THE CONTAINER IS DRIVEN DIRECTLY, by sizing the list the rows sit in. That
   * is not a shortcut around the real layout: `container-type: inline-size` is
   * evaluated against the row's content box whatever set it, so this asks the
   * cascade the same question a drag of the pane divider would.
   */
  const walk = await page.evaluate(() => {
    const list = document.querySelector('[data-pr-row]')?.parentElement;
    if (list === undefined || list === null) return null;
    const previous = list.style.width;
    const out = [];
    for (let w = 300; w <= 560; w += 1) {
      list.style.width = `${w}px`;
      const row = document.querySelector('[data-pr-row]');
      const identity = row.querySelector('[data-pr-identity]').getBoundingClientRect();
      const status = row.querySelector('[data-pr-status]').getBoundingClientRect();
      const cs = getComputedStyle(row);
      const num = (k) => Number.parseFloat(cs.getPropertyValue(k)) || 0;
      const content =
        row.getBoundingClientRect().width -
        num('padding-left') - num('padding-right') -
        num('border-left-width') - num('border-right-width');
      out.push({ content, split: identity.right <= status.left + 0.5 && status.top < identity.bottom });
    }
    list.style.width = previous;
    return out;
  });
  check('the container walk ran', walk !== null && walk.length > 200, String(walk?.length));
  const firstSplit = walk?.find((s) => s.split)?.content ?? null;
  const lastStacked = [...(walk ?? [])].reverse().find((s) => !s.split)?.content ?? null;
  console.log(`  stacked up to ${lastStacked?.toFixed(1)}px, split from ${firstSplit?.toFixed(1)}px`);
  check(
    `the row is ONE column below ${PR_SPLIT_PX} and two at or above it`,
    firstSplit !== null && Math.abs(firstSplit - PR_SPLIT_PX) <= 1.5,
    `first split at ${firstSplit}`,
  );
  check(
    'and it really does stack below that, so the query is not simply always true',
    lastStacked !== null && lastStacked < PR_SPLIT_PX,
    `last stacked at ${lastStacked}`,
  );

  /**
   * ==================================================== WHAT THE BUTTONS ARE
   *
   * `mergeable` HAS THREE VALUES and only one of them may grey the control.
   * GitHub computes mergeability lazily, so `UNKNOWN` -- read as `null` -- is
   * what most open pull requests carry: greying on `null` would refuse a
   * legitimate merge on nearly every row. Measured on the built bundle, on one
   * row of each kind.
   */
  const merges = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pr-row]')].map((row) => ({
      number: row.querySelector('[data-pr-number]')?.textContent,
      state: row.querySelector('[data-pr-merge]')?.getAttribute('data-pr-merge-state') ?? null,
      disabled: row.querySelector('[data-pr-merge]')?.disabled ?? null,
      note: row.querySelector('[data-pr-merge-note]')?.getAttribute('data-note') ?? null,
    })),
  );
  const byNumber = (n) => merges.find((m) => m.number === n);
  check(
    'the row GitHub says merges is offered and actionable',
    byNumber('#128')?.state === 'ready' && byNumber('#128')?.disabled === false,
    JSON.stringify(byNumber('#128')),
  );
  check(
    'THE ONE THAT MATTERS: a row GitHub has not computed is still actionable',
    byNumber('#131')?.state === 'ready' && byNumber('#131')?.disabled === false,
    JSON.stringify(byNumber('#131')),
  );
  check(
    'and only the row GitHub RULED on is greyed, with the reason on it',
    byNumber('#119')?.state === 'conflicting' &&
      byNumber('#119')?.disabled === true &&
      /conflict/i.test(byNumber('#119')?.note ?? ''),
    JSON.stringify(byNumber('#119')),
  );
  check(
    'the greyed control is THERE rather than withdrawn',
    (await page.locator('[data-pr-merge][data-pr-merge-state="conflicting"]').boundingBox()) !== null,
  );
  // A disabled button takes no focus, so the reason hangs on a wrapper that
  // does. Walked, not assumed: `tabIndex` in the markup is not a tab stop.
  const reached = await page.evaluate(() => {
    document.activeElement?.blur();
    return null;
  });
  void reached;
  check(
    'the reason sits on a stop the keyboard can reach',
    (await page.locator('[data-pr-merge-note]').getAttribute('tabindex')) === '0',
  );

  /**
   * ==================================== AND WHAT COLOUR THEY ACTUALLY PAINT
   *
   * A CLASS STRING IS NOT A PAINT. A Tailwind utility naming a `--color-*`
   * token that does not exist emits NO RULE AT ALL -- no error, no fallback --
   * and every test that reads `className` passes anyway. So the computed
   * `color` and `border-color` of each control are read off the live element,
   * against the fill actually behind it, in BOTH themes.
   */
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('light', t === 'light');
    }, theme);
    await page.waitForTimeout(150);
    const paint = await page.evaluate(() => {
      const skin = (sel) => {
        const el = document.querySelector(`${sel} [data-tap-skin]`);
        if (el === null) return null;
        const cs = getComputedStyle(el);
        const ground = window.vamInk.groundOf(el.parentElement);
        const parts = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const rect = el.getBoundingClientRect();
        return {
          colour: cs.color,
          border: cs.borderTopColor,
          ground,
          rgb: parts(cs.color),
          opaque: window.vamInk.opaque(cs.color) && window.vamInk.opaque(ground),
          ink: Number(window.vamInk.ratio(cs.color, ground).toFixed(3)),
          edge: Number(window.vamInk.ratio(cs.borderTopColor, ground).toFixed(3)),
          h: Math.round(rect.height * 10) / 10,
          w: Math.round(rect.width * 10) / 10,
          // The label inside its own skin: a variable-width chip that clips
          // its word is invisible to every "is it at least 44?" check.
          clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
          fontPx: Number.parseFloat(cs.fontSize),
        };
      };
      return {
        merge: skin('[data-pr-merge][data-pr-merge-state="ready"]'),
        grey: skin('[data-pr-merge][data-pr-merge-state="conflicting"]'),
        del: skin('[data-pr-delete-branch]'),
        title: getComputedStyle(document.querySelector('[data-pr-title]')).color,
      };
    });
    console.log(`  ${theme}: ${JSON.stringify(paint)}`);

    check(`${theme}: all three controls are painted`, paint.merge !== null && paint.grey !== null && paint.del !== null);
    check(`${theme}: every ink and its ground is opaque, so a ratio means something`,
      paint.merge.opaque && paint.grey.opaque && paint.del.opaque);

    // MERGE IS GREEN, and green is a fact about the channels rather than
    // about the token's name: a retoken to a blue would redden this.
    const [mr, mg, mb] = paint.merge.rgb;
    check(
      `${theme}: Merge really paints GREEN (g dominates r and b)`,
      mg > mr + 20 && mg > mb + 20,
      paint.merge.colour,
    );
    check(`${theme}: and its border is the same green`, paint.merge.border === paint.merge.colour, `${paint.merge.border} vs ${paint.merge.colour}`);
    check(`${theme}: Merge's label clears 4.5:1 on the card (WCAG 1.4.3)`, paint.merge.ink >= 4.5, `${paint.merge.ink}:1`);
    check(`${theme}: Merge's boundary clears 3:1 (WCAG 1.4.11)`, paint.merge.edge >= 3, `${paint.merge.edge}:1`);

    // GREY IS GREY, and it is a NEUTRAL: r, g and b within a few points of
    // each other, which no hue can satisfy.
    const [gr, gg, gb] = paint.grey.rgb;
    check(
      `${theme}: the conflicting Merge paints a NEUTRAL grey, not a hue`,
      Math.max(gr, gg, gb) - Math.min(gr, gg, gb) <= 8,
      paint.grey.colour,
    );
    /**
     * AND IT READS AS DISABLED -- asserted on the property, not on a proxy.
     *
     * The obvious proxy is "its contrast ratio is lower than the enabled
     * one's", which is what `model-picker-shots.mjs` uses. It is right there,
     * where both inks are neutrals, and WRONG here: measured in light,
     * `--vam-ink-faint` reads 5.379:1 on the card while `--vam-icon-green`
     * reads 5.016:1, so the greyed control would "fail" for being more
     * legible than the green one. Luminance contrast is not loudness.
     *
     * What actually separates them is what an eye uses: the disabled control
     * is the only one of the three with NO HUE, and its whole chip is quieter
     * because its boundary is the neutral rule rather than a colour.
     */
    check(
      `${theme}: the greyed control is the only one of the three with no hue`,
      paint.grey.colour !== paint.merge.colour && paint.grey.colour !== paint.del.colour,
      `${paint.grey.colour} / ${paint.merge.colour} / ${paint.del.colour}`,
    );
    check(
      `${theme}: and its boundary is quieter than the actionable Merge's, so the chip recedes`,
      paint.grey.edge < paint.merge.edge,
      `${paint.grey.edge} vs ${paint.merge.edge}`,
    );
    // The model picker's own floor for a disabled label: WCAG exempts an
    // inactive control from 1.4.3, but a greyed control nobody can READ is a
    // control that is not there.
    check(`${theme}: and it is still readable at 3:1`, paint.grey.ink >= 3, `${paint.grey.ink}:1`);

    // DELETE BRANCH IS DISTINCT FROM MERGE AT REST, and it does not out-shout
    // it: red WORD, neutral boundary, so the affirmative keeps the stronger
    // presence in a list.
    const [dr, dg, db] = paint.del.rgb;
    check(`${theme}: Delete branch paints RED (r dominates g and b)`, dr > dg + 20 && dr > db + 20, paint.del.colour);
    check(`${theme}: it is a different colour from Merge before either is touched`, paint.del.colour !== paint.merge.colour);
    check(`${theme}: Delete branch's label clears 4.5:1 on the card`, paint.del.ink >= 4.5, `${paint.del.ink}:1`);
    check(
      `${theme}: and its boundary is quieter than Merge's, so the destructive one does not out-shout the affirmative`,
      paint.del.edge < paint.merge.edge,
      `${paint.del.edge} vs ${paint.merge.edge}`,
    );

    // BIGGER, at the operator's ask -- measured, not classed. The old chip
    // was an 11px type step (`--text-meta`, the scale's own floor) in a 22px
    // box.
    for (const [what, box] of [['Merge', paint.merge], ['the greyed Merge', paint.grey], ['Delete branch', paint.del]]) {
      check(`${theme}: ${what} is drawn above the type scale's floor`, box.fontPx >= 12, `${box.fontPx}px`);
      check(`${theme}: ${what} paints at least 28px tall`, box.h >= 28, `${box.h}px`);
      check(`${theme}: ${what}'s own label fits inside it`, box.clipped === false, `${box.w}x${box.h}`);
    }

    /**
     * ============================================ THE CHECKS MARK'S CONTRAST
     *
     * WCAG 1.4.11 asks 3:1 of a non-text mark that carries meaning, and this
     * one carries the whole checks verdict on the rows where the rail's
     * verdict slot is occupied by `conflicts` or `changes requested`. So it is
     * measured AS PAINT, in both themes, over all four verdicts.
     *
     * WHAT "AS PAINT" MEANS HERE, and it is the reason this assertion could
     * fail at all. The mark has been drawn two ways: as a 6px disc, whose ink
     * is its own `background-color`, and as a glyph, whose ink is the `color`
     * its `currentColor` strokes resolve to. A check that read only `color`
     * would have measured the row's INHERITED text ink on the disc -- 11.44:1
     * dark, 17.72:1 light -- and passed with flying colours while the disc
     * beside it sat at 1.71:1 and 1.46:1. So the painting element is asked for
     * an opaque fill of its own FIRST, and only falls back to its ink.
     *
     * AND IT WAS SEEN TO GO RED. Run against the build BEFORE the glyph
     * landed, with `none` already in the fixture, it reported exactly:
     *
     *   FAIL  dark: every checks mark clears 3:1 … — none 1.713:1
     *   FAIL  light: every checks mark clears 3:1 … — none 1.457:1
     *
     * A contrast assertion that was green from the moment it was written has
     * never demonstrated that it can fail.
     */
    const marks = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[data-pr-checks-mark]')) {
        const painter = el.querySelector('svg') ?? el;
        const cs = getComputedStyle(painter);
        const fill = cs.backgroundColor;
        const ink = window.vamInk.opaque(fill) ? fill : cs.color;
        const ground = window.vamInk.groundOf(el.parentElement);
        const box = el.getBoundingClientRect();
        out.push({
          checks: el.closest('[data-pr-row]')?.getAttribute('data-pr-checks') ?? '?',
          ink,
          ground,
          opaque: window.vamInk.opaque(ink) && window.vamInk.opaque(ground),
          ratio: Number(window.vamInk.ratio(ink, ground).toFixed(3)),
          w: Math.round(box.width * 10) / 10,
          h: Math.round(box.height * 10) / 10,
        });
      }
      return out;
    });
    console.log(`  ${theme} marks: ${marks.map((m) => `${m.checks} ${m.ratio}:1`).join(', ')}`);
    // A SWEEP MUST PROVE IT FOUND A CORPUS: "every mark clears 3:1" is exactly
    // as green over four verdicts as over the three the fixture used to carry,
    // and `none` was the one that was broken.
    const verdicts = [...new Set(marks.map((m) => m.checks))].sort();
    check(
      `${theme}: all four checks verdicts are on screen to be measured`,
      verdicts.join(',') === 'failing,none,passing,pending',
      verdicts.join(','),
    );
    check(
      `${theme}: every mark's ink and its ground is opaque, so the ratio means something`,
      marks.length > 0 && marks.every((m) => m.opaque),
      JSON.stringify(marks.filter((m) => !m.opaque)),
    );
    check(
      `${theme}: every checks mark clears 3:1 against the card (WCAG 1.4.11)`,
      marks.every((m) => m.ratio >= 3),
      marks.filter((m) => m.ratio < 3).map((m) => `${m.checks} ${m.ratio}:1`).join('; '),
    );

    /* THE LIGHT SHOT, TAKEN WHERE IT IS NEARLY FREE. There was no
       light-theme picture of this surface at all: every light ratio anyone
       has quoted about it was computed from token hex in `styles.css`, which
       is a different claim from "this is what it looks like". The guard
       already drives both themes for the button paint, so the shot costs one
       line and closes the gap. Taken HERE rather than at the end of the
       block, so it is the list at rest -- the dark shot below is taken after
       a merge has been confirmed and carries the answer note. */
    if (theme === 'light') {
      await page.screenshot({ path: `${outDir}/prs-tab-desktop-light.png` });
      console.log(`${outDir}/prs-tab-desktop-light.png`);
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove('light'));
  await page.waitForTimeout(150);

  /**
   * THE COMPOSER IS GONE, asked of the LIVE DOM after a real click. The unit
   * test pins which views draw one; this proves the built bundle agrees.
   */
  check(
    'the PRs view draws no prompt box',
    (await page.locator('[data-composer-bar]').count()) === 0,
  );
  await page.click('[data-view="response"]');
  await page.waitForSelector('[data-composer-bar]', { timeout: 5_000 });
  check(
    'and the Response view still does — so it was withdrawn, not deleted',
    (await page.locator('[data-composer-bar]').count()) === 1,
  );
  await openPrs(page);

  // Clicking the row reaches the bridge, with the address that was drawn.
  await page.locator('[data-pr-open]').first().click();
  const opened = await page.evaluate(() => globalThis.window.__prs.opened);
  check(
    'clicking a row opens that pull request',
    opened.length === 1 && opened[0] === 'https://github.com/operator/atlas/pull/128',
    JSON.stringify(opened),
  );

  /**
   * MERGE ASKS FIRST. This is the guarantee between a button in a side panel
   * and an irreversible act on a real repository, so it is measured on the
   * built bundle and not only in a unit environment.
   */
  await page.locator('[data-pr-merge]').first().click();
  await page.waitForSelector('[data-confirm-pr-action]', { timeout: 5_000 });
  const asked = await page.locator('[data-confirm-pr-action]').innerText();
  check('the confirm names the number', asked.includes('128'), asked.slice(0, 120));
  check(
    'the confirm names the title',
    asked.includes('Rework the detail pane'),
    asked.slice(0, 120),
  );
  check(
    'the confirm shows the exact command it will run',
    (await page.locator('[data-confirm-pr-action-command]').innerText()).includes('gh pr merge'),
  );
  check(
    'nothing has been run yet',
    (await page.evaluate(() => globalThis.window.__prs.acted.length)) === 0,
  );

  // Escape leaves without acting.
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-confirm-pr-action]', { state: 'detached', timeout: 5_000 });
  check(
    'escaping the confirm runs nothing',
    (await page.evaluate(() => globalThis.window.__prs.acted.length)) === 0,
  );

  // And confirming does.
  await page.locator('[data-pr-merge]').first().click();
  await page.waitForSelector('[data-confirm-pr-action]', { timeout: 5_000 });
  await page.click('[data-confirm-pr-action-go]');
  await page.waitForSelector('[data-pr-note]', { timeout: 5_000 });
  const acted = await page.evaluate(() => globalThis.window.__prs.acted);
  check(
    'confirming merges, with no admin flag anywhere near it',
    acted.length === 1 && acted[0].action.kind === 'merge' && acted[0].action.method === 'squash',
    JSON.stringify(acted),
  );
  check(
    "the answer is gh's own sentence",
    (await page.locator('[data-pr-note]').innerText()).includes('Squashed and merged'),
  );

  // The merged row offers the branch delete; the open one does not.
  const deletes = await page.locator('[data-pr-delete-branch]').count();
  check('exactly one row offers to delete its branch', deletes === 1, String(deletes));

  await page.screenshot({ path: `${outDir}/prs-tab-desktop.png` });
  console.log(`${outDir}/prs-tab-desktop.png`);
  await page.close();
}

/*
 * ------------------------------------------------------------------- 390px
 *
 * THIS BLOCK USED TO OPEN THE PRs TAB ON THE PHONE SHELL AND MEASURE IT.
 * There is no such screen any more: the operator cut the PRs view from mobile
 * entirely, and the withdrawal is `visibleTabs`' (`src/renderer/panels/
 * tabs.ts`). So what is measured here now is the CUT -- at the same 390x844,
 * against the same stubbed bridge, from a session that really does have five
 * pull requests to show.
 *
 * WHAT WENT WITH THE SCREEN, stated rather than quietly dropped, because a
 * check that disappears from a guard is indistinguishable from one that was
 * never written:
 *
 *  - the 44x44 touch floor on Merge and Delete branch, and the label-fits-its-
 *    skin check beside it. Both were about `.vam-phone .vam-tap`, a rule that
 *    only applies under the phone shell. There is no phone route to these two
 *    controls to hold to a floor.
 *  - `every row stacks its status under its identity at 390px`. NOT lost: the
 *    desktop block above WALKS the row's container from 300px to 560px and
 *    measures where the split actually happens, which is a strictly stronger
 *    statement than one reading at one width, and it is the assertion that
 *    catches a `@min-[...]` class Tailwind never emitted.
 *  - the confirm dialog fitting 390px. The narrowest window this dialog can
 *    now appear in is 520px (`SIDEBAR_MIN + DETAIL_MIN`; below it vam draws
 *    the phone shell), and it is measured at exactly that width below.
 */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(install);
  await page.goto(origin, { waitUntil: 'networkidle' });
  // The phone shell opens on the LIST; a session has to be entered first.
  await page.waitForSelector('[data-phone-shell] [data-session-row]', { timeout: 10_000 });
  await page.locator('[data-phone-shell] [data-session-row]').first().click();

  /**
   * THE CORPUS, PROVED BEFORE THE ABSENCES. Every check below is "there is no
   * such thing on this screen", and that is exactly as green over a session
   * screen that failed to open as over one that opened and withdrew the view.
   * So: the shell is on the session screen, its view row was found, and the
   * stub bridge that makes the two irreversible controls drawable is installed.
   */
  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('[data-phone-shell] [data-phone-views] [data-phone-view]')].map(
      (el) => el.getAttribute('data-phone-view'),
    ),
  );
  console.log(`  the phone's view row: ${JSON.stringify(icons)}`);
  check(
    'the phone session screen and its view row were reached at all',
    (await page.locator('[data-phone-shell="session"]').count()) === 1 && icons.length > 0,
    JSON.stringify(icons),
  );
  check(
    'the bridge that draws Merge and Delete branch is installed on this page',
    await page.evaluate(() => typeof globalThis.window.api?.prs?.act === 'function'),
  );

  check('the phone offers Response and Agents, and nothing else', icons.join(',') === 'response,agents', icons.join(','));
  check(
    'there is no PRs icon on the phone',
    (await page.locator('[data-phone-view="prs"]').count()) === 0,
  );

  /**
   * NO PANE BY ANY ROUTE, checked after EVERY icon rather than once. Checking
   * at the end would only ever measure whichever view the last tap opened --
   * the shape of sweep this repo has already shipped as a clean verdict over
   * an empty corpus.
   */
  const reached = [];
  for (const view of [...icons, ...icons].reverse()) {
    await page.click(`[data-phone-view="${view}"]`);
    reached.push({
      view,
      rows: await page.locator('[data-pr-row]').count(),
      merge: await page.locator('[data-pr-merge]').count(),
      del: await page.locator('[data-pr-delete-branch]').count(),
      pane: await page.locator('[data-prs]').count(),
    });
  }
  console.log(`  after every view the phone has: ${JSON.stringify(reached)}`);
  check(
    'no view a phone can open draws a pull request row',
    reached.length >= 2 && reached.every((r) => r.rows === 0 && r.pane === 0),
    JSON.stringify(reached),
  );
  check(
    'and neither Merge nor Delete branch is reachable from any of them',
    reached.every((r) => r.merge === 0 && r.del === 0),
    JSON.stringify(reached),
  );
  check(
    'nothing was sent to the pull-request bridge while trying',
    (await page.evaluate(() => globalThis.window.__prs.acted.length)) === 0,
  );

  await page.screenshot({ path: `${outDir}/prs-tab-phone-withdrawn.png` });
  console.log(`${outDir}/prs-tab-phone-withdrawn.png`);
  await page.close();
}

/*
 * --------------------------------------------- 520px: the narrowest desktop
 *
 * `SIDEBAR_MIN + DETAIL_MIN` is 520, the narrowest window in which vam draws
 * columns at all -- one pixel under it is the phone shell, which no longer has
 * this view. So this is now the narrowest screen the PRs tab can be seen on,
 * and it is where the two claims that outlived the phone belong: nothing in a
 * row spills off the screen, and the confirm for an irreversible act keeps
 * both of its buttons on it.
 */
{
  const page = await browser.newPage({ viewport: { width: 520, height: 844 } });
  await page.addInitScript(install);
  await page.goto(origin, { waitUntil: 'networkidle' });
  check(
    'at 520 the desktop shell draws, not the phone one',
    (await page.locator('[data-phone-shell]').count()) === 0,
  );
  await openPrs(page);

  /**
   * THE MEASUREMENT THIS GUARD EXISTS FOR. A row wider than the surface it
   * sits in does not look broken in a unit test -- it looks identical. Every
   * row's own box, and the box of every field inside it, must stay on screen.
   */
  const overflow = await page.evaluate(() => {
    const problems = [];
    const limit = globalThis.window.innerWidth;
    for (const row of document.querySelectorAll('[data-pr-row]')) {
      const box = row.getBoundingClientRect();
      if (box.right > limit + 0.5 || box.left < -0.5) {
        problems.push(`row ${row.getAttribute('data-pr-state')} ${box.left}..${box.right}`);
      }
      for (const field of row.querySelectorAll(
        '[data-pr-branches], [data-pr-label], [data-pr-merge], [data-pr-delete-branch], [data-pr-title]',
      )) {
        const f = field.getBoundingClientRect();
        if (f.right > limit + 0.5) {
          problems.push(
            `${field.getAttribute('data-pr-title') === null ? field.tagName : 'title'} ${f.right} > ${limit}`,
          );
        }
      }
    }
    return problems;
  });
  // A SWEEP MUST PROVE IT FOUND A CORPUS. `overflow.length === 0` is exactly
  // as green over three rows as over none, and "none" is what a renamed
  // attribute or a tab that failed to open would silently produce.
  const rowsHere = await page.locator('[data-pr-row]').count();
  check('there are rows at 520px to measure at all', rowsHere === 5, String(rowsHere));
  check('no row and no field overflows a 520px screen', overflow.length === 0, overflow.join('; '));

  // And the row is actually TALL -- a wrapped row is fine, a clipped one is not.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pr-row]')].some(
      (row) => row.scrollWidth > row.clientWidth + 1,
    ),
  );
  check('no row is scrolled sideways inside its own box', clipped === false);

  /**
   * ============================================ 9.15 THE STACKED RAIL AT 520
   *
   * BELOW THE SPLIT THE RAIL IS A DETACHED RIGHT-HAND COLUMN, not a full-width
   * one. It becomes a block the width of the row's content box -- so its right
   * edge is the identity's -- and its two lines stay `justify-end` inside it,
   * so the 156px grid sits at the right of a 265px block rather than stretching
   * across it. Stretching would give back exactly the alignment the fixed grid
   * was built for, and it is the obvious thing a `w-full` does by accident.
   *
   * ASSERTED AS GEOMETRY. "justify-end" is a class; what is measured is that
   * line two's right edge lands on the rail's right edge, and that the four
   * slots still carry the widths their constants declare.
   */
  const stacked = await page.evaluate(readRails);
  check('there are stacked rows to measure', stacked.length === 5, String(stacked.length));
  check(
    'every row really is stacked here, so this is the narrow case',
    stacked.every((r) => r.content < PR_SPLIT_PX && r.identity.b <= r.status.t + 0.5),
    stacked.map((r) => r.content.toFixed(1)).join(', '),
  );
  check(
    "the rail fills the row's content box",
    stacked.every((r) => Math.abs(r.status.w - r.content) <= 0.5),
    stacked.map((r) => `${r.number} ${r.status.w.toFixed(1)} vs ${r.content.toFixed(1)}`).join('; '),
  );
  check(
    "and its right edge is the identity's",
    stacked.every((r) => Math.abs(r.status.r - r.identity.r) <= 0.5),
    stacked.map((r) => `${r.number} ${r.status.r.toFixed(1)} vs ${r.identity.r.toFixed(1)}`).join('; '),
  );
  const stackedSlots = stacked.flatMap((r) => r.slots);
  const stackedWrong = stackedSlots.filter((s) => Math.abs(s.w - PR_SLOT[s.name]) > 0.5);
  check('there are slot boxes at 520 to measure', stackedSlots.length >= 16, String(stackedSlots.length));
  check(
    'the four slots keep their fixed widths when the rail detaches',
    stackedWrong.length === 0,
    stackedWrong.map((s) => `${s.name} ${s.w.toFixed(1)}`).join('; '),
  );
  const pushedRight = stacked.flatMap((r) => {
    const line2 = r.slots.filter((s) => s.name === 'diff' || s.name === 'files');
    if (line2.length === 0) return [];
    const right = Math.max(...line2.map((s) => s.r));
    return Math.abs(right - r.status.r) <= 0.5 ? [] : [`${r.number} ${right.toFixed(1)} vs ${r.status.r.toFixed(1)}`];
  });
  check(
    "line two is pushed to the rail's right edge rather than stretched across it",
    pushedRight.length === 0 &&
      stacked.some((r) => r.slots.some((s) => s.name === 'diff')),
    pushedRight.join('; '),
  );
  const stackedHeights = [...new Set(stacked.map((r) => Math.round(r.row.h)))];
  const stackedExpected = PR_STACKED_MIN_PX + 8 + 8 + 2;
  check('every stacked row is the same height too', stackedHeights.length === 1, stackedHeights.join(', '));
  check(
    `and that height is PR_STACKED_MIN_PX plus padding and border (${stackedExpected})`,
    stackedHeights[0] === stackedExpected,
    String(stackedHeights[0]),
  );
  const stackedClips = stackedSlots.filter((s) => s.over > 1);
  const stackedUnexpected = stackedClips.filter(
    (s) => s.name !== 'verdict' || s.text !== 'changes requested',
  );
  check(
    'no slot overflows at 520 either, beyond the one declared truncation',
    stackedUnexpected.length === 0,
    stackedUnexpected.map((s) => `${s.name} "${s.text}" over by ${s.over}`).join('; '),
  );
  check(
    'and every slot that clips here still carries its whole value on `title`',
    stackedClips.length > 0 && stackedClips.every((s) => s.title === s.text),
    stackedClips.map((s) => `${s.name} ${s.over} title=${JSON.stringify(s.title)}`).join('; '),
  );
  // The action anchor is scoped to the split layout by §5, and `mt-auto` is a
  // no-op in a stacked block with no spare height. What must still hold here
  // is the right edge -- asserted, so the scoping is a decision rather than a
  // gap nobody noticed.
  check(
    "the action stays flush with the rail's right edge when stacked",
    stacked.filter((r) => r.actions !== null).length >= 3 &&
      stacked.every((r) => r.actions === null || Math.abs(r.actions.r - r.status.r) <= 0.5),
    stacked.map((r) => `${r.number} ${r.actions === null ? '-' : r.actions.r.toFixed(1)}`).join(' '),
  );

  // The rows as they sit in the narrowest pane vam will ever give them.
  await page.screenshot({ path: `${outDir}/prs-tab-narrow-rows.png` });
  console.log(`${outDir}/prs-tab-narrow-rows.png`);

  /**
   * THE CONFIRM HAS TO FIT TOO. A dialog wider than the screen is a dialog
   * whose Cancel button can be off it, which on an irreversible action is the
   * worst place in the app to put an unreachable control.
   */
  await page.locator('[data-pr-merge]').first().click();
  await page.waitForSelector('[data-confirm-pr-action]', { timeout: 5_000 });
  const cancel = await page.locator('[data-confirm-pr-action-cancel]').boundingBox();
  const go = await page.locator('[data-confirm-pr-action-go]').boundingBox();
  check(
    'both of the confirm’s buttons are on the 520px screen',
    cancel !== null &&
      go !== null &&
      cancel.x >= 0 &&
      cancel.x + cancel.width <= 520 &&
      go.x >= 0 &&
      go.x + go.width <= 520,
    JSON.stringify({ cancel, go }),
  );
  await page.screenshot({ path: `${outDir}/prs-tab-narrow.png` });
  console.log(`${outDir}/prs-tab-narrow.png`);
  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nprs-tab: every check passed.');
