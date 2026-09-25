/**
 * THE DISMISS BUTTON ON THE SIDEBAR'S OWN QUIET LINE, MEASURED AS RECTANGLES,
 * IN BOTH THEMES.
 *
 * `test/panels/SessionList.hidden-note.test.tsx` already proves the note's
 * BEHAVIOUR in happy-dom: it appears, auto-hides, pauses on hover/focus,
 * dismisses, and stays quiet for an acknowledged count. None of that is a
 * rectangle question. This file is the two things a unit environment cannot
 * answer at all:
 *
 *  1. Is the Dismiss button's real, painted hit rectangle actually INSIDE
 *     the note, and at least as large as the sidebar's own icon buttons
 *     (Settings/Remote/theme, `SessionList.tsx`'s `h-[26px] w-[26px]`
 *     square)? happy-dom never lays anything out — `getBoundingClientRect`
 *     there is always a zero rect — so "same size as the others" is a claim
 *     only a real layout engine can check.
 *  2. Does it actually look right, dark AND light? `docs/ui/hidden-sessions-
 *     note-dark.png` and `-light.png` are the committed evidence — this
 *     guard is what regenerates them, so `run-web-guards.mjs`'s own orphan
 *     check (`VAM_E2E_CHECK_ORPHANS`) does not flag them as stale.
 *
 * THE STUB, same shape `sidebar-ownership-shots.mjs` already uses for the
 * SAME family of fixture (two foreign Claude Code sessions, no tmux server
 * yet — `noServerProjects()` there, copied rather than imported: these
 * scripts are each run standalone by `node e2e/<name>.mjs`, not as modules of
 * one another).
 *
 * FALSIFIED BY HAND: comment out the Dismiss button's `vam-tap` class in
 * `SessionList.tsx` and widen the viewport to a phone width — the hit-size
 * check does not run at 1100px (there is no 44px floor to fail on a
 * desktop), so this file only proves the DESKTOP rectangle; the phone floor
 * is `e2e/phone-shell.pw.ts`'s own territory. On the desktop rectangle
 * itself: shrink the Dismiss button's classes from `h-[26px] w-[26px]` to
 * `h-4 w-4` and re-run — "at least as large as Settings" goes red.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/hidden-sessions-note-shots.mjs http://localhost:5520 e2e/test-results
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

/** `sidebar-ownership-shots.mjs`'s own `noServerProjects()`: two Claude Code
 *  rows, both `vamControlled: false`, no `vamListingGap` at all -- the
 *  ordinary "no tmux server yet" state, honestly zero ownership rather than
 *  an unreadable listing, which is what puts the quiet line on screen with
 *  nothing else drawn above it. */
function projects() {
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

/** A full, minimal `PreloadSourceApi` — `sidebar-ownership-shots.mjs`'s own
 *  header holds why it has to be complete: `App.tsx`'s top-level switch
 *  takes the page off `?demo=1` the moment `window.api` is merely DEFINED,
 *  so a partial stub reddens the whole page before a single check runs. */
function install(projectsArg) {
  globalThis.window.api = {
    describe: async () => ({
      id: 'hidden-note-stub',
      label: 'Hidden note stub',
      capabilities: window.__hiddenNoteCapabilities,
      declines: {},
      viewerScope: 'operator',
    }),
    load: async () => projectsArg,
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

function rect(box) {
  return `${Math.round(box.width)}x${Math.round(box.height)} @ (${Math.round(box.x)},${Math.round(box.y)})`;
}

/** Is `inner` fully within `outer`, allowing a hairline of sub-pixel
 *  rounding? A dismiss button drawn even one pixel outside its own note
 *  would be a control an operator could not connect to the sentence it acts
 *  on. */
function within(inner, outer, slack = 1) {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.addInitScript((caps) => {
  window.__hiddenNoteCapabilities = caps;
}, CAPABILITIES);
await page.addInitScript(install, projects());
await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-foreign-hidden]', { timeout: 10_000 });

const noticeText = await page.locator('[data-foreign-hidden-count]').textContent();
check(
  'the quiet line is up, naming the two foreign rows',
  (noticeText ?? '').includes('2 sessions hidden'),
  noticeText ?? '(none)',
);

const note = page.locator('[data-foreign-hidden]');
const dismiss = page.locator('[data-foreign-hidden-dismiss]');
check('the note offers a Dismiss button', (await dismiss.count()) === 1, `${await dismiss.count()}`);
check(
  'labelled exactly "Dismiss", not a longer sentence',
  (await dismiss.getAttribute('aria-label')) === 'Dismiss',
  await dismiss.getAttribute('aria-label'),
);

// ---------------------------------------------------------------------------
// THE RECTANGLES.
// ---------------------------------------------------------------------------
const noteBox = await note.boundingBox();
const dismissBox = await dismiss.boundingBox();
const settingsBox = await page.locator('button[aria-label="settings"]').boundingBox();
check('the note itself painted a real rectangle', noteBox !== null && noteBox.width > 0);
check('Dismiss painted a real rectangle', dismissBox !== null && dismissBox.width > 0);
check(
  'the sidebar has its own icon button to measure against (Settings)',
  settingsBox !== null && settingsBox.width > 0,
);

if (noteBox !== null && dismissBox !== null) {
  console.log(`  note:     ${rect(noteBox)}`);
  console.log(`  dismiss:  ${rect(dismissBox)}`);
  check(
    "Dismiss's rectangle sits INSIDE the note's own rectangle",
    within(dismissBox, noteBox),
    `dismiss ${rect(dismissBox)} vs note ${rect(noteBox)}`,
  );
}
if (dismissBox !== null && settingsBox !== null) {
  console.log(`  settings: ${rect(settingsBox)}`);
  check(
    'and its hit size is AT LEAST the sidebar icon button’s own (Settings)',
    dismissBox.width >= settingsBox.width - 1 && dismissBox.height >= settingsBox.height - 1,
    `dismiss ${rect(dismissBox)} vs settings ${rect(settingsBox)}`,
  );
}

// ---------------------------------------------------------------------------
// THE COMMITTED EVIDENCE, ONE THEME PER FILE -- `docs/ui/hidden-sessions-
// note-dark.png` and `-light.png`. `DEFAULT_THEME` (`prefs.ts`) is `dark`, so
// this stub's first paint already IS the dark shot; the toggle button (no
// prefs seeded) reads "switch to light theme" until it is pressed once.
// ---------------------------------------------------------------------------
await note.screenshot({ path: `${outDir}/hidden-sessions-note-dark.png` });
console.log(`${outDir}/hidden-sessions-note-dark.png`);

await page.locator('button[aria-label="switch to light theme"]').click();
await page.waitForSelector('button[aria-label="switch to dark theme"]', { timeout: 3_000 });
await note.screenshot({ path: `${outDir}/hidden-sessions-note-light.png` });
console.log(`${outDir}/hidden-sessions-note-light.png`);

// ---------------------------------------------------------------------------
// THE REAL CLICK: Dismiss actually removes the note, through its own exit
// fade, in a real browser -- never happy-dom's fake `transitionend`.
// ---------------------------------------------------------------------------
await dismiss.click();
await page.waitForFunction(() => document.querySelector('[data-foreign-hidden]') === null, {
  timeout: 2_000,
});
check('Dismiss removes the note for real, not just in the unit suite', (await note.count()) === 0);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nhidden-sessions-note-shots: all checks passed.');
