/**
 * DISMISS, IN A REAL BROWSER -- the operator's own report: "some sessions
 * cannot be closed and report a failure — they stay there forever."
 *
 * `docs/design/vam-owns-the-session.md` §5, "Dismiss is the safe fallback":
 * a row `closeSession` refuses is removed from the sidebar rather than left
 * spinning there forever, and the removal is never claimed as a kill. The
 * exact scenario reproduced here is the one the operator's own error log
 * showed (`sonnh`'s report, quoted verbatim in the task): a Claude Code
 * BACKGROUND row named "vam" the source already reports `failed` --
 * `stop.ts`'s `already-finished`, which is not even a real failure (there was
 * never a job left to stop) and must not cost the operator a false alarm.
 *
 * WHY THIS NEEDS A REAL BROWSER AND NOT ONLY `Canvas.dismiss-session.test.tsx`.
 * That file already proves the LOGIC in happy-dom -- `entries`'s own filter,
 * `dismissSession`'s prefs write -- but never proves the actual CLICK lands on
 * the actual rendered `×`, through the real preload contract shape
 * (`createSourceFromPreload`, the same factory the desktop build uses), in a
 * real DOM where `getBoundingClientRect`, hover-reveal opacity and Radix's
 * tooltip portal are all real. `attention-shots.mjs`'s own header makes the
 * same argument for a different seam; this is that seam for Close.
 *
 * THE STUB is a full `PreloadSourceApi` (one project, one FAILED background
 * row) exactly shaped like `attention-shots.mjs`'s own, with `closeSession`
 * wired to throw the CLI's exact refusal rather than resolve.
 *
 * FALSIFIED BY HAND: comment out the `dismissSession(sessionId, title, reason)`
 * call in `Canvas.tsx`'s `closeSession` catch block (leaving only
 * `setStatus(reason)`), rebuild, and re-run this file alone against a
 * `vite preview` -- the "row is gone from the sidebar" check goes red. This
 * run's real output is quoted in the agent's final report.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/close-dismiss-shots.mjs http://localhost:5520 e2e/test-results
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

const SESSION_ID = 'vam';
const SESSION_TITLE = 'vam';
/** The CLI's own words, `stop.ts:367-372` verbatim -- a background row the
 *  source already reports `done`/`failed` has no job left to stop. */
const REFUSAL = {
  kind: 'refused',
  code: 'already-finished',
  message:
    '"vam" already failed; there is no running job left to stop. Nothing was lost -- the conversation is kept either way.',
};

/**
 * `page.addInitScript(fn, arg)` serialises `fn`'s SOURCE TEXT into the page
 * and re-evaluates it there -- it does not carry this module's closure across
 * the Node/browser boundary. So `sessionId`/`refusal` are passed in as the
 * one argument the call contributes, exactly as `attention-shots.mjs` passes
 * `{ agentId, marker }`, rather than closed over from the outer scope (which
 * would read back as `ReferenceError: SESSION_ID is not defined` inside the
 * page -- measured, the first shape of this file).
 */
const install = ({ sessionId, title, refusal }) => {
  globalThis.window.__dismiss = { closeCalls: 0 };
  globalThis.window.api = {
    describe: async () => ({
      id: 'dismiss-stub',
      label: 'Dismiss stub',
      capabilities: {
        liveUpdates: false,
        recordPrompt: true,
        deliverPrompt: false,
        promptAttachments: false,
        slashCommands: false,
        renameSession: false,
        closeSession: true,
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
        name: 'dismiss project',
        sessions: [
          {
            id: sessionId,
            title,
            epic: null,
            branch: null,
            status: 'failed',
            runningAgents: 0,
            activity: null,
            age: '4d',
            decisions: [],
          },
        ],
      },
    ],
    subscribe: () => () => {},
    recordPrompt: async () => {},
    renameSession: async () => {},
    closeSession: async () => {
      globalThis.window.__dismiss.closeCalls += 1;
      // The bridge's own shape: `preload/api.ts`'s `unwrap` throws
      // `result.error` verbatim on `{ ok: false, error }`, so throwing the
      // refusal HERE is the faithful stand-in for what a real main process
      // sends back over IPC.
      throw refusal;
    },
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
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

await page.addInitScript(install, { sessionId: SESSION_ID, title: SESSION_TITLE, refusal: REFUSAL });
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector(`[data-session-row="${SESSION_ID}"]`, { timeout: 10_000 });

check(
  'the row is on screen before Close is ever pressed',
  (await page.locator(`[data-session-row="${SESSION_ID}"]`).count()) === 1,
);

await page.screenshot({ path: `${outDir}/close-dismiss-before.png` });

// THE REAL CLICK: hover-reveals the row's `×` (opacity: 0 at rest, see
// `SessionList.tsx`'s own comment on why -- a real browser is the only
// environment where that hover state and the click it gates are both real),
// then presses it.
const row = page.locator(`[data-session-row="${SESSION_ID}"]`);
await row.hover();
await page.getByLabel(`close ${SESSION_TITLE}`).click();

// Settle: the write is async, the row's removal is a prefs write plus a
// re-render, neither of which is instantaneous.
await page.waitForTimeout(300);

const closeCalls = await page.evaluate(() => window.__dismiss.closeCalls);
check('vam actually asked the source to close it', closeCalls === 1, `closeCalls=${closeCalls}`);

const rowCount = await page.locator(`[data-session-row="${SESSION_ID}"]`).count();
check('THE ROW IS GONE FROM THE SIDEBAR', rowCount === 0, `rowCount=${rowCount}`);

const statusNote = await page.evaluate(
  () => document.querySelector('[data-status-bar] [data-status]')?.getAttribute('data-note') ?? '',
);
console.log(`  status: ${statusNote}`);
check(
  'the message says it was removed from the list, not that it failed',
  /removed it from your list/i.test(statusNote),
  statusNote,
);
check('the message never claims a "failure"', !/\bfailure\b/i.test(statusNote), statusNote);

// AND THE UNDO: the status bar's own count control brings it right back --
// `docs/design/vam-owns-the-session.md` §5's "always reversible".
const restoreButton = page.locator('[data-restore-dismissed]');
check('the status bar offers a way back', (await restoreButton.count()) === 1);
await restoreButton.click();
await page.waitForTimeout(200);
const restoredCount = await page.locator(`[data-session-row="${SESSION_ID}"]`).count();
check('restoring brings the row back', restoredCount === 1, `rowCount=${restoredCount}`);

await page.screenshot({ path: `${outDir}/close-dismiss-after.png` });

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nclose-dismiss: every check passed.');
