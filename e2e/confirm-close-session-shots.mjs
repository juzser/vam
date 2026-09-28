/**
 * DECISION 1's dialog, in a real browser, both themes -- for the PR body,
 * not for the gate.
 *
 * `docs/design/vam-owns-the-session.md` §5, "Confirm only when the agent is
 * mid-turn": `ConfirmCloseSession` now shows on the DESKTOP too, in front of
 * a `running` session, on every close route. This is a picture of that, the
 * same way `command-palette-shots.mjs` captures both themes of its own
 * subject -- a stub `window.api` with one `running` session, the row's own
 * hover-revealed `×` (a real hover, a real click, never a dispatched
 * keydown), and a screenshot on each side of the light/dark toggle
 * `command-palette-shots.mjs` itself uses.
 *
 * TAKES NO ASSERTIONS AND IS DELIBERATELY NOT IN `run-web-guards.mjs`'s
 * `GUARDS` list, on the same rule that file's own header states for
 * `issue-188-shots`, `pane-refinements-shots`, `pane-patches-shots`,
 * `phone-list-shots`, `phone-prompt-shots` and `uiux-pane-shots`: a script
 * that only takes a picture and asserts nothing would turn a green tick into
 * a broader claim than it is. `Canvas.close-confirm.test.tsx` and
 * `test/phone/PhoneShell.session.test.tsx` already own the BEHAVIOUR this
 * dialog is under; this file only owns the two PNGs `docs/ui` carries.
 *
 * Regenerates `docs/ui/confirm-close-session-dark.png` and
 * `docs/ui/confirm-close-session-light.png` -- named here so
 * `run-web-guards.mjs`'s own orphan check (`VAM_E2E_CHECK_ORPHANS`) finds
 * them referenced and does not flag them as screenshots a removed guard left
 * behind.
 *
 * Run by hand against an already-built, already-served `dist-web`:
 *   node e2e/confirm-close-session-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION_ID = 'a1';
const SESSION_TITLE = 'nightly sweep';

/**
 * `page.addInitScript(fn, arg)` re-evaluates `fn`'s SOURCE TEXT in the page;
 * it does not carry this module's closure across the boundary -- the same
 * reason `close-dismiss-shots.mjs`'s own `install` takes its values as one
 * argument rather than closing over `SESSION_ID`/`SESSION_TITLE` directly.
 */
const install = ({ sessionId, title }) => {
  globalThis.window.api = {
    describe: async () => ({
      id: 'shots-stub',
      label: 'Shots stub',
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
        name: 'alpha',
        sessions: [
          {
            id: sessionId,
            title,
            epic: null,
            branch: null,
            status: 'running',
            runningAgents: 1,
            activity: 'reading the transcript',
            age: '2m',
            decisions: [
              { id: 'd1', label: 'the turn', input: 'run the drop suite', output: null, commands: [] },
            ],
          },
        ],
      },
    ],
    subscribe: () => () => {},
    recordPrompt: async () => {},
    renameSession: async () => {},
    // Never resolves for the shot's duration -- the dialog itself is the
    // picture, not whatever a real close would do after Confirm.
    closeSession: async () => new Promise(() => {}),
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

await page.addInitScript(install, { sessionId: SESSION_ID, title: SESSION_TITLE });
await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
await page.waitForSelector(`[data-session-row="${SESSION_ID}"]`, { timeout: 10_000 });

// THE REAL CLICK, on `close-dismiss-shots.mjs`'s own rule: hover-reveals the
// row's `×` (opacity: 0 at rest), then presses it -- a real browser is the
// only environment where that hover state and the click it gates are both
// real.
const row = page.locator(`[data-session-row="${SESSION_ID}"]`);
await row.hover();
await page.getByLabel(`close ${SESSION_TITLE}`).click();
await page.waitForSelector('[data-confirm-close-session]', { timeout: 5_000 });
await page.waitForTimeout(150);

for (const theme of ['dark', 'light']) {
  // `command-palette-shots.mjs`'s own toggle: dark is the default (no class
  // on `<html>`), light is the `.light` class.
  await page.evaluate(
    (t) => document.documentElement.classList.toggle('light', t === 'light'),
    theme,
  );
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${outDir}/confirm-close-session-${theme}.png` });
  console.log(`${outDir}/confirm-close-session-${theme}.png`);
}

await browser.close();
console.log('confirm-close-session-shots: done.');
