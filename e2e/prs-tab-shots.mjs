/**
 * THE PRs TAB, IN A REAL BROWSER — what it draws, where it goes, what it does,
 * and whether any of it fits a phone.
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
 *  - the row's own box stays inside the pane at 390px, with every field
 *    visible rather than clipped -- a row that overflowed would hide the one
 *    field the operator opened this tab to read;
 *  - the composer really is gone from this view, measured off the DOM after a
 *    real click rather than off a predicate;
 *  - a click on the row reaches `prs.open` with the address that was drawn;
 *  - Merge OPENS A QUESTION and spawns nothing, and the question names the
 *    pull request -- the one guarantee standing between a side-panel button
 *    and an irreversible act on somebody's repository;
 *  - the confirm's own box fits a 390px screen, because a dialog that
 *    overflows is a dialog whose Cancel can be off-screen.
 *
 *   node e2e/prs-tab-shots.mjs http://localhost:5520 e2e/test-results
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
for (const literal of [
  `@min-[${PR_SPLIT_PX}px]:flex-row`,
  `@min-[${PR_SPLIT_PX}px]:w-[${PR_STATUS_PX}px]`,
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
                pr({
                  number: 128,
                  title: 'Rework the detail pane so a narrow column stays readable end to end',
                  state: 'open',
                  checks: 'passing',
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
 * TWO SELECTORS, because the two shells genuinely have two view bars:
 * `PhoneShell` draws `data-phone-view` and states in its own header that the
 * hook is deliberately not the desktop's `data-view`. A guard that knew only
 * one of them would pass on a desktop and time out on a phone -- which is how
 * a 390px defect ships.
 */
