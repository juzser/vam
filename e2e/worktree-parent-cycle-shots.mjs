/**
 * THE PARENT/CHILD CYCLE (cross-provider review finding), AS A REAL BROWSER
 * PAINTS THE FALLBACK -- a project that is itself a LINKED worktree used to
 * list the main checkout as one of ITS OWN "children"
 * (`main/worktrees/worktrees.ts`'s own header now names the root cause and
 * the fix). Combined with the correct edge already recorded the other way
 * (the main checkout correctly lists the linked worktree as ITS child), the
 * sidebar's `useWorktreeParents` hook ended up with a two-node cycle: each
 * project read as a "suppressed child" of the other, with no unsuppressed
 * ancestor to stop at, and `SessionList.tsx`'s `isSuppressedWorktreeChild`
 * hid BOTH sections at once -- both projects' sessions vanished from the
 * sidebar entirely.
 *
 * `test/panels/worktrees/useWorktreeParents.test.ts` and
 * `test/panels/SessionList.worktree-suppression.test.tsx` already prove the
 * fallback BEHAVIOUR in happy-dom: a cyclic parent map is broken, and both
 * projects' headings stay in the DOM. Neither is a paint question. This file
 * is the real-browser, real-screenshot half: two genuine top-level project
 * sections, each with its own session row, actually rendered by Chromium
 * with `window.api.worktrees.list` stubbed to answer the EXACT cyclic shape
 * the review reproduced against real git (`list(main) => [linked as a
 * child]` AND `list(linked) => [main as a child]`) -- proving the renderer's
 * OWN second guard (`useWorktreeParents.ts`'s `breakCycles`) holds even
 * when fed the worst-case input directly, independent of whether the
 * main-process fix ever regresses.
 *
 * Committed evidence: `docs/ui/worktree-parent-cycle-sidebar-{dark,light}.png`.
 *
 * FALSIFIED BY HAND, MEASURED: comment out the `breakCycles(...)` call in
 * `useWorktreeParents.ts` (pass `new Map(lists.flat())` straight to
 * `setParents` instead) and re-run -- this is not a partial regression, it
 * is a total one: `visibleEntries`' own suppression check reads BOTH
 * projects as a "suppressed child" of the other (neither hidden, so
 * neither's own top-level section draws), which ALSO means neither
 * project's `WorktreesSection` (only rendered for a VISIBLE top-level
 * entry) ever mounts to nest the other's session either -- every
 * `data-session-row` in the sidebar drops to zero at once, and
 * `page.waitForSelector('[data-session-row]')` below times out outright
 * rather than merely finding fewer rows than expected. This is the exact
 * "sessions vanish from the sidebar" the cross-provider review reported.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/worktree-parent-cycle-shots.mjs http://localhost:5520 docs/ui
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

const CAPABILITIES = {
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
};

// The main checkout, and the linked worktree -- deliberately its OWN vam
// project, `docs/design/worktrees.md` §4's identity decision
// (`projectIdOf(worktreeId)`, a digest of a DIFFERENT directory).
const MAIN_PROJECT_ID = 'claude-code:vam-11112222';
const LINKED_PROJECT_ID = 'claude-code:parent-cycle-fix-33334444';

function twoProjects() {
  return [
    {
      id: MAIN_PROJECT_ID,
      name: 'vam',
      source: 'claude-code',
      sessions: [
        {
          id: 'claude:main-session',
          title: 'main checkout session',
          epic: null,
          branch: 'main',
          status: 'idle',
          runningAgents: 0,
          activity: null,
          age: '4m',
          decisions: [],
          source: 'claude-code',
        },
      ],
    },
    {
      id: LINKED_PROJECT_ID,
      name: 'parent-cycle-fix',
      source: 'claude-code',
      sessions: [
        {
          id: 'claude:linked-session',
          title: 'linked worktree session',
          epic: null,
          branch: 'fix/parent-cycle',
          status: 'idle',
          runningAgents: 0,
          activity: null,
          age: '1m',
          decisions: [],
          source: 'claude-code',
        },
      ],
    },
  ];
}

/**
 * THE EXACT CYCLE, at the API layer: `list(main)` correctly names the
 * linked worktree as ITS child (the direction §4 always intended), and
 * `list(linked)` -- reproducing the bug this fix closes -- ALSO names the
 * main checkout as one of ITS children. `useWorktreeParents.ts`'s
 * `breakCycles` is what has to stand between this stub and a blank sidebar.
 */
