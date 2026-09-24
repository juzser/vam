/**
 * A BARE DIGIT PICKS A VIEW — in Select, and only there.
 *
 * The operator asked for it by name: "in Select mode, is there a shortcut to
 * switch between the function tabs of the focused session faster? For example
 * a number, or Shift+number? Only in Select mode." `Ctrl+Option+<digit>` is
 * three keys for something done constantly, so the same action gains a second,
 * one-key spelling rather than moving — a view is still switchable from inside
 * the prompt box, which is what the three-key chord is for.
 *
 * WHAT THIS FILE IS ABOUT, rather than what it repeats. `pick-view-binding
 * .test.ts` already proves the view row is a real binding the sheet can find;
 * everything here is about the properties the BARE spelling has and its
 * chord cousin does not:
 *
 *   - it is spelled by POSITION (`event.code`), like every other digit binding
 *     in this grammar, so one key sheet is true on every layout;
 *   - Shift+digit is a DIFFERENT keystroke and is bound to nothing, which is
 *     the other half of the operator's own question answered;
 *   - it stands down wherever a caret is, because a digit is text to every
 *     text surface and the question card's own option mark besides;
 *   - `0` stays out of it, and `z0` keeps working.
 *
 * Everything below asserts the RESOLVED action for a synthesised event or a
 * row of the GENERATED sheet. Reading back the literal that was just written
 * into a table would prove only that the file was saved.
 */

