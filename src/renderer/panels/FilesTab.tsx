/**
 * The Files tab: the session's own working directory as a TREE on the right,
 * a plain-textarea editor for the open file in the middle, and both on screen
 * at once. The operator's own words were "quản lý file" -- managing, not just
 * editing -- and `.env` specifically, which is why browsing exists at all and
 * why dotfiles are never hidden from it.
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
 * bundle cost.
 *
 * COLOUR, AND THE RULE THAT SURVIVED IT. This tab shipped with no syntax
 * highlighting at all, on a stated rule: "a highlighter that mis-tokenises
 * unfamiliar syntax is a worse lie than drawing none." The operator has since
 * asked for styling, so vam draws it -- and the rule is intact, as the list of
 * what `files-highlight.ts` declines to colour (it names `.ts`'s regex
 * literals and `.sh`'s heredocs, both of which defeat a scanner this size on
 * VALID input). A file vam is not confident about renders as plain text, with
 * no overlay mounted at all.
 *
 * AND ONE FILE TYPE HAS A SECOND VIEW. Markdown renders, through the very
 * same `OUT_MARKDOWN` component map the transcript dresses an agent's answer
 * with (`out-markdown.tsx`), reached by a toggle beside the formatter and by
 * `Mod-Shift-m`. The two views are exclusive and the textarea is genuinely
 * UNMOUNTED in preview rather than hidden -- see the `hidden` prop's own
 * comment for why a merely-hidden `data-insert-stop` is the trap this file
 * keeps walking into. Nothing about the buffer changes when the view does:
 * `buffers` is the only thing holding unsaved text, the toggle does not touch
 * it, and a view control that lost an edit would be worse than no control.
 * The preview is READ-ONLY, which is what lets the toggle be free of every
 * question a two-way editor would raise.
 *
 * AND A FORMATTER, WHICH IS MOSTLY REFUSALS. `files-format.ts` reformats only
 * where it can prove it changed nothing but whitespace -- a JSON file, guarded
 * token by token, and the blank lines and comments of a `.env`/`.ini` -- and
 * refuses aloud, by name, for everything else. The operator asked for it in
 * vam's own style ("tự format theo kiểu của mình") rather than the open
 * project's, which is what makes a refusal an acceptable answer: there is no
 * other formatter here to fall back on and nothing to be consistent with.
 *
 * THE OVERLAY IS TWO LAYERS HOLDING ONE TEXT. A `<textarea>` cannot be styled
 * inside, so the colours are painted on a `<pre>` BEHIND it and the textarea's
 * own text is made transparent (its caret is not). That is only an illusion
 * for as long as every one of these holds, which is why each is asserted in
 * `e2e/files-tab-keyboard-shots.mjs` against real Chromium rather than
 * described here: identical font, size, line-height and padding box on both
 * layers; the overlay scrolls with the textarea in BOTH axes; neither wraps;
 * and the gutter stays level with both. happy-dom lays none of that out.
 *
 * A TREE ON THE RIGHT, NOT A SUB-VIEW THAT TRADES PLACES WITH THE EDITOR.
 * This tab shipped as two sub-views -- a flat `cmdk` list OR the editor,
 * never both -- on the argument that a split halves an already narrow pane.
 * The operator's answer to that, in their own words, was "file tree nằm bên
 * phải pane, content ở giữa, giống orca": the tree on the RIGHT, the content
 * in the middle, the way orca has it. It is the better arrangement for the
 * job this tab actually does -- opening `.env`, reading what is beside it,
 * opening the next one -- because the swap made every one of those a
 * round-trip through a screen that hid the thing you were editing. The width
 * argument survives as a CLAMP rather than as a swap (see `TREE_WIDTH`): the
 * tree takes a share of the pane, floored so it can still be read and capped
 * so it can never take the editor's.
 *
 * THE TREE IS DERIVED IN THE RENDERER, from the flat array of absolute paths
 * `CHANNELS.filesList` already answers with -- no second channel, no second
 * walk, no second authorisation surface. `files-tree.ts` is that derivation
 * and its own header carries the reasoning; what matters here is that
 * `list.ts` is untouched by this change.
 *
 * THE FOURTH INSERT SCOPE, AND THE TWO BOXES THAT ARE DELIBERATELY NOT ONE.
 * `keyboard/focus-scope.ts` names three today: the question card, the
 * composer, the terminal pane. The editor's own `<textarea>` is marked
 * `data-insert-scope`/`data-insert-stop` below, conditionally on `!hidden` --
 * see that prop's own comment for why an ALWAYS-MOUNTED stop would silently
 * break `I` on every OTHER tab. The tree's FILTER box and the "new file" box
 * are left UNMARKED, the same as `SessionList.tsx`'s own session-search box:
 * a native `<input>` is already exempt from vam's chord grammar by tag name
 * (`Canvas.tsx`'s own `typing` guard), which is what makes typing into either
 * safe without the extra mark; the mark itself is reserved for surfaces the
 * STATUS BAR must call Insert, and neither a filter box nor a "name a new
 * file" box is that. It is also the sharper half of the `hidden` rule: this
 * component is mounted EARLIER in the pane than the composer, so an
 * unconditionally marked filter box would be the first `data-insert-stop`
 * `focusInsertStop` finds on every other tab, and a `display: none` element
 * cannot take focus -- `I` would silently stop reaching the composer. There
 * is a guard for exactly that in `test/panels/DetailPanel.files-tab.test.tsx`
 * and it asserts the whole tab, not just the textarea.
 *
 * AND THE TREE IS NOT AN INSERT SCOPE EITHER, for the opposite reason: it is
 * walked with BARE `j`/`k`/`h`/`l`, and those keys are only free to mean
 * "walk" because nothing here is a text box. The rows are `<button>`s that
 * call `preventDefault()` on exactly the keys they answer, which is how
 * `Canvas.tsx`'s window listener stands down for them (`event.
 * defaultPrevented`, the same contract an open question's option list uses)
 * without either side enumerating the other's keys.
 */

import { AlignLeft, Code, Eye, FilePlus, Loader2, RefreshCw, Save, Search } from 'lucide-react';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  FileListResult,
  FileReadResult,
  FileSignature,
  FileWriteResult,
} from '../../main/files/types.js';
import { normalizeKey } from '../keyboard/chords.js';
import { insertScopeMark, insertStopMark } from '../keyboard/focus-scope.js';
import { activeEditorSettings, subscribeEditorSettings } from '../prefs/editor.js';
import {
  renderedTreeWidth,
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_MAX,
  TREE_WIDTH_MIN,
  treeWidthCeiling,
} from '../prefs/files-tree-width.js';
import { PANE_RESIZE_STEP } from '../prefs/panes.js';
import type { SourceError } from '../sources/port.js';
import { type Buffer, isDirty, useFileBuffers } from './files-buffers.js';
import { applyTab, isMarkdownPath, lineStartOffset, relativeLabel } from './files-editor-text.js';
import { FORMAT_OFFER, formatFile } from './files-format.js';
import { type EditorLang, highlightEditor, highlightLangFor } from './files-highlight.js';
import { FileRowIcon } from './files-icons.js';
import { EDITOR_KEYS, type FileTreeRow } from './files-tree.js';
import { useFilesTreeState } from './files-tree-state.js';
import { SYNTAX_CLASS } from './highlight.js';
import { Note } from './Note.js';
import { OverlayScroll } from './OverlayScroll.js';
import { OUT_MARKDOWN, OUT_URL_TRANSFORM } from './out-markdown.js';
import { type PointerDragHandlers, RESIZE_HANDLE_RESET, usePointerDrag } from './pane-drag.js';
import {
  NO_UNSAVED_FILES,
  publishUnsaved,
  releaseUnsaved,
  type UnsavedReportSink,
} from './unsaved-files.js';

export type ReadFile = (path: string) => Promise<FileReadResult>;
export type WriteFile = (
  path: string,
  content: string,
  baseSignature: FileSignature | null,
) => Promise<FileWriteResult>;
export type ListFiles = (sessionId: string) => Promise<FileListResult>;

/**
 * HOW WIDE THE TREE IS WHEN NOBODY HAS SAID, and why that is still a clamp
 * rather than a number.
 *
 * A SHARE, so a wide pane gives the tree room to show a real path and a
 * narrow one does not hand it a third of nothing. FLOORED at 7.5rem because
 * below that a row shows an ellipsis and no name, which is not a tree. CAPPED
 * at 13.5rem because past that the tree is taking width from the only thing
 * on this tab anyone types into. The floor is what the editor is measured
 * against at vam's narrowest legal pane (`DETAIL_MIN`, 320px) in
 * `e2e/files-tab-keyboard-shots.mjs`: the editor keeps the larger half there.
 *
 * THIS IS NOW THE DEFAULT AND NOT THE WHOLE STORY. The paragraph that stood
 * here said NO RESIZER, and listed four costs a drag handle would bring: its
 * own keyboard story, its own persistence, its own narrow-pane arithmetic,
 * and a third resizable boundary in a pane that already has two. The operator
 * has since asked for the handle, so the paragraph is re-argued rather than
 * deleted -- every one of those four is a real cost and every one of them is
 * now PAID, here, in the order it was raised:
 *
 *   1. ITS OWN KEYBOARD STORY. `FilesTreeResizer` below is the same ARIA
 *      slider `PaneResizer` is, answering the same keys through the same
 *      `PANE_RESIZE_STEP`: bare arrows, Shift for the larger jump, Home/End
 *      for the two extremes. It is reached by Tab and by nothing else, it
 *      carries NEITHER insert mark (so the status bar never calls a drag
 *      Insert and `focusInsertStop` never lands `I` on a separator), and it
 *      `preventDefault()`s exactly the keys it answers -- which is how
 *      `Canvas.tsx`'s window grammar keeps hearing every bare letter while
 *      the handle holds focus, the same contract the tree rows already use.
 *      It is one new Tab stop, not a trap: every key it does not own falls
 *      through untouched.
 *
 *   2. ITS OWN PERSISTENCE. `prefs.filesTreeWidth` -- global, for the reason
 *      `editorIndent` and `focusView` are (one `FilesTab` per split leaf plus
 *      `PhoneShell`'s, and no dialogue in which a pane opened by a keystroke
 *      could be asked which width it wanted). `null` means "never dragged",
 *      which is what keeps THIS constant load-bearing: an operator who never
 *      touches the handle gets the share, pixel for pixel, on every pane.
 *
 *   3. ITS OWN NARROW-PANE ARITHMETIC. `files-tree-width.ts` restates the
 *      13.5rem cap as the invariant it was standing in for -- the tree may
 *      never take more than half of what the two columns share, so the editor
 *      keeps at least as much as the tree at every pane width, including
 *      `DETAIL_MIN`. The floor still wins last, exactly as `min-width` beats
 *      `max-width` in CSS, so nothing about the narrowest pane changes for an
 *      operator who has dragged nothing. `e2e/files-tree-resize-shots.mjs`
 *      measures both as rectangles, after a real drag to the maximum at
 *      `DETAIL_MIN` -- and it caught two defects no unit test could see while
 *      this was being built.
 *
 *   4. A THIRD RESIZABLE BOUNDARY. What happens when the PANE is resized
 *      under a tree whose width was chosen by hand: the chosen width is kept,
 *      and only what is DRAWN shrinks. `renderedTreeWidth` is pure and lives
 *      on the render path only; nothing on a resize, a split, or a tab switch
 *      writes. Widen the pane again and the operator's own number comes back
 *      -- asserted by narrowing a real window and widening it, which is the
 *      only check in the suite that sees a write-back, because a hidden tab
 *      is never measured at all.
 *      The one trap this arrangement has is that a hidden pane measures 0px
 *      and this tab is hidden with `display: none` rather than unmounted --
 *      see `files-tree-width.ts`'s header, which is entirely about that.
 */
