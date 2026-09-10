/**
 * THE KEYS TELL THE TRUTH: what a chord claims, and what a dead key says.
 *
 * Three audit findings, measured in a real browser because each is about a
 * keystroke arriving somewhere jsdom cannot put it, or about what the screen
 * really paints:
 *
 *  - F9. `gt`/`gT` were captioned `next project` and stepped one SESSION.
 *    Asserted here against the SIDEBAR AS PAINTED: the project order and each
 *    project's first row are read off the screen, and the landing is compared
 *    to that — never to an order this file assumes.
 *
 *  - F7. Keys that could never act said nothing at all. Insert `j`/`k` clamped
 *    an index into a one-entry list, Insert `l` was an unconditional `return`,
 *    `gg`/`G` on an empty list returned, a bad jump label dismissed the mode
 *    and an unbound second chord key dropped the prefix — five silences.
 *
 *  - F3. Two actions could come to claim one key, and both surfaces went on
 *    advertising it for both. The last section seeds that map through
 *    storage, reads what the sheet PAINTS for the dead half, and then presses
 *    the key to see which action it really reaches.
 *
 * WHY A REAL BROWSER, for the second one especially. The quiet case and the
 * loud one are told apart by `event.defaultPrevented`: the options list of an
 * open question answers `j` itself and calls `preventDefault`, and the window
 * listener stands down. That depends on a real keydown being CANCELABLE and on
 * React's root container sitting below `window` in the bubble path — and a
 * `KeyboardEvent` built in a unit test without `cancelable` makes
 * `preventDefault()` a no-op by specification, which is exactly how that guard
 * came to be inert in every jsdom test in this repo. Here the keystrokes are
 * the browser's own, delivered to whatever really holds focus.
 *
 * Failures are COLLECTED, not thrown: one refusal that regresses should not
 * hide the state of the other four. Every wait is for the screen to reach the
 * state the NEXT action needs — never for a condition that was already true
 * before the action started, which measures the previous screen.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/key-truth-shots.mjs http://localhost:5527 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5527';
const outDir = process.argv[3] ?? 'docs/ui';

/** A session with an open question — the state where `j` belongs to the card. */
const ASKING_SESSION = 'vam-build-1';
/** A session with none, where Insert's own cursor has one stop: the prompt. */
const QUIET_SESSION = 'notes-1';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
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

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');

/** The sidebar as drawn: the project order, each project's rows in order, and
 *  where the cursor is. Everything below compares against THIS, so a fixture
 *  reordered by status cannot turn a real regression green. */
const sidebar = () =>
  page.evaluate(() => {
    const cursor = document.querySelector('[data-row-cursor]')?.closest('[data-session-row]');
    return {
      projects: [...document.querySelectorAll('[data-project-rows]')].map((el) => ({
        id: el.getAttribute('data-project-rows'),
        rows: [...el.querySelectorAll('[data-session-row]')].map((row) =>
          row.getAttribute('data-session-row'),
        ),
      })),
      focused: cursor?.getAttribute('data-session-row') ?? null,
      focusedProject:
        cursor?.closest('[data-project-rows]')?.getAttribute('data-project-rows') ?? null,
    };
  });

/**
 * The refusal channel, in both halves plus what the CSS does to it.
 *
 * `text` is what the cell contains (`truncateStatus`, 72 characters); `full`
 * is the tooltip's whole string. They must be equal, or the clause that
 * explains the refusal is reachable only by hover — and `overflow` says
 * whether the box then clipped what survived, which is a fact only a real
 * layout has.
 */
const status = () =>
  page.evaluate(() => {
    const cell = document.querySelector('[data-status-bar] [data-status]');
    if (cell === null) return { present: false, text: '', full: '', clientWidth: 0, scrollWidth: 0 };
    return {
      present: true,
      text: cell.textContent ?? '',
      full: cell.getAttribute('data-note') ?? '',
      clientWidth: cell.clientWidth,
      scrollWidth: cell.scrollWidth,
    };
  });

/** Back to a known screen: Escape closes whatever is open, leaves Insert and
 *  clears the bar. Waited on, so the next case cannot read this one's message. */
async function reset() {
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => (document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '') === '',
    undefined,
    { timeout: 4000 },
  );
}

/** Press a key and wait for the bar to say something NEW — never for "not
 *  empty", which was already true before the press half the time. */
