/**
 * THE SIDEBAR SHOWS ONLY WHAT VAM OWNS -- `docs/design/vam-owns-the-
 * session.md`, Stage 1's own acceptance line, read straight off a real
 * browser: "a sidebar with one live session and eleven finished Codex
 * threads shows one row; the toggle shows twelve; killing tmux shows twelve
 * and a reason; and a `tmux new-session -s vam-x` with a bare shell in it
 * appears as a row."
 *
 * ── WHY THIS NEEDS A REAL BROWSER, NOT `session-filter.foreign.test.ts` ────
 *
 * The unit file proves `isForeign`/`isHiddenByForeignFilter` are correct
 * PREDICATES. It cannot prove the popover actually WIRES them: that clicking
 * `[data-origin-toggle="foreign"]` reaches `Canvas.tsx`'s `entries` memo,
 * that the memo really stands both rules down while `vamListingGap` is set
 * (an app-wide state transition no unit test drives end to end), or that the
 * reason text lands where an operator would actually read it. Those are DOM
 * facts, and this file measures them the way `attention-shots.mjs` measures
 * a real `visibilitychange`.
 *
 * ── THE STUB, AND THE ONE DELIBERATE SIMPLIFICATION IN IT ─────────────────
 *
 * A full `PreloadSourceApi`, the same shape `attention-shots.mjs` and
 * `prs-tab-shots.mjs` both use and for the same reason their own headers
 * give: `App.tsx`'s top-level switch takes the page off `?demo=1` the moment
 * `window.api` is merely DEFINED, so a partial stub reddens the whole page
 * with "e.describe is not a function" before a single check here runs.
 *
 * The eleven "finished Codex threads" are built `vamControlled: false`,
 * `status: 'done'`, and deliberately WITHOUT `ended: true`. A real Codex
 * source would set both -- an ended thread never keeps a live vam pane, so
 * the two facts are correlated in practice -- but `hideEnded` (PR 431) is
 * already covered by `session-filter.ended.test.ts` and is not this file's
 * subject. Leaving `ended` off means the ONLY thing hiding these eleven rows
 * by default is the toggle this file exists to prove, which is what makes
 * "the toggle shows twelve" a claim about ONE control rather than two.
 *
 * ── WHAT EACH STATE PROVES ─────────────────────────────────────────────────
 *
 *  1. DEFAULT: one row. `vamControlled: true` survives, `vamControlled:
 *     false` does not -- `hideForeign`'s shipped default.
 *  2. THE TOGGLE: turning `[data-origin-toggle="foreign"]` off, for real,
 *     through a real click, reveals all twelve.
 *  3. TMUX UNAVAILABLE: every row carries `vamListingGap` (the shape
 *     `Session.vamListingGap` and `CLAUDE_CODE_SOURCE`/`createCodexSource`'s
 *     `load()` both produce when their own `listVamSessions` call fails).
 *     All twelve show WITHOUT the operator touching the toggle, and the
 *     reason is readable in the popover -- `docs/design/vam-owns-the-
 *     session.md`'s own trap: "an unreadable tmux listing must not empty the
 *     sidebar... it is never to show nothing."
 *
 *     WHAT THIS STATE DOES AND DOES NOT PROVE. `ownershipSessions`'s `withGap`
 *     stamps `vamListingGap` onto every row DIRECTLY, including the one
 *     `source: 'claude-code'` row (`live`) -- there is no real
 *     `CLAUDE_CODE_SOURCE`/`createCodexSource` behind this stub, only
 *     `window.api.load()` answering with invented data. So this state proves
 *     the RENDERER half only: that `Canvas.tsx`'s stand-down memo and
 *     `SessionList.tsx`'s banner read `Session.vamListingGap` generically,
 *     off ANY row regardless of which source produced it, and do not require
 *     a Codex row to fire. It does NOT prove that `CLAUDE_CODE_SOURCE.load()`
 *     itself stamps the field when the real `listVamSessions` call fails --
 *     that a Claude Code row on the operator's own machine gets the same
 *     treatment `codex/source.ts` always gave its own rows is proven at the
 *     main-process level instead, by `test/sources/claude-code.test.ts`'s own
 *     `vamListingGap` describe block, which injects a REAL failing runner
 *     into the REAL `listVamSessions` and asserts `loadClaudeCodeProjects`
 *     carries the error through.
 *  4. THE BARE PANE ROW: a session shaped exactly like `pane-row.ts`'s
 *     `paneRow()` output -- `status: 'unstarted'`, `vamControlled: true`, an
 *     id under the `pane:` prefix -- draws as an ordinary row with the
 *     hollow `unstarted` mark, proving the render side of the row
 *     `unclaimedPanes`/`loadClaudeCodeProjects` now derive from a bare,
 *     untagged `vam-x` session (`test/sources/claude-code-pane-rows.test.ts`
 *     proves the main-process half; the real-tmux half is in this task's own
 *     report, scripted against a private `-L` socket).
 *  5. NO TMUX SERVER YET: `listVamSessions` answering `ok, []` -- the state
 *     after every reboot before vam starts its first session -- is NOT a
 *     listing gap: ownership is honestly zero, so `vamListingGap` stays
 *     null, and there is nothing for state 3 above to catch. `hideForeign`
 *     (on by default) still takes both Claude Code rows with it, and the
 *     sidebar's own quiet line (`SessionList.tsx`'s `[data-foreign-hidden]`)
 *     is what keeps that from reading as an empty, broken app: it names how
 *     many and why, and `Show` brings both back with no popover in between.
 *  6. THE TAB STRIP AGREES WITH THE SIDEBAR, FOR ONE PROJECT: the operator's
 *     later report, on the same fixture family but with the live and the
 *     foreign sessions in the SAME project this time (`mixedOwnershipProjects`)
 *     -- ownership hid two of three rows from the sidebar and the pane strip
 *     drew all three as tabs anyway. `[data-session-tab]`'s count now has to
 *     equal `[data-session-row]`'s, both at the shipped default and once the
 *     toggle brings the foreign rows back.
 *
 * FALSIFIED BY HAND, twice, at the UNIT level (`test/canvas/Canvas.demo-
 * foreign.test.tsx`, `test/domain/session-filter.foreign.test.ts`) rather
 * than by re-running this whole real-browser file per mutation, and both are
 * quoted verbatim in the agent's own report:
 *   (a) `const foreignFilterApplies = true;` in `Canvas.tsx`'s `entries`
 *       memo (deleting the demo exemption this file's own header explains)
 *       reddened `Canvas.demo-foreign.test.tsx`'s first assertion -- which is
 *       the SAME failure this guard would have hit for real: the first draft
 *       of it, run against the real bundle before that exemption existed,
 *       is what caught `vam-build-1` (the demo's own deliberately-foreign
 *       row) disappearing and timing out `split-panes-shots.mjs` and
 *       `prompt-suggest-shots.mjs`, both of which click that row for reasons
 *       that have nothing to do with ownership;
 *   (b) reverting `session-filter.ts`'s `isForeign` to `session.vamControlled
 *       !== true` (reading ABSENT as foreign, the exact trap the design doc
 *       names first) reddened `session-filter.foreign.test.ts`'s own
 *       absence-is-not-false assertions.
 *
 * `?demo=1` is never used here: this stubs the bridge directly, the same
 * route `attention-shots.mjs` takes, so `App.tsx` never reaches the shared
 * demo fixture at all.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/sidebar-ownership-shots.mjs http://localhost:5520 e2e/test-results
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

/** One live Claude Code session and eleven finished-but-foreign Codex
 *  threads -- the doc's own fixture, built once and reused by every state
 *  that shares it. `gap` stamps every row with the same `vamListingGap` a
 *  real source produces when its own `listVamSessions` call fails. */
