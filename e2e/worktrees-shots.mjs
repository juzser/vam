/**
 * THE WORKTREES SIDEBAR, AS A REAL BROWSER PAINTS IT: the "Worktrees"
 * sub-list under a project, the create form, and the delete confirmation --
 * in both themes. Phase 2a adds a SECOND row -- a worktree ADOPTED from
 * outside vam (a path `git worktree add` could have made directly, never
 * inside `<repo>-worktrees/`), with its dirty dot and ahead/behind badges
 * painted -- and a THIRD, locked row proving its delete control is never
 * drawn at all.
 *
 * PHASE 2B ADDS THE FILTER ITSELF: both the adopted row (truly external --
 * its path sits outside `vam-worktrees/` entirely) and the locked row (vam's
 * own, but locked) are now HIDDEN BY DEFAULT -- the operator's own report
 * opening a project full of worktrees that are not vam's, or are locked, with
 * no way to hide or fold them. `worktrees-sidebar` is now the SHIPPED
 * DEFAULT: one plain row, a quiet "2 hidden" note, nothing else. A second
 * state, `worktrees-external-tree`, turns "Show external worktrees" on from
 * the same filter popover every session-origin toggle already lives in, and
 * shoots the compact, dimmed, dotted-connector tree those two rows draw in
 * once shown -- nested under the project's own worktrees, never mixed into
 * the plain list above it.
 *
 * `test/panels/worktrees/WorktreesSection.test.tsx`,
 * `WorktreesSection.external-worktrees.test.tsx` and
 * `ConfirmDeleteWorktree.test.tsx` already prove the BEHAVIOUR in happy-dom:
 * fetch, create, delete, the dirty-tree escalation, the agent-worktree
 * filter, the external/locked filter, the badges. None of that is a
 * rectangle or a paint question, and `WorktreesSection.tsx`'s own header
 * names why this feature reads `window.api` directly rather than taking
 * SessionList's usual callback props -- which this file also exercises for
 * real, through the actual preload-shaped stub, rather than a mocked prop.
 *
 * THE STUB is `sidebar-ownership-shots.mjs`'s own full `PreloadSourceApi`
 * shape (that file's header explains why a partial one reddens the whole
 * page before a single check here runs), extended with `worktrees.{list,
 * create,remove,status}` backed by an in-page array so create/delete
 * actually change what `list` answers next -- the same "stub behaves like
 * the real bridge, not just its type" bar `sidebar-ownership-shots.mjs`
 * holds for `window.api.load`.
 *
 * Committed evidence: `docs/ui/worktrees-sidebar-{dark,light}.png`,
 * `worktrees-external-tree-{dark,light}.png`, `worktrees-create-
 * {dark,light}.png`, `worktrees-delete-confirm-{dark,light}.png`.
 *
 * FALSIFIED BY HAND: comment out `WorktreesSection`'s
 * `if (worktrees.length === 0 && !creating) return null;` early return --
 * every project in the sidebar draws an empty "Worktrees" heading, and the
 * `worktrees-sidebar` shot goes from "a lean project with no worktrees
 * printed" to "clutter above the fold" instantly visible in the PNG diff.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/worktrees-shots.mjs http://localhost:5520 e2e/test-results
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'e2e/test-results';

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

const CAPABILITIES = {
  liveUpdates: false,
  // REQUIRED alongside `createSession` -- `preload-factory.ts`'s own port
  // rule: a write surface cannot exist without `recordPrompt`, so
  // `createSession: true, recordPrompt: false` is a contradiction the port
  // refuses to build a source from at all. This stub never actually calls
  // `recordPrompt` (no test here types a prompt); it only has to be
  // ADVERTISED so `createSessionIn` ("Start a session here") is reachable.
  recordPrompt: true,
  deliverPrompt: false,
  promptAttachments: false,
  slashCommands: false,
  renameSession: false,
  closeSession: false,
  createSession: true,
  governance: false,
  pullRequests: false,
  terminal: false,
  agentRoster: false,
  resumeSession: false,
};

const PROJECT_ID = 'claude-code:vam-11112222';

function worktreesProjects() {
  return [
    {
      id: PROJECT_ID,
      name: 'vam',
      source: 'claude-code',
      sessions: [
        {
          id: 'claude:main-session',
          title: 'main session',
          epic: null,
          branch: 'main',
          status: 'idle',
          runningAgents: 0,
          activity: null,
          age: '2m',
          decisions: [],
          source: 'claude-code',
        },
      ],
    },
  ];
}

/** One pre-existing worktree, so the "Worktrees" sub-list is already visible
 *  on first paint -- `WorktreesSection` stays hidden with zero, by design.
 *  Made through vam ITSELF -- inside `vam-worktrees/`, clean, no badges. */
