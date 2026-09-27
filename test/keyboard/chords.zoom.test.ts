/**
 * UI ZOOM GETS THREE KEYS — #281's reversal (`main/zoom.ts`'s own header
 * carries the whole story). `Mod-0` already answers `focusList`, so zoom
 * cannot have it back; `Mod-=` and `Mod-+` both zoom in (the unshifted and
 * shifted spellings of the same physical key — the same "browsers bind
 * both" convention every OS already ships), `Mod--` zooms out. No reset
 * chord: `Mod-Shift-0` is impossible on macOS (`normalizeKey`'s own header:
 * "NOTHING IS BOUND UNDER Mod-Shift-<digit>… macOS captures Cmd+Shift+3/4/5
 * for screenshots"), and the Settings row's own reset button is the nearer
 * way back to 100%.
 */

import { describe, expect, it } from 'vitest';
import {
  bindingClashes,
  bindKey,
  defaultBindings,
  EMPTY_CHORD,
  type KeyAction,
  type KeyEventLike,
  NO_BINDINGS,
  newClashes,
  normalizeKey,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';

/** `Mod-=`: the unshifted physical key, Cmd held. */
const CMD_EQUAL: KeyEventLike = { key: '=', code: 'Equal', metaKey: true };
/** `Mod-+`: the SAME physical key with Shift held — the browser hands back
 *  `+` as `event.key` already, so this is a genuinely different string. */
const CMD_SHIFT_EQUAL: KeyEventLike = { key: '+', code: 'Equal', metaKey: true, shiftKey: true };
/** `Mod--`. */
const CMD_MINUS: KeyEventLike = { key: '-', code: 'Minus', metaKey: true };
/** The same three gestures off macOS, where `Mod` is Control. */
const CTRL_EQUAL: KeyEventLike = { key: '=', code: 'Equal', ctrlKey: true };
const CTRL_MINUS: KeyEventLike = { key: '-', code: 'Minus', ctrlKey: true };

function actionFor(event: KeyEventLike, mac = true): KeyAction | null {
  const key = normalizeKey(event, mac);
  return key === null ? null : resolveChord(EMPTY_CHORD, key).action;
}

const sheetRows = () => buildKeySheet().flatMap((group) => group.rows);

describe('zoom in: Mod-= and Mod-+', () => {
  it('both reach { kind: "zoom", delta: 1 }, on every platform’s modifier', () => {
    expect(actionFor(CMD_EQUAL)).toEqual({ kind: 'zoom', delta: 1 });
    expect(actionFor(CMD_SHIFT_EQUAL)).toEqual({ kind: 'zoom', delta: 1 });
    expect(actionFor(CTRL_EQUAL, false)).toEqual({ kind: 'zoom', delta: 1 });
  });

  it('are spelled two different strings, not one binding answering twice by accident', () => {
    expect(normalizeKey(CMD_EQUAL, true)).toBe('Mod-=');
    expect(normalizeKey(CMD_SHIFT_EQUAL, true)).toBe('Mod-+');
  });
});

describe('zoom out: Mod--', () => {
  it('reaches { kind: "zoom", delta: -1 }', () => {
    expect(actionFor(CMD_MINUS)).toEqual({ kind: 'zoom', delta: -1 });
    expect(actionFor(CTRL_MINUS, false)).toEqual({ kind: 'zoom', delta: -1 });
    expect(normalizeKey(CMD_MINUS, true)).toBe('Mod--');
  });
});

describe('Mod-0 still answers focusList, untouched by this reversal', () => {
  it('is not a zoom reset — the setting has no chord for that', () => {
    const zero: KeyEventLike = { key: '0', code: 'Digit0', metaKey: true };
    expect(actionFor(zero)).toEqual({ kind: 'focusList' });
  });
});

describe('the generated key sheet names all three', () => {
  it('gives each a row with a caption naming zoom', () => {
    const rows = sheetRows();
    expect(rows.length).toBeGreaterThan(30);
    for (const keys of ['Mod-=', 'Mod-+', 'Mod--']) {
      const row = rows.find((each) => each.keys === keys);
      expect(row, `no sheet row for ${keys}`).toBeDefined();
      expect(row?.label.toLowerCase()).toMatch(/zoom/);
      expect(row?.dead).toBeNull();
    }
  });
});

describe('nothing shipped loses a key to it', () => {
  it('leaves the shipped map with no contested chord at all', () => {
    expect(defaultBindings().length).toBeGreaterThan(30);
    expect(bindingClashes(NO_BINDINGS)).toEqual([]);
  });

  it('and the clash machinery would see the new bindings if something else took them', () => {
    // `zoom:1`, NOT bare `zoom` -- `actionId` gives zoom in and zoom out
    // DIFFERENT ids (the same `resizePane`/`stepTab`/`scrollHalf` rule,
    // `chords.ts`'s own comment on `stepTab` names the exact bug a shared id
    // would reintroduce: both deltas silently merging into whichever one the
    // table saw first).
    const contested = bindKey(NO_BINDINGS, 'focusList', 0, 'Mod-=');
    expect(newClashes(NO_BINDINGS, contested)).toEqual([
      { chord: 'Mod-=', winner: 'focusList', shadowed: ['zoom:1'] },
    ]);
  });
});
