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

// ---------------------------------------------------------------- desktop
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(install);
  await page.goto(origin, { waitUntil: 'networkidle' });
  await openPrs(page);

  check('three rows are drawn', (await page.locator('[data-pr-row]').count()) === 3);

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
  check('there are rows at 390px to measure at all', rowsHere === 3, String(rowsHere));
  check('no row and no field overflows a 390px screen', overflow.length === 0, overflow.join('; '));

  // And the row is actually TALL -- a wrapped row is fine, a clipped one is not.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pr-row]')].some(
      (row) => row.scrollWidth > row.clientWidth + 1,
    ),
  );
  check('no row is scrolled sideways inside its own box', clipped === false);

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
