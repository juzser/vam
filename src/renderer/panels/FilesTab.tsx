/**
 * The Files tab: a flat, filterable list of every file under the focused
 * session's own working directory, and a plain-textarea editor for the one
 * the operator picked. The operator's own words were "quản lý file" --
 * managing, not just editing -- and `.env` specifically, which is why
 * browsing exists at all and why dotfiles are never hidden from it.
 *
 * NO EDITOR LIBRARY. vam ships eleven runtime dependencies and none of them
 * is Monaco, CodeMirror or anything like them, and this tab does not change
 * that. orca -- a sibling ADE doing the same job -- ships Monaco but turns
 * every language service off (`noSemanticValidation`, `noSuggestionDiagnostics`,
 * `noSyntaxValidation`), because a sandboxed worker cannot resolve a real
 * project's imports and the false-positive tail is worse than having no
 * diagnostics at all -- it keeps Monaco as, in effect, a coloured textarea
 * with a good gutter. `.env` and "a few other files" is a narrower job than
 * orca's own, so a `<textarea>` with a line-number gutter, trapped Tab
 * indentation and a monospace face buys most of the same value at zero
 * bundle cost. No syntax highlighting is drawn, on purpose: a highlighter
 * that mis-tokenises unfamiliar syntax is a worse lie than drawing none.
 *
 * A FLAT LIST, NOT A TREE. The operator's own repository can be a real
 * monorepo, so "flat" here means `list.ts`'s own recursive walk -- every
 * file under the root, filtered by typing, exactly the shape `orca`'s own
 * quick-open already is and the shape `cmdk` (already a dependency, already
 * vam's OWN choice for the same job -- see `CommandPalette.tsx`'s header, "the
 * same library orca uses for its own QuickOpen") already renders well. A
 * real expand/collapse tree is a lot more code for a feature whose own
 * stated audience opens `.env` and a handful of named files, not one that
 * spends its time navigating a directory structure by hand.
 *
 * TWO SUB-VIEWS, NEVER A PERMANENT SPLIT. Browsing (the filtered list) and
 * editing (one open file) trade places in the same tab, the way Terminal and
 * Agents trade places on the bar itself -- a split would halve an already
 * narrow detail pane for a feature whose own population is "a few files".
 * Switching between them never discards anything: every file the operator
 * has opened keeps its own buffer, in `buffers` below, for as long as this
 * component stays mounted (see `DetailPanel.tsx`'s own comment on why it
 * stays mounted across a pane-tab switch -- the short version: unsaved text
 * is the one thing this feature must never lose).
 *
 * THE FOURTH INSERT SCOPE. `keyboard/focus-scope.ts` names three today: the
 * question card, the composer, the terminal pane. The editor's own
 * `<textarea>` is marked `data-insert-scope`/`data-insert-stop` below,
 * conditionally on `!hidden` -- see that prop's own comment for why an
 * ALWAYS-MOUNTED stop would silently break `I` on every OTHER tab. The list's
 * own filter input and the "new file" input are deliberately left UNMARKED,
 * the same as `SessionList.tsx`'s own session-search box: a native
 * `<input>`/`<textarea>` is already exempt from vam's chord grammar by tag
 * name (`Canvas.tsx`'s own `typing` guard), which is what makes typing into
 * either safe without the extra mark; the mark itself is reserved for
 * surfaces the STATUS BAR must call Insert, and neither a filter box nor a
 * "name a new file" box is that.
 */

import { Command } from 'cmdk';
import { FilePlus, FolderOpen, Loader2, RefreshCw, Save } from 'lucide-react';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  FileListResult,
  FileReadResult,
  FileSignature,
  FileWriteResult,
} from '../../main/files/types.js';
import { normalizeKey } from '../keyboard/chords.js';
import { insertScopeMark, insertStopMark } from '../keyboard/focus-scope.js';
import type { SourceError } from '../sources/port.js';
import { applyTab, relativeLabel } from './files-editor-text.js';

export type ReadFile = (path: string) => Promise<FileReadResult>;
export type WriteFile = (
  path: string,
  content: string,
  baseSignature: FileSignature | null,
) => Promise<FileWriteResult>;
export type ListFiles = (sessionId: string) => Promise<FileListResult>;

