/**
 * `Ctrl-D` / `Ctrl-U` — HALF A SCREEN, THE WAY VIM SPELLS IT.
 *
 * The operator asked for the two keys by name. This file holds the GRAMMAR's
 * half: that a real keydown reaches the action, that nothing shipped loses a
 * key to it, that the generated sheet can name it — and the one fact this
 * binding has that no other binding in the table has, which is that it STANDS
 * DOWN wherever the keyboard is inside something being typed into.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `Cmd+D` AND `Ctrl+D` ARE ONE CHORD HERE, AND THAT IS ACCEPTED, NOT MISSED.
 *
 * `normalizeKey` computes `const mod = event.ctrlKey === true || event.metaKey
 * === true` — Ctrl and Cmd fold into one `Mod-` token, deliberately and for
 * every binding in the table ("vam runs on one machine at a time, both
 * spellings mean the same intent"). So `Mod-d` is `Cmd+D` as well, the same
 * way `Mod-p` is `Cmd+P` as well as the `Cmd+Shift+P` the operator asked for.
 * The operator was told. Splitting the two would be a change to the grammar's
 * spelling rules touching every binding in it, not a change to this one.
 *
 * It is asserted below rather than left to be discovered, so that a later
 * attempt to give the two modifiers separate meanings reddens here.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything here goes through `normalizeKey` + `resolveChord` and the
 * GENERATED sheet, never against the table literal — a test that reads the
 * line of source it was written beside cannot fail.
 */