function ownershipSessions(gap) {
  const listingGap = gap
    ? { code: 'no-server', message: 'no tmux server is running, so there is nothing to reach' }
    : null;
  const withGap = (session) => (listingGap === null ? session : { ...session, vamListingGap: listingGap });
  const live = withGap({
    id: 'claude:live-1',
    title: 'the one live session',
    epic: null,
    branch: 'main',
    status: 'idle',
    runningAgents: 0,
    activity: null,
    age: '2m',
    decisions: [],
    source: 'claude-code',
    vamControlled: true,
  });
  const finished = Array.from({ length: 11 }, (_, i) =>
    withGap({
      id: `codex:finished-${i + 1}`,
      title: `a finished Codex thread ${i + 1}`,
      epic: null,
      branch: null,
      status: 'done',
      runningAgents: 0,
      activity: null,
      age: `${i + 1}d`,
      decisions: [],
      source: 'codex',
      vamControlled: false,
    }),
  );
  return { live, finished };
}

function ownershipProjects(gap) {
  const { live, finished } = ownershipSessions(gap);
  return [
    { id: 'claude-code:alpha', name: 'alpha', source: 'claude-code', sessions: [live] },
    { id: 'codex:alpha', name: 'alpha', source: 'codex', sessions: finished },
  ];
}

