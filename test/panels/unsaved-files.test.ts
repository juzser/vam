/**
 * The renderer's side of the quit guard: the union of every mounted Files
 * tab's unsaved buffers, and the one push of it into main.
 *
 * THE UNION IS THE WHOLE POINT. `Canvas.tsx` mounts one `FilesTab` per split
 * leaf, each with its own `buffers` state, so a single channel carrying "what
 * I am holding" would be last-writer-wins: a clean pane re-rendering would
 * tell main nothing is unsaved while the pane beside it holds an hour of typed
 * `.env`. That is the exact silent loss the quit guard exists to prevent, so
 * it is asserted here first.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  encodeUnsaved,
  publishUnsaved,
  releaseUnsaved,
  resetUnsavedRegistry,
  unsavedUnion,
} from '../../src/renderer/panels/unsaved-files.js';

afterEach(() => {
  resetUnsavedRegistry();
});

const file = (path: string, label: string) => ({ path, label });

describe('the unsaved registry', () => {
  it('starts empty, and says so as a report rather than as nothing', () => {
    expect(unsavedUnion()).toEqual({ count: 0, names: [] });
  });

  it('carries one pane s unsaved files, by label, in name order', () => {
    publishUnsaved(
      'pane-1',
      encodeUnsaved([file('/w/atlas/src/app.ts', 'src/app.ts'), file('/w/atlas/.env', '.env')]),
      undefined,
    );
    expect(unsavedUnion()).toEqual({ count: 2, names: ['.env', 'src/app.ts'] });
  });

  it('UNIONS panes — a clean pane never speaks for a dirty one', () => {
    publishUnsaved('pane-1', encodeUnsaved([file('/w/atlas/.env', '.env')]), undefined);
    publishUnsaved('pane-2', encodeUnsaved([]), undefined);
    expect(unsavedUnion()).toEqual({ count: 1, names: ['.env'] });

    publishUnsaved('pane-2', encodeUnsaved([file('/w/other/notes.md', 'notes.md')]), undefined);
    expect(unsavedUnion()).toEqual({ count: 2, names: ['.env', 'notes.md'] });
  });

  it('counts FILES, not buffers — the same path open dirty in two panes is one file', () => {
    publishUnsaved('pane-1', encodeUnsaved([file('/w/atlas/.env', '.env')]), undefined);
    publishUnsaved('pane-2', encodeUnsaved([file('/w/atlas/.env', '.env')]), undefined);
    expect(unsavedUnion()).toEqual({ count: 1, names: ['.env'] });
  });

  it('drops a pane that went away — an unmounted tab holds nothing', () => {
    publishUnsaved('pane-1', encodeUnsaved([file('/w/atlas/.env', '.env')]), undefined);
    publishUnsaved('pane-2', encodeUnsaved([file('/w/atlas/notes.md', 'notes.md')]), undefined);
    releaseUnsaved('pane-1', undefined);
    expect(unsavedUnion()).toEqual({ count: 1, names: ['notes.md'] });
  });

  it('survives a path with a newline or a tab in it', () => {
    publishUnsaved('pane-1', encodeUnsaved([file('/w/a\tb\nc.env', 'a\tb\nc.env')]), undefined);
    expect(unsavedUnion()).toEqual({ count: 1, names: ['a\tb\nc.env'] });
  });

  it('encodes by VALUE — the same set twice is the same string, so React can skip it', () => {
    const once = encodeUnsaved([file('/w/b', 'b'), file('/w/a', 'a')]);
    const twice = encodeUnsaved([file('/w/a', 'a'), file('/w/b', 'b')]);
    expect(once).toBe(twice);
    expect(encodeUnsaved([])).not.toBe(once);
  });
});

describe('what reaches main', () => {
  it('pushes the WHOLE union on every publish, not just the pane that changed', () => {
    const sink = vi.fn();
    publishUnsaved('pane-1', encodeUnsaved([file('/w/atlas/.env', '.env')]), sink);
    publishUnsaved('pane-2', encodeUnsaved([file('/w/atlas/notes.md', 'notes.md')]), sink);
    expect(sink).toHaveBeenNthCalledWith(1, { count: 1, names: ['.env'] });
    expect(sink).toHaveBeenNthCalledWith(2, { count: 2, names: ['.env', 'notes.md'] });
  });

  it('pushes the EMPTY union too — main must be told when the last edit was saved', () => {
    const sink = vi.fn();
    publishUnsaved('pane-1', encodeUnsaved([file('/w/atlas/.env', '.env')]), sink);
    publishUnsaved('pane-1', encodeUnsaved([]), sink);
    expect(sink).toHaveBeenLastCalledWith({ count: 0, names: [] });
  });

  it('pushes on release, so an unmounted pane stops blocking a quit', () => {
    const sink = vi.fn();
    publishUnsaved('pane-1', encodeUnsaved([file('/w/atlas/.env', '.env')]), sink);
    releaseUnsaved('pane-1', sink);
    expect(sink).toHaveBeenLastCalledWith({ count: 0, names: [] });
  });

  it('does nothing at all without a bridge — the browser build has no app to quit', () => {
    expect(() =>
      publishUnsaved('pane-1', encodeUnsaved([file('/w/a', 'a')]), undefined),
    ).not.toThrow();
    expect(unsavedUnion()).toEqual({ count: 1, names: ['a'] });
  });

  it('a sink that throws never reaches the tab the operator is typing in', () => {
    const sink = vi.fn(() => {
      throw new Error('the bridge is gone');
    });
    expect(() => publishUnsaved('pane-1', encodeUnsaved([file('/w/a', 'a')]), sink)).not.toThrow();
    expect(() => releaseUnsaved('pane-1', sink)).not.toThrow();
  });
});
