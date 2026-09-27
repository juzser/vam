/**
 * THE FILE-BUFFER CONCERN, extracted out of `FilesTab.tsx`'s own scope --
 * which file is open per session, what each open file's in-memory text is,
 * and the load/open/edit/save/reload cycle that keeps it in step with disk.
 *
 * This started as a MOVE, not a rewrite: the save/dirty logic, the
 * `changed-on-disk` conflict handling, the `not-found` "start a new file"
 * path all read exactly as they did inside `FilesTab`. See that file's own
 * header for the reasoning; this module only relocated the scope. Save-time
 * normalisation (`files-save-normalize.ts`) landed on `FilesTab` after this
 * split and is folded in here rather than left behind in the component --
 * see `saveFile`'s own comment for what it does and why `FilesTab.tsx`'s
 * `onNormalizedBeforeSave` exists.
 */

import { useCallback, useMemo, useState } from 'react';
import type { FileReadResult, FileSignature, FileWriteResult } from '../../main/files/types.js';
import type { SourceError } from '../sources/port.js';
import { relativeLabel } from './files-editor-text.js';
import { normalizeForSaveWithMap } from './files-save-normalize.js';
import { encodeUnsaved } from './unsaved-files.js';

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'error'; readonly error: SourceError };

export type Buffer =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'editable';
      readonly content: string;
      readonly savedContent: string;
      readonly baseSignature: FileSignature | null;
      /** Opened via `not-found` — nothing is on disk at this path yet. */
      readonly isNew: boolean;
      readonly save: SaveState;
    }
  | { readonly kind: 'binary'; readonly size: number }
  | { readonly kind: 'refused'; readonly error: SourceError };

export const isDirty = (buffer: Buffer | undefined): boolean =>
  buffer?.kind === 'editable' && buffer.content !== buffer.savedContent;

export interface UseFileBuffersParams {
  readonly sessionId: string | null;
  /** The active session's tree root, for labelling unsaved files — `null`
   *  when nothing has been listed yet. */
  readonly root: string | null;
  readonly read: ((path: string) => Promise<FileReadResult>) | undefined;
  readonly write:
    | ((
        path: string,
        content: string,
        baseSignature: FileSignature | null,
      ) => Promise<FileWriteResult>)
    | undefined;
  /**
   * Fired only when saving trims/newlines the buffer's text out from under
   * the caret (`files-save-normalize.ts`) -- never on a save that changes
   * nothing (including the X-SET-2 no-op above, which returns before this
   * could ever fire). `mapOffset` is the normalisation's own offset map --
   * S3 in the cross-provider review -- so a caller holding a caret in the
   * OLD text can place it at the same logical position in the new text
   * rather than merely clamping it to a shorter length. The caret itself is
   * a DOM concern this hook does not own (`FilesTab.tsx`'s
   * `textareaRef`/`pendingSelection`), so it is reported here rather than
   * clamped inside the hook.
   */
  readonly onNormalizedBeforeSave?: (path: string, mapOffset: (offset: number) => number) => void;
}

export interface UseFileBuffersResult {
  readonly buffers: Record<string, Buffer>;
  readonly activePath: string | null;
  readonly activeBuffer: Buffer | undefined;
  /** The encoded set of dirty files across every open buffer — see
   *  `unsaved-files.ts`'s own `encodeUnsaved` for why a string. */
  readonly unsavedKey: string;
  readonly loadInto: (path: string) => Promise<void>;
  readonly openFile: (path: string) => void;
  readonly setContent: (path: string, content: string) => void;
  readonly saveFile: (path: string) => Promise<void>;
  readonly reloadFile: (path: string) => void;
}