/** The bare-pane state: one project, one row shaped exactly like
 *  `pane-row.ts`'s `paneRow()` -- an untagged `vam-x` session with nothing
 *  started in it yet. */
function paneRowProjects() {
  return [
    {
      id: 'claude-code:beta',
      name: 'beta',
      source: 'claude-code',
      sessions: [
        {
          id: 'pane:vam-x-000001',
          title: 'vam-x-000001',
          epic: null,
          branch: null,
          status: 'unstarted',
          runningAgents: 0,
          activity: null,
          age: null,
          decisions: [],
          source: 'claude-code',
          vamControlled: true,
          pane: 'vam-x-000001',
        },
      ],
    },
  ];
}

/**
 * THE STATE THE COORDINATOR'S OWN REPORT NAMED: no tmux server yet, the
 * ordinary state after every reboot before vam starts its first session.
 * `listVamSessions` answers `ok, []` here -- NOT a listing gap, ownership is
 * honestly zero -- so every Claude Code row this fixture draws carries
 * `vamControlled: false` and no `vamListingGap` at all, unlike every other
 * state in this file. `hideForeign` (on by default) takes both rows with it,
 * and `SessionList.tsx`'s own quiet line (`[data-foreign-hidden]`) is the
 * only thing that keeps the sidebar from reading as simply broken.
 */
function noServerProjects() {
  const session = (id, title) => ({
    id,
    title,
    epic: null,
    branch: 'main',
    status: 'idle',
    runningAgents: 0,
    activity: null,
    age: '4m',
    decisions: [],
    source: 'claude-code',
    vamControlled: false,
  });
  return [
    {
      id: 'claude-code:alpha',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('claude:a1', 'session one'), session('claude:a2', 'session two')],
    },
  ];
}

/**
 * ONE PROJECT, MIXED OWNERSHIP -- unlike `ownershipProjects` above, which
 * puts the live session and the foreign ones in two DIFFERENT projects
 * (`claude-code:alpha` / `codex:alpha`), so a pane's tab strip (scoped by
 * exact project id, never `projectMergeKey`) could never have drawn the
 * foreign rows as tabs regardless of the bug this fixture exists to catch.
 * The operator's own report needs the SAME project id: a session vam just
 * started, alongside one still running outside vam entirely.
 */
function mixedOwnershipProjects() {
  return [
    {
      id: 'claude-code:blacksmith',
      name: 'blacksmith',
      source: 'claude-code',
      sessions: [
        {
          id: 'claude:vam-started',
          title: 'vam-started',
          epic: null,
          branch: 'main',
          status: 'idle',
          runningAgents: 0,
          activity: null,
          age: '1m',
          decisions: [],
          source: 'claude-code',
          vamControlled: true,
        },
        {
          id: 'claude:elsewhere-1',
          title: 'elsewhere-1',
          epic: null,
          branch: 'main',
          status: 'idle',
          runningAgents: 0,
          activity: null,
          age: '9m',
          decisions: [],
          source: 'claude-code',
          vamControlled: false,
        },
        {
          id: 'claude:elsewhere-2',
          title: 'elsewhere-2',
          epic: null,
          branch: 'main',
          status: 'idle',
          runningAgents: 0,
          activity: null,
          age: '14m',
          decisions: [],
          source: 'claude-code',
          vamControlled: false,
        },
      ],
    },
  ];
}

/** A full, minimal `PreloadSourceApi` -- see this file's own header for why
 *  it must be complete. `projects` is handed in as page-init data, not a
 *  closure, because `addInitScript` serialises its argument rather than
 *  capturing anything from this module's scope. */
