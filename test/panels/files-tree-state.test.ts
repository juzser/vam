// @vitest-environment happy-dom
/**
 * The extracted TREE-STATE hook, asserted through its own return value --
 * not through `FilesTab`'s DOM. Three cases carry the load-bearing rules:
 * expanding a directory adds exactly that path to the expanded set,
 * collapsing removes it, and moving the cursor past the end of the visible
 * rows is a no-op rather than a cursor pointing at nothing.
 */

import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FileListResult } from '../../src/main/files/types.js';
import { useFilesTreeState } from '../../src/renderer/panels/files-tree-state.js';

/** The root level of `files` only, the shape the lazy tree loads first. */
const rootLevel = (files: readonly string[]) => {
  const entries = new Map<string, 'file' | 'dir'>();
  for (const file of files) {
    const [first, ...rest] = file.slice('/w/atlas/'.length).split('/');
    entries.set(first as string, rest.length > 0 ? 'dir' : 'file');
  }
  return {
    root: '/w/atlas',
    dirs: new Map([['/w/atlas', [...entries].map(([name, kind]) => ({ name, kind }) as const)]]),
    loading: new Set<string>(),
  };
};

function setup(files: readonly string[]) {
  const openFile = vi.fn();
  const setNote = vi.fn();
  const focusEditor = vi.fn().mockReturnValue(true);
  const focusFilter = vi.fn();
  const requestRowFocus = vi.fn();
  const requestEditorFocus = vi.fn();
  const treeRef = createRef<HTMLDivElement>();
  const { result } = renderHook(() =>
    useFilesTreeState({
      tree: rootLevel(files),
      walk: null,
      walkPending: false,
      walkFailed: false,
      filter: '',
      openFile,
      setNote,
      focusEditor,
      focusFilter,
      requestRowFocus,
      requestEditorFocus,
      treeRef,
    }),
  );
  return { result, openFile, setNote, focusFilter, requestRowFocus, requestEditorFocus };
}

describe('useFilesTreeState', () => {
  it('expanding a directory adds exactly that path to the expanded set', () => {
    const { result } = setup(['/w/atlas/src/index.ts', '/w/atlas/README.md']);

    act(() => result.current.toggleDir('/w/atlas/src', true));

    expect(result.current.expanded.has('/w/atlas/src')).toBe(true);
    expect(result.current.expanded.size).toBe(1);
  });

  it('collapsing a directory removes it from the expanded set', () => {
    const { result } = setup(['/w/atlas/src/index.ts', '/w/atlas/README.md']);

    act(() => result.current.toggleDir('/w/atlas/src', true));
    expect(result.current.expanded.has('/w/atlas/src')).toBe(true);

    act(() => result.current.toggleDir('/w/atlas/src', false));
    expect(result.current.expanded.has('/w/atlas/src')).toBe(false);
  });

  it('moving the cursor past the end of the visible rows is a no-op', () => {
    const { result } = setup(['/w/atlas/README.md']);

    // Only one row is visible (the file at root — nothing is expanded), so
    // its own index, 0, is the last legal one.
    act(() => result.current.setCursorPath(result.current.rows[0]?.path ?? null));
    expect(result.current.cursorIndex).toBe(0);

    // A cursor path that matches no row falls back to index 0 — never an
    // index past the array, which `rows[cursorIndex]` would resolve to
    // `undefined` for.
    act(() => result.current.setCursorPath('/w/atlas/does-not-exist.md'));

    expect(result.current.cursorIndex).toBe(0);
    expect(result.current.cursorRow).toBe(result.current.rows[0]);
  });

  it('pressing the down key at the last row is a no-op, not a step off the end', () => {
    const { result } = setup(['/w/atlas/README.md']);

    // Only one row is visible, so the cursor is already on the last one.
    act(() => result.current.setCursorPath(result.current.rows[0]?.path ?? null));
    expect(result.current.cursorIndex).toBe(0);

    act(() => {
      result.current.onTreeKeyDown({
        key: 'j',
        preventDefault: () => {},
      } as unknown as Parameters<typeof result.current.onTreeKeyDown>[0]);
    });

    expect(result.current.cursorIndex).toBe(0);
    expect(result.current.cursorPath).toBe(result.current.rows[0]?.path ?? null);
  });

  it('an open directory draws the level loaded for it, and none until it arrives', () => {
    const { result } = setup(['/w/atlas/src/index.ts']);
    act(() => result.current.toggleDir('/w/atlas/src', true));
    // The level for `src` was never loaded: the row is there, its children are not.
    expect(result.current.rows.map((row) => row.path)).toEqual(['/w/atlas/src']);
  });

  it('a typed filter draws no rows while its walk is pending, and the walk once it lands', () => {
    const base = rootLevel(['/w/atlas/src/index.ts', '/w/atlas/README.md']);
    const params = (walk: FileListResult | null, walkPending: boolean) => ({
      tree: base,
      walk,
      walkPending,
      walkFailed: false,
      filter: 'index',
      openFile: vi.fn(),
      setNote: vi.fn(),
      focusEditor: vi.fn().mockReturnValue(true),
      focusFilter: vi.fn(),
      requestRowFocus: vi.fn(),
      requestEditorFocus: vi.fn(),
      treeRef: createRef<HTMLDivElement>(),
    });
    const pending = renderHook(() => useFilesTreeState(params(null, true)));
    expect(pending.result.current.rows).toEqual([]);
    const landed = renderHook(() =>
      useFilesTreeState(
        params({ root: '/w/atlas', files: ['/w/atlas/src/index.ts'], truncated: false }, false),
      ),
    );
    expect(landed.result.current.rows.map((row) => row.path)).toEqual([
      '/w/atlas/src',
      '/w/atlas/src/index.ts',
    ]);
  });
  it('a typed filter whose walk failed draws no rows and the filter error, never the unfiltered tree', () => {
    const base = rootLevel(['/w/atlas/src/index.ts', '/w/atlas/README.md']);
    const params = (filter: string) => ({
      tree: base,
      walk: null,
      walkPending: false,
      walkFailed: true,
      filter,
      openFile: vi.fn(),
      setNote: vi.fn(),
      focusEditor: vi.fn().mockReturnValue(true),
      focusFilter: vi.fn(),
      requestRowFocus: vi.fn(),
      requestEditorFocus: vi.fn(),
      treeRef: createRef<HTMLDivElement>(),
    });
    const typed = renderHook(() => useFilesTreeState(params('index')));
    expect(typed.result.current.rows).toEqual([]);
    const cleared = renderHook(() => useFilesTreeState(params('')));
    expect(cleared.result.current.rows.map((row) => row.path)).toEqual([
      '/w/atlas/src',
      '/w/atlas/README.md',
    ]);
  });
});