const INITIAL_WORKTREE = {
  worktreeId: '/Users/operator/code/vam-worktrees/fix-terminal-echo',
  path: '/Users/operator/code/vam-worktrees/fix-terminal-echo',
  branch: 'fix-terminal-echo',
  projectId: 'claude-code:fix-terminal-echo-99998888',
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  detached: false,
  external: false,
};

/**
 * ADOPTED -- phase 2a's own row: a path `git worktree add` made directly,
 * never inside `vam-worktrees/`, that vam now lists and can safely delete
 * exactly like `INITIAL_WORKTREE` above. Its `status` entry (below) paints
 * both badges at once: a dirty dot AND an ahead/behind pair.
 *
 * `external: true` -- phase 2b's own field, purely path-based
 * (`worktrees.ts`'s own `worktreesRootFor`): this is the row phase 2b's new
 * filter hides by default, and shows nested/dimmed once the operator turns
 * it on.
 */
const ADOPTED_WORKTREE = {
  worktreeId: '/Users/operator/code/scratch/manual-hotfix',
  path: '/Users/operator/code/scratch/manual-hotfix',
  branch: 'manual-hotfix',
  projectId: 'claude-code:manual-hotfix-77776666',
  locked: false,
  lockReason: null,
  prunable: false,
  prunableReason: null,
  detached: false,
  external: true,
};

/** LOCKED -- proves its delete "×" is never drawn at all (`removeWorktree`
 *  refuses a locked worktree unconditionally, so offering the control would
 *  not be honest), and that the row still says why via `lockReason`. VAM'S
 *  OWN (`external: false`) but hidden by the SAME phase-2b default as
 *  `ADOPTED_WORKTREE` above: the operator's own ask covers "not vam's, OR
 *  locked" as one rule, and this row is the second half of it. */
const LOCKED_WORKTREE = {
  worktreeId: '/Users/operator/code/vam-worktrees/release-freeze',
  path: '/Users/operator/code/vam-worktrees/release-freeze',
  branch: 'release-freeze',
  projectId: 'claude-code:release-freeze-55554444',
  locked: true,
  lockReason: 'reserved for the release build',
  prunable: false,
  prunableReason: null,
  detached: false,
  external: false,
};

/** `worktree:status`'s own answer for the two rows worth badging --
 *  `INITIAL_WORKTREE` and `LOCKED_WORKTREE` are left out entirely, the same
 *  "no row for this id" shape `getWorktreeStatuses` already answers with
 *  for anything it was not asked to badge. */
const STATUS_BY_WORKTREE_ID = {
  [ADOPTED_WORKTREE.worktreeId]: {
    worktreeId: ADOPTED_WORKTREE.worktreeId,
    dirty: true,
    ahead: 2,
    behind: 1,
  },
};

/** A full `PreloadSourceApi`, `sidebar-ownership-shots.mjs`'s own shape,
 *  extended with `worktrees` and a real-acting `createSessionIn`. `projects`
 *  arrives as page-init data, not a closure -- `addInitScript` serialises
 *  its argument rather than capturing this module's scope. */
