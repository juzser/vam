/**
 * THE KEYS TELL THE TRUTH: what a chord claims, and what a dead key says.
 *
 * Two audit findings, measured in a real browser because both of them are
 * about a keystroke arriving somewhere jsdom cannot put it:
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

await browser.close();

if (failures.length > 0) {
  throw new Error(
    `${failures.length} key-truth guard(s) failed:\n  - ${failures.join('\n  - ')}`,
  );
}
console.log('\nkey-truth: every assertion passed.');
