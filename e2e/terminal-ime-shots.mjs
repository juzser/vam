/**
 * TYPING VIETNAMESE INTO THE TERMINAL TAB, WITH A REAL INPUT METHOD.
 *
 * THE REPORT was "terminal đang không support utf-8 nên viết tiếng Việt bị
 * lỗi?" and the guess was the encoding. It is not: `capture-pane`'s stdout is
 * decoded at Node's default `utf8` and the send path hands `execFile` an argv
 * ARRAY, which Node encodes as UTF-8. It is COMPOSITION -- Telex types
 * `tieengs` to get `tiếng`, and the pane sent all seven letters plus the Enter
 * that commits the syllable.
 *
 * WHY THIS FILE EXISTS BESIDE `test/panels/TerminalTab.ime.test.tsx`. That one
 * proves the handlers do the right thing with the events it hands them; it
 * cannot prove those are the events a browser produces, because happy-dom
 * implements no input method at all -- its `CompositionEvent` does not even
 * carry `data` (measured: `new CompositionEvent('compositionend', { data })`
 * yields `data: undefined` there). Everything below is driven through CDP
 * `Input.imeSetComposition` in the engine vam actually ships, so what is
 * measured here is Chromium's own answer:
 *
 *   1. THE COMMIT KEY REALLY CARRIES `isComposing`. A keydown dispatched with
 *      a composition live arrives as `{ key: 'Enter', isComposing: true }`,
 *      and the pane must send nothing for it -- while an identical Enter with
 *      nothing composing must still be a Return. A guard that only proved the
 *      first half would pass with the pane made mute.
 *   2. `compositionend` REALLY DELIVERS THE SYLLABLE, and it reaches the send
 *      channel as one `text` keystroke rather than as the letters it was
 *      built from.
 *   3. THE HIDDEN BOX REALLY TAKES THE KEYBOARD, which is `document
 *      .activeElement` as Chromium answers it and the status bar's own mode
 *      chip reading Insert off that -- not a mark on some JSX.
 *   4. TAB REALLY LEAVES, FORWARDS AND BACKWARDS. The pane's accessible name
 *      promises it, and a container that is itself a tab stop would hand
 *      Shift+Tab straight back into the box it just left. Only real
 *      sequential focus navigation can tell.
 *   5. THE SCROLLING KEYS REALLY SCROLL. A focused text control eats
 *      PageUp/PageDown/Home/End before any scroll container sees them, so the
 *      pane does it itself now; `scrollTop` after a real keypress is the only
 *      thing that can say whether that works.
 *   6. A DRAG REALLY SELECTS THE SCREEN. Focusing a text control collapses the
 *      document selection, so the box must not take the keyboard mid-gesture
 *      -- mouse selection is the only way to copy text out of this tab.
 *   7. FOCUSING THE BOX DOES NOT MOVE SOMEBODY'S TERMINAL. The box is
 *      absolutely positioned inside the scrolling region, so a plain `.focus()`
 *      scrolls the pane to it; `preventScroll` is what stops the screen
 *      jumping under the operator on every click.
 *
 * THE BRIDGE IS A STUB, injected with `page.addInitScript`, exactly as
 * `files-tab-keyboard-shots.mjs` does and for the same reason recorded there:
 * merely DEFINING `window.api` takes `App.tsx` off the `?demo=1` fixture and
 * onto `createSourceFromPreload(api)`, so the stub has to be a complete
 * `PreloadSourceApi` or the page reddens before a single check runs. Every
 * send it is asked to make is recorded in the page and read back here.
 *
 * WHAT THIS STILL CANNOT PROVE, said plainly: no real input method is
 * installed in this Chromium. `Input.imeSetComposition` drives the composition
 * pipeline that a macOS Vietnamese keyboard drives, and the events are the
 * engine's own -- but which keystrokes a Telex layout turns into which
 * candidate is the OS's business and is not measured anywhere in this repo.
 *
 * Falsify it by hand, each alone:
 *   - spell the guard `event.isComposing` instead of
 *     `event.nativeEvent.isComposing` in `TerminalTab.tsx` -> case 1 reddens.
 *   - delete the `onCompositionEnd` send -> case 2 reddens.
 *   - drop `insertStopMark` from the pane onto the hidden box -> case 3's
 *     insert-stop check reddens.
 *   - give the pane `tabIndex={0}` again -> case 4's Shift+Tab reddens.
 *   - drop `preventScroll` -> case 7 reddens.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-ime-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'crosscheck-2';
/** The syllable, and the letters a Telex layout builds it from. */
const SYLLABLE = 'tiếng';

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
 * A complete `PreloadSourceApi` stub plus `terminal`, whose `send` records
 * what it was asked rather than answering a fiction: the checks below are
 * about WHICH keystrokes leave the renderer, so the recording IS the subject.
 * The screen is two hundred numbered lines so that there is something to
 * scroll, and `cursor` is `unreadable` because this stub never asked tmux.
 */