const TREE_WIDTH = 'w-[38%] min-w-[7.5rem] max-w-[13.5rem]';

/** A Shift-held arrow moves further than a bare one -- the WAI-ARIA APG
 *  slider pattern, and the same multiplier `PaneResizer` uses so the two
 *  handles do not teach an operator's hands two different numbers. */
const TREE_JUMP_MULTIPLIER = 4;

/**
 * "OPEN THIS FILE, AT THIS LINE" -- the one thing outside this tab that can
 * drive it, and it arrives already authorised.
 *
 * A REQUEST, NOT A SELECTION, exactly as `DetailPanel.tsx`'s `tabRequest` is,
 * and a fresh object per press for the same reason: asking twice for the same
 * file is two asks, which a `{path, line}` compared by value could not say.
 *
 * IT CARRIES THE SESSION IT WAS RESOLVED FOR. The path came out of main
 * authorised against ONE session's working directory (`resolve-ipc.ts`), and
 * this tab keeps its open file per session -- so a request that arrives after
 * the operator has walked to another session is dropped rather than filed
 * under the session now showing.
 */
export type FileOpenRequest = {
  readonly sessionId: string;
  /** Absolute, already `realpath`-resolved by main. */
  readonly path: string;
  /** 1-based. See `src/shared/file-ref.ts`. */
  readonly line: number;
};

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
   * Tells MAIN how much unsaved text this tab is holding, so
   * `app.on('before-quit')` has something true to say before Cmd-Q throws it
   * away. `undefined` in the browser build, which has no file editor and no
   * application to quit -- `beforeunload` is the whole of the guard there, and
   * it is the same derivation, so nothing is half-armed. See
   * `./unsaved-files.ts` for the union across split leaves and
   * `src/main/quit/guard.ts` for what main does with it.
   */
  readonly reportUnsaved: UnsavedReportSink | undefined;
  /**
   * `DetailPanel.tsx`'s own `cornerReserve`: how far the view-icon pill
   * reaches IN FROM THE RIGHT of this tab's own box. The strip floats,
   * `position: absolute`, over this tab's top-right corner whenever the pane
   * is focused and this is not a phone, exactly as it does over the
   * transcript column (`TurnBlock`'s own `reserveCorner`) -- and it takes
   * real clicks, not just paint. Measured directly: without this, the Save
   * button sat under the Agents icon and Playwright's own click retried for
   * thirty seconds before timing out on the element actually receiving it.
   */
  readonly reserveCorner: number;
  /**
   * The same pill, DOWNWARDS: how far it reaches in from the TOP of this
   * tab's own box. The vertical half was not needed while this tab drew one
   * full-width column; it is needed now, because the thing in the top-right
   * corner is the TREE, and no amount of right-hand padding moves a column
   * that is supposed to be at the right-hand edge. The header row below
   * wears it as a minimum height, so everything under that row -- the tree
   * included -- clears the pill by construction rather than by whatever the
   * header row's font happened to make it. See `DetailPanel.tsx`, where both
   * numbers are derived from the pill's own geometry, and
   * `e2e/files-tab-keyboard-shots.mjs`, which asserts the result as a
   * rectangle rather than as a click -- the Save button was measurably 18px
   * under the pill while every click-based check passed, because Playwright
   * clicks an element's CENTRE and the centre was clear.
   */
  readonly reserveCornerHeight: number;
  /**
   * The width the operator last DRAGGED the tree to, in pixels, or `null` for
   * "never dragged" -- which is a real value and not a missing one: it draws
   * the clamped share `TREE_WIDTH` has always drawn. See `prefs.filesTreeWidth`.
   *
   * This is the STORED number, not the rendered one. What reaches the DOM is
   * `renderedTreeWidth(stored, columnsWidth)`, computed on every render and
   * written back NOWHERE -- see `files-tree-width.ts`.
   */
  readonly filesTreeWidth: number | null;
  /**
   * Persists a new tree width, or `undefined` to withdraw the handle
   * entirely -- ABSENT, NOT DISABLED, the same rule `onSetDefaultProvider`
   * follows in `DetailPanel.tsx`: a caller with nowhere to put the number
   * should not draw a grip that looks draggable and springs back on release.
   *
   * Called ONCE per gesture, at pointerup, and once per key press -- never on
   * a pointermove, for `PaneResizer`'s reason: a preference written sixty
   * times a second is sixty `localStorage` writes for one decision.
   */
  readonly onFilesTreeWidth: ((width: number) => void) | undefined;
  /**
   * A file to open, named by something outside this tab -- today, a
   * `path:line` control in an agent's own answer (`out-markdown.tsx`).
   * `null` at rest, and `undefined` from any caller that cannot produce one.
   */
  readonly openRequest?: FileOpenRequest | null;
};

type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly result: FileListResult }
  | { readonly kind: 'error'; readonly error: SourceError };

const NO_BRIDGE: SourceError = {
  kind: 'unreachable',
  code: 'no-bridge',
  message: 'the file editor is only available in the vam desktop app',
};

