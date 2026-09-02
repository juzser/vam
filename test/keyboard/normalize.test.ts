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