export type FilesTabProps = {
  /**
   * `true` while another tab is showing. NOT unmounted — see this file's own
   * header — only removed from layout and from the Tab order (`hidden`,
   * `display: none`), which is also what keeps a hidden, hence unfocusable,
   * `data-insert-stop` from ever being a candidate `I` could land on: a
   * `display: none` element cannot take DOM focus at all, so
   * `focusInsertStop`'s blind `.focus()` silently does nothing to it. The
   * mark is additionally withheld outright while hidden, belt-and-braces,
   * because "invisible but still first in document order" is exactly the
   * shape of bug a later reorder of this file could otherwise reintroduce.
   */
  readonly hidden: boolean;
  readonly sessionId: string | null;
  readonly list: ListFiles | undefined;
  readonly read: ReadFile | undefined;
  readonly write: WriteFile | undefined;
  /**
   * `DetailPanel.tsx`'s own `cornerOverlay`: the view-icon strip floats,
   * `position: absolute`, over this tab's own top-right corner whenever the
   * pane is focused and this is not a phone, exactly as it does over the
   * transcript column (`TurnBlock`'s own `reserveCorner`) -- and it takes
   * real clicks, not just paint. Measured directly: without this, the Save
   * button sat under the Agents icon and Playwright's own click retried for
   * thirty seconds before timing out on the element actually receiving it.
   */
  readonly reserveCorner: number;
};

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'error'; readonly error: SourceError };

type Buffer =
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

type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly result: FileListResult }
  | { readonly kind: 'error'; readonly error: SourceError };

const isDirty = (buffer: Buffer | undefined): boolean =>
  buffer?.kind === 'editable' && buffer.content !== buffer.savedContent;

const NO_BRIDGE: SourceError = {
  kind: 'unreachable',
  code: 'no-bridge',
  message: 'the file editor is only available in the vam desktop app',
};

