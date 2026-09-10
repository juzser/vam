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
 * WHY THE BINDING IS SPELLED `Mod-p` AND NOT `Mod-Shift-p`, measured rather
 * than assumed.
 *
 * `normalizeKey` folds Shift away for CHARACTERS — "Shift deliberately gets
 * no token *for characters*", and under a modifier the letter is lower-cased
 * "so Cmd-K and Cmd-Shift-K do not become two different bindings for one
 * gesture" (`chords.ts`; `test/keyboard/normalize.test.ts` pins both). The
 * `Shift-` token exists only for the POSITIONAL keys — the digit row and the
 * bracket pair — where a modifier changes which character arrives.
 *
 * So a real `Cmd+Shift+P` keydown normalizes to `Mod-p`, and a table entry
 * written `Mod-Shift-p` would be a string no keystroke on any layout can
 * produce: a DEAD binding printed in the key sheet, which is the one defect
 * `keysheet.ts` exists to make impossible. `bindingClashes` would not catch
 * it either — it finds two actions on one chord, not a chord with no
 * keystroke behind it. The first assertion below is what makes that spelling
 * a test failure rather than a silent dead row.
 *
 * ITS PRICE, QUOTED: `Cmd+P` reaches the same action, because it is the same
 * folded gesture. Nothing native answers it in the desktop app — vam owns its
 * application menu and it is appMenu/editMenu/Window, none of which carries a
 * Cmd+P (`src/main/menu.ts`) — and in the browser build the handler's own
 * `preventDefault` keeps it away from print. Both spellings landing on one
 * action is exactly what the folding rule is FOR; the alternative was giving
 * one gesture two spellings, which is the failure that rule was written
 * against.
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

  it('is spelled `Mod-p`, because a modified letter folds its Shift away', () => {
    // The spelling itself, so a table entry written `Mod-Shift-p` — a string
    // no keystroke produces — reddens here rather than shipping as a dead
    // row in the key sheet.
    expect(normalizeKey(CMD_SHIFT_P)).toBe('Mod-p');
    expect(normalizeKey(CTRL_SHIFT_P)).toBe('Mod-p');
    expect(normalizeKey(CMD_P)).toBe('Mod-p');
    // And therefore Cmd+P is the same act. Asserted rather than left to be
    // discovered: it is the price of the folding rule, and pinning it means a
    // later attempt to separate the two cannot pass unnoticed.
    expect(actionFor(CMD_P)).toEqual({ kind: 'newProject' });
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
    const row = rows.find((each) => each.keys === 'Mod-p');
    expect(row, 'no sheet row for Mod-p').toBeDefined();
    // The caption names the ACT — a directory chosen, a session started —
    // rather than repeating a chord or borrowing `newSession`'s sentence.
    expect(row?.label).toMatch(/directory/i);
    expect(row?.label).toMatch(/project/i);
    // And it is live: a row the sheet marks dead is a key that does nothing.
    expect(row?.dead).toBeNull();
  });

  it('does not read as a second spelling of `o` / `Mod-n`', () => {
    const rows = sheetRows();
    const newProject = rows.find((each) => each.keys === 'Mod-p');
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
    // onto `Mod-p` and the whole-map check must name the newcomer as the one
    // left advertising a dead key. If `newProject` were invisible to
    // `bindingClashes`, this would come back empty.
    const contested = bindKey(NO_BINDINGS, 'revealProject', 0, 'Mod-p');
    expect(newClashes(NO_BINDINGS, contested)).toEqual([
      { chord: 'Mod-p', winner: 'revealProject', shadowed: ['newProject'] },
    ]);
  });
});
