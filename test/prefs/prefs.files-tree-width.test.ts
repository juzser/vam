// @vitest-environment happy-dom

/**
 * THE FILE TREE'S DRAGGED WIDTH, in the store.
 *
 * `null` is a real value here and it is the one design decision in the field:
 * it means "the tree has never been dragged, draw the share the clamp always
 * drew". Without it, shipping the handle would move the tree on every pane
 * of every operator who never touched it -- which is precisely what
 * `DEFAULT_PANES` exists to avoid on the other two boundaries.
 */

import { describe, expect, it } from 'vitest';
import { TREE_WIDTH_MAX, TREE_WIDTH_MIN } from '../../src/renderer/prefs/files-tree-width.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setFilesTreeWidth,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) this.value = value;
    },
  };
}

const stored = (payload: object) => readPrefs(fake(JSON.stringify(payload)));

describe('the dragged tree width round-trips', () => {
  it('starts as null — nobody has dragged anything yet', () => {
    expect(EMPTY_PREFS.filesTreeWidth).toBeNull();
  });

  it('writes and reads back a dragged width, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setFilesTreeWidth(setTheme(EMPTY_PREFS, 'light'), 320));
    const back = readPrefs(storage);
    expect(back.filesTreeWidth).toBe(320);
    expect(back.theme).toBe('light');
  });

  it('defaults to null when the payload predates the field', () => {
    expect(
      stored({ theme: 'light', panes: { sidebar: 300, detail: 400 } }).filesTreeWidth,
    ).toBeNull();
  });

  /** Clamped on the way IN as well as on the way out, like `setOutFontSize`:
   *  the handle cannot produce an out-of-range width, but a future caller
   *  could. This is the STORED clamp — it knows nothing about a container. */
  it('clamps a stored width into the bounds, both ways', () => {
    expect(setFilesTreeWidth(EMPTY_PREFS, 9_000).filesTreeWidth).toBe(TREE_WIDTH_MAX);
    expect(setFilesTreeWidth(EMPTY_PREFS, 4).filesTreeWidth).toBe(TREE_WIDTH_MIN);
  });

  it('reads a garbage payload as null rather than as a width', () => {
    expect(stored({ filesTreeWidth: 'wide' }).filesTreeWidth).toBeNull();
    expect(stored({ filesTreeWidth: Number.NaN }).filesTreeWidth).toBeNull();
    expect(stored({ filesTreeWidth: {} }).filesTreeWidth).toBeNull();
  });

  it('clamps a stored payload that is a number but out of range', () => {
    expect(stored({ filesTreeWidth: 5_000 }).filesTreeWidth).toBe(TREE_WIDTH_MAX);
    expect(stored({ filesTreeWidth: 1 }).filesTreeWidth).toBe(TREE_WIDTH_MIN);
  });

  it('takes null back, so a caller can hand the share its default again', () => {
    expect(setFilesTreeWidth(setFilesTreeWidth(EMPTY_PREFS, 300), null).filesTreeWidth).toBeNull();
  });
});