async function pressAndReadStatus(keys) {
  await reset();
  for (const key of keys) {
    await page.keyboard.press(key);
  }
  try {
    await page.waitForFunction(
      () => (document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '') !== '',
      undefined,
      { timeout: 4000 },
    );
  } catch {
    // Silence is the failure this file is about, so it is reported as one
    // rather than aborting the run and taking the other cases with it.
  }
  return status();
}

// ---------------------------------------------------------------------------
// F9. `gt` LEAVES THE PROJECT, and lands on the next one's first row.

const start = await sidebar();
console.log(
  'sidebar as painted:',
  JSON.stringify(start.projects.map((p) => `${p.id}: ${p.rows.join(', ')}`)),
);
check('the demo paints at least two projects', start.projects.length >= 2, `${start.projects.length}`);
const multi = start.projects.find((p) => p.rows.length >= 2);
check(
  'and one of them holds two sessions, so a session step and a project step differ',
  multi !== undefined,
);

if (multi !== undefined && start.projects.length >= 2) {
  const from = multi.rows[0];
  const at = start.projects.indexOf(multi);
  const nextProject = start.projects[at + 1] ?? start.projects[at - 1];
  const forward = start.projects[at + 1] !== undefined;
  await page.locator(`[data-session-row="${from}"]`).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector('[data-row-cursor]')?.closest('[data-session-row]')
        ?.getAttribute('data-session-row') === id,
    from,
    { timeout: 4000 },
  );
  await page.keyboard.press('g');
  await page.keyboard.press(forward ? 't' : 'T');
  await page.waitForFunction(
    (id) =>
      document.querySelector('[data-row-cursor]')?.closest('[data-session-row]')
        ?.getAttribute('data-session-row') !== id,
    from,
    { timeout: 4000 },
  );
  const landed = await sidebar();
  console.log(`g${forward ? 't' : 'T'} from ${from}: ${landed.focusedProject}/${landed.focused}`);
  check(
    'the cursor left the project it started in',
    landed.focusedProject !== multi.id,
    `still in ${landed.focusedProject}`,
  );
  check(
    'it did not merely step to the next session of the same project',
    landed.focused !== multi.rows[1],
    `landed on ${landed.focused}, which is that project's second row`,
  );
  check(
    'it landed on the adjacent project as the sidebar draws it',
    landed.focusedProject === nextProject.id,
    `expected ${nextProject.id}, got ${landed.focusedProject}`,
  );
  check(
    "and on that project's FIRST row",
    landed.focused === nextProject.rows[0],
    `expected ${nextProject.rows[0]}, got ${landed.focused}`,
  );
  // A KEY THAT ACTED SAYS NOTHING — the other half of every refusal added
  // here. The bar belongs to the keys that could not act; a chord that did
  // exactly what its caption promises must leave it empty, or the fix for
  // silence has been paid for with noise on the working path.
  const afterHop = await status();
  check(
    'and a chord that worked said nothing at all',
    afterHop.text === '',
    `the bar answered a successful gt with "${afterHop.text}"`,
  );
  await page.screenshot({ path: `${outDir}/key-truth-gt-crosses-projects.png` });
  console.log(`${outDir}/key-truth-gt-crosses-projects.png`);
}

// ---------------------------------------------------------------------------
// F7a. INSERT `j` AND `l` WITH NO QUESTION: the keys that could never act.

await reset();
await page.locator(`[data-session-row="${QUIET_SESSION}"]`).click();
await page.waitForFunction(
  (id) =>
    document.querySelector('[data-row-cursor]')?.closest('[data-session-row]')
      ?.getAttribute('data-session-row') === id,
  QUIET_SESSION,
  { timeout: 4000 },
);
const quietHasNoCard = await page.evaluate(
  () => document.querySelectorAll('[data-question-option]').length === 0,
);
check('the quiet session really has no question card', quietHasNoCard);

const insertDown = await pressAndReadStatus(['I', 'j']);
console.log('Insert j:', JSON.stringify(insertDown));
check('Insert j refuses out loud', insertDown.text !== '', 'the bar stayed empty');
check(
  'and the refusal survives the 72-character cell whole',
  insertDown.text === insertDown.full,
  `drawn "${insertDown.text}" vs full "${insertDown.full}"`,
);
check(
  'and the cell is wide enough to paint it without clipping',
  insertDown.scrollWidth <= insertDown.clientWidth + 1,
  `${insertDown.scrollWidth}px of text in a ${insertDown.clientWidth}px cell`,
);