function install({ projects, mainProjectId, linkedProjectId }) {
  globalThis.window.api = {
    describe: async () => ({
      id: 'worktree-parent-cycle-stub',
      label: 'worktree parent/child cycle stub',
      capabilities: window.__worktreeParentCycleCapabilities,
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
      list: async (askedProjectId) => {
        if (askedProjectId === mainProjectId) {
          return [
            window.__worktreeInfoFor(linkedProjectId, '/Users/operator/code/vam-worktrees/parent-cycle-fix', 'fix/parent-cycle'),
          ];
        }
        if (askedProjectId === linkedProjectId) {
          // THE BUG, REPRODUCED ON PURPOSE: before the main-process fix, a
          // linked worktree's own `listWorktrees` call answered with the
          // main checkout as one of ITS children too -- the reverse edge
          // that closes the cycle. Feeding it here, at the stub layer,
          // proves the RENDERER's own second guard independent of whether
          // the main-process fix ever regresses.
          return [window.__worktreeInfoFor(mainProjectId, '/Users/operator/code/vam', 'main')];
        }
        return [];
      },
      create: async () => {
        throw new Error('not exercised in this picture');
      },
      remove: async () => {
        throw new Error('not exercised in this picture');
      },
      status: async () => [],
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
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.addInitScript((caps) => {
  window.__worktreeParentCycleCapabilities = caps;
}, CAPABILITIES);
// `worktreeInfo` is handed in as page-init DATA (never a closure --
// `addInitScript` serialises its argument, `worktrees-shots.mjs`'s own
// header explains why), then wrapped back into a callable inside the page.
await page.addInitScript(() => {
  window.__worktreeInfoFor = (projectId, path, branch) => ({
    worktreeId: path,
    path,
    branch,
    projectId,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    detached: false,
    external: false,
  });
});
await page.addInitScript(install, {
  projects: twoProjects(),
  mainProjectId: MAIN_PROJECT_ID,
  linkedProjectId: LINKED_PROJECT_ID,
});
await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]', { timeout: 10_000 });
// Give `useWorktreeParents`'s own effect a turn to fetch and resolve both
// `list()` calls before asserting anything -- otherwise a pass could be for
// the wrong reason (nothing resolved yet) rather than the right one (both
// resolved, cycle broken, neither suppressed).
await page.waitForFunction(
  () => document.querySelectorAll('[data-project-heading]').length >= 2,
  { timeout: 10_000 },
);

check(
  "the MAIN checkout's own top-level section is drawn",
  (await page.locator(`[data-project-heading][data-project-id="${MAIN_PROJECT_ID}"]`).count()) ===
    1,
);
check(
  "the LINKED worktree's own top-level section is ALSO drawn -- the cycle fallback, not suppression",
  (await page.locator(`[data-project-heading][data-project-id="${LINKED_PROJECT_ID}"]`).count()) ===
    1,
);
// `>= 1`, not `=== 1`: `WorktreesSection` re-fetches `list()` a second time
// and nests the SAME session a second time under the (also unsuppressed)
// other project's "Worktrees" row -- `docs/design/worktrees.md` §4's own
// "accepted v1 duplication", unrelated to this fix. What matters here is
// that neither session's row COUNT ever drops to zero, which is what a
// still-hidden section would do.
check(
  "the main checkout's own session row is visible (at least once, never zero)",
  (await page.locator('[data-session-row="claude:main-session"]').count()) >= 1,
);
check(
  "the linked worktree's own session row is ALSO visible (at least once, never zero) -- not lost inside a hidden section",
  (await page.locator('[data-session-row="claude:linked-session"]').count()) >= 1,
);

await shootBothThemes(page, 'worktree-parent-cycle-sidebar');

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nworktree-parent-cycle-shots: all checks passed.');
