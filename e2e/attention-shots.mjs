/**
 * THE ATTENTION GATE, IN A REAL BROWSER -- whether a real `visibilitychange`
 * actually reaches `useVisibilityInterval`'s listener and does what phase
 * 2's own fake-timer unit tests (`test/useVisibilityInterval.test.ts`,
 * `test/sources/useSourceModel.test.tsx`, `test/sources/useAgentWork.test.tsx`)
 * can only assert about a SYNTHETIC clock that never dispatches a browser
 * event at all. jsdom and happy-dom both let a test hand `visibilityState` a
 * new value directly and call a handler by hand; neither can say whether the
 * app's own `document.addEventListener('visibilitychange', ...)` is even
 * wired to the right property, at the right layer, on the event the browser
 * itself would raise -- and this repo's own history is that fake-DOM
 * environments have hidden real bugs in visibility-driven code before
 * (`jsdom cannot reproduce deferred-updater bugs`, among others). This file
 * is the real-browser half of that pair: it proves the WIRING, not the
 * CADENCE MATH -- the 10s/20s/40s arithmetic stays exactly where the unit
 * tests already prove it, with a fake clock that can jump 40 real seconds in
 * a millisecond.
 *
 * THE STUB, AND WHY IT IS A FULL `PreloadSourceApi` RATHER THAN `?demo=1`
 * ALONE. `App.tsx`'s own top-level switch is
 * `globalThis.window?.api !== undefined ? <DesktopCanvas> : isDemo() ?
 * <DemoCanvas> : <BrowserCanvas>` -- so merely DEFINING `window.api` (however
 * little it carries) takes the page off the demo fixture entirely and onto
 * `createSourceFromPreload(api)`, which calls `api.describe()`/`api.load()`
 * for real (`files-tab-keyboard-shots.mjs`'s own header names the same
 * discovery). That is exactly what this guard wants: the demo fixture
 * resolves its own data synchronously, in-page, with no bridge call to count
 * at all, so it cannot answer "did the poller actually fire" for anything.
 * The stub below is that full, minimal `PreloadSourceApi` -- one project, one
 * session, every capability false -- with `load` and `agentWork` wrapped in
 * counters (`window.__attn`) so an assertion can read what the app actually
 * asked for, the same technique `prs-tab-shots.mjs` and
 * `files-tab-keyboard-shots.mjs` already use for a bridge `?demo=1` cannot
 * reach.
 *
 * THE GAP THIS GUARD ONCE DOCUMENTED IS NOW CLOSED. This header used to
 * record a finding of its own: picking an agent through this same stub never
 * started `useAgentWork`'s poll, because `sources/preload-factory.ts`'s
 * `createSourceFromPreload` never assigned `agentWork` onto the `SessionSource`
 * it built, although `port.ts`'s own doc comment says it must be "OPTIONAL AND
 * ANSWER-GATED, exactly like `history` above" -- and `history` was wired
 * unconditionally two lines above it. `AgentWorkReaderProvider` therefore
 * always published `null` on `DesktopCanvas` (and on `BrowserCanvas`, which
 * reaches the same factory through `http-factory.ts`), so `useAgentWork`'s
 * `read` was always `undefined` and its own
 * `useVisibilityInterval(agentId !== null && read !== undefined, ...)` never
 * started a timer at all. `createSourceFromPreload` now assigns `agentWork`
 * the same way `history` is assigned, unconditionally, and the section below
 * headed "THE AGENTS TAB REACHES THE BRIDGE" proves it in this same real
 * browser: picking the stub's one agent increments `window.__attn.agentWork`
 * and the pane renders the exact turn text the stub answered with, not the
 * no-surface refusal. `DemoCanvas` remains a SEPARATE path (it wires
 * `agentWork.demoAgentWork` in directly and never touches `window.api`), so it
 * still offers no call to count -- but it no longer matters, because the
 * bridge path this guard exercises now works too.
 *
 * `document.hidden` VS `document.visibilityState`. A first draft of this file
 * overrode `document.hidden` on `Object.defineProperty`, following a common
 * shorthand -- but neither `useVisibilityInterval.ts` nor `useSourceModel.ts`
 * ever reads `document.hidden`; both read `document.visibilityState ===
 * 'hidden'` exclusively (`useSourceModel.ts`'s `isDocumentHidden`,
 * `useVisibilityInterval.ts`'s `periodNow`/`restart`/`onVisibility`, all four
 * call sites). Overriding only `.hidden` would have shipped a guard that
 * dispatched a real event at a property the app never reads, and every
 * assertion below would have measured "does the app do nothing in response
 * to an event it was never listening for a property change on" -- true, and
 * meaningless. Both properties are overridden below for robustness (some
 * future code path reading `.hidden` would still be exercised honestly), but
 * `.visibilityState` is the one that actually drives the app.
 *
 * WHAT IS ASSERTED, against `useSourceModel`'s load poller (`SOURCE_POLL_INTERVAL_MS`
 * = 10s visible, `{ slowBy: 4 }` = 40s hidden -- it may never fully pause,
 * `useSourceModel.ts`'s own header says why: it is `notify/waiting.ts`'s only
 * transition-detection loop):
 *   1. the load counter does not increase over a real 3s hidden window --
 *      well under both the 10s visible and 40s hidden cadence, so this proves
 *      "no burst, no busy-loop" rather than the exact rate (that arithmetic is
 *      `test/sources/useSourceModel.test.tsx`'s job, with a fake clock that
 *      can actually wait out 40 real seconds);
 *   2. becoming visible again fires ONE immediate call within ~500ms --
 *      `useVisibilityInterval.ts`'s OFF -> ON edge, the same "coming back is
 *      when the numbers are stalest" contract `TerminalTab`'s own refresh
 *      keeps.
 *
 * FALSIFIED BY HAND: comment out the `hidden` branch's early return in
 * `useVisibilityInterval.ts`'s `onVisibility` (so a hidden window keeps
 * ticking at the VISIBLE rate instead of stopping/slowing), rebuild, and
 * re-run this file alone against a `vite preview` -- assertion 1 goes red.
 * This phase's own run of that falsification, and its real output, is in the
 * agent's final report.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/attention-shots.mjs http://localhost:5520 e2e/test-results
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

/** The one row the Agents tab has to pick, for the section below headed
 *  "THE AGENTS TAB REACHES THE BRIDGE". A unique string in `input` is what
 *  that section greps the rendered pane for -- proof the pane painted THIS
 *  answer and not a cached or a demo one. */
