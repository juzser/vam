/**
 * THE DIGIT ROW, AFTER Ctrl AND Cmd STOPPED MEANING THE SAME THING.
 *
 * The operator's report: "Ctrl+number seems to be conflicting between
 * switching function and switching tab. Cancel the Ctrl+number shortcuts; use
 * a three-key combo instead for switching function." Asked which of the two
 * consequences they wanted, they chose both narrowings: Cmd+number keeps
 * picking a session tab, and the view row moves to the three-key chord ALONE
 * -- no short `Alt+number` form beside it.
 *
 * So four rows, and each is asserted here as a RESOLVED ACTION for a
 * synthesised keydown rather than as a lookup in the table:
 *
 *   Cmd + digit          the session tab at that position   (unchanged act)
 *   Ctrl + digit         nothing                            (cancelled)
 *   Ctrl + Option + digit   the view in the focused pane     (moved here)
 *   Option + digit       nothing                            (cancelled)
 *
 * WHY THE WHOLE KEYSTROKE AND NOT THE TABLE. `chords.ts` folded Ctrl and Cmd
 * into one `Mod-` token, so before this change there was no way to write a
 * table entry that told `Ctrl+1` apart from `Cmd+1` -- they were the same
 * string. A test that asserted the table held `Mod-1` would therefore have
 * passed both before and after the fold was lifted, proving nothing about the
 * keystroke the operator actually presses. Every case below starts at
 * `normalizeKey` with the modifier flags a browser really reports.
 *
 * AND ON EVERY PLATFORM, which is the second thing the fold hid. vam ships
 * macOS, Linux and Windows (`electron-builder.config.cjs`) and there is no Cmd
 * key on two of them, so `mac` is passed EXPLICITLY on both sides of every
 * platform-sensitive assertion. Never left to ambient detection: CI runs on
 * ubuntu and this machine is a Mac, and a test that read the platform off its
 * host would assert a different grammar in each place while looking identical.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultBindings,
  EMPTY_CHORD,
  isApplePlatform,
  type KeyAction,
  type KeyEventLike,
  normalizeKey,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';

/** macOS, where Cmd is the command modifier and Control is its own key. */
const MAC = true;
/** Linux and Windows, where Control IS the command modifier. */
const PC = false;

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** One synthesised keydown, resolved the way the window listener resolves it. */
function press(
  event: KeyEventLike,
  mac: boolean,
): { readonly key: string | null; readonly action: KeyAction | null } {
  const key = normalizeKey(event, mac);
  return { key, action: key === null ? null : resolveChord(EMPTY_CHORD, key).action };
}

/** A US-layout digit keydown: the character the browser reports, and the
 *  PHYSICAL key beside it, which is what the binding is actually about. */
const digit = (n: number, modifiers: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: String(n),
  code: `Digit${n}`,
  ...modifiers,
});

