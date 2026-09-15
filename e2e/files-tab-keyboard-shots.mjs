/**
 * THE FILES TAB'S KEYBOARD MODEL, MEASURED AS FOCUS -- which is the one thing
 * jsdom and happy-dom cannot see: neither lays out a real page, neither
 * implements `:focus-visible`, and `document.activeElement` in either is not
 * the browser's own answer to "who owns the keyboard right now". `test/panels/
 * DetailPanel.files-tab.test.tsx` already proves the REFUSAL VOCABULARY and
 * the DIRTY-STATE BOOKKEEPING against a fake bridge in happy-dom; this file's
 * job is the three things that are true only once Chromium has actually
 * painted and focused something:
 *
 *  1. THE EDITOR IS A REAL FOURTH INSERT SCOPE. `keyboard/focus-scope.ts`'s
 *     whole contract is that the cursor mode is derived from
 *     `document.activeElement`'s own ancestry, live, in a real DOM -- and the
 *     status chip that reports it (`mode-truth-shots.mjs`'s own subject) is
 *     the most direct proof there is that the mark actually landed on the
 *     element Chromium focused, not merely on the JSX that built it.
 *
 *  2. `changed-on-disk` STILL READS AS THE OPERATOR'S OWN EDIT, on screen,
 *     after a real save round-trip runs through a real click.
 *
 *  3. CLOSING WARNS. `beforeunload` is a real browser event with no analogue
 *     in either unit environment; dispatching a genuine (synthetic, but real)
 *     `beforeunload` and reading `defaultPrevented` back is the only way to
 *     prove vam actually asked the page to arm it.
 *
 * THE BRIDGE IS A STUB, injected with `page.addInitScript` -- the same
 * technique `settings-chrome-shots.mjs` already uses for `window.api.remote`.
 * IT MUST BE A COMPLETE ONE, not `files` alone: `App.tsx`'s own top-level
 * switch is `globalThis.window?.api !== undefined ? <DesktopCanvas ...>` --
 * merely DEFINING `window.api` (whatever it carries) takes the app off the
 * `?demo=1` fixture entirely and onto `createSourceFromPreload(api)`, which
 * calls `api.describe()`/`api.load()` for real. A `files`-only stub was tried
 * first here and reddened the whole page with "e.describe is not a
 * function" before a single Files-tab check ever ran -- so the stub below is
 * a full, minimal `PreloadSourceApi` (every capability false, one project,
 * one session) alongside `files`, which is what actually exercises
 * `Canvas.tsx`'s `filesTab` flag (`window.api?.files !== undefined`, with NO
 * `source.kind` gate -- see that flag's own comment for why that omission is
 * safe) the way the real desktop app would set it.
 *
 * Falsified by hand, three ways, each named in the task that built this file:
 *   - remove `insertScopeMark`/`insertStopMark` from the editor's `<textarea>`
 *     in `FilesTab.tsx` -- "the editor keeps focus while typing" reddens,
 *     because the mode chip stops reading Insert.
 *   - in `FilesTab.tsx`'s `saveFile`, fold `changed-on-disk` into the SAME
 *     branch as a real success (drop the `error.code === 'changed-on-disk'`
 *     check) -- "a conflict still shows the operator's own edit" reddens.
 *   - delete the `beforeunload` effect in `FilesTab.tsx` -- "closing warns
 *     while a buffer is dirty" reddens.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/files-tab-keyboard-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** A demo session with no open question, same one `composer-bar-shots.mjs` uses. */
const PLAIN_SESSION = 'crosscheck-2';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

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
 * capability false -- plus `files`, an in-memory filesystem defined ENTIRELY
 * inside the page so the conflict scenario below (a save whose baseline no
 * longer matches) can mutate real in-page state between calls. `files`'s own
 * refusals are worded and shaped exactly like `main/files/ipc.ts`'s, because
 * a stub that answers differently from the real channel would be testing a
 * fiction. See this file's own header for why the OTHER members exist at
 * all: this is what `DesktopCanvas` needs to render anything rather than
 * crash on `api.describe()`.
 */