const AGENT_ID = 'attn-agent-1';
const WORK_MARKER = 'ATTENTION_GUARD_AGENT_WORK_MARKER';

/**
 * A COMPLETE `PreloadSourceApi` stub -- one project, one session with one
 * running agent, every capability false -- with `load` and `agentWork`
 * wrapped in counters. See this file's own header for why the shape must be
 * complete (a partial one reddens the whole page with "e.describe is not a
 * function" before a single check here ever runs).
 */
const install = ({ agentId, marker }) => {
  globalThis.window.__attn = { load: 0, agentWork: 0 };
  globalThis.window.api = {
    describe: async () => ({
      id: 'attn-stub',
      label: 'Attention stub',
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
    load: async () => {
      globalThis.window.__attn.load += 1;
      return [
        {
          id: 'p1',
          name: 'attention project',
          sessions: [
            {
              id: 's1',
              title: 'attention session',
              epic: null,
              branch: null,
              status: 'waiting',
              runningAgents: 1,
              activity: null,
              age: '2m',
              decisions: [],
              agents: [
                { id: agentId, type: 'stub', description: 'answers the attention guard', running: true },
              ],
            },
          ],
        },
      ];
    },
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
    agentWork: async () => {
      globalThis.window.__attn.agentWork += 1;
      return {
        kind: 'work',
        whole: true,
        brief: null,
        turns: [
          {
            id: `${agentId}:t1`,
            label: 'brief',
            input: marker,
            output: 'the bridge answered',
            commands: [],
            errorCount: 0,
            steps: [],
          },
        ],
      };
    },
    applyWaivers: async () => {},
    transitionLesson: async () => {},
  };
};

/** Reads the counters back off the page. */
const counts = (page) => page.evaluate(() => ({ ...window.__attn }));

/** Overrides BOTH properties and dispatches a real `visibilitychange` -- see
 *  this file's own header for why `.visibilityState` is the one that
 *  actually matters. */
async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', {
      value: h ? 'hidden' : 'visible',
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: h, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

await page.addInitScript(install, { agentId: AGENT_ID, marker: WORK_MARKER });
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]', { timeout: 10_000 });

const settled = await counts(page);
console.log(`  after settling: load=${settled.load} agentWork=${settled.agentWork}`);
check('the load poller fired at least once by the time the row is on screen', settled.load >= 1, JSON.stringify(settled));

await page.screenshot({ path: `${outDir}/attention-visible.png` });

// ---------------------------------------------------------------- HIDE IT
const beforeHide = await counts(page);
await setHidden(page, true);
const atHide = await counts(page);
check('hiding fires no call of its own', atHide.load === beforeHide.load, `${beforeHide.load} -> ${atHide.load}`);

// THE ONE FIXED WAIT THIS GUARD NEEDS: asserting about wall-clock cadence
// itself, not UI settling, so there is no DOM signal to poll instead.
await page.waitForTimeout(3_000);

const afterHiddenWait = await counts(page);
console.log(`  after 3s hidden: load=${afterHiddenWait.load} agentWork=${afterHiddenWait.agentWork}`);
// Do NOT assert this reaches zero over the WHOLE hidden lifetime -- item 7's
// own rule, and `useSourceModel.ts`'s header says why: hidden is 4x slower
// (40s), never fully paused, because it feeds `notify/waiting.ts`'s only
// transition loop. 3s is well under either cadence, so a flat count here
// proves "no burst" rather than the exact rate -- that arithmetic belongs to
// `test/sources/useSourceModel.test.tsx`'s fake clock, which can wait out 40
// real seconds in a millisecond; this guard's job is only to prove a real
// `visibilitychange` reaches the listener at all, which no fake-DOM
// environment can be asked.
check(
  'the load counter does not increase over 3s hidden (at most one unavoidable in-flight call)',
  afterHiddenWait.load - beforeHide.load <= 1,
  `${beforeHide.load} -> ${afterHiddenWait.load}`,
);

await page.screenshot({ path: `${outDir}/attention-hidden.png` });

// -------------------------------------------------------------- SHOW IT AGAIN
const beforeShow = await counts(page);
const shownAt = Date.now();
await setHidden(page, false);

let resumed = null;
while (Date.now() - shownAt < 800) {
  const c = await counts(page);
  if (c.load > beforeShow.load) {
    resumed = { counts: c, ms: Date.now() - shownAt };
    break;
  }
  await page.waitForTimeout(20);
}
console.log(`  resume: ${resumed === null ? 'no call landed' : `+${resumed.counts.load - beforeShow.load} at ${resumed.ms}ms`}`);
check(
  'becoming visible fires ONE immediate call within ~500ms',
  resumed !== null && resumed.ms <= 500 && resumed.counts.load === beforeShow.load + 1,
  resumed === null ? 'no call landed within 800ms' : JSON.stringify(resumed),
);

// ------------------------------------------- THE AGENTS TAB REACHES THE BRIDGE
// This is the section this file's own header names: proof that
// `preload-factory.ts` assigning `agentWork` actually reaches the Agents pane
// through `window.api`, not merely that `createSourceFromPreload` returns an
// object with the member (`test/sources/preload-factory.test.ts` already
// proves that in isolation). Opening the session row and picking the stub's
// one agent is the only way anything in this app calls `window.api.agentWork`
// at all -- so a real click is what this section drives, on the same stub
// `window.__attn` above already counts through.
await page.locator('[data-session-row="s1"]').first().click();
await page.waitForSelector('[data-view="agents"]', { timeout: 5_000 });
await page.locator('[data-view="agents"]').click();
await page.waitForSelector('[data-agent-row]', { timeout: 5_000 });

const beforePick = await counts(page);
check(
  'picking nobody yet asks the bridge for nothing',
  beforePick.agentWork === 0,
  `agentWork=${beforePick.agentWork}`,
);

await page.locator(`[data-agent-pick="${AGENT_ID}"]`).click();
await page.waitForSelector('[data-agent-turn]', { timeout: 5_000 }).catch(() => {});

const afterPick = await counts(page);
console.log(`  after picking the one agent: agentWork=${afterPick.agentWork}`);
check(
  'picking the agent asks the bridge for its work',
  afterPick.agentWork >= 1,
  `agentWork=${afterPick.agentWork}`,
);

const detailText = await page.evaluate(
  () => document.querySelector('[data-agent-detail]')?.textContent ?? '',
);
check(
  'the pane renders what the bridge actually answered, not the no-surface refusal',
  detailText.includes(WORK_MARKER) && !/cannot report/i.test(detailText),
  JSON.stringify(detailText).slice(0, 160),
);

await page.screenshot({ path: `${outDir}/attention-agent-work.png` });

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nattention: every check passed.');
