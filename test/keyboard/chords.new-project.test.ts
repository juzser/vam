/**
 * NEW PROJECT GETS A KEY — the operator asked for `Cmd+Shift+P`.
 *
 * The act already existed and was reachable only by the Projects header's
 * `+`: choose a directory, start a session in it (`newProject` in
 * `Canvas.tsx`). This file holds the GRAMMAR's half — that a real keydown
 * reaches the action, that nothing already shipped loses a key to it, and
 * that the generated sheet can name it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE BINDING IS SPELLED `Mod-Shift-p`, AND WHY IT WAS NOT.
 *
 * It shipped as `Mod-p`, and this paragraph used to argue at length that
 * `Mod-Shift-p` was a string NO KEYSTROKE COULD PRODUCE: `normalizeKey`
 * lower-cased a letter under a modifier "so Cmd-K and Cmd-Shift-K do not
 * become two different bindings for one gesture", so a real `Cmd+Shift+P`
 * arrived spelled `Mod-p` and a table entry with the token would have been a
 * dead row in the key sheet. That was true of the grammar as it stood, and it
 * quoted its own price: `Cmd+P` reached the same act, because it was the same
 * folded gesture.
 *
 * THE GRAMMAR CHANGED UNDER IT, for a reason `Cmd+Shift+P` could never have
 * produced on its own. The operator asked for `Cmd+Shift+H` — "so it does not
 * collide with the OS shortcut" — and Cmd+H IS an OS shortcut: macOS's Hide,
 * claimed by `role: 'appMenu'` before the page sees the keydown. Under the
 * fold there was no way to SAY Cmd+Shift+H: it normalized to `Mod-h`, the
 * gesture macOS had already taken. So the token now covers letters as well as
 * positions, the base stays lower-cased, and `shiftKey` — not the case the
 * browser hands back, which CapsLock also changes — is what carries it.
 *
 * Which makes this spelling the one the operator always asked for, and gives
 * `Cmd+P` back to the browser's print dialog.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything here is asserted through `normalizeKey` + `resolveChord` and the
 * GENERATED sheet, never against the table literal — a test that reads the
 * line of source it was written beside cannot fail.
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

/** A real macOS `Cmd+Shift+P` keydown: Shift has already upper-cased the key. */
const CMD_SHIFT_P: KeyEventLike = { key: 'P', code: 'KeyP', metaKey: true, shiftKey: true };
/** The same gesture on the platform CI runs, where `Mod` is Ctrl. */
const CTRL_SHIFT_P: KeyEventLike = { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true };
/** And without Shift — the same binding, which is the cost this file quotes. */
const CMD_P: KeyEventLike = { key: 'p', code: 'KeyP', metaKey: true };

/** The whole path a keystroke takes: normalized, then resolved. */
function actionFor(event: KeyEventLike): KeyAction | null {
  const key = normalizeKey(event);
  return key === null ? null : resolveChord(EMPTY_CHORD, key).action;
}

const sheetRows = () => buildKeySheet().flatMap((group) => group.rows);

describe('Cmd+Shift+P starts a new project', () => {
  it('reaches the new-project action from a real keydown, on either modifier', () => {
    expect(actionFor(CMD_SHIFT_P)).toEqual({ kind: 'newProject' });
    expect(actionFor(CTRL_SHIFT_P)).toEqual({ kind: 'newProject' });
  });

  it('is spelled `Mod-Shift-p`, which is now a string a keystroke produces', () => {
    // THE SPELLING ITSELF, and it is the assertion that used to say the
    // opposite. A row in the key sheet naming a chord no keydown can make is
    // the one defect `keysheet.ts` exists to prevent, and `bindingClashes`
    // cannot catch it — it finds two actions on one chord, not a chord with
    // nothing behind it.
    expect(normalizeKey(CMD_SHIFT_P)).toBe('Mod-Shift-p');
    expect(normalizeKey(CTRL_SHIFT_P)).toBe('Mod-Shift-p');
    // And Cmd+P is a DIFFERENT gesture again, bound to nothing. Pinned, so
    // that a later fold cannot quietly hand vam the browser's print key back.
    expect(normalizeKey(CMD_P)).toBe('Mod-p');
    expect(actionFor(CMD_P)).toBeNull();
  });

  it('leaves bare `p` alone — it still reveals the focused session’s project', () => {
    expect(resolveChord(EMPTY_CHORD, 'p').action).toEqual({ kind: 'revealProject' });
  });

  it('is a DIFFERENT action from `gt`/`gT`, which step between projects', () => {
    // The names must not be confusable and neither must the behaviours: `gt`
    // moves the cursor to a project that already exists, this one creates the
    // conditions for a new one. Read through the chord, not the table.
    expect(resolveChord({ pending: 'g' }, 't').action).toEqual({ kind: 'project', delta: 1 });
    expect(resolveChord({ pending: 'g' }, 'T').action).toEqual({ kind: 'project', delta: -1 });
    expect(actionFor(CMD_SHIFT_P)).not.toEqual({ kind: 'project', delta: 1 });
  });
});

describe('the generated key sheet names it', () => {
  it('gives `Mod-p` a row with a caption of its own', () => {
    const rows = sheetRows();
    // The corpus first: every assertion below is vacuous over an empty sheet.
    expect(rows.length).toBeGreaterThan(30);
    const row = rows.find((each) => each.keys === 'Mod-Shift-p');
    expect(row, 'no sheet row for Mod-Shift-p').toBeDefined();
    // The caption names the ACT — a directory chosen, a session started —
    // rather than repeating a chord or borrowing `newSession`'s sentence.
    expect(row?.label).toMatch(/directory/i);
    expect(row?.label).toMatch(/project/i);
    // And it is live: a row the sheet marks dead is a key that does nothing.
    expect(row?.dead).toBeNull();
  });

  it('does not read as a second spelling of `o` / `Mod-n`', () => {
    const rows = sheetRows();
    const newProject = rows.find((each) => each.keys === 'Mod-Shift-p');
    const newSession = rows.find((each) => each.keys === 'o');
    expect(newSession, 'no sheet row for o').toBeDefined();
    expect(newProject?.label).not.toBe(newSession?.label);
  });
});

describe('nothing shipped loses a key to it', () => {
  it('leaves the shipped map with no contested chord at all', () => {
    // The corpus, again: `bindingClashes` over an empty grammar is [] for the
    // wrong reason.
    expect(defaultBindings().length).toBeGreaterThan(30);
    expect(bindingClashes(NO_BINDINGS)).toEqual([]);
  });

  it('and PR #297’s machinery sees the new binding when something takes it', () => {
    // Falsifies the guard above rather than trusting it: move `revealProject`
    // onto `Mod-Shift-p` and the whole-map check must name the newcomer as the one
    // left advertising a dead key. If `newProject` were invisible to
    // `bindingClashes`, this would come back empty.
    const contested = bindKey(NO_BINDINGS, 'revealProject', 0, 'Mod-Shift-p');
    expect(newClashes(NO_BINDINGS, contested)).toEqual([
      { chord: 'Mod-Shift-p', winner: 'revealProject', shadowed: ['newProject'] },
    ]);
  });
});
