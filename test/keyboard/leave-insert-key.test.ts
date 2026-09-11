/**
 * `Mod-[` — THE KEY THAT NOW LETS GO OF THE PROMPT BOX.
 *
 * Escape in the composer became the interrupt (the operator's request: Escape
 * should cancel the running prompt, Claude Code's own default), so the way out
 * of the box needed a key of its own. `Mod-[` is vim's `Ctrl-[`, which IS
 * Escape, and `Mod` folds Ctrl and Cmd (`normalizeKey`), so the same binding is
 * `Cmd+[` on the keyboard the operator actually has.
 *
 * TWO PROPERTIES ARE MEASURED HERE RATHER THAN ASSUMED, because both are ways
 * this key could be dead or dangerous on arrival:
 *
 *  - `normalizeKey` really SPELLS it `Mod-[`, and spells it that way whether or
 *    not the browser reported a `code`. Brackets are handled POSITIONALLY in
 *    that function, so the spelling is not obvious from the key name.
 *  - It cannot be confused with `Mod-Shift-[`, which is a SHIPPED binding
 *    (previous tab). A real `Cmd+Shift+[` keydown arrives as `{`, and a
 *    spelling that folded the two would make the tab step leave the box.
 */

import { describe, expect, it } from 'vitest';
import { isReserved, normalizeKey, RESERVED_KEYS } from '../../src/renderer/keyboard/chords.js';

describe('Mod-[ is spelled the way the composer listens for it', () => {
  it('spells Cmd+[ and Ctrl+[ as the one token Mod-[', () => {
    expect(normalizeKey({ key: '[', code: 'BracketLeft', metaKey: true })).toBe('Mod-[');
    expect(normalizeKey({ key: '[', code: 'BracketLeft', ctrlKey: true })).toBe('Mod-[');
  });

  it('spells it the same with no code at all, which is every hand-built event', () => {
    // `POSITION_CHARS` is the fallback, and it is the path a test — or an
    // older browser — takes. A binding that only worked under `event.code`
    // would be green in the app and dead in every unit test, or the reverse.
    expect(normalizeKey({ key: '[', metaKey: true })).toBe('Mod-[');
  });

  it('is a different string from the shipped Mod-Shift-[ , under both spellings', () => {
    // THE COLLISION THAT WOULD MATTER. `Mod-Shift-[` steps to the previous
    // tab; if Shift folded away, stepping tabs would also drop the keyboard
    // out of the prompt box.
    expect(normalizeKey({ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true })).toBe(
      'Mod-Shift-[',
    );
    expect(normalizeKey({ key: '{', metaKey: true, shiftKey: true })).toBe('Mod-Shift-[');
    expect(normalizeKey({ key: '[', code: 'BracketLeft', metaKey: true, altKey: true })).toBe(
      'Mod-Alt-[',
    );
  });

  it('needs the modifier: a bare [ is still a bare [', () => {
    // The composer must not lose the keyboard because a prompt mentioned an
    // array. Without a modifier `normalizeKey` returns the character itself.
    expect(normalizeKey({ key: '[' })).toBe('[');
  });
});

describe('Mod-[ is not available to be bound to something else', () => {
  it('is reserved, for the reason Escape is: another surface already binds it', () => {
    // An operator who bound `Mod-[` to `close` in the shortcut editor would
    // press it in the composer and get BOTH — the box let go and a session
    // shut. Escape is in this list for the same shape of reason.
    expect(RESERVED_KEYS).toContain('Mod-[');
    expect(isReserved('Mod-[')).toBe(true);
  });

  it('reserves only the exact token, leaving its neighbours bindable', () => {
    // `Mod-Shift-[` and `Mod-Alt-[` are shipped bindings; reserving the whole
    // bracket family would make them unrebindable for no reason.
    expect(isReserved('Mod-Shift-[')).toBe(false);
    expect(isReserved('Mod-Alt-[')).toBe(false);
    expect(isReserved('[')).toBe(false);
  });
});
