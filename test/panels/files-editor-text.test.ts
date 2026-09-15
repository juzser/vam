/**
 * The file editor's own text arithmetic: Tab/Shift+Tab indentation, and the
 * label a path draws in the list. Pure, DOM-free -- `FilesTab.tsx` is the
 * only caller, and it hands this real `selectionStart`/`selectionEnd`
 * numbers off a real `<textarea>`; this file supplies and checks them by
 * hand instead, the same split `TerminalTab.tsx`'s `fitPane` draws from its
 * own component.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTab,
  editorFileKind,
  extensionOf,
  relativeLabel,
} from '../../src/renderer/panels/files-editor-text.js';

describe('applyTab — Tab/Shift+Tab inside the editor, trapped rather than moving focus', () => {
  it('inserts two spaces at the caret when nothing is selected', () => {
    const result = applyTab('const x = 1;', 6, 6, false, 2);
    expect(result.value).toBe('const   x = 1;');
    // The caret lands AFTER the inserted indent, not at the old position.
    expect(result.selectionStart).toBe(8);
    expect(result.selectionEnd).toBe(8);
  });

  it('replaces a selection with the indent, same as typing any character would', () => {
    const result = applyTab('const xxxxx = 1;', 6, 11, false, 2);
    expect(result.value).toBe('const    = 1;');
    expect(result.selectionStart).toBe(8);
    expect(result.selectionEnd).toBe(8);
  });

  it('indents every line touched by a multi-line selection, not just the first', () => {
    const value = 'one\ntwo\nthree';
    // Selection spans from inside "one" to inside "three".
    const result = applyTab(value, 1, value.length - 2, false, 2);
    expect(result.value).toBe('  one\n  two\n  three');
  });

  it('Shift+Tab removes up to one indent worth of leading spaces on each touched line', () => {
    const value = '  one\n  two\n    three';
    const result = applyTab(value, 0, value.length, true, 2);
    expect(result.value).toBe('one\ntwo\n  three');
  });

  it('Shift+Tab on a line with no leading whitespace is a no-op for that line', () => {
    const value = 'one\n  two';
    const result = applyTab(value, 0, value.length, true, 2);
    expect(result.value).toBe('one\ntwo');
  });

  /**
   * THE WIDTH IS THE OPERATOR'S NOW (`prefs/editor.ts`), and both directions
   * have to follow it — an indent of four that outdented by two would walk a
   * block sideways one step per press.
   */
  it('indents and outdents by the width it is given, in both directions', () => {
    expect(applyTab('x', 0, 0, false, 4).value).toBe('    x');
    expect(applyTab('x', 0, 0, false, 8).value).toBe('        x');
    const four = '    one\n    two';
    expect(applyTab(four, 0, four.length, true, 4).value).toBe('one\ntwo');
    // Unevenly indented lines lose UP TO one step each and never a character
    // of their own text — the property that makes an outdent safe on a paste.
    expect(applyTab('  one\n      two', 0, 15, true, 4).value).toBe('one\n  two');
  });

  it('indents with spaces at every width — a tab byte would break the gutter', () => {
    for (const width of [2, 3, 4, 8]) {
      expect(applyTab('x', 0, 0, false, width).value).toBe(`${' '.repeat(width)}x`);
    }
    // And a width that never came from the picker still cannot reach the file.
    expect(applyTab('x', 0, 0, false, 999).value).toBe(`${' '.repeat(8)}x`);
    expect(applyTab('x', 0, 0, false, Number.NaN).value).toBe('  x');
  });
});

describe('editorFileKind — one answer the formatter and the highlighter share', () => {
  it('knows .env is a NAME, and that .ts is none of the three', () => {
    expect(editorFileKind('/w/.env')).toBe('env');
    expect(editorFileKind('/w/.env.local')).toBe('env');
    expect(editorFileKind('/w/staging.env')).toBe('env');
    expect(editorFileKind('/w/a.json')).toBe('json');
    expect(editorFileKind('/w/a.INI')).toBe('ini');
    for (const path of ['/w/a.ts', '/w/Makefile', '/w/a.jsonc', '/w/.gitignore', '/w/a.md']) {
      expect(editorFileKind(path), path).toBeNull();
    }
  });

  it('reads no extension off a leading dot', () => {
    expect(extensionOf('.env')).toBeNull();
    expect(extensionOf('.gitignore')).toBeNull();
    expect(extensionOf('Makefile')).toBeNull();
    expect(extensionOf('a.JSON')).toBe('.json');
    expect(extensionOf('.env.local')).toBe('.local');
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