function install(projects) {
  globalThis.window.api = {
    describe: async () => ({
      id: 'ownership-stub',
      label: 'Ownership stub',
      capabilities: window.__ownershipCapabilities,
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
  };
}

function rowCount(page) {
  return page.evaluate(() => document.querySelectorAll('[data-session-row]').length);
}

async function openFilterPopover(page) {
  await page.click('[data-filter-toggle]');
  await page.waitForSelector('[data-filter-menu]');
}

const browser = await chromium.launch();

// ---------------------------------------------------------------------------
// STATES 1 & 2: the default view, and the toggle.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((caps) => {
    window.__ownershipCapabilities = caps;
  }, CAPABILITIES);
  await page.addInitScript(install, ownershipProjects(false));
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]', { timeout: 10_000 });

  const defaultCount = await rowCount(page);
  console.log(`  default rows: ${defaultCount}`);
  check('one live session and eleven finished Codex threads shows ONE row', defaultCount === 1, `${defaultCount}`);
  const defaultTitle = await page.evaluate(
    () => document.querySelector('[data-session-row] [data-row-title]')?.textContent,
  );
  check(
    'and it is the vam-controlled one, not one of the foreign eleven',
    defaultTitle === 'the one live session',
    defaultTitle ?? '(none)',
  );
  await page.screenshot({ path: `${outDir}/sidebar-ownership-default.png` });

  await openFilterPopover(page);
  const toggle = page.locator('[data-origin-toggle="foreign"]');
  check('the popover offers a row for foreign sessions', (await toggle.count()) === 1, `${await toggle.count()}`);
  check('it is on by default', (await toggle.getAttribute('aria-checked')) === 'true', await toggle.getAttribute('aria-checked'));
  check(
    'and says how many it is holding back, over the unfiltered workspace',
    (await toggle.textContent())?.includes('11') === true,
    await toggle.textContent(),
  );
  await toggle.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-session-row]').length === 12, {
    timeout: 5_000,
  });
  const toggledCount = await rowCount(page);
  console.log(`  toggle shows: ${toggledCount}`);
  check('the toggle shows all twelve', toggledCount === 12, `${toggledCount}`);
  await page.screenshot({ path: `${outDir}/sidebar-ownership-toggle.png` });

  await page.close();
}

// ---------------------------------------------------------------------------
// STATE 3: tmux itself could not be read.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((caps) => {
    window.__ownershipCapabilities = caps;
  }, CAPABILITIES);
  await page.addInitScript(install, ownershipProjects(true));
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]', { timeout: 10_000 });

  const gapCount = await rowCount(page);
  console.log(`  tmux-unavailable rows: ${gapCount}`);
  check('killing tmux shows all twelve, never an empty sidebar', gapCount === 12, `${gapCount}`);
  await page.screenshot({ path: `${outDir}/sidebar-ownership-gap-rows.png` });

  await openFilterPopover(page);
  const gapText = await page.evaluate(
    () => document.querySelector('[data-vam-listing-gap]')?.textContent ?? null,
  );
  check(
    'and a reason is on screen — not just the row count',
    gapText !== null && gapText.includes('no tmux server is running'),
    gapText ?? '(no [data-vam-listing-gap] on screen)',
  );
  await page.screenshot({ path: `${outDir}/sidebar-ownership-gap-reason.png` });

  await page.close();
}

// ---------------------------------------------------------------------------
// STATE 4: a bare `tmux new-session -s vam-x`, nothing started in it.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((caps) => {
    window.__ownershipCapabilities = caps;
  }, CAPABILITIES);
  await page.addInitScript(install, paneRowProjects());
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]', { timeout: 10_000 });

  const row = page.locator('[data-session-row="pane:vam-x-000001"]');
  check('the bare pane appears as a row', (await row.count()) === 1, `${await row.count()}`);
  check(
    'titled by the tmux session’s own name — the one thing an empty pane has',
    (await row.locator('[data-row-title]').textContent()) === 'vam-x-000001',
    await row.locator('[data-row-title]').textContent(),
  );
  check(
    'drawn with the hollow unstarted mark, not one of the five agent statuses',
    (await row.locator('[data-status-mark="unstarted"]').count()) === 1,
    `${await row.locator('[data-status-mark]').count()} status mark(s) on the row`,
  );
  await page.screenshot({ path: `${outDir}/sidebar-ownership-bare-pane.png` });

  await page.close();
}

