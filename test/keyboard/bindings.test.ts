/**
 * Editable bindings, at the level the grammar itself lives on.
 *
 * The property the sheet has always had — it names only what is bound — has to
 * survive the operator being allowed to change what is bound. So every
 * assertion here goes through `effectiveBindings`/`resolveChord`/`buildKeySheet`
 * with an override map, never through a hand-written expectation of what the
 * override "should" have produced.
 */

import { describe, expect, it } from 'vitest';
import {
  actionId,
  bindingConflict,
  bindKey,
  clearBindings,
  defaultBindings,
  EMPTY_CHORD,
  effectiveBindings,
  isReserved,
  type KeyBindings,
  MAX_BINDINGS,
  NO_BINDINGS,
  RESERVED_KEYS,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';

const chordsOf = (bindings: KeyBindings, id: string) =>
  effectiveBindings(bindings)
    .find((b) => b.id === id)
    ?.chords.map((c) => `${c.prefix}${c.key}`) ?? [];

const sheetKeys = (bindings: KeyBindings) =>
  buildKeySheet(bindings).flatMap((group) => group.rows.map((row) => row.keys));

describe('the default catalogue', () => {
  it('walks a real corpus and gives every action a stable id', () => {
    const bindings = defaultBindings();
    expect(bindings.length).toBeGreaterThan(20);
    const ids = bindings.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of bindings) {
      expect(actionId(b.action)).toBe(b.id);
      expect(b.chords.length).toBeGreaterThan(0);
    }
  });

  it('distinguishes the parameterised actions instead of collapsing them', () => {
    const ids = defaultBindings().map((b) => b.id);
    expect(ids).toContain('move:left');
    expect(ids).toContain('move:right');
    expect(ids).toContain('sessionAt:0');
  });

  it('folds an action bound twice by default into one entry with two chords', () => {
    // `x` and `Mod-w` are one action, and the editor must show them as the two
    // slots they are rather than as two unrelated rows.
    expect(chordsOf(NO_BINDINGS, 'close')).toEqual(['x', 'Mod-w']);
  });
});

describe('an override is what is in force', () => {
  it('fires the operator’s key and no longer the default it replaced', () => {
    const bindings = bindKey(NO_BINDINGS, 'rename', 0, 'p');
    expect(resolveChord(EMPTY_CHORD, 'p', bindings).action).toEqual({ kind: 'rename' });
    expect(resolveChord(EMPTY_CHORD, 'r', bindings).action).toBeNull();
  });

  it('keeps a second binding on the same action working', () => {
    const bindings = bindKey(bindKey(NO_BINDINGS, 'rename', 0, 'p'), 'rename', 1, 'u');
    expect(chordsOf(bindings, 'rename')).toEqual(['p', 'u']);
    expect(resolveChord(EMPTY_CHORD, 'p', bindings).action).toEqual({ kind: 'rename' });
    expect(resolveChord(EMPTY_CHORD, 'u', bindings).action).toEqual({ kind: 'rename' });
  });

  it('never grows past two bindings for one action', () => {
    let bindings = NO_BINDINGS;
    for (const key of ['p', 'u', 'q']) {
      bindings = bindKey(bindings, 'rename', MAX_BINDINGS - 1, key);
    }
    expect(chordsOf(bindings, 'rename').length).toBeLessThanOrEqual(MAX_BINDINGS);
  });

  it('preserves the untouched half of a two-key default, chord included', () => {
    // `gg` cannot be typed into a capture box, so editing the OTHER slot must
    // not be the thing that silently unbinds it.
    const bindings = bindKey(NO_BINDINGS, 'close', 1, 'q');
    expect(chordsOf(bindings, 'close')).toEqual(['x', 'q']);
    expect(resolveChord(EMPTY_CHORD, 'x', bindings).action).toEqual({ kind: 'close' });
  });

  it('leaves every other action alone', () => {
    const bindings = bindKey(NO_BINDINGS, 'rename', 0, 'p');
    expect(resolveChord(EMPTY_CHORD, 'i', bindings).action).toEqual({ kind: 'prompt' });
    expect(resolveChord({ pending: 'g' }, 'g', bindings).action).toEqual({ kind: 'first' });
  });

  it('reads back the shipped grammar when nothing is overridden', () => {
    expect(resolveChord(EMPTY_CHORD, 'r', NO_BINDINGS).action).toEqual({ kind: 'rename' });
    expect(resolveChord(EMPTY_CHORD, 'Escape', NO_BINDINGS).action).toEqual({ kind: 'cancel' });
  });
});

describe('conflicts are refused, and named', () => {
  it('reports the action a key already belongs to', () => {
    expect(bindingConflict(NO_BINDINGS, 'rename', 'i')).toBe('prompt');
  });

  it('does not call an action’s own key a conflict', () => {
    expect(bindingConflict(NO_BINDINGS, 'rename', 'r')).toBeNull();
  });

  it('sees the conflict against what is in force, not against the shipped table', () => {
    const bindings = bindKey(NO_BINDINGS, 'rename', 0, 'p');
    // `r` was freed by the override, `p` is now taken.
    expect(bindingConflict(bindings, 'icon', 'r')).toBeNull();
    expect(bindingConflict(bindings, 'icon', 'p')).toBe('rename');
  });

  it('does not confuse a chord’s second key with a top-level one', () => {
    expect(bindingConflict(NO_BINDINGS, 'rename', 't')).toBeNull();
  });
});

describe('reserved keys are named in one place', () => {
  it('reserves Escape — the cancel gesture the capture box needs', () => {
    expect(RESERVED_KEYS).toContain('Escape');
    expect(isReserved('Escape')).toBe(true);
  });

  it('reserves the chord prefixes, which are not free keys', () => {
    for (const prefix of ['g', 'y', 'z']) {
      expect(isReserved(prefix), `"${prefix}" opens a chord`).toBe(true);
    }
  });

  it('leaves an ordinary key free', () => {
    expect(isReserved('p')).toBe(false);
  });
});

describe('the sheet still derives from what is in force', () => {
  it('lists the operator’s binding rather than the default once overridden', () => {
    const bindings = bindKey(NO_BINDINGS, 'rename', 0, 'p');
    const keys = sheetKeys(bindings);
    expect(keys).toContain('p');
    expect(keys).not.toContain('r');
  });

  it('still names no key that nothing is bound to', () => {
    const bindings = bindKey(NO_BINDINGS, 'rename', 0, 'p');
    for (const keys of sheetKeys(bindings)) {
      const first = keys.length === 2 && 'gyz'.includes(keys[0] ?? '') ? keys[0] : '';
      const rest = first === '' ? keys : keys.slice(1);
      const state = first === '' ? EMPTY_CHORD : { pending: first as 'g' | 'y' | 'z' };
      expect(
        resolveChord(state, rest, bindings).action,
        `sheet advertises "${keys}"`,
      ).not.toBeNull();
    }
  });
});

describe('reset', () => {
  it('restores one action’s defaults rather than writing the current key back', () => {
    const bindings = clearBindings(bindKey(NO_BINDINGS, 'rename', 0, 'p'), 'rename');
    expect(Object.keys(bindings)).not.toContain('rename');
    expect(chordsOf(bindings, 'rename')).toEqual(['r']);
    expect(resolveChord(EMPTY_CHORD, 'r', bindings).action).toEqual({ kind: 'rename' });
  });
});
