import { describe, expect, it } from 'vitest';
import { normalizeKey } from '../../src/renderer/keyboard/chords.js';

describe('normalizeKey', () => {
  it('leaves a plain key alone', () => {
    expect(normalizeKey({ key: 'j' })).toBe('j');
    expect(normalizeKey({ key: 'Escape' })).toBe('Escape');
  });

  it('keeps case, because G and g are different bindings', () => {
    expect(normalizeKey({ key: 'G' })).toBe('G');
    expect(normalizeKey({ key: 'T' })).toBe('T');
  });

  it('folds Ctrl and Cmd into one Mod token', () => {
    // The tool runs on one machine at a time and both spellings mean the same
    // intent. Two tokens would mean every binding declared twice.
    expect(normalizeKey({ key: 'k', ctrlKey: true })).toBe('Mod-k');
    expect(normalizeKey({ key: 'k', metaKey: true })).toBe('Mod-k');
  });

  it('lower-cases the letter under Mod, so Cmd-Shift-K is not a third spelling', () => {
    expect(normalizeKey({ key: 'K', metaKey: true })).toBe('Mod-k');
  });

  it('marks Alt separately from Mod', () => {
    expect(normalizeKey({ key: 'k', altKey: true })).toBe('Alt-k');
  });

  it('orders the modifiers the same way every time', () => {
    expect(normalizeKey({ key: 'k', ctrlKey: true, altKey: true })).toBe('Mod-Alt-k');
    expect(normalizeKey({ key: 'k', altKey: true, metaKey: true })).toBe('Mod-Alt-k');
  });

  it('ignores a modifier keypress on its own', () => {
    // Holding Cmd fires a keydown whose key IS "Meta". Left alone it would
    // abandon whatever chord was half-typed the moment you reached for a
    // shortcut you then decided against.
    expect(normalizeKey({ key: 'Control', ctrlKey: true })).toBeNull();
    expect(normalizeKey({ key: 'Meta', metaKey: true })).toBeNull();
    expect(normalizeKey({ key: 'Shift', shiftKey: true })).toBeNull();
    expect(normalizeKey({ key: 'Alt', altKey: true })).toBeNull();
  });

  it('does not put Shift in the token — the key already carries it', () => {
    expect(normalizeKey({ key: 'G', shiftKey: true })).toBe('G');
    expect(normalizeKey({ key: '?', shiftKey: true })).toBe('?');
  });
});

/**
 * THE BRACKET PAIR IS THE DIGIT ROW'S CASE, ONE FAMILY WIDER.
 *
 * `Mod-Shift-[` / `Mod-Shift-]` (the browser's own previous/next tab on
 * macOS) and `Mod-Alt-[` / `Mod-Alt-]` (one modifier up — previous/next pane)
 * are bindings about a POSITION on the board, not about the character sitting
 * there — the same argument `normalizeKey`'s doc comment already makes for
 * `Digit0`..`Digit9`, and it fails the same two ways when a character
 * spelling is used instead.
 *
 * Shift ALTERS the character: a real `Cmd+Shift+[` keydown arrives as `{`, so
 * a character spelling would have to be written `Mod-{` — unrenderable as a
 * position in any key sheet, and dead on every layout that puts `[` somewhere
 * else. Alt alters it too, and further: on macOS `Alt+[` produces `“`.
 */
describe('normalizeKey — the bracket pair, by POSITION', () => {
  it('reads the position off event.code, whatever character the modifiers produced', () => {
    // What a real macOS Chromium keydown carries for Cmd+Shift+[.
    expect(normalizeKey({ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true })).toBe(
      'Mod-Shift-[',
    );
    expect(normalizeKey({ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true })).toBe(
      'Mod-Shift-]',
    );
    // And Alt, which on macOS produces a typographic quote rather than a brace.
    expect(normalizeKey({ key: '“', code: 'BracketLeft', metaKey: true, altKey: true })).toBe(
      'Mod-Alt-[',
    );
    expect(normalizeKey({ key: '‘', code: 'BracketRight', metaKey: true, altKey: true })).toBe(
      'Mod-Alt-]',
    );
  });

  it('falls back to the character for an event that reports no code', () => {
    // Every hand-built KeyEventLike in this repo is key-only. The shifted
    // forms map back to their own position, so a browser that reported `{`
    // without a code would still answer the binding rather than go dead.
    expect(normalizeKey({ key: '[', metaKey: true, shiftKey: true })).toBe('Mod-Shift-[');
    expect(normalizeKey({ key: '{', metaKey: true, shiftKey: true })).toBe('Mod-Shift-[');
    expect(normalizeKey({ key: '}', metaKey: true, shiftKey: true })).toBe('Mod-Shift-]');
  });

  it('leaves an UNMODIFIED bracket exactly as typed', () => {
    // Typing `[` into a prompt is not a chord, and `normalizeKey` returns
    // before any of this for a key with no modifier on it.
    expect(normalizeKey({ key: '[', code: 'BracketLeft' })).toBe('[');
    expect(normalizeKey({ key: '{', code: 'BracketLeft', shiftKey: true })).toBe('{');
  });

  it('does not confuse the two brackets with each other under any modifier', () => {
    expect(normalizeKey({ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true })).not.toBe(
      normalizeKey({ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true }),
    );
  });
});