async function openPrs(page, phone = false) {
  await page.click(phone ? '[data-phone-view="prs"]' : '[data-view="prs"]');
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
    ['review decision', '[data-pr-review]'],
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
      const IDENTITY = ['[data-pr-title]', '[data-pr-number]', '[data-pr-branches]', '[data-pr-author]', '[data-pr-label]'];
      const STATUS = [
        '[data-pr-state-label]', '[data-pr-checks-label]', '[data-pr-additions]',
        '[data-pr-deletions]', '[data-pr-files]', '[data-pr-review]',
        '[data-pr-mergeable]', '[data-pr-updated]', '[data-pr-merge]', '[data-pr-delete-branch]',
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
      '[data-pr-status] [data-pr-state-label], [data-pr-status] [data-pr-checks-label],' +
        ' [data-pr-status] [data-pr-additions], [data-pr-status] [data-pr-updated],' +
        ' [data-pr-status] [data-pr-review], [data-pr-merge], [data-pr-delete-branch]',
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
   * RIGHT-ALIGNED, NOT MERELY ON THE RIGHT -- and asked PER LINE, which is the
   * correction that makes this a guard at all.
   *
   * It was written first as "the widest field in the rail ends where the rail
   * ends", and a mutation that left-aligned one of the rail's three lines
   * walked straight through it: the OTHER two lines still reached the edge, so
   * the maximum did. A claim about a column answered with one number about the
   * whole column cannot see a line that is wrong.
   *
   * So the fields are grouped into the bands they actually wrap into -- same
   * top, within a pixel -- and EVERY band has to end at the rail's right edge.
   */
  const ragged = sides.flatMap((s) => {
    const bands = new Map();
    for (const f of s.statusFields.filter((f) => f.w > 0)) {
      const key = Math.round(f.t);
      bands.set(key, Math.max(bands.get(key) ?? 0, f.r));
    }
    return [...bands.entries()]
      .filter(([, right]) => right < s.status.r - 1.5)
      .map(([top, right]) => `${s.number} band y=${top} ends at ${right.toFixed(1)}, rail at ${s.status.r.toFixed(1)}`);
  });
  const bandCount = sides.reduce(
    (n, s) => n + new Set(s.statusFields.filter((f) => f.w > 0).map((f) => Math.round(f.t))).size,
    0,
  );
  check('there are wrapped status bands to check the alignment of', bandCount >= 10, String(bandCount));
  check(
    'every line of the status rail is right-aligned against it',
    ragged.length === 0,
    ragged.join('; '),
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

// ------------------------------------------------------------------ 390px
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(install);
  await page.goto(origin, { waitUntil: 'networkidle' });
  // The phone shell opens on the LIST; a session has to be entered first.
  await page.waitForSelector('[data-phone-shell] [data-session-row]', { timeout: 10_000 });
  await page.locator('[data-phone-shell] [data-session-row]').first().click();
  await openPrs(page, true);

  /**
   * THE MEASUREMENT THIS GUARD EXISTS FOR. A row that is wider than the
   * surface it sits in does not look broken in a unit test -- it looks
   * identical. Every row's own box, and the box of every field inside it,
   * must stay within the viewport.
   */
  const overflow = await page.evaluate(() => {
    const problems = [];
    const limit = globalThis.window.innerWidth;
    for (const row of document.querySelectorAll('[data-pr-row]')) {
      const box = row.getBoundingClientRect();
      if (box.right > limit + 0.5 || box.left < -0.5) {
        problems.push(`row ${row.getAttribute('data-pr-state')} ${box.left}..${box.right}`);
      }
      for (const field of row.querySelectorAll('[data-pr-branches], [data-pr-label], [data-pr-merge], [data-pr-delete-branch], [data-pr-title]')) {
        const f = field.getBoundingClientRect();
        if (f.right > limit + 0.5) {
          problems.push(`${field.getAttribute('data-pr-title') === null ? field.tagName : 'title'} ${f.right} > ${limit}`);
        }
      }
    }
    return problems;
  });
  // A SWEEP MUST PROVE IT FOUND A CORPUS. `overflow.length === 0` is exactly
  // as green over three rows as over none, and "none" is what a renamed
  // attribute or a tab that failed to open would silently produce.
  const rowsHere = await page.locator('[data-pr-row]').count();
  check('there are rows at 390px to measure at all', rowsHere === 5, String(rowsHere));
  check('no row and no field overflows a 390px screen', overflow.length === 0, overflow.join('; '));

  // And the row is actually TALL -- a wrapped row is fine, a clipped one is not.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pr-row]')].some(
      (row) => row.scrollWidth > row.clientWidth + 1,
    ),
  );
  check('no row is scrolled sideways inside its own box', clipped === false);

  /**
   * AND AT 390 THE TWO SIDES STACK, which is the whole point of the split
   * being a container query: the phone's row box is below `PR_SPLIT_PX`, so
   * the status block goes UNDER the identity rather than beside it. A row
   * that kept two columns here would be the 390px defect this file exists to
   * catch, and it would look identical in every unit test.
   */
  const phoneStack = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pr-row]')].map((row) => {
      const id = row.querySelector('[data-pr-identity]').getBoundingClientRect();
      const st = row.querySelector('[data-pr-status]').getBoundingClientRect();
      const cs = getComputedStyle(row);
      const num = (k) => Number.parseFloat(cs.getPropertyValue(k)) || 0;
      return {
        content:
          row.getBoundingClientRect().width -
          num('padding-left') -
          num('padding-right') -
          num('border-left-width') -
          num('border-right-width'),
        stacked: st.top >= id.bottom - 0.5,
        idWidth: Math.round(id.width),
        stWidth: Math.round(st.width),
      };
    }),
  );
  console.log(`  the phone's row container measures ${phoneStack[0]?.content?.toFixed(1)}px`);
  check(
    'the phone really is below the split, so this measures the stacked case',
    phoneStack.length === 5 && phoneStack.every((s) => s.content < PR_SPLIT_PX),
    phoneStack.map((s) => s.content.toFixed(1)).join(', '),
  );
  check(
    'every row stacks its status under its identity at 390px',
    phoneStack.every((s) => s.stacked),
    JSON.stringify(phoneStack),
  );
  check(
    'and both sides take the full width there rather than sharing it',
    phoneStack.every((s) => s.idWidth > 200 && s.stWidth > 200),
    JSON.stringify(phoneStack.map((s) => [s.idWidth, s.stWidth])),
  );

  /**
   * THE TOUCH FLOOR, AND THE HALF OF IT NOBODY CHECKS.
   *
   * This repo's phone floor is 44x44 (`.vam-phone .vam-tap`), and every
   * existing assertion about it asks one question: is the HIT BOX at least
   * 44? That question is blind to the failure this pair of controls is most
   * exposed to -- a variable-width skin whose own word does not fit the box
   * it is painted in, which stayed green through every floor check in this
   * repo once already and was found by looking at a screenshot.
   *
   * `phone-shell.pw.ts` CANNOT COVER THESE. It drives `?demo=1`, whose
   * fixture declares no pull requests at all, so no PR control has ever been
   * measured by it. This is the only place these boxes exist on a phone.
   */
  const taps = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-pr-merge], [data-pr-delete-branch]')) {
      const hit = el.getBoundingClientRect();
      const skinEl = el.querySelector('[data-tap-skin]');
      const skin = skinEl?.getBoundingClientRect() ?? null;
      const range = document.createRange();
      range.selectNodeContents(skinEl ?? el);
      const word = range.getBoundingClientRect();
      range.detach();
      out.push({
        hook: el.hasAttribute('data-pr-merge') ? 'merge' : 'delete-branch',
        state: el.getAttribute('data-pr-merge-state'),
        label: (el.textContent ?? '').trim(),
        hitW: Math.round(hit.width * 10) / 10,
        hitH: Math.round(hit.height * 10) / 10,
        skinW: skin === null ? null : Math.round(skin.width * 10) / 10,
        skinH: skin === null ? null : Math.round(skin.height * 10) / 10,
        // THE SECOND QUESTION: does the word fit the box it is painted in?
        wordW: Math.round(word.width * 10) / 10,
        overflows:
          skinEl === null ||
          skinEl.scrollWidth > skinEl.clientWidth + 1 ||
          skinEl.scrollHeight > skinEl.clientHeight + 1 ||
          word.right > (skin?.right ?? 0) + 0.5 ||
          word.left < (skin?.left ?? 0) - 0.5,
      });
    }
    return out;
  });
  console.log(`  phone action boxes ${JSON.stringify(taps)}`);
  check('there are action controls on the phone to measure at all', taps.length >= 3, String(taps.length));
  const under = taps.filter((t) => t.hitW < 44 || t.hitH < 44);
  check(
    'every pull request action clears the 44x44 touch floor',
    under.length === 0,
    under.map((t) => `${t.label} ${t.hitW}x${t.hitH}`).join('; '),
  );
  const spilling = taps.filter((t) => t.overflows);
  check(
    'and every one of their labels FITS the box it is painted in',
    spilling.length === 0,
    spilling.map((t) => `${t.label} word ${t.wordW} in skin ${t.skinW}`).join('; '),
  );
  // The paint is deliberately SMALLER than the hit, which is this app's own
  // answer to "on mobile the buttons are too big" -- assert it, so a later
  // edit that inflates the border onto the 44 box is caught here.
  check(
    'the paint comes inward: the skin is shorter than the 44px hit box',
    taps.every((t) => t.skinH !== null && t.skinH < t.hitH),
    JSON.stringify(taps.map((t) => [t.label, t.skinH, t.hitH])),
  );

  // The stacked row itself, before anything is pressed -- the shot the old
  // one below could not be, because it is taken with the confirm dialog open
  // over three of the five rows.
  await page.screenshot({ path: `${outDir}/prs-tab-phone-rows.png` });
  console.log(`${outDir}/prs-tab-phone-rows.png`);

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
    'both of the confirm’s buttons are on the 390px screen',
    cancel !== null &&
      go !== null &&
      cancel.x >= 0 &&
      cancel.x + cancel.width <= 390 &&
      go.x >= 0 &&
      go.x + go.width <= 390,
    JSON.stringify({ cancel, go }),
  );
  await page.screenshot({ path: `${outDir}/prs-tab-phone.png` });
  console.log(`${outDir}/prs-tab-phone.png`);
  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nprs-tab: every check passed.');