function install({ projects, projectId, initialWorktrees }) {
  globalThis.window.__worktreesStore = initialWorktrees.map((w) => ({ ...w }));
  globalThis.window.api = {
    describe: async () => ({
      id: 'worktrees-stub',
      label: 'Worktrees stub',
      capabilities: window.__worktreesCapabilities,
      declines: {},
      viewerScope: 'operator',
    }),
    load: async () => projects,
    subscribe: () => () => {},
    recordPrompt: async () => {},
    renameSession: async () => {},
    closeSession: async () => {},
    createSession: async () => {},
    createSessionIn: async () => {},
    resumeSession: async () => {},
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
    worktrees: {
      list: async (askedProjectId) =>
        askedProjectId === projectId ? window.__worktreesStore : [],
      create: async (input) => {
        const worktree = {
          worktreeId: `/Users/operator/code/vam-worktrees/${input.name}`,
          path: `/Users/operator/code/vam-worktrees/${input.name}`,
          branch: input.name,
          projectId: `claude-code:${input.name}-00000000`,
          locked: false,
          lockReason: null,
          prunable: false,
          prunableReason: null,
          detached: false,
          external: false,
        };
        window.__worktreesStore = [...window.__worktreesStore, worktree];
        return worktree;
      },
      remove: async (input) => {
        window.__worktreesStore = window.__worktreesStore.filter(
          (w) => w.worktreeId !== input.worktreeId,
        );
        return { preservedBranch: false };
      },
      // Phase 2a's own member -- `window.__statusByWorktreeId` is a plain
      // object (not a closure) for the identical `addInitScript` reason
      // `initialWorktrees` is handed in as page-init data below.
      status: async ({ worktreeIds }) =>
        worktreeIds.flatMap((id) => {
          const status = window.__statusByWorktreeId[id];
          return status === undefined ? [] : [status];
        }),
    },
  };
}

async function shootBothThemes(page, name) {
  await page.screenshot({ path: `${outDir}/${name}-dark.png` });
  console.log(`${outDir}/${name}-dark.png`);
  await page.locator('button[aria-label="switch to light theme"]').click();
  await page.waitForSelector('button[aria-label="switch to dark theme"]', { timeout: 3_000 });
  await page.screenshot({ path: `${outDir}/${name}-light.png` });
  console.log(`${outDir}/${name}-light.png`);
  // Back to dark, so the next state in this same page starts from the shipped default.
  await page.locator('button[aria-label="switch to dark theme"]').click();
  await page.waitForSelector('button[aria-label="switch to light theme"]', { timeout: 3_000 });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => console.log('CONSOLE:', msg.type(), msg.text()));
await page.addInitScript((caps) => {
  window.__worktreesCapabilities = caps;
}, CAPABILITIES);
await page.addInitScript((byId) => {
  window.__statusByWorktreeId = byId;
}, STATUS_BY_WORKTREE_ID);
await page.addInitScript(install, {
  projects: worktreesProjects(),
  projectId: PROJECT_ID,
  initialWorktrees: [INITIAL_WORKTREE, ADOPTED_WORKTREE, LOCKED_WORKTREE],
});
await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]', { timeout: 10_000 });