await page.addInitScript(() => {
  const ENV_PATH = '/work/demo/.env';
  const files = new Map([[ENV_PATH, { content: 'A=1\n', rev: 0 }]]);
  const sig = (path) => {
    const entry = files.get(path);
    return { size: entry.content.length, mtimeMs: entry.rev, sha256: `rev-${entry.rev}` };
  };
  const refuse = (code, message) => Promise.reject({ kind: 'refused', code, message });
  const unavailable = () =>
    Promise.resolve({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
    });

  globalThis.window.api = {
    describe: async () => ({
      id: 'stub',
      label: 'Stub',
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
      },
      declines: {},
      viewerScope: 'operator',
    }),
    load: async () => [
      {
        id: 'p1',
        name: 'stub project',
        sessions: [
          {
            id: 'crosscheck-2',
            title: 'stub session',
            icon: null,
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
    ],
    subscribe: () => () => {},
    recordPrompt: async () => {},
    renameSession: async () => {},
    closeSession: async () => {},
    createSession: async () => {},
    createSessionIn: async () => {},
    pickImageAttachment: async () => null,
    history: async () => unavailable(),
    agentWork: async () => unavailable(),
    applyWaivers: async () => {},
    transitionLesson: async () => {},
    usage: { get: async () => ({ kind: 'unavailable' }) },
    files: {
      list: async () => ({ root: '/work/demo', files: [...files.keys()], truncated: false }),
      read: async (path) => {
        const entry = files.get(path);
        if (entry === undefined) return refuse('not-found', `${path} does not exist`);
        return { content: entry.content, isBinary: false, signature: sig(path) };
      },
      write: async (path, content, baseSignature) => {
        const entry = files.get(path);
        const current = entry === undefined ? null : sig(path);
        const matches =
          (current === null && baseSignature === null) ||
          (current !== null && baseSignature !== null && current.sha256 === baseSignature.sha256);
        if (!matches) {
          return refuse('changed-on-disk', `${path} changed under you`);
        }
        const rev = (entry?.rev ?? -1) + 1;
        files.set(path, { content, rev });
        return { signature: sig(path) };
      },
    },
  };
  // Stands in for "an agent (or the operator, elsewhere) wrote this file
  // between the operator's own read and their own next save" — the exact
  // race `content.ts`'s own header describes. Called directly from the test,
  // at a moment IT chooses, rather than folded into `write` itself: the
  // conflict has to land BETWEEN two of the operator's own saves, not inside
  // one of them.
  globalThis.window.__agentEditNow = () => {
    const entry = files.get(ENV_PATH);
    files.set(ENV_PATH, { content: `${entry.content}\n# an agent wrote this`, rev: entry.rev + 1 });
  };
});

await page.goto(origin, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${PLAIN_SESSION}"]`).first().click();
await page.waitForSelector('[data-view="files"]', { timeout: 5_000 });
await page.locator('[data-view="files"]').click();
await page.waitForSelector('[data-files-row]', { timeout: 5_000 });
await page.locator('[data-files-row]').first().click();
await page.waitForSelector('[data-files-editor]', { timeout: 5_000 });

// ---------------------------------------------------------------------------
// 1. THE EDITOR IS A REAL INSERT SCOPE — the mode chip, not a class name.

const editor = page.locator('[data-files-editor]');
await editor.click();
await page.waitForFunction(
  () => document.activeElement?.matches('[data-files-editor]') ?? false,
  null,
  { timeout: 3_000 },
);
check(
  'the editor actually holds DOM focus after a click',
  await page.evaluate(() => document.activeElement?.matches('[data-files-editor]') ?? false),
);
const modeWhileEditing = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check(
  'the mode chip reads Insert while the editor has focus — the fourth insert scope',
  modeWhileEditing === 'Insert',
  `it reads ${modeWhileEditing}`,
);
await page.screenshot({ path: `${outDir}/files-tab-editor-insert.png` });
console.log(`${outDir}/files-tab-editor-insert.png`);

// A bare letter must land IN the box.
await editor.press('End');
await page.keyboard.type('j');
const afterBareKey = await editor.inputValue();
check(
  'a bare letter typed in the editor lands in the editor',
  afterBareKey === 'A=1\nj',
  `editor reads ${JSON.stringify(afterBareKey)}`,
);

/**
 * `Mod-d` IS THE ONE `isSelectOnly` CHORD IN THE WHOLE TABLE
 * (`keyboard/chords.ts`'s own `isSelectOnly`) — the sharpest lever there is
 * for "did the insert scope actually register". `Canvas.tsx`'s handler reads
 * the cursor mode off `document.activeElement` at the moment the key
 * arrives: with the mark intact it reads Insert and returns BEFORE doing
 * anything, including `setStatus` — so whatever the status bar already said
 * is untouched. With the mark REMOVED, the same keystroke resolves as
 * `scrollHalf`, finds no transcript column behind the Files tab, and calls
 * `setStatus('nothing to scroll — this pane is not showing a transcript')` --
 * a status line the correct behaviour never produces at all, which is the
 * one thing that is safe to assert changed or did not, in either case.
 */
const statusBefore = await page.evaluate(() => document.querySelector('[data-status]')?.textContent ?? '');
await page.keyboard.press('Control+d');
const statusAfter = await page.evaluate(() => document.querySelector('[data-status]')?.textContent ?? '');
check(
  'Mod-d (the one select-only chord) is silently declined, not fired as scrollHalf',
  statusAfter === statusBefore,
  `status went from ${JSON.stringify(statusBefore)} to ${JSON.stringify(statusAfter)}`,
);
check(
  'and the editor keeps focus throughout',
  await page.evaluate(() => document.activeElement?.matches('[data-files-editor]') ?? false),
);

// Leave the way the composer's own Mod-[ does, and confirm Select comes back.
await page.keyboard.press('Control+[');
await page.waitForFunction(
  () => (document.querySelector('[data-mode]')?.textContent ?? '') === 'Select',
  null,
  { timeout: 3_000 },
).catch(() => {});
const modeAfterLeave = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check('Mod-[ hands the keyboard back to Select', modeAfterLeave === 'Select', `it reads ${modeAfterLeave}`);
check(
  'and the unsaved text is still in the box — leaving is not discarding',
  (await editor.inputValue()) === 'A=1\nj',
);

// ---------------------------------------------------------------------------
// 2. `changed-on-disk` STILL SHOWS THE OPERATOR'S OWN EDIT.

await editor.click();
await editor.fill('A=1\nj');
await page.locator('[data-files-save]').click();
await page.waitForFunction(
  () => document.querySelector('[data-files-save]')?.getAttribute('data-files-save-state') === 'idle',
  null,
  { timeout: 5_000 },
);

// An agent writes the file between this save and the operator's next one.
await page.evaluate(() => {
  globalThis.window.__agentEditNow();
});
await editor.click();
await editor.fill('A=OPERATORS-OWN-EDIT');
await page.locator('[data-files-save]').click();
await page.waitForSelector('[data-files-conflict]', { timeout: 5_000 });
const conflictText = await page.locator('[data-files-conflict]').innerText();
check('a changed-on-disk save shows the conflict banner', conflictText.includes('changed on disk'), conflictText);
const editorDuringConflict = await editor.inputValue();
check(
  'and the operator\'s own edit is still in the box — never silently overwritten or reverted',
  editorDuringConflict === 'A=OPERATORS-OWN-EDIT',
  `editor reads ${JSON.stringify(editorDuringConflict)}`,
);
check(
  'and the dirty mark is still shown — a real success would have cleared it',
  (await page.locator('[data-files-dirty]').count()) > 0,
);
await page.screenshot({ path: `${outDir}/files-tab-conflict.png` });
console.log(`${outDir}/files-tab-conflict.png`);

// Reload is the one explicit, labelled way to give the edit up.
await page.locator('[data-files-reload]').click();
await page.waitForFunction(
  () => document.querySelector('[data-files-conflict]') === null,
  null,
  { timeout: 5_000 },
);
const reloaded = await editor.inputValue();
check(
  'Reload replaces the buffer with what is actually on disk, only once asked',
  reloaded.includes('an agent wrote this'),
  `editor reads ${JSON.stringify(reloaded)}`,
);

// ---------------------------------------------------------------------------
// 3. CLOSING WARNS WHILE A BUFFER IS DIRTY.

const beforeUnloadPrevented = () =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

check(
  'no warning is armed with nothing dirty (just reloaded, matches disk)',
  (await beforeUnloadPrevented()) === false,
);

await editor.click();
await editor.fill('A=UNSAVED-ON-CLOSE');
const armedWhileDirty = await beforeUnloadPrevented();
check('closing warns the moment a buffer is dirty', armedWhileDirty === true, `defaultPrevented was ${armedWhileDirty}`);

await page.locator('[data-files-save]').click();
await page.waitForFunction(
  () => document.querySelector('[data-files-save]')?.getAttribute('data-files-save-state') === 'idle',
  null,
  { timeout: 5_000 },
).catch(() => {});
const disarmedAfterSave = await beforeUnloadPrevented();
check('and the warning stands down once the save actually lands', disarmedAfterSave === false);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nfiles-tab-keyboard: every check passed.');
