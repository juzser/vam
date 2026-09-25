/**
 * THE DIRECTORY-TREE CONCERN, extracted out of `FilesTab.tsx`'s own scope --
 * which directories are open, where the tree's own cursor sits, the rows
 * that fall out of the two, and the tree's keyboard.
 *
 * This is a MOVE, not a rewrite: `rows`' derivation still goes through
 * `files-tree.ts`'s own `fileTreeRows`, and `onTreeKeyDown`'s semantics are
 * `resolveTreeKey`'s, carried out key for key exactly as they were inside
 * `FilesTab`. See that file's own header for the reasoning; this module only
 * relocates the scope.
 *
 * WHAT STAYS OUTSIDE. `setNote`, `openFile`, `focusEditor` and the two
 * focus-intent flags (`requestRowFocus`/`requestEditorFocus`) are not tree
 * state -- they are shared with the editor half of the tab (the format
 * button, the preview toggle, an incoming `FileOpenRequest`) and moving them
 * here would only pull that half's concerns into this one's scope, the exact
 * thing this extraction exists to stop. They are taken as parameters instead.
 */

import type { KeyboardEvent, RefObject } from 'react';
import { useCallback, useMemo, useState } from 'react';
import type { FileListResult } from '../../main/files/types.js';
import { normalizeKey } from '../keyboard/chords.js';
import { type FileTreeRow, fileTreeRows, resolveTreeKey } from './files-tree.js';

export interface UseFilesTreeStateParams {
  readonly ready: FileListResult | null;
  readonly filter: string;
  readonly openFile: (path: string) => void;
  readonly setNote: (note: string | null) => void;
  readonly focusEditor: () => boolean;
  /**
   * Puts the keyboard in the filter box and SELECTS its existing text — the
   * one `focusFilter` every surface in `FilesTab.tsx` reaches the filter
   * through (`/` from the tree is one of them), so a second `.focus()`
   * written out here is not a second answer to what the key does. See that
   * function's own header in `FilesTab.tsx`.
   */
  readonly focusFilter: () => void;
  readonly requestRowFocus: () => void;
  readonly requestEditorFocus: () => void;
  readonly treeRef: RefObject<HTMLDivElement | null>;
}

export interface UseFilesTreeStateResult {
  readonly rows: readonly FileTreeRow[];
  readonly cursorIndex: number;
  readonly cursorRow: FileTreeRow | null;
  readonly expanded: ReadonlySet<string>;
  readonly cursorPath: string | null;
  readonly setCursorPath: (path: string | null) => void;
  readonly toggleDir: (path: string, open: boolean) => void;
  /** Opens `path` in the editor and puts the tree's cursor on it. */
  readonly openFromTree: (path: string, intoEditor: boolean) => void;
  readonly focusCursorRow: () => boolean;
  readonly onTreeKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function useFilesTreeState({
  ready,
  filter,
  openFile,
  setNote,
  focusEditor,
  focusFilter,
  requestRowFocus,
  requestEditorFocus,
  treeRef,
}: UseFilesTreeStateParams): UseFilesTreeStateResult {
  /**
   * Which directories are open, by absolute path — so nothing has to be
   * keyed by session: a path belongs to exactly one session's root, and a
   * path from another root simply never matches a row here. Same for the
   * cursor below.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [cursorPath, setCursorPath] = useState<string | null>(null);

  /** The visible rows, in draw order. See `files-tree.ts`. */
  const rows: readonly FileTreeRow[] = useMemo(
    () =>
      ready === null
        ? []
        : fileTreeRows({ root: ready.root, files: ready.files, expanded, filter }),
    [ready, expanded, filter],
  );
  /**
   * WHERE THE TREE'S CURSOR IS, derived rather than held — the same rule
   * `keyboard/focus-scope.ts` makes about the cursor MODE, for the same
   * reason. A stored index would go stale the moment a filter, an expand or
   * a fresh listing changed the rows under it; a stored PATH that is no
   * longer drawn simply falls back to the first row.
   */
  const cursorIndex = Math.max(
    0,
    rows.findIndex((row) => row.path === cursorPath),
  );
  const cursorRow = rows[cursorIndex] ?? null;

  const focusCursorRow = useCallback((): boolean => {
    const row = treeRef.current?.querySelector<HTMLElement>('[data-files-cursor]') ?? null;
    if (row === null) return false;
    row.focus();
    return row.ownerDocument.activeElement === row;
  }, [treeRef]);

  const openFromTree = useCallback(
    (path: string, intoEditor: boolean) => {
      setNote(null);
      setCursorPath(path);
      openFile(path);
      if (intoEditor) requestEditorFocus();
      else requestRowFocus();
    },
    [openFile, setNote, requestEditorFocus, requestRowFocus],
  );

  const toggleDir = useCallback(
    (path: string, open: boolean) => {
      setNote(null);
      setCursorPath(path);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.add(path);
        else next.delete(path);
        return next;
      });
    },
    [setNote],
  );

  /**
   * THE TREE'S OWN KEYBOARD. `resolveTreeKey` decides; this only carries the
   * decision out.
   *
   * `preventDefault` on exactly what it answered, and NOTHING else -- a
   * `null` step falls through unprevented so `Alt-<digit>`, `Mod-k` and the
   * rest of the grammar still work with the keyboard in here. It is
   * deliberately not `stopPropagation`, for the reason `focus-scope.ts`
   * states about the question list: swallowing everything would strand the
   * keyboard in a list it could not leave.
   */
  const onTreeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const key = normalizeKey(event);
      if (key === null) return;
      const step = resolveTreeKey({ key, rows, index: cursorIndex, expanded });
      if (step === null) return;
      event.preventDefault();
      switch (step.kind) {
        case 'move':
          setNote(null);
          setCursorPath(rows[step.index]?.path ?? null);
          requestRowFocus();
          return;
        case 'expand':
          toggleDir(step.path, true);
          requestRowFocus();
          return;
        case 'collapse':
          toggleDir(step.path, false);
          requestRowFocus();
          return;
        case 'open':
          openFromTree(step.path, step.focusEditor);
          return;
        case 'filter':
          focusFilter();
          return;
        case 'editor':
          setNote(focusEditor() ? null : 'no file is open — press Enter on one in the tree first');
          return;
        case 'leave':
          (document.activeElement as HTMLElement | null)?.blur();
          return;
        case 'refuse':
          setNote(step.message);
          return;
      }
    },
    [
      rows,
      cursorIndex,
      expanded,
      toggleDir,
      openFromTree,
      focusEditor,
      focusFilter,
      setNote,
      requestRowFocus,
    ],
  );

  return {
    rows,
    cursorIndex,
    cursorRow,
    expanded,
    cursorPath,
    setCursorPath,
    toggleDir,
    openFromTree,
    focusCursorRow,
    onTreeKeyDown,
  };
}