// ---------------------------------------------------------------------------
// STATE 1: the sidebar, "Worktrees" already open, THE SHIPPED DEFAULT -- one
// plain (vam-made, unlocked) row, and a quiet note for the two phase-2b
// hides: the ADOPTED row (external) and the LOCKED row (vam's own, but
// locked). Neither draws at all yet -- that is the whole point of this
// state, and `worktrees-sidebar` is the SAME committed filename phase 2a
// shot, now painting the NEW default rather than three flat rows.
// ---------------------------------------------------------------------------
const section = page.locator(`[data-worktrees-section="${PROJECT_ID}"]`);
await section.waitFor({ timeout: 10_000 });
check('the section is drawn under the project it belongs to', (await section.count()) === 1);
const row = page.locator('[data-worktree-row]');
check(
  'ONE worktree row by default -- the external/locked filter hides the other two',
  (await row.count()) === 1,
  `${await row.count()}`,
);
check(
  'the vam-made row shows its branch',
  (await page.locator(`[data-worktree-row="${INITIAL_WORKTREE.worktreeId}"] [data-worktree-branch]`).textContent()) ===
    'fix-terminal-echo',
);
check(
  '"Start a session here" — no live session in this worktree yet',
  (await page.locator('[data-worktree-start-here]').count()) === 1,
  `${await page.locator('[data-worktree-start-here]').count()}`,
);
check(
  'the quiet note names both hidden rows, without drawing either',
  (await page.locator('[data-worktrees-external-hidden-count]').textContent()) === '2 hidden',
);
check(
  'neither hidden row is in the DOM at all, not merely visually hidden',
  (await page.locator(`[data-worktree-row="${ADOPTED_WORKTREE.worktreeId}"]`).count()) === 0 &&
    (await page.locator(`[data-worktree-row="${LOCKED_WORKTREE.worktreeId}"]`).count()) === 0,
);

await shootBothThemes(page, 'worktrees-sidebar');

// ---------------------------------------------------------------------------
// STATE 1b: "Show external worktrees" turned ON from the SAME filter popover
// every session-origin toggle already lives in -- the compact, dimmed,
// dotted-connector tree the operator's own report asked for, nested under
// this project's plain worktree row rather than mixed into it.
// ---------------------------------------------------------------------------
await page.locator('[data-filter-toggle]').click();
await page.waitForSelector('[data-origin-toggle="external-worktree"]', { timeout: 5_000 });
await page.locator('[data-origin-toggle="external-worktree"]').click();
await page.locator('[data-filter-toggle]').click();

const externalGroup = page.locator(`[data-worktrees-external-group="${PROJECT_ID}"]`);
await externalGroup.waitFor({ timeout: 5_000 });
check(
  'the tree is expanded by default the first time it is shown',
  (await page.locator(`[data-worktrees-external-toggle="${PROJECT_ID}"]`).getAttribute('aria-expanded')) ===
    'true',
);
check(
  'both previously-hidden rows now draw, nested under that one group',
  (await externalGroup.locator(`[data-worktree-row="${ADOPTED_WORKTREE.worktreeId}"]`).count()) === 1 &&
    (await externalGroup.locator(`[data-worktree-row="${LOCKED_WORKTREE.worktreeId}"]`).count()) === 1,
);
check(
  'the plain row never moves into that group',
  (await externalGroup.locator(`[data-worktree-row="${INITIAL_WORKTREE.worktreeId}"]`).count()) === 0,
);
const adoptedRow = page.locator(`[data-worktree-row="${ADOPTED_WORKTREE.worktreeId}"]`);
check(
  'the ADOPTED row still offers delete -- adoption means the same affordances',
  (await adoptedRow.locator('[data-worktree-delete]').count()) === 1,
);
check(
  'the ADOPTED row shows a dirty dot',
  (await adoptedRow.locator('[data-worktree-dirty]').count()) === 1,
);
check(
  'the ADOPTED row shows its ahead/behind pair',
  (await adoptedRow.locator('[data-worktree-ahead]').textContent()) === '2' &&
    (await adoptedRow.locator('[data-worktree-behind]').textContent()) === '1',
);

const lockedRow = page.locator(`[data-worktree-row="${LOCKED_WORKTREE.worktreeId}"]`);
check(
  'the LOCKED row never offers delete',
  (await lockedRow.locator('[data-worktree-delete]').count()) === 0,
);
check(
  'the LOCKED row says so',
  (await lockedRow.locator('[data-worktree-locked]').count()) === 1,
);