describe('the digit row on macOS', () => {
  it('selects the session tab at that position under Cmd', () => {
    for (const n of DIGITS) {
      expect(press(digit(n, { metaKey: true }), MAC).action, `Cmd+${n}`).toEqual({
        kind: 'selectTab',
        digit: n,
      });
    }
  });

  it('answers a Ctrl+<digit> with NOTHING — the row the operator cancelled', () => {
    for (const n of DIGITS) {
      expect(press(digit(n, { ctrlKey: true }), MAC).action, `Ctrl+${n}`).toBeNull();
    }
    // And it is unbound rather than misrouted: the spelling it now normalizes
    // to is its own, so it can never answer the Cmd row's binding by accident.
    expect(press(digit(1, { ctrlKey: true }), MAC).key).toBe('Ctrl-1');
  });

  it('picks the view in the focused pane under Ctrl+Option', () => {
    for (const n of DIGITS) {
      expect(
        press(digit(n, { ctrlKey: true, altKey: true }), MAC).action,
        `Ctrl+Option+${n}`,
      ).toEqual({ kind: 'pickView', digit: n });
    }
  });

  it('answers a bare Option+<digit> with NOTHING — the view row moved off it', () => {
    // macOS Option+1 prints an inverted exclamation mark; the POSITION is
    // still Digit1, which is the only reason this can be asserted at all.
    for (const n of DIGITS) {
      expect(press(digit(n, { altKey: true }), MAC).action, `Option+${n}`).toBeNull();
    }
    expect(press({ key: '¡', code: 'Digit1', altKey: true }, MAC).key).toBe('Alt-1');
  });

  it('keeps Cmd+0 on the session list, at the head of the row it belongs to', () => {
    expect(press({ key: '0', code: 'Digit0', metaKey: true }, MAC).action).toEqual({
      kind: 'focusList',
    });
    expect(press({ key: '0', code: 'Digit0', ctrlKey: true }, MAC).action).toBeNull();
  });

  it('leaves Cmd+Shift+<digit> unbound, as it has always been', () => {
    // macOS claims Cmd+Shift+3/4/5 for screenshots before any window sees the
    // keydown, so nothing may live on that row. The Shift token is what stops
    // the shifted digit (`!`) from answering the unshifted binding.
    const shifted = press({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }, MAC);
    expect(shifted.key).toBe('Mod-Shift-1');
    expect(shifted.action).toBeNull();
  });
});

describe('the digit row where Control IS the command modifier', () => {
  it('selects the session tab under Ctrl, so Linux and Windows keep the row', () => {
    for (const n of DIGITS) {
      expect(press(digit(n, { ctrlKey: true }), PC).action, `Ctrl+${n}`).toEqual({
        kind: 'selectTab',
        digit: n,
      });
    }
  });

  it('picks the view under Ctrl+Alt — the same physical chord as on macOS', () => {
    for (const n of DIGITS) {
      expect(press(digit(n, { ctrlKey: true, altKey: true }), PC).action, `Ctrl+Alt+${n}`).toEqual({
        kind: 'pickView',
        digit: n,
      });
    }
  });

  it('answers a bare Alt+<digit> with nothing there either', () => {
    expect(press(digit(1, { altKey: true }), PC).action).toBeNull();
    expect(press(digit(9, { altKey: true }), PC).action).toBeNull();
  });

  it('lets the Super key reach the tab row too rather than spelling a bare digit', () => {
    // A digit that lost every modifier token would BE a bare digit, and a bare
    // digit is a real keystroke elsewhere (`z0`, the question card's option
    // marks). Super is the command modifier's other spelling here.
    const pressed = press(digit(3, { metaKey: true }), PC);
    expect(pressed.key).toBe('Mod-3');
    expect(pressed.action).toEqual({ kind: 'selectTab', digit: 3 });
  });
});