export function FilesTab({
  hidden,
  sessionId,
  list,
  read,
  write,
  reportUnsaved,
  reserveCorner,
  reserveCornerHeight,
  filesTreeWidth,
  onFilesTreeWidth,
  openRequest = null,
}: FilesTabProps) {
  const [listing, setListing] = useState<Record<string, ListState>>({});
  const [newFileName, setNewFileName] = useState('');
  const [filter, setFilter] = useState('');
  /**
   * RENDERED, OR RAW — the operator's own toggle, and ONE flag for the whole
   * tab rather than one per file.
   *
   * It is a MODE, not a property of a document: "show me markdown rendered" is
   * a thing the operator is doing, and it should hold while they read three
   * `.md` files in a row rather than needing pressing again on each. A file
   * this tab cannot preview simply ignores it (`showingPreview` below), which
   * is why opening a `.env` while it is on shows the editor and coming back to
   * the README shows the document again — the mode was never forgotten, it was
   * inapplicable. `test/panels/DetailPanel.files-tab.test.tsx` holds exactly
   * that sequence.
   *
   * A per-path record was the alternative and buys one thing: opening a second
   * `.md` for EDITING while the first is being read. It costs a second map to
   * keep in step with `buffers`, entries for files that are no longer open,
   * and a rule about what a file not in the map inherits. One keystroke is a
   * cheaper answer to the case it serves.
   */
  const [preview, setPreview] = useState(false);
  /**
   * WHAT THE LAST KEYSTROKE REFUSED, in words, or null at rest. The house
   * rule this tab is held to: a control that cannot act says so rather than
   * doing nothing, because a key that silently does nothing is
   * indistinguishable from a frozen application. Modelled on
   * `DetailPanel.tsx`'s own `viewNote` — `role="status"`, not `alert`: it
   * appears immediately after the key the operator pressed, so assertive
   * would interrupt a screen reader to repeat something.
   */
  const [note, setNote] = useState<string | null>(null);
  /**
   * THE LAST FORMAT, AND THE WAY BACK OUT OF IT.
   *
   * A format replaces the whole buffer, and this textarea's `value` is a
   * controlled React prop -- so the replacement is programmatic, and a
   * programmatic replacement is exactly what the browser's own undo stack does
   * NOT record. Left at that, `Mod-z` after a format would not give the
   * operator their file back, and a format is a whole-file change. That is the
   * same class of harm as `changed-on-disk`: text the operator had, gone,
   * with nothing on screen saying so.
   *
   * So vam keeps its own one-step undo, offered two ways (`Mod-z`, and a
   * button in the note for hands that are not in the editor). It is armed by a
   * format and it DISARMS ITSELF -- see `formatUndoReady` -- rather than being
   * cleared by a lifecycle nobody can keep track of.
   */
  const [formatUndo, setFormatUndo] = useState<{
    readonly path: string;
    readonly before: string;
    readonly after: string;
  } | null>(null);

  /**
   * The editor's own two settings, as the operator set them (Appearance).
   * Subscribed rather than drilled, for the reason `prefs/editor.ts` gives:
   * `Canvas.tsx` mounts one of these per split leaf and neither setting is a
   * paint CSS could carry -- one decides what Tab inserts, the other decides
   * what is rendered at all.
   */
  const settings = useSyncExternalStore(
    subscribeEditorSettings,
    activeEditorSettings,
    activeEditorSettings,
  );

  const currentListing = sessionId === null ? undefined : listing[sessionId];
  const ready = currentListing?.kind === 'ready' ? currentListing.result : null;
  const root = ready?.root ?? null;

  const {
    buffers,
    activePath,
    activeBuffer,
    unsavedKey,
    openFile,
    setContent,
    saveFile,
    reloadFile,
  } = useFileBuffers({ sessionId, root, read, write });

  /**
   * Whether the open file COULD be previewed, and whether it IS.
   *
   * `isMarkdownPath` rather than `highlightLangFor(...) === 'md'`, deliberately
   * — the second would make the toggle disappear when the operator turns the
   * editor's colours off in Appearance, and a rendered document has nothing to
   * do with whether a raw one is syntax-coloured.
   */
  const canPreview =
    activePath !== null && activeBuffer?.kind === 'editable' && isMarkdownPath(activePath);
  const showingPreview = preview && canPreview;

  /**
   * THE ONE THING THAT CANNOT SURVIVE: THE APP CLOSING. Every OTHER exit this
   * component has -- Escape/Mod-[ off the editor, switching files, switching
   * to another pane tab and back -- keeps every open buffer alive in
   * `buffers` above for as long as `FilesTab` stays mounted (see this file's
   * own header). Quitting vam, or closing this browser tab, ends that: there
   * is no main-process persistence for a draft, so any of them WOULD be lost
   * silently, which is the one outcome the brief that built this tab named as
   * worse than not shipping it at all.
   *
   * ── ONE DERIVATION, TWO EXITS ─────────────────────────────────────────
   * There are two hooks below and exactly one set of facts under them, and
   * that is deliberate: a second, independent "is anything dirty?" would be a
   * second answer that could disagree with the first, and the two exits would
   * then guard different things while looking like they guarded the same one.
   *
   *  `beforeunload` is a PAGE hook. It covers the window closing and a browser
   *  tab closing, and it is armed exactly when -- no earlier, no later --
   *  `buffers` holds unsaved text, across every open file and every session,
   *  not only the one currently showing.
   *
   *  `reportUnsaved` covers QUITTING THE APPLICATION, which `beforeunload`
   *  cannot: Cmd-Q reaches `app.on('before-quit')` in main, where a page hook
   *  has no standing, and the window is torn down afterwards. Main cannot read
   *  React state, so this tab pushes the fact across the bridge whenever it
   *  changes and main holds the last one (`src/main/quit/guard.ts`).
   *
   * The encoded set is a STRING rather than an array so the push below fires
   * when the SET changes and not on every keystroke into a file that was
   * already dirty -- see `encodeUnsaved`. `useMemo` recomputes it on every
   * render; what it buys is a dependency React can compare by value.
   */
  const anyDirty = unsavedKey !== NO_UNSAVED_FILES;
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
  /**
   * One slot per mounted tab, so the union across split leaves is a union and
   * not last-writer-wins -- `unsaved-files.ts` carries that argument in full.
   * `useId` is stable for the life of this component, which is exactly the
   * lifetime a slot has.
   */
  const unsavedSlot = useId();
  useEffect(() => {
    // Runs on mount too, with whatever this tab holds -- including nothing.
    // That zero is what corrects main's copy after a reload: the renderer that
    // reported the old one is gone, and this is the first true word since.
    publishUnsaved(unsavedSlot, unsavedKey, reportUnsaved);
  }, [unsavedSlot, unsavedKey, reportUnsaved]);
  useEffect(
    // UNMOUNT ONLY -- an empty dependency list, not a cleanup on `unsavedKey`,
    // which would release and re-take the slot on every change. Closing this
    // tab's pane discards its unsaved text in the renderer there and then;
    // this is what stops main from later asking about text that is gone.
    () => () => releaseUnsaved(unsavedSlot, reportUnsaved),
    [unsavedSlot, reportUnsaved],
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

  /**
   * IS THERE A FORMAT TO UNDO RIGHT NOW? Derived, never stored — the same rule
   * the tree's cursor is held to, and for a sharper reason here: a stored
   * "undo is available" flag would have to be cleared by every act that
   * touches the buffer (typing, Tab, a reload, a switch, a save), and the one
   * that got missed would be an undo that silently reverted a format the
   * operator made five minutes and forty keystrokes ago.
   *
   * Asking instead whether the buffer IS STILL EXACTLY what the format
   * produced cannot miss a case: type one character and this is false, so
   * `Mod-z` is not ours and the browser's own undo of that keystroke runs.
   */
  const formatUndoReady =
    formatUndo !== null &&
    formatUndo.path === activePath &&
    activeBuffer?.kind === 'editable' &&
    activeBuffer.content === formatUndo.after;

  /**
   * FORMAT THE OPEN FILE, or say why not. `files-format.ts` decides; this only
   * carries the decision out, and draws all three of its answers -- including
   * `unchanged`, because "I pressed it and nothing happened" is
   * indistinguishable from a broken button.
   */
  const formatActive = useCallback(() => {
    if (activePath === null) return;
    const buffer = buffers[activePath];
    if (buffer?.kind !== 'editable') return;
    const result = formatFile(activePath, buffer.content, settings.indent);
    if (result.kind === 'refused') {
      setNote(result.message);
      return;
    }
    if (result.kind === 'unchanged') {
      setNote('already formatted — vam found nothing it could tidy.');
      return;
    }
    // The caret, kept roughly where it was rather than thrown to the end of a
    // reflowed file: the textarea would otherwise scroll to the bottom on a
    // format, which looks like the file jumping.
    const caret = Math.min(textareaRef.current?.selectionStart ?? 0, result.value.length);
    pendingSelection.current = { path: activePath, start: caret, end: caret };
    setFormatUndo({ path: activePath, before: buffer.content, after: result.value });
    setContent(activePath, result.value);
    setNote('formatted — Mod-z puts it back exactly as it was.');
  }, [activePath, buffers, setContent, settings.indent]);

  /** Put the file back as it was before the last format. Answers whether it
   *  had anything to undo, because `Mod-z` has to know whether to keep the
   *  keystroke or hand it to the browser. */
  const undoFormat = useCallback((): boolean => {
    if (!formatUndoReady || formatUndo === null) return false;
    setContent(formatUndo.path, formatUndo.before);
    setFormatUndo(null);
    setNote(null);
    return true;
  }, [formatUndo, formatUndoReady, setContent]);

  /* -------------------------------------------------------------------------
   * MOVING THE KEYBOARD BETWEEN THE TWO HALVES.
   *
   * Both of these ANSWER whether they landed, the way `focusInsertStop` does
   * and for the same reason: an element that cannot take focus would
   * otherwise report a move that never happened, and the caller has a
   * refusal to say instead.
   * ---------------------------------------------------------------------- */
  const treeRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  // `HTMLElement`, not `HTMLDivElement`: the preview is a `<section>` (a
  // labelled region landmark by element rather than by attribute), and a ref
  // typed for the wrong tag is a type that quietly stops describing the DOM.
  const previewRef = useRef<HTMLElement | null>(null);

  /* -------------------------------------------------------------------------
   * HOW WIDE THE TREE IS DRAWN, AND THE ONE RULE THAT MAKES IT SAFE.
   *
   * Two measurements and one piece of state, and the state is the SMALLEST
   * one that buys live feedback: `dragWidth` holds the in-progress gesture so
   * the column follows the pointer without a `localStorage` write per frame,
   * and it is cleared the moment the gesture ends -- the same division
   * `PaneResizer`/`Canvas.tsx` already draw between `onChange` and
   * `onCommit`.
   *
   * NOTHING ON THIS PATH WRITES. `renderedTreeWidth` is pure and is called on
   * every render; the container it clamps against is whatever is on screen
   * now. A pane narrowed, a split opened, or -- the one that matters -- THIS
   * TAB HIDDEN behind another one, which measures 0px because `hidden` here
   * is `display: none` and not an unmount, must all change what is DRAWN and
   * nothing else. `files-tree-width.ts`'s header is entirely about that 0.
   * ---------------------------------------------------------------------- */
  const treeBoxRef = useRef<HTMLDivElement | null>(null);
  /**
   * A CALLBACK REF, NOT A `useRef`, AND THAT IS A BUG THIS FILE ALREADY HAD.
   *
   * This component returns EARLY -- "No session selected", "the file editor
   * is only available in the vam desktop app" -- and the shell mounts it
   * before any session is focused, so the first render draws neither column.
   * A `useRef` read from a layout effect keyed on `hidden` would find `null`
   * on that first pass and never look again, and the measurement would stay 0
   * for the life of the tab. It did: the e2e guard caught a tree rendering its
   * whole stored 480px inside a 291px pane, with the editor squeezed to
   * nothing, because an unmeasured container reads as "unknown" and an
   * unknown container clamps nothing.
   *
   * A callback ref re-fires the effect the moment the node attaches, whenever
   * that is.
   */
  const [columnsEl, setColumnsEl] = useState<HTMLDivElement | null>(null);
  const [columnsWidth, setColumnsWidth] = useState(0);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  /**
   * `clientWidth`, not `getBoundingClientRect().width`: it ignores ancestor
   * transforms, so a pane mid-animation cannot report a width the layout does
   * not have (orca's own measured note, and the reason it uses the same one).
   *
   * Re-run when `hidden` flips so the first frame after a tab switch measures
   * before it paints rather than a `ResizeObserver` callback later -- the
   * flash it saves is only visible when a stored width is wider than the
   * ceiling, which is exactly the case an operator who drags will be in.
   */
  useLayoutEffect(() => {
    if (columnsEl === null || hidden) {
      // NO COLUMNS ON SCREEN IS NO MEASUREMENT, and so is a hidden tab -- one
      // has nothing to measure and the other would measure 0px, which is not
      // a narrow container (`files-tree-width.ts`). Said here rather than left
      // to a `ResizeObserver` that would report the same 0 a beat later: this
      // way `hidden` is a real dependency, the observer is not kept alive over
      // a box nobody is looking at, and coming BACK re-measures inside a
      // layout effect -- before paint -- rather than a frame after it.
      setColumnsWidth(0);
      return;
    }
    const measure = () => setColumnsWidth(columnsEl.clientWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(columnsEl);
    return () => observer?.disconnect();
  }, [columnsEl, hidden]);

  const storedTreeWidth = dragWidth ?? filesTreeWidth;
  /** What reaches the DOM, or `null` for "nobody has dragged this -- keep the
   *  share `TREE_WIDTH` has always drawn". */
  const drawnTreeWidth =
    storedTreeWidth === null ? null : renderedTreeWidth(storedTreeWidth, columnsWidth);

  /**
   * The width a gesture STARTS from, which is not always a stored number: a
   * tree still on its share has no stored width at all, and an arrow press
   * there must move from what is on screen rather than from a constant the
   * operator has never seen.
   */
  const treeWidthNow = useCallback((): number => {
    if (drawnTreeWidth !== null) return drawnTreeWidth;
    const measured = treeBoxRef.current?.clientWidth ?? 0;
    return measured > 0 ? measured : TREE_WIDTH_DEFAULT;
  }, [drawnTreeWidth]);

  /**
   * Store a width the operator CHOSE.
   *
   * Clamped against the live ceiling as well as the floor, and that is not a
   * contradiction of the render-only rule: the ceiling is the edge the handle
   * physically could not be dragged past, so committing it commits what was
   * on screen under the pointer. What must never be written is a clamp
   * NOBODY PERFORMED -- a narrowing the operator did not do, applied behind
   * their back on a resize or a tab switch. Nothing calls this on a render.
   */
  const commitTreeWidth = useCallback(
    (width: number) => {
      const ceiling = treeWidthCeiling(columnsWidth);
      onFilesTreeWidth?.(Math.round(Math.max(TREE_WIDTH_MIN, Math.min(ceiling, width))));
    },
    [columnsWidth, onFilesTreeWidth],
  );

  /**
   * The gesture is `usePointerDrag`'s, shared with `PaneResizer` and
   * `SplitResizer` -- held entirely by `setPointerCapture`/
   * `releasePointerCapture` on the handle, with no document-wide overlay and
   * no boolean that a pointerup delivered somewhere else would leave set
   * forever. See `pane-drag.ts`, whose own tests are the contract.
   *
   * The handle sits on the tree's LEFT edge and the tree is the RIGHT-hand
   * column, so travel to the left (a negative delta) is what GROWS it -- the
   * same sign `PaneResizer` uses for the detail pane, and for the same reason.
   */
  const { dragging: resizingTree, handlers: treeResizeHandlers } = usePointerDrag<
    HTMLHRElement,
    number
  >({
    axis: 'x',
    onStart: () => treeWidthNow(),
    onMove: (startWidth, delta) => setDragWidth(startWidth - delta),
    onEnd: (startWidth, delta) => {
      setDragWidth(null);
      commitTreeWidth(startWidth - delta);
    },
  });

  /**
   * THE KEYBOARD HALF OF THE ARIA CONTRACT the handle claims -- a slider that
   * Tab reaches and that answers no key is a trap dressed as a control.
   *
   * `PANE_RESIZE_STEP` rather than a step of its own: vam now has three
   * routes to a resize (the `<`/`>` chord, `PaneResizer`'s arrows, and these)
   * and that constant exists precisely so they cannot drift into three
   * different ideas of how far one press moves.
   *
   * Every key that is NOT one of these returns without `preventDefault()`,
   * which is the whole of how the handle declines what it does not own:
   * `Canvas.tsx`'s window listener stands down on `event.defaultPrevented`,
   * so a bare `j` pressed while this has focus still reaches the grammar. A
   * handle that claimed every key would swallow the bare-letter vocabulary
   * for as long as the operator left focus on it.
   */
  const onTreeResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          event.preventDefault();
          const magnitude = PANE_RESIZE_STEP * (event.shiftKey ? TREE_JUMP_MULTIPLIER : 1);
          commitTreeWidth(
            event.key === 'ArrowLeft' ? treeWidthNow() + magnitude : treeWidthNow() - magnitude,
          );
          return;
        }
        case 'Home':
          event.preventDefault();
          commitTreeWidth(TREE_WIDTH_MIN);
          return;
        case 'End':
          event.preventDefault();
          commitTreeWidth(treeWidthCeiling(columnsWidth));
          return;
        default:
          return;
      }
    },
    [columnsWidth, commitTreeWidth, treeWidthNow],
  );

  /**
   * THE MIDDLE COLUMN, whichever of its two shapes is on screen.
   *
   * One function rather than two, because every caller means the same thing by
   * it -- "put the keyboard in the thing I am reading or editing" -- and a
   * caller that had to ask which mode the tab is in would be a third copy of
   * that question. Only one of the two refs is ever non-null.
   */
  const focusEditor = useCallback((): boolean => {
    const target: HTMLElement | null = textareaRef.current ?? previewRef.current;
    if (target === null) return false;
    target.focus();
    return target.ownerDocument.activeElement === target;
  }, []);

  /**
   * A row move and a file open both have to re-focus AFTER React has drawn
   * the new state — the cursor row is a different element each time, and a
   * file opened from the tree may not have a textarea until its read
   * resolves. Two flags rather than one effect that guesses: each is set by
   * the act that wants it and cleared by the frame that satisfies it.
   */
  const wantRowFocus = useRef(false);
  const wantEditorFocus = useRef(false);
  useLayoutEffect(() => {
    if (wantRowFocus.current) {
      wantRowFocus.current = false;
      treeRef.current?.querySelector<HTMLElement>('[data-files-cursor]')?.focus();
    }
    if (!wantEditorFocus.current) return;
    // EITHER SHAPE THE MIDDLE COLUMN HAS. In preview mode there is no
    // textarea and never will be for this file, so a flag that only ever
    // looked for one would fall through to the "give up" branch below and
    // Enter on a tree row would open the document and leave the keyboard
    // behind in the tree.
    const editor: HTMLElement | null = textareaRef.current ?? previewRef.current;
    if (editor !== null) {
      wantEditorFocus.current = false;
      editor.focus();
      return;
    }
    // No textarea yet. Keep waiting only while the buffer is still being
    // read: a file that turns out binary, refused or gone never grows one,
    // and a flag left armed would steal the keyboard the next time one did.
    if (activeBuffer?.kind !== 'loading') wantEditorFocus.current = false;
  });

  const requestRowFocus = useCallback(() => {
    wantRowFocus.current = true;
  }, []);
  const requestEditorFocus = useCallback(() => {
    wantEditorFocus.current = true;
  }, []);

  const {
    rows,
    cursorRow,
    expanded,
    setCursorPath,
    toggleDir,
    openFromTree,
    focusCursorRow,
    onTreeKeyDown,
  } = useFilesTreeState({
    ready,
    filter,
    openFile,
    setNote,
    focusEditor,
    requestRowFocus,
    requestEditorFocus,
    treeRef,
    filterRef,
  });

  /**
   * THE LINE A REQUEST ASKED FOR, held until the file is actually there to
   * put a caret in.
   *
   * It cannot ride on `pendingSelection` above: that one is applied and
   * CLEARED by the very next render, which is right for a Tab keystroke (the
   * text is already on screen) and wrong here -- a file opened for the first
   * time spends one or more renders in `loading`, with no `<textarea>` to
   * aim at, and a selection cleared during those is a caret that silently
   * never moved. This one survives until the buffer is editable, and gives up
   * the moment the buffer turns out to be something a caret cannot go into --
   * the same bargain `wantEditorFocus` makes just above.
   */
  const pendingLine = useRef<{ path: string; line: number } | null>(null);

  /**
   * SOMEBODY OUTSIDE THIS TAB NAMED A FILE. The path arrived authorised
   * (`main/files/resolve-ipc.ts`) and is opened through the SAME `openFile`
   * a tree row goes through -- never a second path into the editor, which is
   * what keeps an already-open buffer's unsaved text from being re-read out
   * from under the operator.
   *
   * Keyed on the request OBJECT alone. `openFile` is a `useCallback` over the
   * session id, so listing it too would only re-run this for a request the
   * operator pressed once -- `DetailPanel.tsx`'s own `tabRequest` effect
   * carries the same scar.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: a request is an act, not a value to re-apply
  useEffect(() => {
    if (openRequest === null || sessionId === null) return;
    // A request resolved for another session is not this tab's to honour --
    // see `FileOpenRequest`.
    if (openRequest.sessionId !== sessionId) return;
    setNote(null);
    setCursorPath(openRequest.path);
    pendingLine.current = { path: openRequest.path, line: openRequest.line };
    wantEditorFocus.current = true;
    openFile(openRequest.path);
  }, [openRequest]);

  /**
   * Puts the caret on the requested line once there is a textarea holding the
   * file, and scrolls it to the middle of the view.
   *
   * THE SCROLL IS SEPARATE FROM THE CARET because a `<textarea>` does not
   * scroll for a programmatic `setSelectionRange` -- only for typing. Line
   * height is read off the element rather than assumed: this editor's own
   * `leading` is a token, and a constant here would be a second copy of it
   * that drifts the first time the type scale moves. A browser that answers
   * something unmeasurable (happy-dom answers `''`) leaves the caret right
   * and the scroll alone, which is the safe half to lose.
   */
  useLayoutEffect(() => {
    const pending = pendingLine.current;
    if (pending === null) return;
    if (pending.path !== activePath) return;
    const buffer = buffers[pending.path];
    if (buffer?.kind === 'loading') return;
    pendingLine.current = null;
    const area = textareaRef.current;
    if (area === null || buffer?.kind !== 'editable') return;
    const at = lineStartOffset(buffer.content, pending.line);
    area.setSelectionRange(at, at);
    const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    area.scrollTop = Math.max(0, (pending.line - 1) * lineHeight - area.clientHeight / 2);
  });

  /**
   * RENDERED OR RAW, AND WHERE THE KEYBOARD GOES WITH IT.
   *
   * The toggle is the ONE act, reached three ways -- the button, `Mod-Shift-m`
   * in the editor, and `Mod-Shift-m` in the preview -- so it lives here rather
   * than three times. It moves the keyboard because the surface the keyboard
   * was on stops existing: leaving it where it was would blur it to the body,
   * and a keystroke that silently drops the operator out of the tab is the
   * thing `note` exists to prevent everywhere else in this file.
   *
   * IT TOUCHES NO BUFFER. That is not incidental -- a view toggle that lost an
   * edit would be worse than no toggle at all, and `buffers` is the only thing
   * holding the operator's unsaved text.
   */
  const togglePreview = useCallback(() => {
    setNote(null);
    setPreview((prev) => !prev);
    wantEditorFocus.current = true;
  }, []);

  const onEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (activePath === null) return;
      const key = normalizeKey(event);
      // NOT OURS, AND SAID FIRST -- `EDITOR_KEYS` is the list, and it is the
      // same list the README's Files-tab table is held against. Everything
      // else falls through unprevented to the app-wide grammar, which is what
      // keeps `Mod-<digit>`, `Mod-k` and `Mod-Shift-[` working from inside
      // this box exactly as they do from inside the composer.
      if (key === null || !EDITOR_KEYS.includes(key)) return;
      if (key === 'Escape' || key === 'Mod-[') {
        // THE WAY OUT, exactly as it is for the composer (`DetailPanel.tsx`'s
        // own `Mod-[` branch): blur, hand the keyboard back to Select. NOT a
        // discard — the buffer is untouched, dirty or not, so unsaved text
        // survives this exactly as it survives a pane-tab switch.
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (key === 'Mod-Shift-e') {
        // ACROSS, to the tree. The same chord goes back (see `onTreeKeyDown`)
        // rather than a second one for the return leg: it is one act -- "the
        // other half of this tab" -- and one act with two spellings is two
        // things to remember for no gain.
        event.preventDefault();
        setNote(focusCursorRow() ? null : 'nothing to move to — no file here matches the filter');
        return;
      }
      if (key === 'Mod-Shift-f') {
        event.preventDefault();
        formatActive();
        return;
      }
      if (key === 'Mod-Shift-m') {
        // ANSWERED EVEN WHEN THERE IS NOTHING TO PREVIEW, because a key that
        // silently does nothing is this tab's own named failure mode. On a
        // `.env` it says so; the alternative -- falling through unprevented --
        // would hand `Mod-Shift-m` to the app grammar from inside a text box,
        // which is not what the operator pressing it here meant.
        event.preventDefault();
        if (canPreview) togglePreview();
        else setNote('only markdown has a preview — this file is shown as text.');
        return;
      }
      if (key === 'Mod-z') {
        // OURS ONLY WHILE THERE IS A FORMAT TO UNDO, and this is the one
        // branch in here that decides whether to `preventDefault` from its
        // RESULT rather than up front. With nothing to undo, the keystroke is
        // left entirely alone and reaches the browser's own undo of whatever
        // the operator last typed -- which is the behaviour this textarea has
        // always had and must keep.
        if (undoFormat()) event.preventDefault();
        return;
      }
      if (key === 'Tab') {
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
          settings.indent,
        );
        pendingSelection.current = {
          path: activePath,
          start: result.selectionStart,
          end: result.selectionEnd,
        };
        setContent(activePath, result.value);
        return;
      }
      if (key === 'Mod-s') {
        // Blocked here before it reaches the browser's own "Save Page" —
        // `preventDefault` on the native event is what the window listener's
        // `defaultPrevented` check (`Canvas.tsx`) then honours too.
        event.preventDefault();
        void saveFile(activePath);
      }
    },
    [
      activePath,
      setContent,
      saveFile,
      focusCursorRow,
      formatActive,
      undoFormat,
      settings.indent,
      canPreview,
      togglePreview,
    ],
  );

  /** Escape/Mod-[ out of either text box, and Mod-Shift-e across to the editor. */
  const onBoxKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const key = normalizeKey(event);
      if (event.key === 'Escape' || key === 'Mod-[') {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (key === 'Mod-Shift-e') {
        event.preventDefault();
        setNote(focusEditor() ? null : 'no file is open — press Enter on one in the tree first');
      }
    },
    [focusEditor],
  );

  /**
   * THE PREVIEW'S OWN KEYBOARD, and it is a SHORT list on purpose.
   *
   * It answers the three keys that MOVE the keyboard and nothing else. It is
   * not an insert scope -- it is a `<div>`, there is nothing here to type into
   * -- so every other key falls through unprevented to the app-wide grammar,
   * exactly as it does from a tree row. That includes `j`/`k`: with the
   * keyboard in here the cursor mode is Select, and Select's keys are the
   * canvas's, which is the same contract every non-text surface in vam holds.
   *
   * Escape and `Mod-[` are here because a read-only pane that swallowed the
   * keyboard would be the one place in this tab an operator could get stuck.
   */
  const onPreviewKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const key = normalizeKey(event);
      if (key === 'Escape' || key === 'Mod-[') {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (key === 'Mod-Shift-m') {
        event.preventDefault();
        togglePreview();
        return;
      }
      if (key === 'Mod-Shift-e') {
        event.preventDefault();
        setNote(focusCursorRow() ? null : 'nothing to move to — no file here matches the filter');
      }
    },
    [focusCursorRow, togglePreview],
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

  const label =
    activePath === null ? null : root === null ? activePath : relativeLabel(root, activePath);
  const dirty = isDirty(activeBuffer);

  return (
    <div
      data-files
      data-files-view
      hidden={hidden}
      className="flex min-h-0 flex-1 flex-col gap-1.5"
    >
      {/* THE CORNER, RESERVED BY MEASUREMENT, IN BOTH DIRECTIONS --
          `DetailPanel.tsx`'s own `cornerReserve`/`cornerReserveHeight`, which
          derive the pill's real footprint from the pill rather than restating
          it as a constant. `paddingRight` keeps the Save button out from
          under it: measured at a 1100px window, the pill is 118px once this
          tab adds a fifth view icon, and the `6rem` this row first used left
          the button's right 18px under it -- while `elementFromPoint` at the
          button's CENTRE still returned the button, so a click-based check
          passed the whole way through. `minHeight` is what keeps the TREE out
          from under it: the tree is at the right-hand edge by definition, so
          no horizontal padding can move it, and its clearance is this row's
          height. Both are asserted as RECTANGLES, not clicks, in
          `e2e/files-tab-keyboard-shots.mjs`. */}
      <div
        data-files-header
        className="flex flex-none items-center gap-1.5"
        style={{
          ...(reserveCorner > 0 ? { paddingRight: reserveCorner } : {}),
          ...(reserveCornerHeight > 0 ? { minHeight: reserveCornerHeight } : {}),
        }}
      >
        {activePath === null ? (
          <span data-files-none className="min-w-0 flex-1 truncate text-control text-ink-faint">
            No file open — pick one in the tree.
          </span>
        ) : (
          <>
            <span
              data-files-path
              className="min-w-0 flex-1 truncate font-mono text-control text-ink-dim"
              title={activePath}
            >
              {label}
              {activeBuffer?.kind === 'editable' && activeBuffer.isNew && ' (new)'}
            </span>
            {dirty && (
              <span
                data-files-dirty
                aria-hidden="true"
                className="flex-none rounded-full bg-ink-dim"
                style={{ width: 6, height: 6 }}
              />
            )}
            {/* FORMAT, AND IT IS NEVER DISABLED. Every file type gets this
                control, including the ones vam will not format: pressing it
                on a `.ts` puts the reason on screen, by name, which is a
                better answer than a greyed-out button that says nothing about
                why. It is an ICON rather than a word because the row it is in
                also holds the path, the dirty dot, Save and the view pill's
                own reservation, and at the 320px floor the path has to keep
                something to truncate. */}
            {/* RENDERED OR RAW, NEXT TO THE FORMATTER — the operator's own
                placement: one toggle button beside the formatter at the top.
                It sits BEFORE Format rather than after, so the row reads as
                one view control followed by the two that change the file.

                DRAWN ONLY FOR A FILE THAT HAS A PREVIEW, which is the
                opposite of the rule the Format button next to it follows,
                and the difference is real. Format is never disabled because
                pressing it teaches the operator something — "vam does not
                format .ts files" is an answer. A preview toggle on a `.ts`
                would have no second state to show, so a control that is
                simply absent is the truer surface. The KEY still answers
                from anywhere (`onEditorKeyDown`), and says why. */}
            {canPreview && (
              <Note text="Switch between the rendered document and the raw text (Mod-Shift-m). Rendered is read-only; your unsaved edits survive either way.">
                <button
                  type="button"
                  data-files-preview
                  data-files-preview-state={showingPreview ? 'preview' : 'raw'}
                  aria-pressed={showingPreview}
                  onClick={togglePreview}
                  aria-label={showingPreview ? 'show the raw markdown' : 'preview this markdown'}
                  className="vam-tap flex flex-none cursor-pointer items-center rounded-[6px] border border-line px-1.5 py-1 text-ink-dim hover:border-line-strong hover:text-ink aria-pressed:border-line-strong aria-pressed:text-ink"
                >
                  {showingPreview ? (
                    <Code size={12} strokeWidth={1.8} />
                  ) : (
                    <Eye size={12} strokeWidth={1.8} />
                  )}
                </button>
              </Note>
            )}
            {/* AND ITS TOOLTIP IS A `Note`, NOT A `title`. The operator asked
                for tooltips on this button and on Save; this one HAD a
                `title`, which is precisely the shape `panels/Note.tsx` exists
                to replace -- a `title` opens on hover and on nothing else, so
                on a keyboard-first tool its explanation was unreadable to its
                own primary user. `aria-label` stays: the note is the
                EXPLANATION, and a screen reader still needs the NAME.

                The scope is quoted from `FORMAT_OFFER` rather than retyped.
                A button that is never disabled owes the operator the reason it
                might refuse, and a hand-written list beside a button is the
                copy that survives the formatter learning a file type. */}
            {activeBuffer?.kind === 'editable' && (
              <Note
                text={`Tidy this file's whitespace (Mod-Shift-f). ${FORMAT_OFFER} — anything else is refused by name, and Mod-z puts back whatever it changed.`}
              >
                <button
                  type="button"
                  data-files-format
                  onClick={formatActive}
                  aria-label="format this file"
                  className="vam-tap flex flex-none cursor-pointer items-center rounded-[6px] border border-line px-1.5 py-1 text-ink-dim hover:border-line-strong hover:text-ink"
                >
                  <AlignLeft size={12} strokeWidth={1.8} />
                </button>
              </Note>
            )}
            {/* SAVE HAD NO TOOLTIP AT ALL, and the one it has now names the
                one behaviour an operator cannot guess from a disk icon: this
                write is REFUSED rather than forced when the file moved under
                it, and their own text survives that refusal. */}
            {activeBuffer?.kind === 'editable' && (
              <Note text="Write this file to disk (Mod-s). If it changed on disk since you opened it the write is refused, not forced — your edits stay in the box either way.">
                <button
                  type="button"
                  data-files-save
                  data-files-save-state={activeBuffer.save.kind}
                  onClick={() => void saveFile(activePath)}
                  disabled={activeBuffer.save.kind === 'saving'}
                  aria-label="save this file"
                  className="vam-tap flex flex-none cursor-pointer items-center gap-1 rounded-[6px] border border-line px-2 py-1 text-control text-ink-dim hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60"
                >
                  {activeBuffer.save.kind === 'saving' ? (
                    <Loader2 size={12} strokeWidth={1.8} className="animate-spin" />
                  ) : (
                    <Save size={12} strokeWidth={1.8} />
                  )}
                  Save
                </button>
              </Note>
            )}
          </>
        )}
      </div>

      {/* WHAT THE LAST KEYSTROKE REFUSED. See `note`'s own comment.
          AND THE WAY OUT OF A FORMAT. The button is drawn from
          `formatUndoReady` rather than from the note, so it survives a note
          being cleared by the next keystroke and disappears the instant the
          buffer stops being what the format produced — the two are one row
          because they answer the same question ("what just happened, and can
          I take it back"), and because a second banner would push the editor
          down every time the operator pressed Format. */}
      {(note !== null || formatUndoReady) && (
        <p
          data-files-note
          role="status"
          className="flex flex-none items-center gap-2 text-control text-waiting"
        >
          <span className="min-w-0 flex-1">{note}</span>
          {formatUndoReady && (
            <button
              type="button"
              data-files-format-undo
              onClick={undoFormat}
              className="vam-tap flex-none cursor-pointer rounded-[6px] border border-line px-1.5 py-0.5 text-meta text-ink-dim hover:border-line-strong hover:text-ink"
            >
              Undo format
            </button>
          )}
        </p>
      )}

      {currentListing?.kind === 'error' && (
        <p
          data-files-refusal={currentListing.error.code}
          className="flex-none text-control text-failed"
        >
          {currentListing.error.message}
        </p>
      )}

      {/* THE ONE REFUSAL THAT MATTERS MOST, drawn as an offer rather than a
          failure: the file changed on disk since this buffer's own baseline,
          so the write was refused rather than overwriting whatever an agent
          (or the operator, elsewhere) just wrote. The operator's own text is
          UNTOUCHED — still in the textarea below, still what `Reload` will
          ask them to give up, in those words, before it does. */}
      {activeBuffer?.kind === 'editable' && activeBuffer.save.kind === 'conflict' && (
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
            onClick={() => activePath !== null && reloadFile(activePath)}
            className="vam-tap flex-none cursor-pointer rounded-[6px] border border-failed px-1.5 py-0.5 text-meta hover:bg-failed hover:text-ground"
          >
            Reload — discards your edits
          </button>
        </p>
      )}
      {activeBuffer?.kind === 'editable' && activeBuffer.save.kind === 'error' && (
        <p
          data-files-refusal={activeBuffer.save.error.code}
          className="flex-none text-control text-failed"
        >
          {activeBuffer.save.error.message}
        </p>
      )}

      {/* THE TWO COLUMNS. Editor in the middle, tree on the right — the
          operator's own arrangement, and orca's. `min-w-0` on the editor is
          what lets it shrink rather than push the tree off the pane.

          AND THE BOX THE TREE'S WIDTH IS CLAMPED AGAINST. This element, not
          the pane and not the window: it is the space the two columns
          actually share, which is the only quantity "the editor keeps the
          larger half" can be written against. Measured with `clientWidth`
          through a `ResizeObserver` — see the block that owns `columnsRef`. */}
      <div ref={setColumnsEl} className="flex min-h-0 flex-1 gap-1.5">
        <div data-files-editor-column className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activePath === null && (
            <p className="text-control text-ink-faint">
              Nothing to edit yet. Walk the tree with <code>j</code>/<code>k</code>, step in and out
              with <code>l</code>/<code>h</code>, and press Enter to open a file here.
            </p>
          )}

          {activeBuffer?.kind === 'loading' && (
            <p data-files-loading className="text-control text-ink-faint">
              Reading {label}…
            </p>
          )}

          {activeBuffer?.kind === 'binary' && (
            <p data-files-binary className="text-control text-ink-faint">
              {label} looks like a binary file ({activeBuffer.size.toLocaleString()} bytes) — vam
              does not show binary content.
            </p>
          )}

          {activeBuffer?.kind === 'refused' && (
            <p data-files-refusal={activeBuffer.error.code} className="text-control text-failed">
              {activeBuffer.error.message}
            </p>
          )}

          {/* ONE OF TWO, NEVER BOTH — and the textarea is genuinely UNMOUNTED
              in preview rather than hidden. A `display: none` textarea would
              still be the tab's `data-insert-stop`, still first in document
              order, and `focusInsertStop`'s blind `.focus()` would silently
              do nothing to it — which is exactly the trap this file's header
              describes for the `hidden` prop. While a document is being read
              there is nothing in this tab to type into, so the honest answer
              is that the tab has NO insert stop and `I` belongs to the
              composer. `test/panels/DetailPanel.files-tab.test.tsx` counts
              them in both modes. */}
          {activeBuffer?.kind === 'editable' &&
            (showingPreview ? (
              <MarkdownPreview
                content={activeBuffer.content}
                label={label ?? ''}
                previewRef={previewRef}
                onKeyDown={onPreviewKeyDown}
              />
            ) : (
              <Editor
                hidden={hidden}
                label={label ?? ''}
                content={activeBuffer.content}
                /* NULL IS "DRAW IT AS PLAIN TEXT", and both ways of reaching it
                   are real answers rather than a gap: a file type vam will not
                   tokenise (`highlightLangFor`) and an operator who turned the
                   colours off (Appearance). No overlay is mounted in either
                   case, so the textarea keeps its own ink and there is no second
                   layer to fall out of step with. */
                lang={
                  settings.highlight && activePath !== null ? highlightLangFor(activePath) : null
                }
                textareaRef={textareaRef}
                onChange={(content) => activePath !== null && setContent(activePath, content)}
                onKeyDown={onEditorKeyDown}
              />
            ))}
        </div>

        <Tree
          treeRef={treeRef}
          boxRef={treeBoxRef}
          widthPx={drawnTreeWidth}
          resizer={
            // ABSENT, NOT DISABLED. A caller with nowhere to store a width
            // draws no grip at all rather than one that springs back on
            // release — `onSetDefaultProvider`'s own rule in `DetailPanel`.
            onFilesTreeWidth === undefined ? null : (
              <FilesTreeResizer
                width={treeWidthNow()}
                ceiling={treeWidthCeiling(columnsWidth)}
                dragging={resizingTree}
                handlers={treeResizeHandlers}
                onKeyDown={onTreeResizeKeyDown}
              />
            )
          }
          filterRef={filterRef}
          rows={rows}
          cursorPath={cursorRow?.path ?? null}
          activePath={activePath}
          expanded={expanded}
          buffers={buffers}
          filter={filter}
          onFilterChange={setFilter}
          listing={currentListing}
          onRefresh={fetchListing}
          onKeyDown={onTreeKeyDown}
          onBoxKeyDown={onBoxKeyDown}
          onOpen={(path) => openFromTree(path, false)}
          onToggle={toggleDir}
          onFilterEnter={() => {
            setCursorPath(rows[0]?.path ?? null);
            wantRowFocus.current = true;
            setNote(rows.length === 0 ? 'no file here matches the filter' : null);
          }}
          newFileName={newFileName}
          onNewFileName={setNewFileName}
          onNewFile={() => {
            const name = newFileName.trim();
            if (name === '' || root === null) return;
            const base = root.endsWith('/') ? root.slice(0, -1) : root;
            openFromTree(`${base}/${name.replace(/^\/+/, '')}`, true);
            setNewFileName('');
          }}
        />
      </div>
    </div>
  );
}

