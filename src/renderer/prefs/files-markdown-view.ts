/**
 * WHICH FACE A `.md` FILE OPENS WEARING: the rendered document, or the raw
 * text -- `FilesTab.tsx`'s own toggle, remembered per device.
 *
 * Operator: ".md files need to be previewed GitHub-style, and there must be a
 * button to switch between preview mode and raw mode." The button already
 * existed; what was missing was that it always came up in the OFF position,
 * so an operator who had never found it saw only the flat text a preview was
 * meant to replace. This module is the one line that changed: the mode a
 * freshly opened tab starts in.
 *
 * A MODULE WITH NO SUBSCRIPTION, deliberately unlike `editor.ts` next to it.
 * `editor.ts` needs one because a Settings-dialog edit has to reach every
 * MOUNTED editor at once. Nothing here is ever changed from outside the tab
 * that owns it -- the only writer is `FilesTab.tsx`'s own toggle -- so the
 * one thing a live subscription would buy is two split panes snapping to
 * match each other's CURRENT mode, which is not the property being kept.
 * `FilesTab.tsx` reads `activeFilesMarkdownView()` exactly once, in its
 * `useState` initialiser, the same moment `filesTreeWidth` is read off a
 * prop -- a fresh DEVICE DEFAULT for a tab that has just mounted, not a
 * value the tab tracks for the rest of its life.
 *
 * THE WRITE SIDE IS A PROP CALLBACK, not a call into this module directly,
 * for the reason `onFilesTreeWidth` is one: `Canvas.tsx` is the one place
 * that holds the live `Prefs` object and the one place that calls
 * `writePrefs`, and `writePrefs` is what calls `activatePrefs`, which is
 * what puts a new value in force here (`setActiveFilesMarkdownView`, called
 * from `prefs.ts` and nowhere else). A component that wrote this module
 * directly would leave `Canvas.tsx`'s own `prefs` state stale, and the next
 * unrelated `savePrefs` call anywhere in the app would overwrite this field
 * back to whatever that stale copy remembered.
 */

/** The two faces a `.md` file can wear. */
export type FilesMarkdownView = 'preview' | 'raw';

/**
 * PREVIEW. The operator's whole ask was that this was the wrong default, so
 * shipping the setting has to actually move it -- unlike every sibling in
 * this directory, where the default is chosen to move NOBODY's file. Raw
 * stays one click or one `Mod-Shift-m` away, and nothing about a document
 * already open is touched by this default: `showingPreview` still requires
 * `canPreview`, so a `.env` or a `.ts` is never affected by it.
 */
export const DEFAULT_FILES_MARKDOWN_VIEW: FilesMarkdownView = 'preview';

/**
 * Total, and the safe direction points at the NEW default rather than the
 * old one: only a literal `'raw'` turns the preview off. A payload from a
 * vam that predates this field, a hand-edited value, or anything else
 * unreadable comes back as `'preview'` -- the same behaviour shipping this
 * setting for the first time gives everyone, on purpose.
 */
export function readFilesMarkdownView(raw: unknown): FilesMarkdownView {
  return raw === 'raw' ? 'raw' : DEFAULT_FILES_MARKDOWN_VIEW;
}

/**
 * THE DEFAULT IN FORCE, for a tab about to mount. Put here by
 * `activatePrefs` (`prefs.ts`), on every read AND every write, exactly as
 * `editor.ts`'s own `active` is -- the difference is only that nothing here
 * subscribes to a change in it.
 */
let active: FilesMarkdownView = DEFAULT_FILES_MARKDOWN_VIEW;

export function activeFilesMarkdownView(): FilesMarkdownView {
  return active;
}

/** Put a mode in force. Called by `activatePrefs`, which every read and
 *  every write goes through -- see `prefs.ts`. Normalised here too, so a
 *  garbage value on the way in cannot become a garbage default for the next
 *  tab that mounts. */
export function setActiveFilesMarkdownView(next: unknown): void {
  active = readFilesMarkdownView(next);
}