describe('the position is still the key, on every layout', () => {
  it('reads the tab row off event.code when the layout shifts the digits', () => {
    // AZERTY: the unshifted key at Digit1 reports `&`. Spelled by character
    // the binding would simply be dead there, which is how it was found.
    expect(press({ key: '&', code: 'Digit1', metaKey: true }, MAC).action).toEqual({
      kind: 'selectTab',
      digit: 1,
    });
  });

  it('reads the VIEW row off event.code too, which its modifier makes unavoidable', () => {
    // Option is macOS's compose key, so Ctrl+Option+1 can arrive carrying the
    // composed character rather than the digit. The position answers both.
    expect(press({ key: '¡', code: 'Digit1', ctrlKey: true, altKey: true }, MAC).action).toEqual({
      kind: 'pickView',
      digit: 1,
    });
    expect(press({ key: '&', code: 'Digit1', ctrlKey: true, altKey: true }, PC).action).toEqual({
      kind: 'pickView',
      digit: 1,
    });
  });

  it('still answers a hand-built event that reports no code at all', () => {
    expect(press({ key: '1', metaKey: true }, MAC).action).toEqual({ kind: 'selectTab', digit: 1 });
    expect(press({ key: '1', ctrlKey: true, altKey: true }, MAC).action).toEqual({
      kind: 'pickView',
      digit: 1,
    });
  });

  /**
   * A BARE DIGIT IS BOUND NOW, AND THIS CASE IS KEPT INVERTED RATHER THAN
   * DELETED, because the fact it was written about has not gone away.
   *
   * WHAT IT SAID: nothing answered a bare digit, so the question card could
   * have them for its option marks with no coordination at all.
   *
   * WHAT IS TRUE NOW: the operator asked for a one-key view switch "only in
   * Select mode", so a bare digit resolves to `pickView` — and the card keeps
   * its marks anyway, by two mechanisms that each suffice on their own. Its
   * listener sits BELOW the window listener and calls `preventDefault` on what
   * it handled, and the bare spelling stands down in Insert regardless
   * (`isSelectOnlyChord`). The mode is the load-bearing half and is measured
   * in `test/canvas/Canvas.select-digit-view.test.tsx`; what belongs HERE is
   * the spelling.
   */
  it('answers a bare digit as a POSITION, the same read the modified rows make', () => {
    expect(normalizeKey(digit(1), MAC)).toBe('1');
    expect(press(digit(1), MAC).action).toEqual({ kind: 'pickView', digit: 1 });
    // AZERTY again, one modifier down: the unshifted `Digit1` reports `&`, and
    // the binding is about the key's PLACE.
    expect(press({ key: '&', code: 'Digit1' }, MAC).action).toEqual({
      kind: 'pickView',
      digit: 1,
    });
  });
});

describe('what the unfold deliberately did NOT touch', () => {
  it('keeps the bracket pair folded, so Ctrl-[ still leaves the prompt box', () => {
    // vim's own way out of insert mode, and `docs/keyboard.md` promises it by
    // name.
    // Ctrl and Cmd still mean one intent here, which is the whole test for
    // whether a family should be folded.
    for (const mac of [MAC, PC]) {
      expect(normalizeKey({ key: '[', code: 'BracketLeft', ctrlKey: true }, mac)).toBe('Mod-[');
      expect(normalizeKey({ key: '[', code: 'BracketLeft', metaKey: true }, mac)).toBe('Mod-[');
    }
  });

  it('keeps both spellings of the tab ring and the pane ring', () => {
    for (const mac of [MAC, PC]) {
      for (const modifiers of [{ metaKey: true }, { ctrlKey: true }]) {
        expect(
          press({ key: '{', code: 'BracketLeft', shiftKey: true, ...modifiers }, mac).action,
        ).toEqual({ kind: 'stepTab', delta: -1 });
        expect(
          press({ key: '“', code: 'BracketLeft', altKey: true, ...modifiers }, mac).action,
        ).toEqual({ kind: 'stepSplit', delta: -1 });
      }
    }
  });

  it('leaves vim’s Ctrl-D and Ctrl-U reaching the transcript on macOS', () => {
    // The operator asked for these two by name, and kept them by name again on
    // PR 361 when every other Ctrl+letter went to the terminal: "keep them in
    // the Response view; drop them in the terminal". They are the whole of
    // `CTRL_GESTURES`, and `test/keyboard/ctrl-letters.test.ts` carries the
    // rest of that rule -- this assertion is here because the digit work must
    // not take them away as a side effect.
    for (const mac of [MAC, PC]) {
      expect(press({ key: 'd', code: 'KeyD', ctrlKey: true }, mac).action).toEqual({
        kind: 'scrollHalf',
        delta: 1,
      });
      expect(press({ key: 'd', code: 'KeyD', metaKey: true }, mac).action).toEqual({
        kind: 'scrollHalf',
        delta: 1,
      });
    }
  });
});