await page.addInitScript(() => {
  const SCREEN = Array.from({ length: 200 }, (_, i) => `line ${i} of the pane's screen`).join('\n');
  globalThis.window.__sent = [];
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
        terminal: true,
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
            decisions: [
              { id: 'd1', label: 'step 1', input: 'a turn', output: 'an answer', commands: [] },
            ],
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
    terminal: {
      read: async () => ({
        kind: 'ok',
        name: 'vam-stub-a1b2c3',
        text: SCREEN,
        cursor: { kind: 'unreadable' },
      }),
      resize: async () => true,
      send: async (_projectId, key) => {
        globalThis.window.__sent.push(key);
        return 'sent';
      },
      answer: async () => ({ kind: 'unavailable' }),
      prompt: async () => ({ kind: 'unavailable' }),
    },
  };
});

await page.goto(origin, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.locator('[data-view="terminal"]').click();
await page.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
// `attached`, not `visible`: the box is `sr-only`, which is the whole point of
// it -- one clipped pixel that takes the keyboard and draws nothing.
await page.waitForSelector('[data-terminal-input]', { state: 'attached', timeout: 5_000 });

const cdp = await page.context().newCDPSession(page);

/** Everything the renderer has asked the bridge to type, and reset. */
const sent = () =>
  page.evaluate(() => {
    const list = globalThis.window.__sent;
    globalThis.window.__sent = [];
    return list;
  });
/** Where Chromium says the keyboard is, and what the status bar claims. */
const keyboardAt = () =>
  page.evaluate(() => {
    const active = document.activeElement;
    const pane = document.querySelector('[data-terminal-pane]');
    return {
      tag: active?.tagName ?? null,
      isBox: active instanceof HTMLElement && active.hasAttribute('data-terminal-input'),
      inPane: active instanceof HTMLElement && pane !== null && pane.contains(active),
      mode: document.querySelector('[data-mode]')?.textContent ?? '',
    };
  });
const paneScroll = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-terminal-pane]');
    return { top: pane?.scrollTop ?? -1, height: pane?.scrollHeight ?? -1 };
  });
