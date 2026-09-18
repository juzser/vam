import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHORD,
  type KeyEventLike,
  normalizeKey,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';

/**
 * CapsLock's own event, reproduced exactly rather than approximated.
 *
 * A browser under CapsLock reports the UPPER-CASE character and
 * `shiftKey: false` -- indistinguishable, at the character level, from a real
 * Shift press with the result already applied. `{ key: 'I', shiftKey: false }`
 * is the literal shape a real CapsLock+`i` keydown carries; every test below
 * builds its bare-letter events the same way rather than trusting a browser
 * that never runs in CI to hand it back.
 */
function capsLock(letter: string): KeyEventLike {
  return { key: letter.toUpperCase(), shiftKey: false };
}

/** A genuine Shift press: the browser already upper-cased the key AND
 *  reports the modifier that did it. */
function shifted(letter: string): KeyEventLike {
  return { key: letter.toUpperCase(), shiftKey: true };
}

describe('normalizeKey under CapsLock — the bare-letter branch', () => {
  it('folds a CapsLock-produced capital back to the lowercase binding', () => {
    // The bug, reproduced at the unit closest to it: `i` arrives as `I` with
    // `shiftKey: false`, and before the fix `normalizeKey` returned `event.key`
    // unchanged here -- `I`, not `i` -- so `resolveChord` answered
    // `focusAction` (bound to `I`) instead of `prompt` (bound to `i`).
    expect(normalizeKey(capsLock('i'))).toBe('i');
    expect(normalizeKey(capsLock('g'))).toBe('g');
    expect(normalizeKey(capsLock('e'))).toBe('e');
    expect(normalizeKey(capsLock('f'))).toBe('f');
    expect(normalizeKey(capsLock('n'))).toBe('n');
    expect(normalizeKey(capsLock('z'))).toBe('z');
    // The silent casualties: bound nowhere under their upper-case spelling,
    // these used to vanish without a status line to say why.
    expect(normalizeKey(capsLock('h'))).toBe('h');
    expect(normalizeKey(capsLock('j'))).toBe('j');
    expect(normalizeKey(capsLock('k'))).toBe('k');
    expect(normalizeKey(capsLock('l'))).toBe('l');
    expect(normalizeKey(capsLock('x'))).toBe('x');
    expect(normalizeKey(capsLock('r'))).toBe('r');
    expect(normalizeKey(capsLock('s'))).toBe('s');
    expect(normalizeKey(capsLock('o'))).toBe('o');
    expect(normalizeKey(capsLock('p'))).toBe('p');
  });

  it('still gives a genuinely Shift-held letter its upper-case binding', () => {
    // The fix must not flatten every letter to lower-case -- only CapsLock's
    // false `shiftKey` is the hazard. A real Shift+I still means `I`
    // (`focusAction`), not `i` (`prompt`).
    expect(normalizeKey(shifted('i'))).toBe('I');
    expect(normalizeKey(shifted('g'))).toBe('G');
    expect(normalizeKey(shifted('e'))).toBe('E');
    expect(normalizeKey(shifted('f'))).toBe('F');
    expect(normalizeKey(shifted('n'))).toBe('N');
  });

  it('reaches the upper-case binding under CapsLock+Shift too', () => {
    // Holding Shift while CapsLock is on is the one case where a browser hands
    // back a LOWER-case letter -- the two invert each other -- with
    // `shiftKey: true`. The operator's hand is on Shift, so they get the Shift
    // binding: `shiftKey` alone decides it, and it is true here.
    expect(normalizeKey({ key: 'i', shiftKey: true })).toBe('I');
    expect(normalizeKey({ key: 'g', shiftKey: true })).toBe('G');
  });

  it('leaves every non-letter binding exactly as the browser sent it', () => {
    // ONLY LETTERS fold by shiftKey. A shifted character is already itself,
    // and refolding it would give one keystroke two spellings.
    expect(normalizeKey({ key: '?' })).toBe('?');
    expect(normalizeKey({ key: '?', shiftKey: true })).toBe('?');
    expect(normalizeKey({ key: '/' })).toBe('/');
    expect(normalizeKey({ key: ',' })).toBe(',');
    expect(normalizeKey({ key: '.' })).toBe('.');
    expect(normalizeKey({ key: '<' })).toBe('<');
    expect(normalizeKey({ key: '<', shiftKey: true })).toBe('<');
    expect(normalizeKey({ key: '>' })).toBe('>');
    // Named keys are longer than one character and are untouched by the fold.
    expect(normalizeKey({ key: 'Enter' })).toBe('Enter');
    expect(normalizeKey({ key: 'Escape' })).toBe('Escape');
  });
});