export function FilesTab({ hidden, sessionId, list, read, write, reserveCorner }: FilesTabProps) {
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [activeBySession, setActiveBySession] = useState<Record<string, string | null>>({});
  const [listing, setListing] = useState<Record<string, ListState>>({});
  const [newFileName, setNewFileName] = useState('');

  const activePath = sessionId === null ? null : (activeBySession[sessionId] ?? null);
  const activeBuffer = activePath === null ? undefined : buffers[activePath];

  /**
   * THE ONE THING THAT CANNOT SURVIVE: THE APP CLOSING. Every OTHER exit this
   * component has -- Escape/Mod-[ off the editor, switching files, switching
   * to another pane tab and back -- keeps every open buffer alive in
   * `buffers` above for as long as `FilesTab` stays mounted (see this file's
   * own header). Quitting vam, or closing this browser tab, ends that: there
   * is no main-process persistence for a draft, so any of them WOULD be lost
   * silently, which is the one outcome the brief that built this tab named as
   * worse than not shipping it at all. `beforeunload` is the one hook a page
   * has for "something you have not saved is about to disappear", and it is
   * armed exactly when — no earlier, no later — `buffers` actually holds
   * unsaved text, across every open file and every session, not only the one
   * currently showing.
   */
  const anyDirty = Object.values(buffers).some(isDirty);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome (and therefore Electron's renderer) still requires the legacy
      // `returnValue` assignment to actually show its own "leave site?"
      // prompt; `preventDefault()` alone is the modern, spec path and is kept
      // too because it is what a non-Chromium engine honours.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);
  const currentListing = sessionId === null ? undefined : listing[sessionId];

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
   * Switches the active view to `path` and, ONLY when nothing is open at
   * that path yet, loads it. An already-open buffer — including a dirty one
   * — is shown exactly as it stood, never refetched: this is the whole of
   * how switching between files keeps unsaved text (see this file's header).
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

  const closeEditor = useCallback(() => {
    if (sessionId === null) return;
    setActiveBySession((prev) => ({ ...prev, [sessionId]: null }));
  }, [sessionId]);

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
   */
  const saveFile = useCallback(
    async (path: string) => {
      const buffer = buffers[path];
      if (buffer?.kind !== 'editable' || write === undefined) return;
      const sentContent = buffer.content;
      const baseSignature = buffer.baseSignature;
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
    [buffers, write],
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

  const fetchListing = useCallback(() => {
    if (sessionId === null || list === undefined) return;
    const forSession = sessionId;
    setListing((prev) => ({ ...prev, [forSession]: { kind: 'loading' } }));
    list(forSession)
      .then((result) => {
        setListing((prev) => ({ ...prev, [forSession]: { kind: 'ready', result } }));
      })
      .catch((reason: unknown) => {
        setListing((prev) => ({
          ...prev,
          [forSession]: { kind: 'error', error: reason as SourceError },
        }));
      });
  }, [sessionId, list]);

  // Fetches once per session the operator focuses -- never on every render,
  // and never again once an answer (ready OR error) is cached for it. The
  // refresh button is the explicit way to ask again; landing on a session
  // Files has already listed must not repeat a request nothing asked for.
  useEffect(() => {
    if (sessionId === null || listing[sessionId] !== undefined) return;
    fetchListing();
  }, [sessionId, listing, fetchListing]);

  // Caret restore after `applyTab` replaces the textarea's controlled value
  // — see `files-editor-text.ts`'s own header. Runs after every render; the
  // guard makes that cheap, and it is the only thing keyed on `activePath`
  // that can safely apply a `setSelectionRange` meant for it.
  const pendingSelection = useRef<{ path: string; start: number; end: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const pending = pendingSelection.current;
    if (pending === null || pending.path !== activePath) return;
    textareaRef.current?.setSelectionRange(pending.start, pending.end);
    pendingSelection.current = null;
  });

  const onEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (activePath === null) return;
      if (event.key === 'Escape' || normalizeKey(event) === 'Mod-[') {
        // THE WAY OUT, exactly as it is for the composer (`DetailPanel.tsx`'s
        // own `Mod-[` branch): blur, hand the keyboard back to Select. NOT a
        // discard — the buffer is untouched, dirty or not, so unsaved text
        // survives this exactly as it survives a pane-tab switch.
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (event.key === 'Tab') {
        // TRAPPED, not a focus move — see `applyTab`'s own header for why
        // that is safe here specifically: Escape and Mod-[ are both real
        // exits already, unlike `TerminalTab`, which has only Tab.
        event.preventDefault();
        const target = event.currentTarget;
        const result = applyTab(
          target.value,
          target.selectionStart ?? 0,
          target.selectionEnd ?? 0,
          event.shiftKey,
        );
        pendingSelection.current = {
          path: activePath,
          start: result.selectionStart,
          end: result.selectionEnd,
        };
        setContent(activePath, result.value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        // Blocked here before it reaches the browser's own "Save Page" —
        // `preventDefault` on the native event is what the window listener's
        // `defaultPrevented` check (`Canvas.tsx`) then honours too.
        event.preventDefault();
        void saveFile(activePath);
      }
    },
    [activePath, setContent, saveFile],
  );

  if (sessionId === null) {
    return (
      <p data-files data-files-empty hidden={hidden} className="text-control text-ink-faint">
        No session selected — pick one in the sidebar.
      </p>
    );
  }

  if (list === undefined || read === undefined || write === undefined) {
    return (
      <p data-files data-files-unavailable hidden={hidden} className="text-control text-ink-faint">
        {NO_BRIDGE.message}
      </p>
    );
  }

  if (activePath !== null && activeBuffer !== undefined) {
    return (
      <FileEditor
        hidden={hidden}
        reserveCorner={reserveCorner}
        path={activePath}
        root={currentListing?.kind === 'ready' ? currentListing.result.root : null}
        buffer={activeBuffer}
        textareaRef={textareaRef}
        onChange={(content) => setContent(activePath, content)}
        onKeyDown={onEditorKeyDown}
        onSave={() => void saveFile(activePath)}
        onReload={() => reloadFile(activePath)}
        onBrowse={closeEditor}
      />
    );
  }

  return (
    <div data-files data-files-list hidden={hidden} className="flex min-h-0 flex-1 flex-col gap-2">
      {currentListing?.kind === 'error' && (
        <p
          data-files-refusal={currentListing.error.code}
          className="flex-none text-control text-failed"
        >
          {currentListing.error.message}
        </p>
      )}
      <form
        data-files-new
        className="flex flex-none items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newFileName.trim();
          const root = currentListing?.kind === 'ready' ? currentListing.result.root : null;
          if (name === '' || root === null) return;
          const base = root.endsWith('/') ? root.slice(0, -1) : root;
          openFile(`${base}/${name.replace(/^\/+/, '')}`);
          setNewFileName('');
        }}
      >
        <FilePlus
          size={13}
          strokeWidth={1.6}
          className="flex-none text-ink-faint"
          aria-hidden="true"
        />
        <input
          value={newFileName}
          onChange={(event) => setNewFileName(event.target.value)}
          placeholder="new file, relative to this session's directory…"
          aria-label="create a new file"
          className="min-w-0 flex-1 rounded-[7px] border border-line bg-card px-2 py-1 font-mono text-control text-ink outline-none placeholder:text-ink-faint"
        />
      </form>
      <Command
        label="files"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[9px] border border-line bg-panel"
        loop
        onKeyDown={(event) => {
          if (event.key === 'Escape' || normalizeKey(event) === 'Mod-[') {
            event.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
          }
        }}
      >
        <div className="flex flex-none items-center gap-1.5 border-line border-b px-2.5 py-1.5">
          <FolderOpen
            size={13}
            strokeWidth={1.6}
            className="flex-none text-ink-faint"
            aria-hidden="true"
          />
          <Command.Input
            autoFocus={!hidden}
            placeholder="filter files…"
            className="min-w-0 flex-1 bg-transparent font-mono text-control text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            aria-label="refresh file list"
            onClick={fetchListing}
            className="vam-tap flex-none cursor-pointer rounded-[6px] p-1 text-ink-faint hover:text-ink"
          >
            <RefreshCw size={13} strokeWidth={1.6} />
          </button>
        </div>
        <Command.List className="vam-no-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
          {currentListing?.kind === 'loading' && (
            <p data-files-listing-pending className="px-2 py-3 text-control text-ink-faint">
              Reading the directory…
            </p>
          )}
          <Command.Empty className="px-2 py-3 text-control text-ink-faint">No match</Command.Empty>
          {currentListing?.kind === 'ready' &&
            currentListing.result.files.map((path) => {
              const dirty = isDirty(buffers[path]);
              return (
                <Command.Item
                  key={path}
                  value={path}
                  data-files-row
                  data-files-row-path={path}
                  onSelect={() => openFile(path)}
                  className="flex cursor-pointer items-baseline gap-1.5 rounded-[6px] px-2 py-1 font-mono text-control text-ink data-[selected=true]:bg-line-strong"
                >
                  {dirty && (
                    <span
                      data-files-dirty
                      aria-hidden="true"
                      className="flex-none rounded-full bg-ink-dim"
                      style={{ width: 6, height: 6 }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {relativeLabel(currentListing.result.root, path)}
                  </span>
                </Command.Item>
              );
            })}
        </Command.List>
        {currentListing?.kind === 'ready' && currentListing.result.truncated && (
          <p className="flex-none border-line border-t px-2.5 py-1 text-meta text-ink-faint">
            Showing the first {currentListing.result.files.length.toLocaleString()} files — this
            directory has more.
          </p>
        )}
      </Command>
    </div>
  );
}

function FileEditor({
  hidden,
  reserveCorner,
  path,
  root,
  buffer,
  textareaRef,
  onChange,
  onKeyDown,
  onSave,
  onReload,
  onBrowse,
}: {
  readonly hidden: boolean;
  readonly reserveCorner: number;
  readonly path: string;
  readonly root: string | null;
  readonly buffer: Buffer;
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly onChange: (content: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
  readonly onBrowse: () => void;
}) {
  const label = root === null ? path : relativeLabel(root, path);
  const dirty = isDirty(buffer);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  /**
   * The gutter's own text: `1\n2\n3...`, one number per LINE of the buffer
   * (never per visual row -- see the editor's own comment for why the
   * textarea must not wrap). An empty file is one line, the same way a
   * blank editor shows a caret on line 1, which is why this counts
   * separators plus one rather than counting non-empty pieces.
   */
  const lineNumbers =
    buffer.kind === 'editable'
      ? Array.from({ length: buffer.content.split('\n').length }, (_, index) => index + 1).join(
          '\n',
        )
      : '';

  /**
   * Keep the numbers level with the text. The textarea owns the scroll (it
   * is the only one of the two that can be scrolled by a caret, a wheel or a
   * drag); the gutter follows it, one assignment, on the same frame the
   * browser already scheduled for the scroll event -- no state, no re-render.
   */
  const syncGutter = useCallback(() => {
    const gutter = gutterRef.current;
    const textarea = textareaRef.current;
    if (gutter !== null && textarea !== null) {
      gutter.scrollTop = textarea.scrollTop;
    }
  }, [textareaRef]);

  return (
    <div
      data-files
      data-files-editor-view
      hidden={hidden}
      className="flex min-h-0 flex-1 flex-col gap-1.5"
    >
      {/* THE CORNER, RESERVED BY MEASUREMENT -- `DetailPanel.tsx`'s own
          `cornerReserve`, which reads the pill's real width off the element
          rather than restating it as a constant. Without any reservation the
          Save button sits under the view icons; with the `6rem` this row
          first used, it still did: measured at a 1100px window, the pill is
          118px once this tab adds a fifth view icon, and the button's right
          18px stayed under it. `elementFromPoint` at the button's CENTRE
          still returned the button, so a click-based check passed the whole
          way through -- which is exactly why this is reserved against a
          measured width now and asserted as a rectangle, not a click, in
          `e2e/files-tab-keyboard-shots.mjs`. */}
      <div
        className="flex flex-none items-center gap-1.5"
        style={reserveCorner > 0 ? { paddingRight: reserveCorner } : undefined}
      >
        <button
          type="button"
          onClick={onBrowse}
          aria-label="back to the file list"
          className="vam-tap flex-none cursor-pointer rounded-[6px] p-1 text-ink-faint hover:text-ink"
        >
          <FolderOpen size={13} strokeWidth={1.6} />
        </button>
        <span
          data-files-path
          className="min-w-0 flex-1 truncate font-mono text-control text-ink-dim"
          title={path}
        >
          {label}
          {buffer.kind === 'editable' && buffer.isNew && ' (new)'}
        </span>
        {dirty && (
          <span
            data-files-dirty
            aria-hidden="true"
            className="flex-none rounded-full bg-ink-dim"
            style={{ width: 6, height: 6 }}
          />
        )}
        {buffer.kind === 'editable' && (
          <button
            type="button"
            data-files-save
            data-files-save-state={buffer.save.kind}
            onClick={onSave}
            disabled={buffer.save.kind === 'saving'}
            aria-label="save this file"
            className="vam-tap flex flex-none cursor-pointer items-center gap-1 rounded-[6px] border border-line px-2 py-1 text-control text-ink-dim hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60"
          >
            {buffer.save.kind === 'saving' ? (
              <Loader2 size={12} strokeWidth={1.8} className="animate-spin" />
            ) : (
              <Save size={12} strokeWidth={1.8} />
            )}
            Save
          </button>
        )}
      </div>

      {buffer.kind === 'loading' && (
        <p data-files-loading className="text-control text-ink-faint">
          Reading {label}…
        </p>
      )}

      {buffer.kind === 'binary' && (
        <p data-files-binary className="text-control text-ink-faint">
          {label} looks like a binary file ({buffer.size.toLocaleString()} bytes) — vam does not
          show binary content.
        </p>
      )}

      {buffer.kind === 'refused' && (
        <p data-files-refusal={buffer.error.code} className="text-control text-failed">
          {buffer.error.message}
        </p>
      )}

      {buffer.kind === 'editable' && (
        <>
          {/* THE ONE REFUSAL THAT MATTERS MOST, drawn as an offer rather than
              a failure: the file changed on disk since this buffer's own
              baseline, so the write was refused rather than overwriting
              whatever an agent (or the operator, elsewhere) just wrote. The
              operator's own text is UNTOUCHED — still in the textarea below,
              still what `Reload` will ask them to give up, in those words,
              before it does. */}
          {buffer.save.kind === 'conflict' && (
            <p
              data-files-conflict
              role="status"
              className="flex flex-none items-center gap-2 rounded-[8px] border border-failed bg-card px-2.5 py-1.5 text-control text-failed"
            >
              <span className="min-w-0 flex-1">
                {label} changed on disk since you opened it — your edits below are still here, but
                saving them now would overwrite what changed.
              </span>
              <button
                type="button"
                data-files-reload
                onClick={onReload}
                className="vam-tap flex-none cursor-pointer rounded-[6px] border border-failed px-1.5 py-0.5 text-meta hover:bg-failed hover:text-ground"
              >
                Reload — discards your edits
              </button>
            </p>
          )}
          {buffer.save.kind === 'error' && (
            <p
              data-files-refusal={buffer.save.error.code}
              className="flex-none text-control text-failed"
            >
              {buffer.save.error.message}
            </p>
          )}
          {/* AN INSERT SCOPE, AND AN INSERT STOP -- ONLY WHILE VISIBLE.
              `hidden` is checked here rather than left to CSS alone: an
              always-mounted, merely-hidden `data-insert-stop` is still the
              FIRST match `focusInsertStop`'s blind `querySelector` would find
              in document order on every OTHER tab, and a `display: none`
              element cannot in fact receive the `.focus()` call that follows
              — so leaving the mark on regardless would make `I`, pressed
              anywhere in this pane, silently fail to reach the composer the
              moment this build has ever shown the Files tab once. See this
              file's own header. */}
          {/* THE GUTTER AND THE TEXTAREA SHARE ONE BOX, and every property
              that keeps their two columns in step is load-bearing rather
              than cosmetic:

              * `whiteSpace: 'pre'` ON THE TEXTAREA. A wrapped line occupies
                two ROWS but is still one LINE, so the moment the textarea
                soft-wraps, number N stops pointing at line N and every
                number below it is wrong -- the single classic bug of a
                hand-built gutter. Not wrapping is also what Monaco (orca's
                own editor) does by default, and it is why `applyTab` indents
                with spaces rather than a tab byte: a tab's RENDERED width is
                a font-and-platform question neither column could answer the
                same way.
              * ONE TEXT NODE, joined by newlines, inside a `pre` box -- not
                one element per line. The numbers then inherit exactly the
                same line box the text does instead of depending on a second
                set of margins agreeing with the first.
              * `overflow-hidden` ON THE GUTTER, scrolled only by the sync
                below, so it can never be scrolled independently into a
                position the text is not at.
              * The MARKS STAY ON THE TEXTAREA, never on this wrapper: the
                insert scope has to be the thing that actually takes focus.
          */}
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-[9px] border border-line bg-panel focus-within:border-line-strong">
            <div
              ref={gutterRef}
              data-files-gutter
              aria-hidden="true"
              className="vam-no-scrollbar flex-none select-none overflow-hidden py-2 pr-2 pl-3 text-right font-mono text-control text-ink-faint leading-[1.5]"
              style={{ whiteSpace: 'pre' }}
            >
              {lineNumbers}
            </div>
            <textarea
              ref={textareaRef}
              data-files-editor
              {...(hidden ? {} : insertScopeMark)}
              {...(hidden ? {} : insertStopMark)}
              value={buffer.content}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              onScroll={syncGutter}
              spellCheck={false}
              aria-label={`edit ${label}`}
              className="vam-no-scrollbar min-h-0 min-w-0 flex-1 resize-none border-0 bg-transparent py-2 pr-3 pl-1 font-mono text-control text-ink leading-[1.5] outline-none"
              style={{ whiteSpace: 'pre', overflowWrap: 'normal' }}
            />
          </div>
        </>
      )}
    </div>
  );
}