/**
 * THREE COLUMNS THAT ARE ONE LINE BOX, and every property that keeps them in
 * step is load-bearing rather than cosmetic:
 *
 *  * `whiteSpace: 'pre'` ON EVERY LAYER. A wrapped line occupies two ROWS but
 *    is still one LINE, so the moment the textarea soft-wraps, number N stops
 *    pointing at line N and every number below it is wrong -- the single
 *    classic bug of a hand-built gutter. Not wrapping is also what Monaco
 *    (orca's own editor) does by default, and it is why `applyTab` indents
 *    with spaces rather than a tab byte: a tab's RENDERED width is a
 *    font-and-platform question the columns could not answer the same way.
 *  * ONE TEXT NODE PER COLUMN, joined by newlines, inside a `pre` box -- not
 *    one element per line. Each column then inherits exactly the same line box
 *    instead of depending on a second set of margins agreeing with the first.
 *    (The overlay is spans, but they are INLINE and carry no box of their own.)
 *  * `overflow-hidden` ON THE GUTTER AND ON THE OVERLAY, both scrolled only by
 *    the sync below, so neither can be scrolled independently into a position
 *    the text is not at. The overlay follows BOTH axes: this editor scrolls
 *    sideways by design, and an overlay that only tracked `scrollTop` would
 *    come apart from the text on the first long line.
 *  * `EDITOR_TEXT` IS ONE STRING, worn by the overlay and the textarea alike.
 *    Two hand-kept copies of a font stack, a size, a line-height and a padding
 *    box is precisely how an overlay comes to sit one pixel off, and one pixel
 *    off is a visible ghost behind every glyph.
 *  * The MARKS STAY ON THE TEXTAREA, never on the wrapper and never on the
 *    overlay: the insert scope has to be the thing that actually takes focus,
 *    and the overlay is drawn FIRST in document order -- a mark there would be
 *    the first `data-insert-stop` in the pane, which is the trap this file's
 *    own header describes.
 */

