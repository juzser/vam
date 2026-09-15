/**
 * THE FILE EDITOR'S OWN TWO SETTINGS: whether to colour, and how wide an
 * indent step is.
 *
 * Operator request: "Phần file editor, nếu cần có thể thêm setting riêng cho
 * tab đó trong phần appearance" -- the file editor gets its own settings, in
 * the Appearance section. These are the two that earn a row there.
 *
 * WHY THESE TWO AND NOT MORE. A setting has to be a thing the operator would
 * really change, or it is a knob that costs a reader a branch and the dialog a
 * line. `highlight` earns it because the colours are new, opinionated and the
 * one control that takes them back if a file type ever tokenises badly;
 * `indent` earns it because two spaces versus four is the single most
 * contested formatting choice there is, and vam now writes it in two places
 * (what Tab inserts, and how `files-format.ts` indents JSON) where it used to
 * be one hard-coded constant.
 *
 * AND THE THIRD ONE THAT IS DELIBERATELY NOT HERE: word wrap. The editor's
 * line-number gutter numbers LINES, not visual rows, so the moment the
 * textarea soft-wraps, number N stops pointing at line N and every number
 * under it is wrong (see `FilesTab.tsx`'s own header). A wrap toggle would be
 * a setting whose "on" position breaks the column beside it, so there is no
 * toggle -- not a preference, an invariant.
 *
 * THE INDENT IS SPACES AND THE WIDTH IS A COUNT, which is the same invariant
 * seen from the other side: `indentText` is the only way to build one, and it
 * can only build spaces. A tab byte's RENDERED width is a font-and-platform
 * question the gutter and the text would answer differently, and that is the
 * one thing that makes a hand-built gutter drift.
 *
 * MODULE STATE RATHER THAN A PROP, exactly as `progress.ts` and
 * `submit-key.ts` do it and for the reason they give at length: `Canvas.tsx`
 * owns the prefs and mounts one `DetailPanel` -- hence one `FilesTab` -- per
 * split leaf, `PhoneShell` mounts another, and neither of these is a paint CSS
 * could carry (one decides what a keystroke inserts, the other decides what is
 * rendered). So: a store with a snapshot and a subscription, the shape
 * `useSyncExternalStore` asks for.
 */

/** Colour by default: the editor that shipped without colours had no way to
 *  ask for them, so nobody chose "off", and a default of off would ship the
 *  whole feature switched off for everyone. */
export const DEFAULT_EDITOR_HIGHLIGHT = true;

/** Two spaces -- what `files-editor-text.ts` hard-coded before this setting
 *  existed, so merely shipping the setting moves nobody's file. */
export const DEFAULT_EDITOR_INDENT = 2;

/** The range the picker offers and every read clamps into. Below 2 an indent
 *  stops being visible as structure; above 8 one step is a third of a narrow
 *  pane's width, and the editor is the only thing on this tab anybody types
 *  into. Enforced on READ as well as on write: a hand-edited payload never
 *  passed the picker. */
export const EDITOR_INDENT_MIN = 2;
export const EDITOR_INDENT_MAX = 8;

/** Both settings, as one value -- they are read together, by one component,
 *  on every render of the editor. */
export type EditorSettings = {
  readonly highlight: boolean;
  readonly indent: number;
};

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  highlight: DEFAULT_EDITOR_HIGHLIGHT,
  indent: DEFAULT_EDITOR_INDENT,
};

/**
 * Total, like `clampOutFontSize`: a string an older vam wrote, a `NaN` from a
 * hand edit, an `Infinity` from devtools -- none of them may reach the text.
 * Rounded as well as clamped, because a fraction of a space is not a thing
 * `String.repeat` can make.
 */
export function clampEditorIndent(raw: unknown): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return DEFAULT_EDITOR_INDENT;
  return Math.min(EDITOR_INDENT_MAX, Math.max(EDITOR_INDENT_MIN, Math.round(raw)));
}

/**
 * Only a literal `false` turns the colours off.
 *
 * The safe direction, and the same one `readFocusView` argues for: a value
 * this vam cannot read must not take a capability away on the strength of a
 * choice nobody made.
 */
export function readEditorHighlight(raw: unknown): boolean {
  return raw === false ? false : DEFAULT_EDITOR_HIGHLIGHT;
}

/**
 * One indent step, as text. The ONLY way to build one, and it can only build
 * spaces -- see this file's header for why a tab byte would break the gutter.
 */
export function indentText(width: unknown): string {
  return ' '.repeat(clampEditorIndent(width));
}

/**
 * THE SETTINGS IN FORCE.
 *
 * `active` is replaced only when a value actually MOVES, which is two
 * requirements in one: `useSyncExternalStore` compares snapshots by identity,
 * so a fresh object per call is an infinite render loop; and `activatePrefs`
 * runs on every prefs write, so a theme flip or a renamed project must not
 * tell every mounted editor to re-render for a setting nobody touched.
 */
let active: EditorSettings = DEFAULT_EDITOR_SETTINGS;
const listeners = new Set<() => void>();

export function activeEditorSettings(): EditorSettings {
  return active;
}

/** Put a pair in force. Called by `activatePrefs`, which every read and every
 *  write goes through. Normalised here too, this being the last gate before
 *  the editor. */
export function setActiveEditorSettings(next: EditorSettings): void {
  const settings: EditorSettings = {
    highlight: readEditorHighlight(next.highlight),
    indent: clampEditorIndent(next.indent),
  };
  if (settings.highlight === active.highlight && settings.indent === active.indent) return;
  active = settings;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  own contract, and the shape `subscribePromptSubmitKey` already has here. */
export function subscribeEditorSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