const insertUp = await pressAndReadStatus(['I', 'k']);
console.log('Insert k:', JSON.stringify(insertUp.text));
check(
  'k answers with its own direction rather than j’s sentence',
  insertUp.text !== '' && insertUp.text !== insertDown.text,
);

const insertRight = await pressAndReadStatus(['I', 'l']);
console.log('Insert l:', JSON.stringify(insertRight.text));
check('Insert l refuses out loud', insertRight.text !== '', 'the bar stayed empty');
check(
  'and l says something other than what j said',
  insertRight.text !== insertDown.text,
  'one sentence for two keys says neither',
);
const stillHome = await sidebar();
check(
  'and none of the three moved the session cursor',
  stillHome.focused === QUIET_SESSION,
  `cursor is on ${stillHome.focused}`,
);
await page.screenshot({ path: `${outDir}/key-truth-insert-refusal.png` });
console.log(`${outDir}/key-truth-insert-refusal.png`);

// ---------------------------------------------------------------------------
// F7b. THE SAME KEY, WITH A QUESTION OPEN: silent, because it acted.
//
// This is the case a noisy fix would break, and the one only a real browser
// can judge: the card calls `preventDefault` on the keydown it handled, and
// the canvas listener reads `event.defaultPrevented` on the very same native
// event as it bubbles past.

await reset();
await page.locator(`[data-session-row="${ASKING_SESSION}"]`).click();
await page.waitForSelector('[data-question-option]', { timeout: 4000 });
await page.keyboard.press('I');
await page.waitForFunction(
  () => document.activeElement?.hasAttribute('data-question-option') === true,
  undefined,
  { timeout: 4000 },
);
const firstOption = await page.evaluate(() => document.activeElement?.textContent ?? '');
await page.keyboard.press('j');
await page.waitForFunction(
  (was) => (document.activeElement?.textContent ?? '') !== was,
  firstOption,
  { timeout: 4000 },
);
const walked = await page.evaluate(() => ({
  onOption: document.activeElement?.hasAttribute('data-question-option') === true,
  label: document.activeElement?.textContent ?? '',
  status: document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '',
}));
console.log('Insert j over an open question:', JSON.stringify(walked));
check('j walked the options rather than refusing', walked.onOption && walked.label !== firstOption);
check(
  'and said nothing — an ordinary walk is not a refusal',
  walked.status === '',
  `the bar said "${walked.status}"`,
);
await page.screenshot({ path: `${outDir}/key-truth-question-walk.png` });
console.log(`${outDir}/key-truth-question-walk.png`);

// ---------------------------------------------------------------------------
// F7c. A CHORD THAT DIED, AND A BARE KEY THAT NEVER OPENED ONE.

const deadChord = await pressAndReadStatus(['g', 'x']);
console.log('gx:', JSON.stringify(deadChord.text));
check('an abandoned chord names the pair it dropped', deadChord.text.includes('gx'));
check(
  'and that refusal fits the cell too',
  deadChord.text === deadChord.full,
  `drawn "${deadChord.text}" vs full "${deadChord.full}"`,
);

await reset();
await page.keyboard.press('q');
await page.waitForTimeout(200);
const stray = await status();
console.log('a bare unbound key:', JSON.stringify(stray.text));
check(
  'a key that opens no chord is left silent',
  stray.text === '',
  `the bar answered a stray keystroke with "${stray.text}"`,
);

// ---------------------------------------------------------------------------
// F7d. A JUMP LABEL NOTHING CARRIES.

const badLabel = await pressAndReadStatus(['f', 'z']);
console.log('f then z:', JSON.stringify(badLabel.text));
check('an unlabelled key is answered rather than swallowed', badLabel.text !== '');
check('and the refusal names the key that labelled nothing', badLabel.text.includes('z'));
check(
  'and it fits the cell',
  badLabel.text === badLabel.full,
  `drawn "${badLabel.text}" vs full "${badLabel.full}"`,
);
const afterJump = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check('and jump mode really did close', afterJump !== 'JUMP', `the bar still reads ${afterJump}`);
await page.screenshot({ path: `${outDir}/key-truth-jump-refusal.png` });
console.log(`${outDir}/key-truth-jump-refusal.png`);