import { describe, expect, it } from 'vitest';
import {
  bindKey,
  defaultBindings,
  EMPTY_CHORD,
  isSelectOnlyChord,
  type KeyEventLike,
  NO_BINDINGS,
  normalizeKey,
  parseChord,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
import { resolveQuestionKey } from '../../src/renderer/keyboard/question-keys.js';
import { primaryChord, shortcutLines } from '../../src/renderer/keyboard/ShortcutTip.js';
import { TABS } from '../../src/renderer/panels/tabs.js';

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** A keydown for a PHYSICAL digit-row key, with whatever character the
 *  layout puts on it. The two are separate arguments because that separation
 *  is the whole property being measured. */
const press = (character: string, digit: number, extra: Partial<KeyEventLike> = {}) =>
  normalizeKey({ key: character, code: `Digit${digit}`, ...extra }, false);

const actionFor = (key: string | null) => resolveChord(EMPTY_CHORD, key ?? '').action;

describe('a bare digit resolves to the view it names', () => {
  it('answers all nine, so the refusal past the last view is reachable from here too', () => {
    for (const digit of DIGITS) {
      expect(actionFor(press(String(digit), digit)), `bare ${digit} is unbound`).toEqual({
        kind: 'pickView',
        digit,
      });
    }
  });

  it('is the SAME action the three-key chord answers — one act, two spellings', () => {
    for (const digit of DIGITS) {
      expect(actionFor(press(String(digit), digit))).toEqual(
        actionFor(
          normalizeKey(
            { key: String(digit), code: `Digit${digit}`, ctrlKey: true, altKey: true },
            false,
          ),
        ),
      );
    }
  });

  it('leaves Ctrl+Option+<digit> working, on both platforms', () => {
    for (const mac of [true, false]) {
      for (const digit of DIGITS) {
        const key = normalizeKey(
          { key: '&', code: `Digit${digit}`, ctrlKey: true, altKey: true },
          mac,
        );
        expect(key).toBe(`Ctrl-Alt-${digit}`);
        expect(actionFor(key)).toEqual({ kind: 'pickView', digit });
      }
    }
  });
});

describe('it is a POSITION, not a character — the rule `chords.ts` already keeps', () => {
  /**
   * The argument is `normalizeKey`'s own and is not restated here: a modifier
   * changes the character a digit key produces, so a binding written as a
   * character is dead on any layout whose digit row is shifted. AZERTY puts
   * `&` on the unshifted `Digit1`; the binding is about the KEY'S PLACE.
   */
  it('lands on view 1 from an AZERTY `&`, which a character-spelled binding could not', () => {
    expect(press('&', 1)).toBe('1');
    expect(actionFor(press('&', 1))).toEqual({ kind: 'pickView', digit: 1 });
    expect(actionFor(press('é', 2))).toEqual({ kind: 'pickView', digit: 2 });
  });

  /**
   * SHIFT+DIGIT IS THE OPERATOR'S OTHER SUGGESTION, AND IT IS DECLINED — in
   * the code as well as in prose. Shift alters a digit, so `Shift+1` arrives
   * as `!` on a US layout and as `1` on AZERTY: a spelling that is a different
   * character on every layout and unrenderable in a key sheet as a position.
   * Under the positional read it is spelled `Shift-1`, a distinct keystroke,
   * and nothing is bound to it.
   */
  it('spells Shift+digit apart, and binds it to nothing', () => {
    expect(press('!', 1, { shiftKey: true })).toBe('Shift-1');
    expect(actionFor(press('!', 1, { shiftKey: true }))).toBeNull();
    // The AZERTY half of the same keystroke: the character IS a digit there,
    // and it must still not answer the unshifted binding.
    expect(press('1', 1, { shiftKey: true })).toBe('Shift-1');
    expect(actionFor(press('1', 1, { shiftKey: true }))).toBeNull();
  });

  it('keeps every hand-built key-only event resolving as it always did', () => {
    // Every `KeyEventLike` in this repo's own tests is built from a `key`
    // alone; `positionKey`'s fallback is what keeps them meaning what they
    // meant, and a numpad digit with NumLock on arrives the same way.
    expect(normalizeKey({ key: '4' }, false)).toBe('4');
    expect(actionFor(normalizeKey({ key: '4' }, false))).toEqual({ kind: 'pickView', digit: 4 });
  });
});

describe('zero is not claimed', () => {
  it('leaves a bare 0 unbound', () => {
    expect(actionFor(press('0', 0))).toBeNull();
  });

  it('keeps z0, which is the chord the zero already belonged to', () => {
    const after = resolveChord(EMPTY_CHORD, 'z');
    expect(after.state.pending).toBe('z');
    expect(resolveChord(after.state, press('0', 0) ?? '').action).toEqual({ kind: 'resetPanes' });
  });
});

describe('a bare digit stands down wherever a caret is', () => {
  it('names the bare digit row and nothing else', () => {
    for (const digit of DIGITS) {
      expect(isSelectOnlyChord({ prefix: '', key: String(digit) })).toBe(true);
    }
    expect(isSelectOnlyChord({ prefix: '', key: '0' })).toBe(true);
    // The chord spelling is deliberately NOT select-only: switching a view
    // from inside the prompt box is what the three-key chord is for.
    expect(isSelectOnlyChord(parseChord('Ctrl-Alt-1'))).toBe(false);
    expect(isSelectOnlyChord(parseChord('Mod-1'))).toBe(false);
    // `z0` is two keystrokes behind a prefix, not a digit under a caret.
    expect(isSelectOnlyChord({ prefix: 'z', key: '0' })).toBe(false);
    expect(isSelectOnlyChord({ prefix: '', key: 'x' })).toBe(false);
  });

  it('leaves the question card its own option marks, which are bare digits too', () => {
    // The card resolves BEFORE this grammar (it calls `preventDefault` on what
    // it handled), and it reads the same normalized spelling — so the
    // positional read reaches it as well, which is a fix for AZERTY there.
    expect(resolveQuestionKey(press('&', 1))).toEqual({ kind: 'mark', at: 0 });
    expect(resolveQuestionKey(press('!', 1, { shiftKey: true }))).toBeNull();
  });
});

describe('the generated key sheet gains the row, and lies about neither spelling', () => {
  const rows = () => buildKeySheet().flatMap((group) => group.rows);

  it('prints a bare-digit row for every digit, tagged as Select only', () => {
    const all = rows();
    // The corpus first: every assertion below is vacuous over an empty sheet.
    expect(all.length).toBeGreaterThan(30);
    for (const digit of DIGITS) {
      const row = all.find((each) => each.keys === String(digit));
      expect(row, `no sheet row for a bare ${digit}`).toBeDefined();
      expect(row?.mode, `the bare ${digit} row does not say which mode it is true in`).toBe(
        'select',
      );
      expect(row?.label).toContain('Select');
    }
  });

  it('captions each bare digit with the view it names, or with the refusal', () => {
    const all = rows();
    for (const [index, name] of TABS.entries()) {
      expect(all.find((each) => each.keys === String(index + 1))?.label).toContain(name);
    }
    expect(all.find((each) => each.keys === '6')?.label).toContain('no view 6');
  });

  it('keeps the three-key chord captioned, and does NOT tag it Select', () => {
    const all = rows();
    for (const digit of DIGITS) {
      const row = all.find((each) => each.keys === `Ctrl-Alt-${digit}`);
      expect(row, `Ctrl-Alt-${digit} left the sheet`).toBeDefined();
      // It works in both modes and must not be captioned as one — the whole
      // reason the bare row carries a mode and this one does not.
      expect(row?.mode).toBeNull();
      expect(row?.label).not.toContain('Select ·');
    }
  });

  it('prints no bare `0` row, because nothing is bound there', () => {
    expect(rows().some((row) => row.keys === '0')).toBe(false);
  });

  it('leads with the spelling that is true in both modes', () => {
    // The inline chip and a tooltip's first line print ONE chord; it must be
    // the one an operator can press wherever the keyboard is.
    expect(primaryChord({ kind: 'pickView', digit: 3 })).toBe('Ctrl-Alt-3');
  });
});

/**
 * THE VIEW ICON'S TOOLTIP IS THE THIRD READER OF THIS TABLE, and it joined the
 * sheet in being able to lie the moment `pickView` grew a second spelling: it
 * prints every chord an action holds, and undifferentiated that reads
 * "Ctrl-Alt-1 or 1" — one of which does nothing under the caret the operator
 * may well have.
 */
describe('the tooltip splits the two spellings rather than joining them', () => {
  const RESPONSE = { kind: 'pickView', digit: 1 } as const;

  /**
   * THE PLATFORM IS PASSED, NEVER READ. `shortcutLines` prints what the
   * operator will press — ⌃⌥1 on a Mac, Ctrl+Alt+1 off one — and its default
   * is this machine, so a case that omitted the flag would assert a different
   * string on ubuntu than on the operator's Mac while looking identical in
   * both. `chords.ts` says exactly that about `normalizeKey`'s own flag.
   */
  it('prints the chord plainly and the bare digit as Select’s', () => {
    for (const [mac, chord] of [
      [true, '⌃⌥1'],
      [false, 'Ctrl+Alt+1'],
    ] as const) {
      expect(shortcutLines(RESPONSE, undefined, NO_BINDINGS, mac)).toEqual([
        { caption: null, keys: chord },
        { caption: 'Select · the Response view, in the focused pane', keys: '1' },
      ]);
    }
  });

  it('drops the bare digit entirely for a caller that knows it is in Insert', () => {
    expect(shortcutLines(RESPONSE, 'insert', NO_BINDINGS, true)).toEqual([
      { caption: null, keys: '⌃⌥1' },
    ]);
    expect(shortcutLines(RESPONSE, 'insert', NO_BINDINGS, false)).toEqual([
      { caption: null, keys: 'Ctrl+Alt+1' },
    ]);
  });

  it('leaves every other action’s tip exactly as it was', () => {
    // `close` holds two chords and neither is Select-only, so it must still be
    // one joined line — the shape this change must not spread to.
    expect(shortcutLines({ kind: 'close' }, undefined, NO_BINDINGS, true)).toEqual([
      { caption: null, keys: 'x or ⌘W' },
    ]);
    expect(shortcutLines({ kind: 'close' }, undefined, NO_BINDINGS, false)).toEqual([
      { caption: null, keys: 'x or Ctrl+W' },
    ]);
  });
});

describe('what the second spelling had to leave true', () => {
  it('takes no chord another action already holds', () => {
    const seen = new Map<string, string>();
    for (const binding of defaultBindings()) {
      for (const chord of binding.chords) {
        const written = `${chord.prefix}${chord.key}`;
        const owner = seen.get(written);
        expect(owner, `${written} is bound to both ${owner} and ${binding.id}`).toBeUndefined();
        seen.set(written, binding.id);
      }
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it('is rebindable in its own slot, and the bare digit stops working when it moves', () => {
    const overrides = bindKey({}, 'pickView:1', 1, 'q');
    expect(resolveChord(EMPTY_CHORD, 'q', overrides).action).toEqual({
      kind: 'pickView',
      digit: 1,
    });
    expect(resolveChord(EMPTY_CHORD, '1', overrides).action).toBeNull();
    // And the chord in slot 0 is untouched by a write to slot 1.
    expect(resolveChord(EMPTY_CHORD, 'Ctrl-Alt-1', overrides).action).toEqual({
      kind: 'pickView',
      digit: 1,
    });
  });
});
