/**
 * THE FILE EDITOR'S OWN TWO SETTINGS, and the store that puts them in force.
 *
 * The same bargain `prefs.out-font.test.ts` holds for `outFontSize` and
 * `prefs.submit-key.test.ts` holds for the send key: a stored value is read
 * back, normalised on BOTH sides, survives a neighbour's write, and actually
 * reaches the module the editor subscribes to.
 *
 * THE INDENT IS SPACES, AND THAT IS NOT A TASTE. `files-editor-text.ts`'s own
 * header explains why: the line-number gutter and the text share one line box,
 * and a literal tab byte has a RENDERED width neither column can agree on. So
 * `indentText` is asserted to be spaces here, not merely to be the right
 * length -- a width that arrived as a tab is the one way this setting could
 * break the gutter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeEditorSettings,
  clampEditorIndent,
  DEFAULT_EDITOR_HIGHLIGHT,
  DEFAULT_EDITOR_INDENT,
  EDITOR_INDENT_MAX,
  EDITOR_INDENT_MIN,
  indentText,
  readEditorHighlight,
  setActiveEditorSettings,
  subscribeEditorSettings,
} from '../../src/renderer/prefs/editor.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setEditorHighlight,
  setEditorIndent,
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
  setActiveEditorSettings({ highlight: DEFAULT_EDITOR_HIGHLIGHT, indent: DEFAULT_EDITOR_INDENT });
});

describe('the defaults ship the editor as it already behaved', () => {
  it('highlights by default, and indents by the two spaces `INDENT` was', () => {
    // The indent default is load-bearing in the same way the send key's is:
    // shipping the setting must not move anybody's file. Two spaces is what
    // `files-editor-text.ts` hard-coded before this setting existed.
    expect(DEFAULT_EDITOR_INDENT).toBe(2);
    expect(DEFAULT_EDITOR_HIGHLIGHT).toBe(true);
    expect(EDITOR_INDENT_MIN).toBeLessThanOrEqual(DEFAULT_EDITOR_INDENT);
    expect(EDITOR_INDENT_MAX).toBeGreaterThan(DEFAULT_EDITOR_INDENT);
  });

  it('builds an indent out of spaces, never a tab byte, at every legal width', () => {
    for (let width = EDITOR_INDENT_MIN; width <= EDITOR_INDENT_MAX; width += 1) {
      expect(indentText(width)).toBe(' '.repeat(width));
      expect(indentText(width)).not.toContain('\t');
    }
    // And a width that never came from the picker still cannot smuggle one in.
    expect(indentText(Number.NaN)).toBe(' '.repeat(DEFAULT_EDITOR_INDENT));
    expect(indentText(999)).toBe(' '.repeat(EDITOR_INDENT_MAX));
  });
});

describe('every value is normalised on the way in and on the way out', () => {
  it('clamps a hand-edited indent into the range the picker offers', () => {
    expect(clampEditorIndent(4)).toBe(4);
    expect(clampEditorIndent(0)).toBe(EDITOR_INDENT_MIN);
    expect(clampEditorIndent(99)).toBe(EDITOR_INDENT_MAX);
    // Fractions would put a fraction of a space in front of a line.
    expect(clampEditorIndent(2.7)).toBe(3);
    // An Infinity IS a number, so it clamps rather than defaulting — the same
    // answer `clampOutFontSize` already gives it, and the same safe one.
    expect(clampEditorIndent(Number.POSITIVE_INFINITY)).toBe(EDITOR_INDENT_MAX);
    expect(clampEditorIndent(Number.NEGATIVE_INFINITY)).toBe(EDITOR_INDENT_MIN);
    for (const raw of [null, undefined, 'four', {}, Number.NaN]) {
      expect(clampEditorIndent(raw), JSON.stringify(raw)).toBe(DEFAULT_EDITOR_INDENT);
    }
  });

  it('reads only a literal false as "do not highlight"', () => {
    // The safe direction: a value this vam cannot read must not take a
    // capability away on the strength of nobody's choice.
    expect(readEditorHighlight(false)).toBe(false);
    expect(readEditorHighlight(true)).toBe(true);
    for (const raw of [null, undefined, 0, 'no', {}]) {
      expect(readEditorHighlight(raw), JSON.stringify(raw)).toBe(DEFAULT_EDITOR_HIGHLIGHT);
    }
  });

  it('normalises in the setters too, so no caller can store what no reader accepts', () => {
    expect(setEditorIndent(EMPTY_PREFS, 999).editorIndent).toBe(EDITOR_INDENT_MAX);
    expect(setEditorIndent(EMPTY_PREFS, Number.NaN).editorIndent).toBe(DEFAULT_EDITOR_INDENT);
    expect(setEditorHighlight(EMPTY_PREFS, false).editorHighlight).toBe(false);
    expect(setEditorHighlight(EMPTY_PREFS, 'yes').editorHighlight).toBe(true);
  });
});

describe('the store round-trips through localStorage', () => {
  it('reads a stored pair back', () => {
    const back = stored({ editorHighlight: false, editorIndent: 4 });
    expect(back.editorHighlight).toBe(false);
    expect(back.editorIndent).toBe(4);
  });

  it('gives a payload that predates the fields the shipped behaviour', () => {
    const back = stored({ theme: 'light', outFontSize: 15 });
    expect(back.editorHighlight).toBe(DEFAULT_EDITOR_HIGHLIGHT);
    expect(back.editorIndent).toBe(DEFAULT_EDITOR_INDENT);
    // And per field: reading the two new ones must not disturb a neighbour.
    expect(back.outFontSize).toBe(15);
    expect(back.theme).toBe('light');
  });

  it('clamps a hand-edited payload on READ, not only in the picker', () => {
    expect(stored({ editorIndent: 40 }).editorIndent).toBe(EDITOR_INDENT_MAX);
    expect(stored({ editorIndent: 'four' }).editorIndent).toBe(DEFAULT_EDITOR_INDENT);
    expect(stored({ editorHighlight: 'off' }).editorHighlight).toBe(DEFAULT_EDITOR_HIGHLIGHT);
  });
});

describe('the settings in force reach the editor without a prop', () => {
  it('puts a read into force, the way `activatePrefs` does for every other pref', () => {
    readPrefs(fake(JSON.stringify({ editorHighlight: false, editorIndent: 6 })));
    expect(activeEditorSettings()).toEqual({ highlight: false, indent: 6 });
  });

  it('tells subscribers when a value MOVES, and stays quiet when it does not', () => {
    const listener = vi.fn();
    const stop = subscribeEditorSettings(listener);
    setActiveEditorSettings({ highlight: true, indent: 2 });
    // `activatePrefs` runs on every prefs write — a renamed project must not
    // re-render every mounted editor for a setting that did not move.
    expect(listener).not.toHaveBeenCalled();
    setActiveEditorSettings({ highlight: false, indent: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    setActiveEditorSettings({ highlight: false, indent: 4 });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setActiveEditorSettings({ highlight: true, indent: 8 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps ONE snapshot identity until a value moves — `useSyncExternalStore` compares by identity', () => {
    // A fresh object per call is an infinite render loop, not a preference.
    const first = activeEditorSettings();
    expect(activeEditorSettings()).toBe(first);
    setActiveEditorSettings({ highlight: DEFAULT_EDITOR_HIGHLIGHT, indent: DEFAULT_EDITOR_INDENT });
    expect(activeEditorSettings()).toBe(first);
    setActiveEditorSettings({ highlight: false, indent: 4 });
    expect(activeEditorSettings()).not.toBe(first);
    expect(activeEditorSettings()).toBe(activeEditorSettings());
  });

  it('normalises what it is handed, so a garbage write cannot reach the editor', () => {
    setActiveEditorSettings({ highlight: 'yes' as unknown as boolean, indent: 99 });
    expect(activeEditorSettings()).toEqual({ highlight: true, indent: EDITOR_INDENT_MAX });
  });
});