// ---------------------------------------------------------------------------
// THE MODE BOUNDARY (audit F4, F5) AND THE TWO NEW BRACKET FAMILIES.
//
// Everything below is here rather than in a unit test for one reason: it is
// about WHERE DOM FOCUS IS after a real key press. jsdom has no focus a
// keystroke can be delivered to, `preventDefault` on a hand-built event is a
// specified no-op, and `document.activeElement` in a jsdom test is whatever
// the test itself last called `.focus()` on. Here the presses are the
// browser's own and land on whatever really holds the keyboard.
//
// `Control`, not `Meta`: `normalizeKey` folds both into `Mod`, and CI is
// ubuntu — a guard spelled with Cmd would be a guard that only ran on one
// developer's machine.

/**
 * Wait for a state and REPORT rather than abort. `page.waitForFunction`
 * throws on timeout, which would end the run and take every case after it
 * with it — the opposite of this file's rule that failures are collected.
 */
async function settle(fn, arg, label) {
  try {
    await page.waitForFunction(fn, arg, { timeout: 4000 });
    return true;
  } catch {
    check(label, false, 'the screen never reached the state this case needs');
    return false;
  }
}

/** Where the keyboard really is, and what the bar claims about it. */
const keyboardAt = () =>
  page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName ?? null,
      isStop: active instanceof HTMLElement && active.hasAttribute('data-insert-stop'),
      inScope: active instanceof HTMLElement && active.closest('[data-insert-scope]') !== null,
      mode: document.querySelector('[data-mode]')?.textContent ?? '',
      cursor:
        document
          .querySelector('[data-row-cursor]')
          ?.closest('[data-session-row]')
          ?.getAttribute('data-session-row') ?? null,
    };
  });

await reset();
await page.locator(`[data-session-row="${QUIET_SESSION}"]`).click();
await settle(
  (id) =>
    document.querySelector('[data-row-cursor]')?.closest('[data-session-row]')
      ?.getAttribute('data-session-row') === id,
  QUIET_SESSION,
  'the quiet session takes the cursor before the mode cases start',
);

// F5. `I` LANDS THE KEYBOARD SOMEWHERE REAL, or does not claim Insert.
await page.keyboard.press('I');
const entered = (await settle(
  () => document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-insert-scope]') !== null,
  undefined,
  'I moves the keyboard into the pane',
))
  ? await keyboardAt()
  : await keyboardAt();
console.log('after I:', JSON.stringify(entered));
check(
  'I lands on a real insert stop rather than leaving focus on the body',
  entered.isStop,
  `activeElement is <${entered.tag}> with no data-insert-stop`,
);
check('and the bar agrees, because it is reading that same focus', entered.mode === 'Insert');
check('and the landing is the prompt ROW, not the box — `i` is the caret', entered.tag !== 'TEXTAREA');

// F4. `Mod-0` FROM INSIDE THE COMPOSER REALLY HANDS THE KEYBOARD BACK.
//
// `i` puts the caret in the textarea, which is where the operator is when they
// reach for `Cmd+0`. The flag-era bug: the mode read Select while that now
// read-only box still held focus, so the window listener returned at its own
// typing guard and every bare key after it vanished.
await reset();
await page.locator(`[data-session-row="${QUIET_SESSION}"]`).click();
await page.keyboard.press('i');
const composing = await settle(
  () => document.activeElement?.tagName === 'TEXTAREA',
  undefined,
  'i puts the caret in the prompt box',
);
if (composing) {
  const before = await keyboardAt();
  check('the caret really is in the box before Mod-0', before.tag === 'TEXTAREA');
  check('and the bar reads Insert while it is', before.mode === 'Insert');
  await page.keyboard.press('Control+Digit0');
  // Waited for the NEW state — the box letting go — never for "not in Insert",
  // which was already false a moment ago on some other screen.
  await settle(
    () => document.activeElement?.tagName !== 'TEXTAREA',
    undefined,
    'Mod-0 releases the composer’s DOM focus',
  );
  const released = await keyboardAt();
  console.log('after Mod-0:', JSON.stringify(released));
  check(
    'Mod-0 blurs the box rather than only writing Select',
    released.tag !== 'TEXTAREA' && !released.inScope,
    `activeElement is still <${released.tag}>`,
  );
  check('and the bar reads Select', released.mode === 'Select');

  // THE ASSERTION THE WHOLE FINDING IS ABOUT: the next bare key gets through.
  const cursorWas = released.cursor;
  await page.keyboard.press('j');
  const moved = await settle(
    (was) =>
      (document.querySelector('[data-row-cursor]')?.closest('[data-session-row]')
        ?.getAttribute('data-session-row') ?? null) !== was,
    cursorWas,
    'the next bare j reaches the sidebar',
  );
  const after = await keyboardAt();
  check(
    'a bare j after Mod-0 walks the sidebar instead of dying in the box',
    moved && after.cursor !== cursorWas,
    `cursor stayed on ${after.cursor}`,
  );
  await page.screenshot({ path: `${outDir}/key-truth-mode-handback.png` });
  console.log(`${outDir}/key-truth-mode-handback.png`);
}