await shootBothThemes(page, 'worktrees-external-tree');

// ---------------------------------------------------------------------------
// CONTRAST, MEASURED IN THE BROWSER, NOT ASSUMED FROM A CLASS STRING -- the
// coordinator's own report: the compact rows read "barely dimmer than
// normal", and the dashed guide was "nearly invisible at 1x". Tailwind v4's
// own opacity modifier (`text-ink-faint/80`) can render as `oklab(... /
// 0.8)`, which `getComputedStyle` returns verbatim rather than downcasting
// to `rgb()` -- a colour string no regex should be trusted to parse. This
// resolves ANY CSS colour to real sRGB bytes, alpha already composited over
// its own real background, using the browser's OWN colour parser
// (`CanvasRenderingContext2D.fillStyle`), then computes WCAG contrast by
// hand. FALSIFIED BY HAND, MEASURED: reverting `WorktreesSection.tsx`'s
// guide to `border-line border-dashed` DOES turn this check red -- 1.614:1
// dark / 1.099:1 light, both under the 3:1 floor, exactly the numbers this
// file's own header on `COMPACT_DIM_TEXT` cites. Reverting the compact
// TEXT to plain `text-ink-faint` (no `/80`) does NOT turn its own check
// red: `text-ink-faint` alone already clears 3:1 (7.247:1 dark / 4.642:1
// light) -- the operator's report was that it read "barely dimmer than
// normal", a RELATIVE complaint no absolute floor check can catch, not
// that it failed the floor outright. This check exists to guard the floor
// (and the border regression it does catch); the SCREENSHOTS above it are
// what a reviewer actually judges "clearly dim" against.
//
// A FOLLOW-UP REVIEW OF THIS FILE ITSELF found the text half was worse than
// that: `document.querySelector('[data-worktree-name]')` was unscoped, so it
// always resolved to the first plain (non-compact) row's own name span --
// never a row inside `groupEl` at all. That row uses `text-ink-dim`, not
// `COMPACT_DIM_TEXT`, and clears 3:1 by a wide margin regardless of what the
// compact token is set to -- which is exactly why the paragraph above could
// truthfully say the compact-text revert "does NOT turn its own check red":
// the check was never measuring a compact row's text in the first place.
// FALSIFIED BY HAND, MEASURED, a second time: with `COMPACT_DIM_TEXT` set to
// `text-ink-faint/40` (well under the floor in both themes), the OLD,
// unscoped lookup left both "compact row text" checks green; scoping
// `nameEl`/`rowEl` to `groupEl` the same way `borderEl` already was, plus a
// new structural check that the measured row actually carries `text-meta`
// (the class `renderRow` only ever gives a compact row), turns both red at
// the same opacity, then green again at the shipped `/80`.
// ---------------------------------------------------------------------------
async function measureContrast() {
  return page.evaluate(() => {
    function relLum([r, g, b]) {
      const chan = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const [rl, gl, bl] = [chan(r), chan(g), chan(b)];
      return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
    }
    function contrastOf(a, b) {
      const la = relLum(a);
      const lb = relLum(b);
      const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
      return (lighter + 0.05) / (darker + 0.05);
    }
    function bgOf(el) {
      let cur = el;
      while (cur !== null) {
        const cs = getComputedStyle(cur);
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
          return cs.backgroundColor;
        }
        cur = cur.parentElement;
      }
      return 'rgb(0, 0, 0)';
    }
    function toRgbBytes(colorStr, backdropStr) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = backdropStr;
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = colorStr;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    }
    // Scoped to `groupEl`, the SAME way `borderEl` already was -- an
    // unscoped `document.querySelector('[data-worktree-name]')` resolves to
    // the first such element in the WHOLE document, which is the plain,
    // non-compact row above the tree (brighter `text-ink-dim`, not
    // `COMPACT_DIM_TEXT`), never a row inside the group. That plain row
    // clears 3:1 trivially regardless of what `COMPACT_DIM_TEXT` is set to,
    // so the two "compact row text" checks below were structurally
    // incapable of catching a regression in the compact row's own text --
    // caught by a fresh pair of eyes on this file, FALSIFIED BY HAND:
    // dropping `COMPACT_DIM_TEXT` to `text-ink-faint/40` (well under the
    // floor) left both checks green under the OLD, unscoped lookup.
    const groupEl = document.querySelector('[data-worktrees-external-group]');
    const nameEl = groupEl?.querySelector('[data-worktree-name]') ?? null;
    const rowEl = nameEl?.closest('[data-worktree-row]') ?? null;
    const borderEl = groupEl?.querySelector('div.border-l') ?? null;
    const rowBg = rowEl === null ? null : bgOf(rowEl);
    const borderBg = borderEl === null ? null : bgOf(borderEl);
    const nameRgb =
      nameEl === null || rowBg === null ? null : toRgbBytes(getComputedStyle(nameEl).color, rowBg);
    const rowBgRgb = rowBg === null ? null : toRgbBytes(rowBg, 'rgb(0,0,0)');
    const borderRgb =
      borderEl === null || borderBg === null
        ? null
        : toRgbBytes(getComputedStyle(borderEl).borderLeftColor, borderBg);
    const borderBgRgb = borderBg === null ? null : toRgbBytes(borderBg, 'rgb(0,0,0)');
    // Proves the row just measured really IS a compact one -- `renderRow`'s
    // own wrapper carries `text-meta` only when `compact: true`
    // (`WorktreesSection.tsx`), so this is a structural fact about the DOM,
    // not another read of the colour this function already measures.
    const rowIsCompact = rowEl !== null && rowEl.className.split(/\s+/).includes('text-meta');
    return {
      nameContrast: nameRgb === null || rowBgRgb === null ? null : contrastOf(nameRgb, rowBgRgb),
      borderContrast:
        borderRgb === null || borderBgRgb === null ? null : contrastOf(borderRgb, borderBgRgb),
      rowIsCompact,
    };
  });
}