import { describe, expect, it } from 'vitest';
import {
  bindingClashes,
  bindKey,
  defaultBindings,
  EMPTY_CHORD,
  isSelectOnly,
  type KeyAction,
  type KeyEventLike,
  NO_BINDINGS,
  newClashes,
  normalizeKey,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';

/** A real `Ctrl+D` keydown — the chord the operator named, and a shell's EOF. */
const CTRL_D: KeyEventLike = { key: 'd', code: 'KeyD', ctrlKey: true };
const CTRL_U: KeyEventLike = { key: 'u', code: 'KeyU', ctrlKey: true };
/** The same gestures on the other modifier, which fold to the same chord. */
const CMD_D: KeyEventLike = { key: 'd', code: 'KeyD', metaKey: true };
const CMD_U: KeyEventLike = { key: 'u', code: 'KeyU', metaKey: true };

/** The whole path a keystroke takes: normalized, then resolved. */
function actionFor(event: KeyEventLike): KeyAction | null {
  const key = normalizeKey(event);
  return key === null ? null : resolveChord(EMPTY_CHORD, key).action;
}

const sheetRows = () => buildKeySheet().flatMap((group) => group.rows);
const rowFor = (keys: string, mode: 'select' | 'insert') =>
  sheetRows().find((row) => row.keys === keys && row.mode === mode);

describe('Ctrl-D and Ctrl-U scroll half a screen', () => {
  it('reaches the scroll action from a real keydown, in both directions', () => {
    expect(actionFor(CTRL_D)).toEqual({ kind: 'scrollHalf', delta: 1 });
    expect(actionFor(CTRL_U)).toEqual({ kind: 'scrollHalf', delta: -1 });
  });

  it('answers Cmd+D and Cmd+U identically — one folded chord, quoted as the cost', () => {
    expect(normalizeKey(CTRL_D)).toBe('Mod-d');
    expect(normalizeKey(CMD_D)).toBe('Mod-d');
    expect(actionFor(CMD_D)).toEqual({ kind: 'scrollHalf', delta: 1 });
    expect(actionFor(CMD_U)).toEqual({ kind: 'scrollHalf', delta: -1 });
  });

  it('leaves bare `d` and `u` free, because a modified letter has its own spelling', () => {
    expect(resolveChord(EMPTY_CHORD, 'd').action).toBeNull();
    expect(resolveChord(EMPTY_CHORD, 'u').action).toBeNull();
  });

  it('does not disturb the two directions `j` and `k` already walk', () => {
    // The session list, one row at a time — a different act, and the one an
    // operator would otherwise expect these to duplicate.
    expect(resolveChord(EMPTY_CHORD, 'j').action).toEqual({ kind: 'move', direction: 'down' });
    expect(resolveChord(EMPTY_CHORD, 'k').action).toEqual({ kind: 'move', direction: 'up' });
  });
});

/**
 * THE ONE RULE THIS BINDING ADDS TO THE GRAMMAR.
 *
 * Every other `Mod-` chord is deliberately reachable from inside the prompt
 * box: "a Cmd/Ctrl chord is never text entry — no layout produces a character
 * from one". That premise is about CHARACTERS, and these two keys are the
 * place it stops being the whole story: inside a macOS text field `Ctrl-D` is
 * delete-forward and `Ctrl-U` is delete-to-line-start — editing commands, not
 * characters — and in a terminal `Ctrl-D` is EOF. Taking them globally would
 * break editing in the composer to add a scroll gesture.
 */
describe('they belong to Select alone', () => {
  it('says so in the grammar, where the binding is declared', () => {
    expect(isSelectOnly({ kind: 'scrollHalf', delta: 1 })).toBe(true);
    expect(isSelectOnly({ kind: 'scrollHalf', delta: -1 })).toBe(true);
  });

  it('and claims no other binding — the tab chords must still fire from the prompt box', () => {
    // The reason the typing guard lets modified keys through at all. If this
    // predicate ever widened to swallow them, the operator's own request —
    // "look at another tab from inside the box I am typing in" — would go
    // dead with nothing else to catch it.
    expect(isSelectOnly({ kind: 'selectTab', digit: 3 })).toBe(false);
    expect(isSelectOnly({ kind: 'stepTab', delta: 1 })).toBe(false);
    expect(isSelectOnly({ kind: 'newTab' })).toBe(false);
    expect(isSelectOnly({ kind: 'palette' })).toBe(false);
    expect(isSelectOnly({ kind: 'close' })).toBe(false);
    // The whole shipped grammar, counted: exactly the two halves of this one
    // action stand down in Insert, so a kind added to the set later has to be
    // argued for here rather than slipped in.
    const standDown = defaultBindings()
      .map((binding) => binding.action)
      .filter(isSelectOnly);
    expect(standDown).toEqual([{ kind: 'scrollHalf', delta: 1 }, { kind: 'scrollHalf', delta: -1 }]);
  });
});

describe('the generated key sheet names both, and names the scope', () => {
  it('gives each direction a row that says which way it goes', () => {
    const rows = sheetRows();
    // The corpus first: every assertion below is vacuous over an empty sheet.
    expect(rows.length).toBeGreaterThan(30);
    const down = rowFor('Mod-d', 'select');
    const up = rowFor('Mod-u', 'select');
    expect(down, 'no Select sheet row for Mod-d').toBeDefined();
    expect(up, 'no Select sheet row for Mod-u').toBeDefined();
    expect(down?.label).toMatch(/half/i);
    expect(down?.label).toMatch(/down/i);
    expect(up?.label).toMatch(/half/i);
    expect(up?.label).toMatch(/up/i);
    expect(down?.label).not.toBe(up?.label);
    // And they are live: a row the sheet marks dead is a key that does nothing.
    expect(down?.dead).toBeNull();
    expect(up?.dead).toBeNull();
  });

  it('and prints an Insert row that promises no scroll at all', () => {
    // The sheet's contract is that it names nothing the key does not do. In
    // Insert these keys are not vam's, and a single undifferentiated caption
    // would be the half-right kind the `hjkl` audit was about.
    const insert = rowFor('Mod-d', 'insert');
    expect(insert, 'no Insert sheet row for Mod-d').toBeDefined();
    expect(insert?.label).not.toMatch(/half a screen/i);
    expect(insert?.label).toMatch(/typ/i);
  });
});

describe('nothing shipped loses a key to them', () => {
  it('leaves the shipped map with no contested chord at all', () => {
    // The corpus, again: `bindingClashes` over an empty grammar is [] for the
    // wrong reason.
    expect(defaultBindings().length).toBeGreaterThan(30);
    expect(bindingClashes(NO_BINDINGS)).toEqual([]);
  });

  it('and the clash machinery sees the newcomers when something takes their key', () => {
    // Falsifies the guard above rather than trusting it: move `palette` onto
    // `Mod-d` and the whole-map check must name the newcomer as the one left
    // advertising a dead key.
    const contested = bindKey(NO_BINDINGS, 'palette', 0, 'Mod-d');
    expect(newClashes(NO_BINDINGS, contested)).toEqual([
      { chord: 'Mod-d', winner: 'palette', shadowed: ['scrollHalf:1'] },
    ]);
  });
});