// ---------------------------------------------------------------------------
// THE BRACKET FAMILIES: a tab step, a pane step, and digits across panes.

/** Every tab drawn, pane by pane, in the order the strips paint them. */
const drawn = () =>
  page.evaluate(() => ({
    panes: [...document.querySelectorAll('[data-split-pane]')].map((pane) => ({
      id: pane.getAttribute('data-split-pane'),
      focused: pane.getAttribute('data-split-focused') === 'true',
      active:
        pane.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')
          ?.textContent ?? null,
      tabs: [...pane.querySelectorAll('[data-tab-select]')].map((t) => t.textContent),
    })),
    flat: [...document.querySelectorAll('[data-split-pane] [data-tab-select]')].map(
      (t) => t.textContent,
    ),
  }));

await reset();
await page.locator(`[data-session-row="${QUIET_SESSION}"]`).click();
await settle(
  () => document.querySelectorAll('[data-split-pane] [data-tab-select]').length >= 2,
  undefined,
  'the quiet session’s project draws more than one tab',
);

const oneStrip = await drawn();
console.log('one pane:', JSON.stringify(oneStrip.flat));
check('the demo can produce a strip with at least two tabs', oneStrip.flat.length >= 2);

if (oneStrip.flat.length >= 2) {
  const activeWas = oneStrip.panes[0]?.active ?? null;
  const nextExpected = oneStrip.flat[(oneStrip.flat.indexOf(activeWas) + 1) % oneStrip.flat.length];
  await page.keyboard.press('Control+Shift+BracketRight');
  await settle(
    (was) =>
      (document.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')
        ?.textContent ?? null) !== was,
    activeWas,
    'Mod-Shift-] brings another tab forward',
  );
  const stepped = await drawn();
  check(
    'Mod-Shift-] steps to the NEXT tab as the strip draws them',
    stepped.panes[0]?.active === nextExpected,
    `expected ${nextExpected}, got ${stepped.panes[0]?.active}`,
  );
  await page.keyboard.press('Control+Shift+BracketLeft');
  await settle(
    (want) =>
      (document.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')
        ?.textContent ?? null) === want,
    activeWas,
    'Mod-Shift-[ comes back',
  );
  const back = await drawn();
  check(
    'and Mod-Shift-[ is its opposite, not a second forward step',
    back.panes[0]?.active === activeWas,
    `expected ${activeWas}, got ${back.panes[0]?.active}`,
  );
}

// A SPLIT, which is where the per-pane rule and the across-panes rule differ.
await page.keyboard.press('z');
await page.keyboard.press('v');
const splitOk = await settle(
  () => document.querySelectorAll('[data-split-pane]').length === 2,
  undefined,
  'zv opens a second pane',
);

