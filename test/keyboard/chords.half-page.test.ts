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
 * `Cmd+D` AND `Ctrl+D` ARE ONE CHORD HERE — AND THESE TWO LETTERS ARE NOW THE
 * ONLY ONES IN THE GRAMMAR OF WHICH THAT IS TRUE.
 *
 * IT WAS THE RULE AND IT BECAME THE EXCEPTION, which is why this paragraph is
 * worth reading before changing anything below. `normalizeKey` used to fold
 * Ctrl and Cmd into one `Mod-` token for every binding in the table ("vam runs
 * on one machine at a time, both spellings mean the same intent"), so this
 * pair's Cmd alias was a side effect quoted as a cost.
 *
 * The operator ended that fold on PR 361 — "Ctrl + a letter applies only to
 * the terminal, like the default terminal shortcuts" — because four of vam's
 * eight letter chords are readline's own. Asked about these two specifically,
 * they kept them: "keep them in the Response view; drop them in the terminal."
 * So the pair is `CTRL_GESTURES` in `chords.ts`, a two-letter list, and the
 * Cmd alias is now DELIBERATE rather than inherited: `Mod-d` is the command
 * modifier like every other chord, and Control on top of that is the vim
 * spelling the operator asked for by name.
 *
 * Both halves are asserted below rather than left to be discovered, so that
 * removing either spelling reddens here.
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
import { buildBindingSheet, buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';

/** A real `Ctrl+D` keydown — the chord the operator named, and a shell's EOF. */
const CTRL_D: KeyEventLike = { key: 'd', code: 'KeyD', ctrlKey: true };
const CTRL_U: KeyEventLike = { key: 'u', code: 'KeyU', ctrlKey: true };
/** The same gestures on the other modifier, which fold to the same chord. */
const CMD_D: KeyEventLike = { key: 'd', code: 'KeyD', metaKey: true };
const CMD_U: KeyEventLike = { key: 'u', code: 'KeyU', metaKey: true };

/** The whole path a keystroke takes: normalized, then resolved. */
function actionFor(event: KeyEventLike, mac = true): KeyAction | null {
  const key = normalizeKey(event, mac);
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

  it('answers Cmd+D and Cmd+U identically — the two-letter exception, on purpose', () => {
    // THE FLAG IS PASSED, on the macOS side especially: this is the one pair
    // whose Ctrl spelling survived PR 361, so an ambient read would prove
    // nothing about the platform the exception was written for.
    for (const mac of [true, false]) {
      expect(normalizeKey(CTRL_D, mac)).toBe('Mod-d');
      expect(normalizeKey(CMD_D, mac)).toBe('Mod-d');
      expect(actionFor(CMD_D, mac)).toEqual({ kind: 'scrollHalf', delta: 1 });
      expect(actionFor(CMD_U, mac)).toEqual({ kind: 'scrollHalf', delta: -1 });
      expect(actionFor(CTRL_U, mac)).toEqual({ kind: 'scrollHalf', delta: -1 });
    }
  });

  it('is an exception of exactly two, and the other six commands left Ctrl', () => {
    // THE OTHER SIDE OF THE SAME DECISION, asserted here because this file is
    // where a future reader will come to ask why `d` and `u` are special. On
    // macOS the six application commands answer the command modifier alone;
    // `test/keyboard/ctrl-letters.test.ts` carries the full argument and the
    // Linux/Windows half.
    for (const key of ['k', 'n', 't', 'w']) {
      expect(normalizeKey({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true }, true)).toBe(
        `Ctrl-${key}`,
      );
    }
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
    expect(standDown).toEqual([
      { kind: 'scrollHalf', delta: 1 },
      { kind: 'scrollHalf', delta: -1 },
    ]);
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

  /**
   * BOTH SPELLINGS, PRINTED WHERE THEY ARE FOUND OUT. `Mod-` is the platform's
   * command modifier for every other letter in the grammar, and this is the one
   * family that also answers Control — so the row means more than its
   * neighbours do and nothing in the sheet's layout can show that. The caption
   * is the whole disclosure, in both directions: an operator who asked for
   * vim's `Ctrl-D` must not be left guessing whether it survived, and one
   * reaching for `Cmd+D` (bookmark, in the browser build) must not be
   * surprised by it.
   *
   * Asserted over the GENERATED rows, both in the sheet's own captions and in
   * the plain label the settings editor shows, so it cannot fall out of one
   * of the two and stay in the other.
   */
  it('names both spellings, because Mod-d is Ctrl+D and Cmd+D alike', () => {
    for (const [keys, pattern] of [
      ['Mod-d', /ctrl\+d/i],
      ['Mod-d', /cmd\+d/i],
      ['Mod-u', /ctrl\+u/i],
      ['Mod-u', /cmd\+u/i],
    ] as const) {
      expect(rowFor(keys, 'select')?.label, keys).toMatch(pattern);
    }
    const editorRows = buildBindingSheet().flatMap((group) => group.rows);
    expect(editorRows.length).toBeGreaterThan(30);
    expect(editorRows.find((row) => row.id === 'scrollHalf:1')?.label).toMatch(/cmd\+d/i);
    expect(editorRows.find((row) => row.id === 'scrollHalf:1')?.label).toMatch(/ctrl\+d/i);
    expect(editorRows.find((row) => row.id === 'scrollHalf:-1')?.label).toMatch(/cmd\+u/i);
    expect(editorRows.find((row) => row.id === 'scrollHalf:-1')?.label).toMatch(/ctrl\+u/i);
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