const NON_TEXT_CONTRAST_FLOOR = 3.0;
const darkContrast = await measureContrast();
check(
  'the row measured for text contrast really is a compact, dimmed one -- not the plain row above it',
  darkContrast.rowIsCompact,
);
check(
  `compact row text clears the ${NON_TEXT_CONTRAST_FLOOR}:1 floor in dark theme`,
  darkContrast.nameContrast !== null && darkContrast.nameContrast >= NON_TEXT_CONTRAST_FLOOR,
  `${darkContrast.nameContrast}`,
);
check(
  `tree guide clears the ${NON_TEXT_CONTRAST_FLOOR}:1 floor in dark theme`,
  darkContrast.borderContrast !== null && darkContrast.borderContrast >= NON_TEXT_CONTRAST_FLOOR,
  `${darkContrast.borderContrast}`,
);

await page.locator('button[aria-label="switch to light theme"]').click();
await page.waitForSelector('button[aria-label="switch to dark theme"]', { timeout: 3_000 });
const lightContrast = await measureContrast();
check(
  'the row measured for text contrast really is a compact, dimmed one -- not the plain row above it (light theme)',
  lightContrast.rowIsCompact,
);
check(
  `compact row text clears the ${NON_TEXT_CONTRAST_FLOOR}:1 floor in light theme`,
  lightContrast.nameContrast !== null && lightContrast.nameContrast >= NON_TEXT_CONTRAST_FLOOR,
  `${lightContrast.nameContrast}`,
);
check(
  `tree guide clears the ${NON_TEXT_CONTRAST_FLOOR}:1 floor in light theme`,
  lightContrast.borderContrast !== null && lightContrast.borderContrast >= NON_TEXT_CONTRAST_FLOOR,
  `${lightContrast.borderContrast}`,
);
await page.locator('button[aria-label="switch to dark theme"]').click();
await page.waitForSelector('button[aria-label="switch to light theme"]', { timeout: 3_000 });