if (splitOk) {
  const split = await drawn();
  console.log('split:', JSON.stringify(split.panes));
  const focusedWas = split.panes.find((p) => p.focused)?.id ?? null;

  // `Mod-1` addresses the FIRST tab on screen, which after `zv` lives in the
  // pane that did NOT keep the keyboard.
  const firstOnScreen = split.flat[0];
  const owner = split.panes.find((p) => p.tabs.includes(firstOnScreen))?.id ?? null;
  check(
    'the first tab on screen is in a pane that does not hold the keyboard',
    owner !== null && owner !== focusedWas,
    `owner ${owner}, focused ${focusedWas}`,
  );
  await page.keyboard.press('Control+Digit1');
  await settle(
    (id) =>
      document.querySelector('[data-split-pane][data-split-focused="true"]')?.getAttribute(
        'data-split-pane',
      ) === id,
    owner,
    'Mod-1 moves the keyboard to the pane the tab lives in',
  );
  const picked = await drawn();
  check(
    'Mod-1 reaches a tab in ANOTHER pane — it counts the screen, not the strip',
    picked.panes.find((p) => p.focused)?.active === firstOnScreen,
    `focused pane shows ${picked.panes.find((p) => p.focused)?.active}, wanted ${firstOnScreen}`,
  );

  // And the pane pair, one modifier up.
  const paneWas = picked.panes.find((p) => p.focused)?.id ?? null;
  await page.keyboard.press('Control+Alt+BracketRight');
  await settle(
    (was) =>
      document.querySelector('[data-split-pane][data-split-focused="true"]')?.getAttribute(
        'data-split-pane',
      ) !== was,
    paneWas,
    'Mod-Alt-] moves the keyboard to the other pane',
  );
  const hopped = await drawn();
  check(
    'Mod-Alt-] steps the PANE, not the tab',
    hopped.panes.find((p) => p.focused)?.id !== paneWas,
    `still in ${paneWas}`,
  );
  await page.screenshot({ path: `${outDir}/key-truth-bracket-families.png` });
  console.log(`${outDir}/key-truth-bracket-families.png`);
}

// ---------------------------------------------------------------------------
// F3. A KEY TWO ACTIONS CLAIM: what the sheet says, and what the key does.
//
// The editor can no longer mint this state — every write is judged on the
// whole resulting map now — but a STORED map still can: an override collides
// with a shipped key the day a later vam moves one onto it, with nothing
// hand-edited. So it is seeded the way it arrives, through `vam.prefs.v1`,
// and the app reads it at boot like any other payload.
//
// Two things only a real browser can answer. Whether the correction is
// PAINTED — a row can carry the right text and still occupy no space, and
// this repo has shipped a style rule that matched no element — and whether
// the keystroke really reaches the action the sheet now names, which needs a
// keydown delivered to whatever holds focus.

await page.addInitScript(() => {
  window.localStorage.setItem('vam.prefs.v1', JSON.stringify({ keyBindings: { icon: ['r'] } }));
});
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');
await page.locator(`[data-session-row="${QUIET_SESSION}"]`).click();
await settle(
  (id) =>
    document.querySelector('[data-row-cursor]')?.closest('[data-session-row]')
      ?.getAttribute('data-session-row') === id,
  QUIET_SESSION,
  'a session takes the cursor before the contested key is pressed',
);

await page.keyboard.press('?');
const sheetOpen = await settle(
  () => document.querySelector('[data-key-sheet]') !== null,
  undefined,
  'the key sheet opens over a contested map',
);

if (sheetOpen) {
  const onR = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-key-sheet] li')].filter(
      (li) => (li.querySelector('[data-key-sheet-keys]')?.textContent ?? '') === 'r',
    );
    return rows.map((li) => {
      const mark = li.querySelector('[data-key-sheet-dead]');
      const chip = li.querySelector('[data-key-sheet-keys]');
      const box = mark?.getBoundingClientRect() ?? null;
      return {
        label: li.querySelector('[data-key-sheet-label]')?.textContent ?? '',
        dead: mark?.textContent ?? null,
        // MEASURED, not scanned: the words have to occupy real space on a
        // real layout, and the chip has to actually strike through.
        painted: box !== null && box.width > 0 && box.height > 0,
        struck: chip === null ? '' : getComputedStyle(chip).textDecorationLine,
      };
    });
  });
  console.log('rows on `r`:', JSON.stringify(onR));
  check(
    'the sheet still lists `r` for both actions that claim it',
    onR.length === 2,
    `${onR.length} rows`,
  );
  const dead = onR.filter((row) => row.dead !== null);
  const live = onR.filter((row) => row.dead === null);
  check('exactly one of them is marked dead', dead.length === 1, `${dead.length} marked`);
  check(
    'the dead one is the row whose key was taken, and it names the taker',
    dead[0]?.label.includes('rename') === true && dead[0]?.dead?.includes('icon') === true,
    `label "${dead[0]?.label}", mark "${dead[0]?.dead}"`,
  );
  check(
    'the correction is painted rather than merely present',
    dead[0]?.painted === true,
    'the mark occupies no space on the real layout',
  );
  check(
    'and the dead chord is struck through while the live one is not',
    dead[0]?.struck.includes('line-through') === true &&
      live[0]?.struck.includes('line-through') === false,
    `dead "${dead[0]?.struck}", live "${live[0]?.struck}"`,
  );
  await page.screenshot({ path: `${outDir}/key-truth-dead-binding.png` });
  console.log(`${outDir}/key-truth-dead-binding.png`);
}