const keyDown = (key, code, keyCode) =>
  cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: code ?? `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: keyCode ?? key.toUpperCase().charCodeAt(0),
    nativeVirtualKeyCode: keyCode ?? key.toUpperCase().charCodeAt(0),
  });

// ---------------------------------------------------------------------------
// 3. THE HIDDEN BOX REALLY TAKES THE KEYBOARD.
//
// First, because everything after it is about what happens to keys that go
// there. `mode` is read off the status bar, which derives it from
// `document.activeElement`'s own ancestry -- the most direct proof there is
// that the insert scope on the PANE covers the box Chromium focused.

const arrived = await keyboardAt();
console.log('on arrival:', JSON.stringify(arrived));
check(
  'the tab hands the keyboard to a real editable box, which is what an IME needs',
  arrived.isBox && arrived.tag === 'TEXTAREA',
  `activeElement is <${arrived.tag}>`,
);
check('and it is inside the pane, so the keys still belong to this session', arrived.inPane);
check('and the bar still reads Insert, because the scope is on the pane', arrived.mode === 'Insert');

const stops = await page.evaluate(() => {
  const pane = document.querySelector('[data-terminal-pane]');
  const found = [...document.querySelectorAll('[data-insert-stop]')];
  return {
    count: found.length,
    firstIsPane: found[0] === pane,
    boxIsStop: document.querySelector('[data-terminal-input]')?.hasAttribute('data-insert-stop'),
    paneTabIndex: pane?.getAttribute('tabindex') ?? null,
  };
});
console.log('insert stops:', JSON.stringify(stops));
check(
  'the pane is still the one insert stop, and the box is not one',
  stops.count === 1 && stops.firstIsPane && stops.boxIsStop === false,
  JSON.stringify(stops),
);

// ---------------------------------------------------------------------------
// 1 + 2. A REAL COMPOSITION.
//
// The discriminating half comes first: with NOTHING composing, an Enter is a
// Return. Without this, a pane made permanently mute would pass every
// composition check below.

await sent();
await keyDown('Enter', 'Enter', 13);
await page.waitForTimeout(150);
const plainEnter = await sent();
check(
  'an Enter with nothing composing is still a Return into the agent',
  plainEnter.length === 1 && plainEnter[0]?.kind === 'enter',
  JSON.stringify(plainEnter),
);

// Now the same key, with a candidate in flight.
await cdp.send('Input.imeSetComposition', { text: 'ti', selectionStart: 2, selectionEnd: 2 });
await cdp.send('Input.imeSetComposition', {
  text: 'tieeng',
  selectionStart: 6,
  selectionEnd: 6,
});
await page.waitForTimeout(100);
const drawn = await page.evaluate(
  () => document.querySelector('[data-terminal-composing]')?.textContent ?? null,
);
check(
  'the in-flight candidate is drawn, because the box holding it cannot be seen',
  drawn !== null && drawn.includes('tieeng'),
  `the pane drew ${JSON.stringify(drawn)}`,
);

await keyDown('n');
await keyDown('Enter', 'Enter', 13);
await page.waitForTimeout(150);
const whileComposing = await sent();
check(
  'no keystroke of a live composition reaches the agent — not a letter, not the commit',
  whileComposing.length === 0,
  `the pane sent ${JSON.stringify(whileComposing)}`,
);

await cdp.send('Input.insertText', { text: SYLLABLE });
await page.waitForTimeout(200);
const committed = await sent();
check(
  'the committed syllable reaches the agent whole, as text',
  committed.length === 1 && committed[0]?.kind === 'text' && committed[0]?.text === SYLLABLE,
  `the pane sent ${JSON.stringify(committed)}`,
);
check(
  'and the candidate stops being drawn once it has been sent',
  (await page.evaluate(() => document.querySelector('[data-terminal-composing]'))) === null,
);
check(
  'and the box is empty again, holding no value of its own',
  (await page.evaluate(() => document.querySelector('[data-terminal-input]')?.value)) === '',
);

// The pane is typable again the moment the composition is over.
await keyDown('x');
await page.waitForTimeout(150);
const after = await sent();
check(
  'a plain keystroke after the syllable is typed as it always was',
  after.length === 1 && after[0]?.kind === 'text' && after[0]?.text === 'x',
  JSON.stringify(after),
);

await page.screenshot({ path: `${outDir}/terminal-ime.png` });

// ---------------------------------------------------------------------------
// 5. THE SCROLLING KEYS REALLY SCROLL.

await page.evaluate(() => {
  document.querySelector('[data-terminal-pane]').scrollTop = 0;
});
await sent();
await keyDown('PageDown', 'PageDown', 34);
await page.waitForTimeout(150);
const paged = await paneScroll();
check(
  'PageDown scrolls the pane, which a focused text control would otherwise eat',
  paged.top > 0,
  `scrollTop is ${paged.top} of ${paged.height}`,
);
await keyDown('End', 'End', 35);
await page.waitForTimeout(150);
const ended = await paneScroll();
check('End reaches the bottom of the screen', ended.top > paged.top, JSON.stringify(ended));
await keyDown('Home', 'Home', 36);
await page.waitForTimeout(150);
check('Home comes back to the top', (await paneScroll()).top === 0);
await keyDown('ArrowDown', 'ArrowDown', 40);
await page.waitForTimeout(150);
const arrowed = await paneScroll();
check('ArrowDown moves it by a row', arrowed.top > 0, JSON.stringify(arrowed));
check(
  'and none of the six is typed into the agent',
  (await sent()).length === 0,
  'a scroll key was sent to tmux',
);

// ---------------------------------------------------------------------------
// 7. FOCUSING THE BOX DOES NOT MOVE SOMEBODY'S TERMINAL.
//
// The box is absolutely positioned at the top of the pane's content, so a
// bare `.focus()` scrolls the pane to it -- measured, and it jumped the screen
// to the top on every click. `preventScroll` is what stops that.

await page.evaluate(() => {
  document.activeElement.blur();
  document.querySelector('[data-terminal-pane]').scrollTop = 400;
});
const paneBox = await page.locator('[data-terminal-pane]').boundingBox();
await page.mouse.click(paneBox.x + paneBox.width - 30, paneBox.y + paneBox.height - 14);
await page.waitForTimeout(200);
const afterClick = await paneScroll();
check(
  'a click hands the keyboard to the box without scrolling the screen away',
  afterClick.top === 400 && (await keyboardAt()).isBox,
  `scrollTop went from 400 to ${afterClick.top}`,
);

// ---------------------------------------------------------------------------
// 6. A DRAG REALLY SELECTS THE SCREEN.

await page.evaluate(() => {
  globalThis.getSelection().removeAllRanges();
});
await page.mouse.move(paneBox.x + 20, paneBox.y + 20);
await page.mouse.down();
await page.mouse.move(paneBox.x + 300, paneBox.y + 60, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(150);
const selected = await page.evaluate(() => String(globalThis.getSelection()));
check(
  'dragging across the screen still selects it — the box does not eat the gesture',
  selected.trim() !== '',
  'the selection came back empty, which is what focusing a text control mid-drag does',
);
const duringCopy = await keyboardAt();
check(
  'and the keyboard stays on the pane while there is something selected to copy',
  duringCopy.inPane && !duringCopy.isBox,
  JSON.stringify(duringCopy),
);
await sent();
await keyDown('h');
await page.waitForTimeout(150);
const resumed = await keyboardAt();
check(
  'typing ends the copy gesture and gives the box the keyboard back',
  resumed.isBox,
  JSON.stringify(resumed),
);
check(
  'and that keystroke was still delivered',
  (await sent()).length === 1,
  'the key that ended the copy gesture was swallowed',
);

// ---------------------------------------------------------------------------
// 6b. A DRAG THAT ENDS OUTSIDE THE PANE STILL ENDS.
//
// THE DEFECT THIS EXISTS FOR, found in review of the first cut of this pane.
// The suppression that protects the drag above is a boolean set on
// `pointerdown`, and it was cleared by an `onPointerUp` ON THE PANE -- so only
// a release OVER the pane cleared it. Dragging out past the edge to reach the
// last line is the ordinary way anyone selects the bottom of a terminal, and
// that release never reached the pane at all: the flag stayed set for the life
// of the component, every later focus forward returned early, the box never
// took the keyboard again, and Vietnamese went back to leaking `tieengs` into
// the agent one raw keystroke at a time. It self-healed on the SECOND
// keystroke, which is what made it invisible by hand.
//
// ONLY A REAL BROWSER CAN SHOW IT. The fix is `setPointerCapture`, and what
// capture promises -- that the release is retargeted to the capturing element
// wherever the pointer physically goes up -- is exactly what happy-dom stubs
// out. So the mouse really leaves the pane here, and what is checked after it
// is the HARM rather than the mechanism: a focus that arrives with no pointer
// release over the pane (which is what `I` is) must still reach the box, and a
// composition after it must still land.

await page.evaluate(() => {
  globalThis.getSelection().removeAllRanges();
});
// UPWARD, OUT OF THE TOP. Measured: the pane runs to within 8px of the bottom
// of an 1100x800 viewport, so a point below it is off-screen -- `mouse.move`
// cannot reach it and `elementFromPoint` answers `null` there, which would
// make this case pass while never leaving the pane at all. Dragging back
// through the scrollback is the natural gesture anyway.
const release = { x: paneBox.x + 200, y: paneBox.y - 20 };
await page.mouse.move(paneBox.x + 60, paneBox.y + 80);
await page.mouse.down();
await page.mouse.move(paneBox.x + 320, paneBox.y + 30, { steps: 8 });
await page.mouse.move(release.x, release.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
const escaped = await page.evaluate((at) => {
  const pane = document.querySelector('[data-terminal-pane]');
  const under = document.elementFromPoint(at.x, at.y);
  // NOT `!pane.contains(under)` alone: `elementFromPoint` answers `null` for a
  // point outside the viewport, and a null would then read as "escaped" for a
  // drag that never moved. The element has to BE something, and something else.
  return { tag: under?.tagName ?? null, outside: under !== null && !pane.contains(under) };
}, release);
check(
  'the release really did land outside the pane, or this case proves nothing',
  escaped.outside,
  `the point under the release is ${JSON.stringify(escaped)} — the coordinates need moving`,
);

await page.evaluate(() => {
  document.activeElement.blur();
  globalThis.getSelection().removeAllRanges();
  // The focus `I` performs: `focusInsertStop` calls this on the pane and
  // touches no pointer, so nothing about it can clear a stuck suppression.
  document.querySelector('[data-terminal-pane]').focus();
});
await page.waitForTimeout(150);
const afterEscape = await keyboardAt();
check(
  'a gesture released outside the pane still ends it, so the keyboard comes back to the box',
  afterEscape.isBox,
  `the keyboard is stuck on <${afterEscape.tag}> — the suppression was never cleared`,
);

await sent();
await cdp.send('Input.imeSetComposition', { text: 'ti', selectionStart: 2, selectionEnd: 2 });
await cdp.send('Input.insertText', { text: SYLLABLE });
await page.waitForTimeout(250);
const afterEscapeSent = await sent();
check(
  'and Vietnamese still composes after it, which is the harm this guards',
  afterEscapeSent.length === 1 && afterEscapeSent[0]?.text === SYLLABLE,
  `the pane sent ${JSON.stringify(afterEscapeSent)}`,
);

// ---------------------------------------------------------------------------
// 4. TAB REALLY LEAVES, FORWARDS AND BACKWARDS.

await keyDown('Tab', 'Tab', 9);
await page.waitForTimeout(150);
const left = await keyboardAt();
check('Tab leaves the pane, which is the exit its own name promises', !left.inPane, left.tag);

await cdp.send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Tab',
  code: 'Tab',
  windowsVirtualKeyCode: 9,
  nativeVirtualKeyCode: 9,
  modifiers: 8,
});
await page.waitForTimeout(150);
const back = await keyboardAt();
check('Shift+Tab comes back into it, landing on the box', back.isBox, JSON.stringify(back));

await cdp.send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Tab',
  code: 'Tab',
  windowsVirtualKeyCode: 9,
  nativeVirtualKeyCode: 9,
  modifiers: 8,
});
await page.waitForTimeout(150);
const out = await keyboardAt();
check(
  'and Shift+Tab out again really leaves — a pane that was its own tab stop would hand it back',
  !out.inPane,
  `the keyboard is still on <${out.tag}>, which is the focus trap this shape exists to avoid`,
);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll terminal IME checks passed.');