/**
 * The classes every text layer wears, spelled once.
 *
 * `pl-1`/`pr-3`/`py-2` is the padding box the textarea has always had; the
 * overlay has to have the same one, because a scrolling box's padding scrolls
 * with its content and a difference of a single pixel is a permanent offset.
 */
const EDITOR_TEXT = 'font-mono text-control leading-[1.5] py-2 pr-3 pl-1';

/** The style object both layers share, for the properties Tailwind has no
 *  utility for here. `tabSize` is stated rather than inherited: vam's own
 *  indent is spaces (`prefs/editor.ts`), but a file may CONTAIN a tab byte,
 *  and the two layers must then be wrong in exactly the same way. */
const EDITOR_TEXT_STYLE = { whiteSpace: 'pre', overflowWrap: 'normal', tabSize: 4 } as const;

/**
 * THE FILE, RENDERED — the other shape the middle column takes.
 *
 * `OUT_MARKDOWN` IS THE WHOLE OF THE STYLING, and reusing it is the decision
 * rather than a saving. It is the component map the transcript already dresses
 * an agent's answer with, which means (a) this preview looks like the rest of
 * vam without a second set of type-scale and colour choices to keep in step,
 * and (b) the security posture is the SAME posture rather than a second one
 * that has to be re-derived. `out-markdown.tsx`'s header carries the argument:
 * no `rehype-raw`, nothing handed to `innerHTML`, and `a`/`img` printed rather
 * than fetched or navigated. A file in a session's working directory is very
 * often an agent's own output one step removed, so it earns exactly the same
 * caution the transcript does.
 *
 * READ-ONLY, and the toolbar above says so. There is no in-preview editing to
 * write back, which is why the toggle can be free of every question a WYSIWYG
 * editor would raise.
 *
 * WRAPS, where the editor deliberately does not. The editor's `whiteSpace:
 * 'pre'` is load-bearing (a wrapped line breaks the gutter's numbering and the
 * overlay's alignment); a rendered document has neither a gutter nor an
 * overlay, and prose that scrolled sideways would be unreadable.
 *
 * FOCUSABLE, because the keyboard has to be able to BE here: the editor it
 * replaced was the middle column's one station in the Tab order, and `Enter`
 * on a tree row means "open it and put me in it". `tabIndex={0}` on a
 * scrollable region is also what lets it be scrolled with the keyboard at all.
 * It is NOT an insert scope -- see the call site.
 */