/** Feed a whole sequence of raw KeyboardEvent-like objects through
 *  `normalizeKey` and `resolveChord`, the way the window listener does. */
function type(events: readonly KeyEventLike[]) {
  let state = EMPTY_CHORD;
  const actions = [];
  for (const event of events) {
    const key = normalizeKey(event);
    if (key === null) continue;
    const step = resolveChord(state, key);
    state = step.state;
    if (step.action !== null) {
      actions.push(step.action);
    }
  }
  return { state, actions };
}

describe('resolveChord under CapsLock — end to end through normalizeKey', () => {
  it('reaches the lowercase bare bindings the operator meant', () => {
    expect(type([capsLock('i')]).actions).toEqual([{ kind: 'prompt' }]);
    expect(type([capsLock('h')]).actions).toEqual([{ kind: 'move', direction: 'left' }]);
    expect(type([capsLock('j')]).actions).toEqual([{ kind: 'move', direction: 'down' }]);
  });

  it('still opens the g prefix under CapsLock, and gg/gt/gT complete it', () => {
    // Before the fix, `g` arrived as `G` (bound to `last`) and the prefix
    // never opened at all -- `gg`, `gt`, `gT` and `gm` were unreachable
    // whenever the operator's CapsLock was on.
    expect(type([capsLock('g'), capsLock('g')]).actions).toEqual([{ kind: 'first' }]);
    expect(type([capsLock('g'), capsLock('t')]).actions).toEqual([{ kind: 'project', delta: 1 }]);
    // `gT` under CapsLock: the continuation key is a genuine Shift+T, which
    // CapsLock does not touch -- CapsLock only inverts a BARE letter's case,
    // and `T` here already carries `shiftKey: true` from the operator's own
    // Shift press, same as it would with CapsLock off.
    expect(type([capsLock('g'), shifted('t')]).actions).toEqual([{ kind: 'project', delta: -1 }]);
  });

  it('reaches the uppercase bare binding on a real Shift press, CapsLock or not', () => {
    expect(type([shifted('i')]).actions).toEqual([{ kind: 'focusAction' }]);
    expect(type([shifted('g')]).actions).toEqual([{ kind: 'last' }]);
  });

  it('reaches the uppercase binding under CapsLock+Shift', () => {
    expect(type([{ key: 'i', shiftKey: true }]).actions).toEqual([{ kind: 'focusAction' }]);
  });

  it('leaves the non-letter bindings reachable under CapsLock', () => {
    // CapsLock has no opinion about these -- they are not letters -- so they
    // must keep working exactly as before.
    expect(type([{ key: '?' }]).actions).toEqual([{ kind: 'help' }]);
    expect(type([{ key: '/' }]).actions).toEqual([{ kind: 'search' }]);
    expect(type([{ key: ',' }]).actions).toEqual([{ kind: 'settings' }]);
    expect(type([{ key: '.' }]).actions).toEqual([{ kind: 'remote' }]);
    expect(type([{ key: '<' }]).actions).toEqual([{ kind: 'resizePane', delta: -1 }]);
    expect(type([{ key: '>' }]).actions).toEqual([{ kind: 'resizePane', delta: 1 }]);
    expect(type([{ key: 'Enter' }]).actions).toEqual([{ kind: 'open' }]);
    expect(type([{ key: 'Escape' }]).actions).toEqual([{ kind: 'cancel' }]);
  });
});