// Back to the shipped default before the remaining states -- STATE 2/3 below
// exercise the SAME behaviour phase 2a already proved, unrelated to this
// filter, and the plain row's own delete confirmation is otherwise
// ambiguous once a second, nested delete button exists for the same name
// class in the DOM.
await page.locator('[data-filter-toggle]').click();
await page.waitForSelector('[data-origin-toggle="external-worktree"]', { timeout: 5_000 });
await page.locator('[data-origin-toggle="external-worktree"]').click();
await page.locator('[data-filter-toggle]').click();
await externalGroup.waitFor({ state: 'detached', timeout: 5_000 });

// ---------------------------------------------------------------------------
// STATE 2: the create form, open, with a name typed in.
// ---------------------------------------------------------------------------
await page.locator(`[data-worktrees-add="${PROJECT_ID}"]`).click();
await page.waitForSelector('[data-worktrees-create-form]', { timeout: 5_000 });
await page.fill('[data-worktrees-create-name]', 'fix-transcript-paging');
check(
  'Create enables once a name is typed',
  (await page.locator('[data-worktrees-create-submit]').isEnabled()) === true,
);
await shootBothThemes(page, 'worktrees-create');

await page.locator('[data-worktrees-create-cancel]').click();
await page.waitForSelector('[data-worktrees-create-form]', { state: 'detached', timeout: 5_000 });

// ---------------------------------------------------------------------------
// STATE 3: the delete confirmation, for the existing row.
//
// NOT `shootBothThemes` -- that helper clicks the theme toggle button in the
// sidebar corner, but this dialog is a REAL modal (`fixed inset-0`, the same
// full-screen scrim `ConfirmRemoveProject` uses): its own backdrop button
// (`aria-label="cancel deleting the worktree"`) covers the whole viewport
// and intercepts that click, exactly as it should for a real operator too.
// So: shoot dark, close, toggle theme, reopen, shoot light.
// ---------------------------------------------------------------------------
async function openDeleteConfirm() {
  // Scoped to the vam-made row specifically -- only one by the shipped
  // default (the other two draw only once "Show external worktrees" is on,
  // and STATE 1b above already turned it back off), but kept scoped rather
  // than the bare `[data-worktree-delete]` selector this used to be: that
  // form would fail Playwright's strict mode the instant a second row with
  // its own delete button is on screen for any reason.
  await page
    .locator(`[data-worktree-row="${INITIAL_WORKTREE.worktreeId}"] [data-worktree-delete]`)
    .click();
  await page.waitForSelector('[data-confirm-delete-worktree]', { timeout: 5_000 });
}

await openDeleteConfirm();
check(
  'names the worktree by its directory name',
  (await page.locator('[data-confirm-delete-worktree]').textContent())?.includes(
    'fix-terminal-echo',
  ) === true,
);
check(
  'Cancel holds initial focus, not the destructive button',
  await page.evaluate(
    () => document.activeElement?.getAttribute('data-confirm-delete-worktree-cancel') !== null,
  ),
);
await page.screenshot({ path: `${outDir}/worktrees-delete-confirm-dark.png` });
console.log(`${outDir}/worktrees-delete-confirm-dark.png`);

await page.locator('[data-confirm-delete-worktree-cancel]').click();
await page.waitForSelector('[data-confirm-delete-worktree]', { state: 'detached', timeout: 5_000 });
await page.locator('button[aria-label="switch to light theme"]').click();
await page.waitForSelector('button[aria-label="switch to dark theme"]', { timeout: 3_000 });

await openDeleteConfirm();
await page.screenshot({ path: `${outDir}/worktrees-delete-confirm-light.png` });
console.log(`${outDir}/worktrees-delete-confirm-light.png`);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nworktrees-shots: all checks passed.');