// ---------------------------------------------------------------------------
// STATE 5: no tmux server yet -- `listVamSessions` answers `ok, []`, which is
// NOT a listing gap. Ownership is honestly zero, and `SessionList.tsx`'s own
// quiet line is what keeps that from reading as an empty, broken sidebar.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((caps) => {
    window.__ownershipCapabilities = caps;
  }, CAPABILITIES);
  await page.addInitScript(install, noServerProjects());
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  // No row is expected at all -- wait on the quiet line instead of a row.
  await page.waitForSelector('[data-foreign-hidden]', { timeout: 10_000 });

  const rowsHidden = await rowCount(page);
  check(
    'every row is hidden by the shipped default -- honestly zero, not a failure',
    rowsHidden === 0,
    `${rowsHidden}`,
  );
  check(
    'no vamListingGap banner — the listing itself succeeded',
    (await page.locator('[data-vam-listing-gap]').count()) === 0,
    `${await page.locator('[data-vam-listing-gap]').count()}`,
  );
  const noticeText = await page.locator('[data-foreign-hidden-count]').textContent();
  check(
    'the quiet line says how many, and why',
    (noticeText ?? '').includes('2 sessions hidden') &&
      (noticeText ?? '').includes('vam did not start them'),
    noticeText ?? '(none)',
  );
  await page.screenshot({ path: `${outDir}/sidebar-ownership-no-server.png` });

  await page.locator('[data-foreign-hidden-show]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-session-row]').length === 2, {
    timeout: 5_000,
  });
  const rowsShown = await rowCount(page);
  check('Show brings both rows back', rowsShown === 2, `${rowsShown}`);
  check(
    'and the quiet line goes with them',
    (await page.locator('[data-foreign-hidden]').count()) === 0,
    `${await page.locator('[data-foreign-hidden]').count()}`,
  );
  await page.screenshot({ path: `${outDir}/sidebar-ownership-no-server-shown.png` });

  await page.close();
}

// ---------------------------------------------------------------------------
// STATE 6: the tab strip agrees with the sidebar, for the SAME project.
//
// The operator's report this state pins: "when I start a new project in a
// particular repo while sessions of that repo are running elsewhere, the
// sidebar shows only the session I just created, but the tab strip shows
// every session from the other sources." `mixedOwnershipProjects` is that
// scenario -- one project, one vam-controlled row and two foreign ones --
// and the DOM fact a unit test cannot promise on its own: that the built
// bundle's pane strip (`[data-session-tab]`) draws exactly as many tabs as
// the sidebar draws rows (`[data-session-row]`) for that project, at the
// shipped default AND once the operator turns `hideForeign` back off.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((caps) => {
    window.__ownershipCapabilities = caps;
  }, CAPABILITIES);
  await page.addInitScript(install, mixedOwnershipProjects());
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]', { timeout: 10_000 });
  await page.waitForSelector('[data-session-tab]', { timeout: 10_000 });

  const tabCount = (p) => p.evaluate(() => document.querySelectorAll('[data-session-tab]').length);

  const defaultRows = await rowCount(page);
  const defaultTabs = await tabCount(page);
  console.log(`  mixed-ownership default: ${defaultRows} sidebar row(s), ${defaultTabs} tab(s)`);
  check('the foreign case: one sidebar row, hideForeign at its shipped default', defaultRows === 1, `${defaultRows}`);
  check(
    'and the tab strip draws exactly that many tabs -- not the two foreign ones it used to adopt',
    defaultTabs === defaultRows,
    `${defaultTabs} tabs for ${defaultRows} row(s)`,
  );
  await page.screenshot({ path: `${outDir}/sidebar-ownership-tabs-follow-filter-default.png` });

  await openFilterPopover(page);
  await page.locator('[data-origin-toggle="foreign"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-session-row]').length === 3, {
    timeout: 5_000,
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-session-tab]').length === 3, {
    timeout: 5_000,
  });
  const toggledRows = await rowCount(page);
  const toggledTabs = await tabCount(page);
  console.log(`  mixed-ownership, hideForeign off: ${toggledRows} sidebar row(s), ${toggledTabs} tab(s)`);
  check('the toggle brings all three rows back', toggledRows === 3, `${toggledRows}`);
  check('and the tab strip grows to match, not just the sidebar', toggledTabs === toggledRows, `${toggledTabs}`);
  await page.screenshot({ path: `${outDir}/sidebar-ownership-tabs-follow-filter-toggled.png` });

  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nsidebar-ownership-shots: all checks passed.');
