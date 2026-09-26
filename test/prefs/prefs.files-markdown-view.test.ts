/**
 * WHICH FACE A `.md` FILE OPENS IN, and the store that puts it in force.
 *
 * The same bargain `prefs.editor.test.ts` holds for the editor's two
 * settings: a stored value is read back, normalised on both sides, survives
 * a neighbour's write, and actually reaches the module `FilesTab.tsx`
 * subscribes to -- except the direction of the safe default is INVERTED
 * here, on purpose, and the first `describe` below is the one that pins it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeFilesMarkdownView,
  DEFAULT_FILES_MARKDOWN_VIEW,
  readFilesMarkdownView,
  setActiveFilesMarkdownView,
} from '../../src/renderer/prefs/files-markdown-view.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setFilesMarkdownView,
} from '../../src/renderer/prefs/prefs.js';

function fake(initial: string | null): StorageLike {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

/** What a stored payload reads back as. */
const stored = (payload: Record<string, unknown>) => readPrefs(fake(JSON.stringify(payload)));

beforeEach(() => {
  setActiveFilesMarkdownView(DEFAULT_FILES_MARKDOWN_VIEW);
});

describe('the default is preview, and only "raw" ever turns it off', () => {
  it('ships preview as the default, which is the whole point of the setting', () => {
    expect(DEFAULT_FILES_MARKDOWN_VIEW).toBe('preview');
  });

  it('reads only a literal "raw" as the raw mode', () => {
    expect(readFilesMarkdownView('raw')).toBe('raw');
    expect(readFilesMarkdownView('preview')).toBe('preview');
    for (const raw of [null, undefined, 0, false, 'Raw', 'RAW', {}, []]) {
      expect(readFilesMarkdownView(raw), JSON.stringify(raw)).toBe('preview');
    }
  });

  it('normalises in the setter too, so no caller can store what no reader accepts', () => {
    expect(setFilesMarkdownView(EMPTY_PREFS, 'raw').filesMarkdownView).toBe('raw');
    expect(setFilesMarkdownView(EMPTY_PREFS, 'garbage').filesMarkdownView).toBe('preview');
  });
});

describe('the store round-trips through localStorage', () => {
  it('reads a stored choice back', () => {
    expect(stored({ filesMarkdownView: 'raw' }).filesMarkdownView).toBe('raw');
    expect(stored({ filesMarkdownView: 'preview' }).filesMarkdownView).toBe('preview');
  });

  it('gives a payload that predates the field the new shipped behaviour', () => {
    const back = stored({ theme: 'light', outFontSize: 15 });
    expect(back.filesMarkdownView).toBe('preview');
    // And per field: reading the new one must not disturb a neighbour.
    expect(back.outFontSize).toBe(15);
    expect(back.theme).toBe('light');
  });

  it('reads a hand-edited payload back in the safe direction, not only in the picker', () => {
    expect(stored({ filesMarkdownView: 'RAW' }).filesMarkdownView).toBe('preview');
    expect(stored({ filesMarkdownView: 42 }).filesMarkdownView).toBe('preview');
  });
});

describe('the default in force reaches a freshly mounted tab without a prop', () => {
  it('puts a read into force, the way `activatePrefs` does for every other pref', () => {
    readPrefs(fake(JSON.stringify({ filesMarkdownView: 'raw' })));
    expect(activeFilesMarkdownView()).toBe('raw');
    readPrefs(fake(JSON.stringify({ filesMarkdownView: 'preview' })));
    expect(activeFilesMarkdownView()).toBe('preview');
  });

  it('normalises what it is handed, so a garbage write cannot reach the next tab that mounts', () => {
    setActiveFilesMarkdownView('garbage');
    expect(activeFilesMarkdownView()).toBe('preview');
    setActiveFilesMarkdownView('raw');
    expect(activeFilesMarkdownView()).toBe('raw');
  });
});