describe('which platform puts the command modifier on Cmd', () => {
  // The strings a real engine reports, so the branch that decides the whole
  // digit row is measured rather than assumed. This is the ONE place the
  // ambient detection is tested; every keystroke assertion above passes `mac`
  // itself, which is what keeps them saying the same thing on a Mac and on the
  // ubuntu runner.
  it.each([
    ['MacIntel', true],
    ['MacPPC', true],
    ['iPhone', true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true],
    ['Linux x86_64', false],
    ['Win32', false],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false],
    ['Mozilla/5.0 (X11; Linux x86_64)', false],
    ['', false],
  ])('reads %s as apple=%s', (description, apple) => {
    expect(isApplePlatform(description)).toBe(apple);
  });

  it('wires that answer into normalizeKey rather than computing it and ignoring it', () => {
    // THE ONE ASSERTION ABOUT THE AMBIENT DEFAULT, and it is written so that it
    // says the same thing wherever it runs: the expectation is DERIVED from the
    // same predicate the module derives its own default from, so a Mac and the
    // ubuntu runner each check their own answer rather than one checking the
    // other's. What it catches is a default that stopped asking — hardcoded
    // `true`, or a detector computed and then not used — which is a wire nobody
    // would notice was cut, because every other test in this file passes the
    // flag itself.
    const apple = isApplePlatform(
      globalThis.navigator?.platform ?? globalThis.navigator?.userAgent ?? '',
    );
    const ambient = normalizeKey(digit(1, { ctrlKey: true }));
    expect(ambient).toBe(normalizeKey(digit(1, { ctrlKey: true }), apple));
    expect(ambient).toBe(apple ? 'Ctrl-1' : 'Mod-1');
  });
});

describe('the two cancelled rows are unbound, not re-homed', () => {
  it('gives no action a Ctrl-<digit> or an Alt-<digit>, over the GENERATED bindings', () => {
    const bindings = defaultBindings();
    // The corpus first: every assertion below is vacuous over an empty
    // grammar, which is how a sweep goes green having examined nothing.
    expect(bindings.length).toBeGreaterThan(40);
    const held = new Set(
      bindings.flatMap((binding) => binding.chords.map((chord) => `${chord.prefix}${chord.key}`)),
    );
    for (const n of [0, ...DIGITS]) {
      expect([...held], `Ctrl-${n} is bound`).not.toContain(`Ctrl-${n}`);
      expect([...held], `Alt-${n} is bound`).not.toContain(`Alt-${n}`);
    }
    // And the two rows that ARE bound, read off the same generated list.
    for (const n of DIGITS) {
      expect([...held]).toContain(`Mod-${n}`);
      expect([...held]).toContain(`Ctrl-Alt-${n}`);
    }
  });
});

/**
 * A SEPARATE REPORT, MEASURED HERE AND DELIBERATELY NOT CLOSED.
 *
 * Another agent traced an operator complaint that `Cmd+Shift+S` no longer
 * saves and does nothing. The claim about this layer holds and is pinned
 * below: `normalizeKey` gives a modified LETTER its Shift as a token, so the
 * keystroke spells `Mod-Shift-s`, and no table in this grammar binds it.
 *
 * NOTHING IS BOUND TO IT HERE. `Mod-s` already saves (`files-tree.ts`'s
 * `EDITOR_KEYS`, not this grammar), so a second save chord is a decision about
 * whether vam wants one -- not a gap to be filled by whoever noticed it. The
 * test records the state so that binding it later is a deliberate act that
 * reddens this line, rather than a silent one.
 */
describe('Cmd+Shift+S reaches nothing in this grammar', () => {
  it('spells it apart from Mod-s and resolves it to no action', () => {
    const pressed = press({ key: 'S', code: 'KeyS', metaKey: true, shiftKey: true }, MAC);
    expect(pressed.key).toBe('Mod-Shift-s');
    expect(pressed.action).toBeNull();
    // Not a normalisation bug: the unshifted chord is a different string, and
    // this grammar binds neither (the editor's own handler reads `Mod-s`).
    expect(normalizeKey({ key: 's', code: 'KeyS', metaKey: true }, MAC)).toBe('Mod-s');
  });
});
