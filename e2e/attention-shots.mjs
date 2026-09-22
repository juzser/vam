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
 * WHAT THIS GUARD DOES NOT PROVE, AND WHY -- A FINDING OF ITS OWN. Item 1's
 * brief asked for a counting wrapper around `useAgentWork`'s `read` too, on
 * the assumption that picking an agent through this same stub would start
 * that poll. It does not, and the reason is not this guard: `useAgentWork`'s
 * `read` argument comes from `useAgentWorkReader()`
 * (`sources/agent-work-reader.ts`), whose only producer on this path is
 * `source.agentWork` -- and `sources/preload-factory.ts`'s
 * `createSourceFromPreload` never assigns that member. Compare its `history`
 * neighbour, wired unconditionally two lines above it
 * (`history: (sessionId, cursor) => api.history(sessionId, cursor)`), which
 * `port.ts`'s own doc comment says `agentWork` should follow "exactly like":
 * "OPTIONAL AND ANSWER-GATED, exactly like `history` above". It does not.
 * `AgentWorkReaderProvider` therefore always publishes `null` on
 * `DesktopCanvas` (and on `BrowserCanvas`, which reaches the same factory
 * through `http-factory.ts`), `useAgentWork`'s `read` is always `undefined`,
 * and its own `useVisibilityInterval(agentId !== null && read !== undefined,
 * ...)` never starts a timer at all -- there is no live poll here for a
 * `visibilitychange` to pause or resume. `DemoCanvas` is the ONE place
 * `useAgentWork` ever actually polls (it wires `agentWork.demoAgentWork` in
 * directly, `App.tsx`'s own `DemoCanvasLoaded`), and that path never touches
 * `window.api`, so it offers no call to count either. `window.__attn.agentWork`
 * below is still wired end to end through the stub, in case a future fix
 * closes this gap and a later pass wants to extend this guard's assertions
 * onto it without re-deriving the stub -- but nothing here asserts on it, and
 * this guard's real, provable claim is `useSourceModel`'s load poller alone,
 * which is exactly the fallback item 5's own brief names for this situation.
 * This gap predates phase 3b entirely (`preload-factory.ts` carries no
 * visibility-gating change and is not part of this branch's diff) and fixing
 * it is out of this guard's scope.
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

/**
 * A COMPLETE `PreloadSourceApi` stub -- one project, one session, every
 * capability false -- with `load` and `agentWork` wrapped in counters. See
 * this file's own header for why the shape must be complete (a partial one
 * reddens the whole page with "e.describe is not a function" before a single
 * check here ever runs) and why `agentWork`'s counter is wired but unused.
 */
const install = () => {
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
              runningAgents: 0,
              activity: null,
              age: '2m',
              decisions: [],
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
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'not wired on this path — see header' },
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

await page.addInitScript(install);
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

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nattention: every check passed.');