function MarkdownPreview({
  content,
  label,
  previewRef,
  onKeyDown,
}: {
  readonly content: string;
  readonly label: string;
  readonly previewRef: React.RefObject<HTMLElement | null>;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    // A `<section>` with an accessible name is a region landmark by element
    // rather than by attribute, which is what a screen reader's landmark list
    // reads and what biome's own rule asks for in place of `role="region"`.
    <section
      ref={previewRef}
      data-files-preview-view
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a labelled, scrollable region is the documented exception — see this component's header
      tabIndex={0}
      aria-label={`preview of ${label}`}
      onKeyDown={onKeyDown}
      className="vam-no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[9px] border border-line bg-panel px-3 py-2 break-words focus-visible:border-line-strong focus-visible:outline-none"
    >
      {/* The same `urlTransform` the transcript uses, for the same reason:
          one scheme list, vam's own, strictly narrower than react-markdown's
          default. See `OUT_URL_TRANSFORM`. */}
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={OUT_MARKDOWN}
        urlTransform={OUT_URL_TRANSFORM}
      >
        {content}
      </Markdown>
    </section>
  );
}

function Editor({
  hidden,
  label,
  content,
  lang,
  textareaRef,
  onChange,
  onKeyDown,
}: {
  readonly hidden: boolean;
  readonly label: string;
  readonly content: string;
  /** Which tokenizer the overlay draws with, or null for no overlay at all. */
  readonly lang: EditorLang | null;
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly onChange: (content: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLPreElement | null>(null);

  /**
   * The gutter's own text: `1\n2\n3...`, one number per LINE of the buffer
   * (never per visual row). An empty file is one line, the same way a blank
   * editor shows a caret on line 1, which is why this counts separators plus
   * one rather than counting non-empty pieces.
   */
  const lineNumbers = Array.from(
    { length: content.split('\n').length },
    (_, index) => index + 1,
  ).join('\n');

  /**
   * The coloured runs, or null when nothing is being coloured. Memoised on the
   * two things it depends on, because it runs on every keystroke in the file.
   *
   * Each run carries the BYTE OFFSET it starts at, accumulated once here
   * rather than recomputed per element in the map below -- the same key
   * `Fence` in `DetailPanel.tsx` uses and for the same reason (an offset is
   * unique even when the same word repeats, which in a config file it does on
   * nearly every line), but counted in one pass rather than n².
   */
  const tokens = useMemo(() => {
    if (lang === null) return null;
    let at = 0;
    return highlightEditor(content, lang).map((token) => {
      const run = { ...token, at };
      at += token.text.length;
      return run;
    });
  }, [content, lang]);

  /**
   * Keep every column level with the text. The textarea owns the scroll (it
   * is the only one of the three that can be scrolled by a caret, a wheel or a
   * drag); the others follow it, one assignment each, on the same frame the
   * browser already scheduled for the scroll event -- no state, no re-render.
   */
  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const gutter = gutterRef.current;
    if (gutter !== null) gutter.scrollTop = textarea.scrollTop;
    const overlay = overlayRef.current;
    if (overlay !== null) {
      overlay.scrollTop = textarea.scrollTop;
      // BOTH AXES. The gutter needs only the vertical one -- it has no long
      // lines -- but the overlay is the same text as the textarea and this
      // editor scrolls sideways rather than wrapping.
      overlay.scrollLeft = textarea.scrollLeft;
    }
  }, [textareaRef]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-[9px] border border-line bg-panel focus-within:border-line-strong">
      <div
        ref={gutterRef}
        data-files-gutter
        aria-hidden="true"
        className={`vam-no-scrollbar flex-none select-none overflow-hidden pr-2 pl-3 text-right ${EDITOR_TEXT} text-ink-faint`}
        style={{ whiteSpace: 'pre' }}
      >
        {lineNumbers}
      </div>
      {/* ONE BOX, TWO LAYERS. `relative` here rather than on the row above:
          the two layers are positioned against THIS element, which is exactly
          the textarea's old box, so the textarea's own geometry is unchanged
          by the overlay's arrival. */}
      <div className="relative min-h-0 min-w-0 flex-1">
        {tokens !== null && (
          <pre
            ref={overlayRef}
            data-files-highlight
            aria-hidden="true"
            className={`vam-no-scrollbar pointer-events-none absolute inset-0 m-0 h-full w-full overflow-hidden ${EDITOR_TEXT} text-ink`}
            style={EDITOR_TEXT_STYLE}
          >
            {tokens.map((token) => (
              <span key={token.at} className={SYNTAX_CLASS[token.kind]}>
                {token.text}
              </span>
            ))}
            {/* THE LAST NEWLINE, PUT BACK. Measured in Chromium: a `<pre>`
                does not give the final `\n` a line box of its own, and a
                `<textarea>` does -- so a file ending in a newline left the
                overlay exactly one line shorter than the text it sits behind,
                and every check of their two heights would have been off by
                18px. One extra `\n` restores it in every case (a file ending
                in two, three or no newlines included). */}
            {content.endsWith('\n') ? '\n' : ''}
          </pre>
        )}
        {/* AN INSERT SCOPE, AND AN INSERT STOP -- ONLY WHILE VISIBLE. `hidden`
            is checked here rather than left to CSS alone: an always-mounted,
            merely-hidden `data-insert-stop` is still the FIRST match
            `focusInsertStop`'s blind `querySelector` would find in document
            order on every OTHER tab, and a `display: none` element cannot in
            fact receive the `.focus()` call that follows — so leaving the mark
            on regardless would make `I`, pressed anywhere in this pane,
            silently fail to reach the composer the moment this build has ever
            shown the Files tab once. See this file's own header. */}
        <textarea
          ref={textareaRef}
          data-files-editor
          {...(hidden ? {} : insertScopeMark)}
          {...(hidden ? {} : insertStopMark)}
          value={content}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          spellCheck={false}
          aria-label={`edit ${label}`}
          className={`vam-no-scrollbar absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent ${EDITOR_TEXT} outline-none ${
            tokens === null ? 'text-ink' : 'text-transparent'
          }`}
          /* THE TEXT IS TRANSPARENT AND THE CARET IS NOT, which is the whole
             of the overlay technique: the glyphs the operator reads are the
             `<pre>`'s, and the ones they are editing are here, invisible,
             exactly on top. `caretColor` has to be stated because `color`
             would otherwise take the caret with it -- an editor with no
             visible caret is the one way this could be worse than no colour
             at all. A SELECTION still paints its own background, so selected
             text stays findable. */
          style={
            tokens === null
              ? EDITOR_TEXT_STYLE
              : { ...EDITOR_TEXT_STYLE, caretColor: 'var(--vam-ink)' }
          }
        />
      </div>
    </div>
  );
}