export function useFileBuffers({
  sessionId,
  root,
  read,
  write,
  onNormalizedBeforeSave,
}: UseFileBuffersParams): UseFileBuffersResult {
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [activeBySession, setActiveBySession] = useState<Record<string, string | null>>({});

  const activePath = sessionId === null ? null : (activeBySession[sessionId] ?? null);
  const activeBuffer = activePath === null ? undefined : buffers[activePath];

  const unsavedKey = useMemo(
    () =>
      encodeUnsaved(
        Object.entries(buffers)
          .filter(([, buffer]) => isDirty(buffer))
          // `relativeLabel` only where a root is known. A buffer belonging to
          // another session's root falls through to the absolute path, which
          // is that function's own documented fallback and is the more useful
          // label in a dialog listing files from two directories.
          .map(([path]) => ({ path, label: root === null ? path : relativeLabel(root, path) })),
      ),
    [buffers, root],
  );

  /**
   * (Re-)loads `path` from disk, replacing whatever buffer it had. Used both
   * by a fresh open and by an explicit reload — the two differ only in
   * whether a buffer already existed, which `openFile` below checks before
   * ever calling this.
   */
  const loadInto = useCallback(
    async (path: string) => {
      if (read === undefined) return;
      setBuffers((prev) => ({ ...prev, [path]: { kind: 'loading' } }));
      try {
        const result = await read(path);
        setBuffers((prev) => ({
          ...prev,
          [path]: result.isBinary
            ? { kind: 'binary', size: result.signature.size }
            : {
                kind: 'editable',
                content: result.content,
                savedContent: result.content,
                baseSignature: result.signature,
                isNew: false,
                save: { kind: 'idle' },
              },
        }));
      } catch (reason) {
        const error = reason as SourceError;
        // `not-found` is not a failure here — it is the "create a new file"
        // path `authorize.ts` was built to allow. An empty, editable buffer
        // with `baseSignature: null` is exactly what `filesWrite` expects for
        // a path that does not exist yet.
        if (error.code === 'not-found') {
          setBuffers((prev) => ({
            ...prev,
            [path]: {
              kind: 'editable',
              content: '',
              savedContent: '',
              baseSignature: null,
              isNew: true,
              save: { kind: 'idle' },
            },
          }));
          return;
        }
        setBuffers((prev) => ({ ...prev, [path]: { kind: 'refused', error } }));
      }
    },
    [read],
  );

  /**
   * Switches the editor to `path` and, ONLY when nothing is open at that
   * path yet, loads it. An already-open buffer — including a dirty one — is
   * shown exactly as it stood, never refetched: this is the whole of how
   * switching between files keeps unsaved text (see `FilesTab.tsx`'s own
   * header).
   */
  const openFile = useCallback(
    (path: string) => {
      if (sessionId === null) return;
      setActiveBySession((prev) => ({ ...prev, [sessionId]: path }));
      setBuffers((prev) => {
        if (prev[path] !== undefined) return prev;
        void loadInto(path);
        return prev;
      });
    },
    [sessionId, loadInto],
  );

  const setContent = useCallback((path: string, content: string) => {
    setBuffers((prev) => {
      const buffer = prev[path];
      if (buffer?.kind !== 'editable') return prev;
      return { ...prev, [path]: { ...buffer, content } };
    });
  }, []);

  /**
   * THE SAVE. `sentContent`/`baseSignature` are captured BEFORE the request
   * goes out and used to build the next state AFTER it answers, never read
   * fresh from `buffers` inside the resolve handler — the operator can keep
   * typing while a save is in flight, and crediting whatever is live in
   * state at resolve time as "saved" would silently mark text nobody ever
   * asked vam to write as clean.
   *
   * X-SET-2 — AN UNEDITED BUFFER IS A NO-OP SAVE, FULL STOP. `isDirty` is the
   * one true "has the operator actually changed anything" check this module
   * already carries (the dirty dot on screen reads the same thing), so a
   * clean buffer returns before any of the rest of this runs: no `write`
   * call, no normalisation, no `save` state transition, no bumped
   * `baseSignature`/mtime. Mod-s pressed on a file nobody touched must be
   * indistinguishable, on disk, from Mod-s never having been pressed —
   * previously this ran the normaliser and re-wrote the file regardless,
   * which could touch the mtime of a file that was only ever READ.
   *
   * TRIM TRAILING WHITESPACE, ONE FINAL NEWLINE — the operator's save-time
   * ask (`files-save-normalize.ts`'s own header carries the behaviour table,
   * the extensions exempted from the per-line trim, and why `.env`/`.ini`
   * are not among them). Computed from the buffer captured above, never
   * re-read from `buffers` after this point, for the same reason
   * `sentContent`/`baseSignature` already are. ONLY WHEN NORMALISING
   * ACTUALLY CHANGED SOMETHING does the buffer's own content move and
   * `onNormalizedBeforeSave` fire — a save that turned out to need no
   * rewrite gets no caret reset and no extra render.
   */
  const saveFile = useCallback(
    async (path: string) => {
      const buffer = buffers[path];
      if (buffer?.kind !== 'editable' || write === undefined) return;
      if (!isDirty(buffer)) return;
      const normalized = normalizeForSaveWithMap(buffer.content, path);
      const sentContent = normalized.value;
      const baseSignature = buffer.baseSignature;
      if (sentContent !== buffer.content) {
        onNormalizedBeforeSave?.(path, normalized.mapOffset);
        setContent(path, sentContent);
      }
      setBuffers((prev) => {
        const b = prev[path];
        return b?.kind === 'editable'
          ? { ...prev, [path]: { ...b, save: { kind: 'saving' } } }
          : prev;
      });
      try {
        const result = await write(path, sentContent, baseSignature);
        setBuffers((prev) => {
          const b = prev[path];
          if (b?.kind !== 'editable') return prev;
          return {
            ...prev,
            [path]: {
              ...b,
              savedContent: sentContent,
              baseSignature: result.signature,
              isNew: false,
              save: { kind: 'idle' },
            },
          };
        });
      } catch (reason) {
        const error = reason as SourceError;
        setBuffers((prev) => {
          const b = prev[path];
          if (b?.kind !== 'editable') return prev;
          return {
            ...prev,
            [path]: {
              ...b,
              save:
                error.code === 'changed-on-disk' ? { kind: 'conflict' } : { kind: 'error', error },
            },
          };
        });
      }
    },
    [buffers, write, setContent, onNormalizedBeforeSave],
  );

  /**
   * THE ONE ACTION THAT DISCARDS LOCAL TEXT ON PURPOSE — reloading a file
   * whose `changed-on-disk` refusal said an agent (or the operator, in
   * another program) moved underneath it. It re-runs `loadInto`, which
   * replaces the buffer wholesale, and is reachable only from a labelled
   * button next to the conflict banner — never a keystroke, never automatic.
   */
  const reloadFile = useCallback(
    (path: string) => {
      void loadInto(path);
    },
    [loadInto],
  );

  return {
    buffers,
    activePath,
    activeBuffer,
    unsavedKey,
    loadInto,
    openFile,
    setContent,
    saveFile,
    reloadFile,
  };
}