await page.keyboard.press('Escape');
await settle(
  () => document.querySelector('[data-key-sheet]') === null,
  undefined,
  'the sheet closes before the key is pressed',
);

// AND THE KEYSTROKE ITSELF. The sheet says `icon` has `r`; if `r` opened a
// rename field instead, the sheet would be wrong in the new direction rather
// than the old one — which is why this is measured and not reasoned about.
await page.keyboard.press('r');
const reached = await settle(
  () => document.querySelector('[data-icon-picker]') !== null,
  undefined,
  '`r` invokes the action the sheet names as the winner',
);
if (reached) {
  const renaming = await page.evaluate(
    () => document.querySelector('[aria-label="rename session"]') !== null,
  );
  check(
    'and the shadowed action did not also run',
    renaming === false,
    'a rename field opened as well as the icon panel',
  );
}


// AND THE EDITOR, where the operator would go to fix it. The notice and the
// struck slot are asserted as PAINTED — a report that renders to a zero box,
// or scrolls off the panel it belongs to, is a report nobody reads.
await page.keyboard.press('Escape');
await page.keyboard.press(',');
const settingsOpen = await settle(
  () => document.querySelector('[data-settings-overlay]') !== null,
  undefined,
  'the settings overlay opens',
);
if (settingsOpen) {
  await page.locator('[data-settings-nav-item="keyboard"]').click();
  await settle(
    () => document.querySelector('[data-binding-clash]') !== null,
    undefined,
    'the keyboard section reports the contested key',
  );
  const editor = await page.evaluate(() => {
    const note = document.querySelector('[data-binding-clash]');
    const slot = document.querySelector('[data-binding-slot="rename:0"]');
    const noteBox = note?.getBoundingClientRect() ?? null;
    const panel = document.querySelector('[data-settings-scroll]');
    const panelBox = panel?.getBoundingClientRect() ?? null;
    return {
      text: note?.textContent ?? '',
      painted: noteBox !== null && noteBox.width > 0 && noteBox.height > 0,
      inView:
        noteBox !== null &&
        panelBox !== null &&
        noteBox.top >= panelBox.top - 1 &&
        noteBox.bottom <= panelBox.bottom + 1,
      slotLabel: slot?.getAttribute('aria-label') ?? '',
      slotStruck:
        slot === null ? '' : getComputedStyle(slot).textDecorationLine,
    };
  });
  console.log('settings over a contested map:', JSON.stringify(editor));
  check(
    'the notice names the key, the winner and the loser',
    editor.text.includes('"r"') && editor.text.includes('icon') && editor.text.includes('rename'),
    editor.text,
  );
  check('and it is painted', editor.painted && editor.inView, 'the notice has no visible box');
  check(
    'the dead slot says so in its accessible name, not only in ink',
    editor.slotLabel.includes('dead') && editor.slotLabel.includes('icon'),
    editor.slotLabel,
  );
  check(
    'and it is struck through on screen',
    editor.slotStruck.includes('line-through'),
    editor.slotStruck,
  );
  await page.screenshot({ path: `${outDir}/key-truth-dead-binding-editor.png` });
  console.log(`${outDir}/key-truth-dead-binding-editor.png`);
  // A second frame, scrolled to the row itself: the notice is at the top of
  // the section and the slot it is about is several groups down, and a shot
  // of one is not a shot of the other.
  await page.locator('[data-binding-slot="rename:0"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${outDir}/key-truth-dead-binding-slot.png` });
  console.log(`${outDir}/key-truth-dead-binding-slot.png`);
  await page.keyboard.press('Escape');
}


// AND THE REFUSAL ITSELF, driven the way an operator drives it. The map is
// the one F3's first two steps leave behind — `rename` moved to a free key,
// `icon` on the freed `r` — and the third step is the click that used to hand
// `r` to two actions in silence. A unit test can prove the write did not
// happen; only this can prove the control is reachable, the message lands on
// screen, and the row still shows the binding it refused to change.
await page.addInitScript(() => {
  window.localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({ keyBindings: { rename: ['b'], icon: ['r'] } }),
  );
});
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');
await page.keyboard.press(',');
const editorOpen = await settle(
  () => document.querySelector('[data-settings-overlay]') !== null,
  undefined,
  'the settings overlay opens for the refusal case',
);
if (editorOpen) {
  await page.locator('[data-settings-nav-item="keyboard"]').click();
  await settle(
    () => document.querySelector('[data-binding-reset="rename"]') !== null,
    undefined,
    'the moved binding offers a reset',
  );
  await page.locator('[data-binding-reset="rename"]').click();
  const refused = await settle(
    () => document.querySelector('[data-binding-message]') !== null,
    undefined,
    'the reset that would take `r` is refused out loud',
  );
  if (refused) {
    const said = await page.evaluate(() => {
      const note = document.querySelector('[data-binding-message]');
      const box = note?.getBoundingClientRect() ?? null;
      // WHERE IT IS, not merely that it exists. The reset control that
      // produced it can be far down a scrolling panel — clicking it scrolls
      // the row into view — and a refusal painted above the fold of that
      // panel is a refusal the operator never sees. Measured against the
      // scrollport, because only a real layout knows.
      const scroller = document.querySelector('[data-settings-scroll]');
      const view = scroller?.getBoundingClientRect() ?? null;
      // And what is actually PAINTED at the top of that scrollport: a bar
      // pinned there still fails if a row scrolling under it comes out on
      // top, and a scrollport's own padding is a strip a naive `top: 0`
      // leaves uncovered — measured, because both were true of the first
      // version of this bar.
      return {
        text: note?.textContent ?? '',
        painted: box !== null && box.width > 0 && box.height > 0,
        inView:
          box !== null && view !== null && box.top >= view.top - 1 && box.bottom <= view.bottom + 1,
        slot: document.querySelector('[data-binding-slot="rename:0"]')?.textContent ?? '',
        stillClaimed: document.querySelector('[data-binding-clash]') === null,
      };
    });
    console.log('refused reset:', JSON.stringify(said));
    check(
      'the refusal names the key and the action that owns it',
      said.text.includes('"r"') && said.text.includes('icon'),
      said.text,
    );
    check('and a way out of it', said.text.includes('reset shortcuts'), said.text);
    check('and it is painted', said.painted, 'the message has no visible box');
    check(
      'and it is on screen after the click that scrolled the panel',
      said.inView,
      'the refusal is outside the panel the operator is looking at',
    );
    await page.screenshot({ path: `${outDir}/key-truth-reset-refused.png` });
    console.log(`${outDir}/key-truth-reset-refused.png`);
    // AND IT IS OPAQUE — measured in pixels, because the two cheap ways to
    // ask are both vacuous. `elementFromPoint` answers about HIT TESTING and
    // returns a transparent element happily; reading `backgroundColor` back
    // off the class that set it proves only that somebody typed the rule.
    // So: photograph the pinned strip at two scroll offsets. The bar's own
    // content is identical in both and it does not move, so identical bytes
    // mean nothing behind it reached the screen — and a transparent bar
    // shows two different rows and two different images.
    const strip = await page.evaluate(() => {
      const note = document.querySelector('[data-binding-message]');
      const bar = note?.parentElement?.getBoundingClientRect() ?? null;
      return bar === null
        ? null
        : { x: bar.x + 8, y: bar.y + 1, width: Math.max(bar.width - 16, 1), height: bar.height - 2 };
    });
    const shotAt = async (top) => {
      await page.evaluate((y) => {
        const scroller = document.querySelector('[data-settings-scroll]');
        if (scroller !== null) scroller.scrollTop = y;
      }, top);
      await page.waitForTimeout(120);
      return page.screenshot({ clip: strip });
    };
    if (strip === null) {
      check('the pinned refusal can be photographed', false, 'no bar to measure');
    } else {
      const [low, high] = [await shotAt(240), await shotAt(420)];
      check(
        'and it is opaque — two scroll offsets photograph the same strip',
        low.equals(high),
        'the rows behind the pinned refusal reach the screen',
      );
    }
    check(
      'the row still shows the binding the reset did not change',
      said.slot.includes('b'),
      `the slot reads "${said.slot}"`,
    );
    check(
      'and no key ended up claimed twice',
      said.stillClaimed,
      'the refusal let the clash through anyway',
    );
  }
}

await browser.close();

if (failures.length > 0) {
  throw new Error(
    `${failures.length} key-truth guard(s) failed:\n  - ${failures.join('\n  - ')}`,
  );
}
console.log('\nkey-truth: every assertion passed.');
