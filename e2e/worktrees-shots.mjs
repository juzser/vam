/**
 * THE WORKTREES SIDEBAR, AS A REAL BROWSER PAINTS IT: the "Worktrees"
 * sub-list under a project, the create form, and the delete confirmation --
 * in both themes. Phase 2a adds a SECOND row -- a worktree ADOPTED from
 * outside vam (a path `git worktree add` could have made directly, never
 * inside `<repo>-worktrees/`), with its dirty dot and ahead/behind badges
 * painted -- and a THIRD, locked row proving its delete control is never
 * drawn at all.
 *
 * `test/panels/worktrees/WorktreesSection.test.tsx` and
 * `ConfirmDeleteWorktree.test.tsx` already prove the BEHAVIOUR in happy-dom:
 * fetch, create, delete, the dirty-tree escalation, the agent-worktree
 * filter, the badges. None of that is a rectangle or a paint question, and
 * `WorktreesSection.tsx`'s own header names why this feature reads
 * `window.api` directly rather than taking SessionList's usual callback
 * props -- which this file also exercises for real, through the actual
 * preload-shaped stub, rather than a mocked prop.
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
 * `worktrees-create-{dark,light}.png`, `worktrees-delete-confirm-
 * {dark,light}.png`.
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
};

/**
 * ADOPTED -- phase 2a's own row: a path `git worktree add` made directly,
 * never inside `vam-worktrees/`, that vam now lists and can safely delete
 * exactly like `INITIAL_WORKTREE` above. Its `status` entry (below) paints
 * both badges at once: a dirty dot AND an ahead/behind pair.
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
};

/** LOCKED -- proves its delete "×" is never drawn at all (`removeWorktree`
 *  refuses a locked worktree unconditionally, so offering the control would
 *  not be honest), and that the row still says why via `lockReason`. */
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
// STATE 1: the sidebar, "Worktrees" already open -- one vam-made row, one
// ADOPTED row with both badges, one LOCKED row with no delete control.
// ---------------------------------------------------------------------------
const section = page.locator(`[data-worktrees-section="${PROJECT_ID}"]`);
await section.waitFor({ timeout: 10_000 });
check('the section is drawn under the project it belongs to', (await section.count()) === 1);
const row = page.locator('[data-worktree-row]');
check(
  'three worktree rows, from the stubbed list()',
  (await row.count()) === 3,
  `${await row.count()}`,
);
check(
  'the vam-made row shows its branch',
  (await page.locator(`[data-worktree-row="${INITIAL_WORKTREE.worktreeId}"] [data-worktree-branch]`).textContent()) ===
    'fix-terminal-echo',
);
check(
  '"Start a session here" — no live session in this worktree yet',
  (await page.locator('[data-worktree-start-here]').count()) === 3,
  `${await page.locator('[data-worktree-start-here]').count()}`,
);

const adoptedRow = page.locator(`[data-worktree-row="${ADOPTED_WORKTREE.worktreeId}"]`);
check(
  'the ADOPTED row is listed, living outside vam-worktrees/ entirely',
  (await adoptedRow.count()) === 1,
);
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

await shootBothThemes(page, 'worktrees-sidebar');

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
  // Scoped to the vam-made row specifically -- three rows now offer delete
  // (the vam-made one and the adopted one; the locked one offers none at
  // all), so the bare `[data-worktree-delete]` selector this used to be
  // would match more than one element and fail Playwright's strict mode.
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
