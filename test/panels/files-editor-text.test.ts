/**
 * The file editor's own text arithmetic: Tab/Shift+Tab indentation, and the
 * label a path draws in the list. Pure, DOM-free -- `FilesTab.tsx` is the
 * only caller, and it hands this real `selectionStart`/`selectionEnd`
 * numbers off a real `<textarea>`; this file supplies and checks them by
 * hand instead, the same split `TerminalTab.tsx`'s `fitPane` draws from its
 * own component.
 */

import { describe, expect, it } from 'vitest';
import { applyTab, relativeLabel } from '../../src/renderer/panels/files-editor-text.js';

describe('applyTab — Tab/Shift+Tab inside the editor, trapped rather than moving focus', () => {
  it('inserts two spaces at the caret when nothing is selected', () => {
    const result = applyTab('const x = 1;', 6, 6, false);
    expect(result.value).toBe('const   x = 1;');
    // The caret lands AFTER the inserted indent, not at the old position.
    expect(result.selectionStart).toBe(8);
    expect(result.selectionEnd).toBe(8);
  });

  it('replaces a selection with the indent, same as typing any character would', () => {
    const result = applyTab('const xxxxx = 1;', 6, 11, false);
    expect(result.value).toBe('const    = 1;');
    expect(result.selectionStart).toBe(8);
    expect(result.selectionEnd).toBe(8);
  });

  it('indents every line touched by a multi-line selection, not just the first', () => {
    const value = 'one\ntwo\nthree';
    // Selection spans from inside "one" to inside "three".
    const result = applyTab(value, 1, value.length - 2, false);
    expect(result.value).toBe('  one\n  two\n  three');
  });

  it('Shift+Tab removes up to one indent worth of leading spaces on each touched line', () => {
    const value = '  one\n  two\n    three';
    const result = applyTab(value, 0, value.length, true);
    expect(result.value).toBe('one\ntwo\n  three');
  });

  it('Shift+Tab on a line with no leading whitespace is a no-op for that line', () => {
    const value = 'one\n  two';
    const result = applyTab(value, 0, value.length, true);
    expect(result.value).toBe('one\ntwo');
  });
});

describe('relativeLabel — what a list row shows for an absolute path', () => {
  it('strips the root and the separator, leaving a path relative to it', () => {
    expect(relativeLabel('/home/s1', '/home/s1/src/index.ts')).toBe('src/index.ts');
  });

  it('falls back to the absolute path when it is not actually under root', () => {
    // Defensive only -- every path this draws SHOULD be under its own root,
    // since `listFiles` only ever walks inside it. A label that silently
    // hid this instead of showing the raw path would be the harder bug to
    // notice.
    expect(relativeLabel('/home/s1', '/elsewhere/x.txt')).toBe('/elsewhere/x.txt');
  });

  it('handles the root itself named with a trailing slash', () => {
    expect(relativeLabel('/home/s1/', '/home/s1/.env')).toBe('.env');
  });
});