function Tree({
  treeRef,
  boxRef,
  widthPx,
  resizer,
  filterRef,
  rows,
  cursorPath,
  activePath,
  expanded,
  buffers,
  filter,
  onFilterChange,
  listing,
  onRefresh,
  onKeyDown,
  onBoxKeyDown,
  onOpen,
  onToggle,
  onFilterEnter,
  newFileName,
  onNewFileName,
  onNewFile,
}: {
  readonly treeRef: React.RefObject<HTMLDivElement | null>;
  /** The tree's OUTER box — what a gesture that starts on a tree still using
   *  the share has to measure, because there is no stored number to read. */
  readonly boxRef: React.RefObject<HTMLDivElement | null>;
  /** A dragged width in pixels, or `null` to keep `TREE_WIDTH`'s share. */
  readonly widthPx: number | null;
  /** The drag handle, or `null` when no caller can store a width. */
  readonly resizer: React.ReactNode;
  readonly filterRef: React.RefObject<HTMLInputElement | null>;
  readonly rows: readonly FileTreeRow[];
  readonly cursorPath: string | null;
  readonly activePath: string | null;
  readonly expanded: ReadonlySet<string>;
  readonly buffers: Record<string, Buffer>;
  readonly filter: string;
  readonly onFilterChange: (value: string) => void;
  readonly listing: ListState | undefined;
  readonly onRefresh: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onBoxKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onOpen: (path: string) => void;
  readonly onToggle: (path: string, open: boolean) => void;
  readonly onFilterEnter: () => void;
  readonly newFileName: string;
  readonly onNewFileName: (value: string) => void;
  readonly onNewFile: () => void;
}) {
  return (
    <div
      ref={boxRef}
      data-files-tree
      // `relative`, so the handle can straddle this column's own left border
      // the way `PaneResizer` straddles a pane's — one absolutely positioned
      // hit zone inside the thing it moves, and no document-wide overlay.
      //
      // The share and the pixel width are EXCLUSIVE: a tree that has been
      // dragged keeps neither `w-[38%]` nor the two CSS bounds, because the
      // clamp those express is now `renderedTreeWidth`'s job and two clamps
      // disagreeing about one column is the bug this avoids rather than the
      // belt to its braces. A tree nobody has dragged keeps all three and is
      // pixel-identical to what shipped.
      className={`relative flex min-h-0 flex-none flex-col overflow-hidden rounded-[9px] border border-line bg-panel ${
        widthPx === null ? TREE_WIDTH : ''
      }`}
      style={widthPx === null ? undefined : { width: widthPx }}
    >
      {resizer}
      <div className="flex flex-none items-center gap-1 border-line border-b px-2 py-1.5">
        <Search
          size={12}
          strokeWidth={1.6}
          className="flex-none text-ink-faint"
          aria-hidden="true"
        />
        {/* UNMARKED, deliberately — see this file's header. A native `input`
            is already exempt from the chord grammar by tag name; the insert
            marks are for surfaces the status bar must call Insert, and a
            filter box is not one. */}
        <input
          ref={filterRef}
          data-files-filter
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onFilterEnter();
              return;
            }
            onBoxKeyDown(event);
          }}
          placeholder="filter…"
          aria-label="filter files"
          className="min-w-0 flex-1 bg-transparent font-mono text-control text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          aria-label="refresh file list"
          onClick={onRefresh}
          className="vam-tap flex-none cursor-pointer rounded-[6px] p-1 text-ink-faint hover:text-ink"
        >
          <RefreshCw size={12} strokeWidth={1.6} />
        </button>
      </div>

      <form
        data-files-new
        className="flex flex-none items-center gap-1 border-line border-b px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          onNewFile();
        }}
      >
        <FilePlus
          size={12}
          strokeWidth={1.6}
          className="flex-none text-ink-faint"
          aria-hidden="true"
        />
        <input
          value={newFileName}
          onChange={(event) => onNewFileName(event.target.value)}
          onKeyDown={onBoxKeyDown}
          placeholder="new file…"
          aria-label="create a new file"
          className="min-w-0 flex-1 bg-transparent font-mono text-control text-ink outline-none placeholder:text-ink-faint"
        />
      </form>

      {/* THE `tree` ROLE AND THE KEYDOWN ARE ON THE ROWS' OWN WRAPPER, NOT ON
          THE SCROLLER.
          One listener rather than one per row -- and it still only ever fires
          for a row, because a row is the only thing in here that can hold
          focus. It is a SEPARATE element from the scroller on purpose:
          `role="tree"` may own only `treeitem`s and `group`s, and the notices
          the scroller also holds ("Reading the directory…", "No match", the
          truncation line) are real text a screen reader has to reach. One
          element for both would have made those notices either invalid
          children of the tree or `presentation`al -- and `presentation` would
          have hidden the words. */}
      {/* `OverlayScroll`, not a bare `overflow-y-auto`, and this is the
          SECOND half of what the operator asked for. The cap and the scroll
          were already right -- measured against real Chromium at four pane
          sizes with 159 rows, the tree's bottom lands on the pane's and the
          list's `scrollHeight` is five times its `clientHeight` -- but
          `vam-no-scrollbar` hid the only thing on screen that SAID so, so a
          tree clipped at the pane's bottom edge was indistinguishable from a
          tree that simply stopped. The sidebar's own list has answered this
          since `OverlayScroll` was written: a thumb painted OVER the content,
          `pointer-events-none`, so it takes no width from a column that is
          already short of it and cannot interfere with `j`/`k`. */}
      <OverlayScroll className="min-h-0 flex-1 overflow-y-auto p-1">
        {listing?.kind === 'loading' && (
          <p data-files-listing-pending className="px-2 py-3 text-control text-ink-faint">
            Reading the directory…
          </p>
        )}
        {listing?.kind === 'ready' && rows.length === 0 && (
          <p data-files-no-match className="px-2 py-3 text-control text-ink-faint">
            {filter.trim() === '' ? 'Nothing in this directory' : 'No match'}
          </p>
        )}
        <div ref={treeRef} role="tree" aria-label="files" onKeyDown={onKeyDown}>
          {rows.map((row) => {
            const open = expanded.has(row.path);
            const isCursor = row.path === cursorPath;
            return (
              <button
                key={row.path}
                type="button"
                role="treeitem"
                data-files-row
                data-files-row-path={row.path}
                data-files-row-kind={row.isDirectory ? 'directory' : 'file'}
                {...(row.isDirectory ? { 'data-files-row-open': String(open) } : {})}
                {...(isCursor ? { 'data-files-cursor': '' } : {})}
                {...(row.path === activePath ? { 'data-files-row-active': '' } : {})}
                aria-expanded={row.isDirectory ? open : undefined}
                aria-selected={row.path === activePath}
                // The DEPTH, said to a screen reader -- 1-based, as ARIA wants
                // it, where `depth` is 0-based because it multiplies an indent.
                // Without it a nested tree is announced as a flat list, which
                // is the one thing this whole change stopped it being.
                aria-level={row.depth + 1}
                // ROVING TABINDEX: one station in the Tab order for the whole
                // tree, not one per file. A 5,000-entry listing would otherwise
                // put 5,000 stops between the tab and whatever follows it.
                tabIndex={isCursor ? 0 : -1}
                onClick={() => (row.isDirectory ? onToggle(row.path, !open) : onOpen(row.path))}
                style={{ paddingLeft: 6 + row.depth * 10 }}
                className={[
                  'flex w-full cursor-pointer items-center gap-1 rounded-[6px] py-0.5 pr-1 text-left font-mono text-control outline-none',
                  row.path === activePath ? 'text-ink' : 'text-ink-dim',
                  isCursor ? 'bg-line-strong text-ink' : 'hover:bg-raised hover:text-ink',
                ].join(' ')}
              >
                {/* ONE SLOT, ONE GLYPH — and it replaces the `▸`/`▾` twisty
                    this row used to draw rather than sitting beside it.

                    The operator asked for "an icon before the folder name",
                    singular, and a chevron NEXT TO a folder is two icons
                    before it. One that changes shape when the row opens
                    (`Folder`/`FolderOpen`) carries the same open/shut fact in
                    12px instead of 24, which is width this column genuinely
                    does not have: at vam's narrowest legal pane the tree is
                    `TREE_WIDTH`'s 7.5rem floor and every pixel of chrome comes
                    off the NAME. The state a screen reader hears is unchanged
                    — `aria-expanded` above was always what carried it, and the
                    twisty was `aria-hidden` exactly as this is.

                    `e2e/files-tab-keyboard-shots.mjs` measures what is left
                    for the name at that floor, as a rectangle: a glyph that
                    fits the column while squeezing the names down to an
                    ellipsis would pass every check in this file. */}
                <FileRowIcon path={row.path} isDirectory={row.isDirectory} open={open} />
                <span data-files-row-name className="min-w-0 flex-1 truncate">
                  {row.name}
                </span>
                {isDirty(buffers[row.path]) && (
                  <span
                    data-files-dirty
                    aria-hidden="true"
                    className="flex-none rounded-full bg-ink-dim"
                    style={{ width: 5, height: 5 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {listing?.kind === 'ready' && listing.result.truncated && (
          <p className="px-2 py-1 text-meta text-ink-faint">
            Showing the first {listing.result.files.length.toLocaleString()} files — this directory
            has more.
          </p>
        )}
      </OverlayScroll>
    </div>
  );
}

/**
 * THE GRIP ON THE TREE'S LEFT EDGE.
 *
 * Presentational on purpose: every number and every callback is decided in
 * `FilesTab` beside the arithmetic that produces them, so this element cannot
 * hold a second opinion about what a drag means. It is `PaneResizer`'s
 * vocabulary verbatim -- a native `<hr>` (the `separator` role by element,
 * which is what biome's `a11y/useSemanticElements` asks for in place of a
 * bare `role`), `cursor-col-resize`, transparent at rest and
 * `bg-line-loudest` on hover and while held -- because an operator who has
 * learned one of vam's three resize boundaries should not have to learn a
 * second grammar for the third. `RESIZE_HANDLE_RESET` is the part of that
 * vocabulary that is now a constant rather than a copied string: preflight
 * gives every `<hr>` a 1px `currentColor` top border, so all three handles had
 * been drawing a hairline across their own top edge, and a copied class list
 * is how all three came to have the identical defect.
 *
 * NEITHER INSERT MARK, deliberately, and it is worth saying why rather than
 * merely doing it: `keyboard/focus-scope.ts` derives the cursor mode from
 * whether DOM focus sits inside a `data-insert-scope`, so a handle carrying
 * one would make the status bar announce Insert for a column drag, and
 * `focusInsertStop`'s blind `.focus()` would send `I` to a separator. It is a
 * new Tab stop and nothing more -- see `onTreeResizeKeyDown` for how it hands
 * back every key that is not its own.
 *
 * OUTSIDE `role="tree"`, which is why it is rendered here at the top of the
 * column rather than beside the rows: a `tree` may own only `treeitem`s and
 * `group`s, and a separator among the files would be both invalid and
 * something a screen reader met between two filenames.
 */
function FilesTreeResizer({
  width,
  ceiling,
  dragging,
  handlers,
  onKeyDown,
}: {
  readonly width: number;
  readonly ceiling: number;
  readonly dragging: boolean;
  readonly handlers: PointerDragHandlers<HTMLHRElement>;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <hr
      aria-orientation="vertical"
      aria-label="file tree width"
      // The RENDERED width, which is what the operator can see and what the
      // next arrow press will move from. `aria-valuemax` is the STORED cap
      // rather than the live ceiling: a screen reader reading a maximum that
      // changed every time the pane moved would be describing the window, not
      // the control. The live ceiling is what `End` actually lands on.
      aria-valuenow={Math.round(width)}
      aria-valuemin={TREE_WIDTH_MIN}
      aria-valuemax={TREE_WIDTH_MAX}
      aria-valuetext={`${Math.round(width)} pixels, at most ${Math.round(ceiling)} in this pane`}
      tabIndex={0}
      data-files-tree-resize={dragging ? 'dragging' : 'idle'}
      className={[
        `absolute top-0 -left-[2px] z-10 h-full w-1 ${RESIZE_HANDLE_RESET}`,
        'cursor-col-resize',
        dragging ? 'bg-line-loudest' : 'bg-transparent hover:bg-line-loudest',
      ].join(' ')}
      onKeyDown={onKeyDown}
      {...handlers}
    />
  );
}
