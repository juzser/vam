/**
 * EVERY MOUNTED FILES TAB'S UNSAVED TEXT, AS ONE FACT, and the single push of
 * that fact into main.
 *
 * ── WHY THIS IS A MODULE AND NOT AN EFFECT IN `FilesTab.tsx` ──────────────
 * `Canvas.tsx` mounts one `FilesTab` per split leaf (the same reason
 * `prefs/editor.ts` exists as a store rather than as props), and each one
 * keeps its OWN `buffers`. If each pushed "what I am holding" down one
 * channel, the last one to render would speak for all of them -- a clean pane
 * re-rendering would tell main nothing is unsaved while the pane beside it
 * holds an hour of typed `.env`. That is the precise silent loss the quit
 * guard exists to prevent, so the union is computed here, in the renderer,
 * where the instances actually are, and main is handed one answer.
 *
 * ── SLOTS, AND WHY RELEASING ONE IS NOT A LOSS OF INFORMATION ─────────────
 * A slot is one mounted tab (`useId`). It is dropped on unmount, which is
 * right and is also the sharp edge worth naming: unmounting a `FilesTab` --
 * closing its pane -- DISCARDS its unsaved text there and then, in the
 * renderer, with no prompt. Dropping the slot does not cause that; it keeps
 * main from later asking about text that is already gone. Guarding the
 * pane-close itself is a separate piece of work and is not pretended to here.
 *
 * ── COUNTS FILES, NOT BUFFERS ─────────────────────────────────────────────
 * Keyed by absolute PATH, so the same file open dirty in two panes is one
 * file. "2 files have unsaved changes" about one file would be a prompt that
 * says something false, which is the one thing vam's dialogs may not do.
 *
 * ── AND NOTHING HERE REACHES THE BRIDGE ITSELF ────────────────────────────
 * The sink is passed IN, per call, exactly as `list`/`read`/`write` are passed
 * into `FilesTab` as props rather than read off `globalThis` (`DetailPanel` is
 * the one place this app reads `window.api`). `undefined` is the browser
 * build, which has no file editor and no application to quit; the union is
 * still kept, so nothing else has to branch on the build.
 */

/** One unsaved file: what identifies it, and what the operator is shown. */
export type UnsavedFile = {
  /** The absolute path. The IDENTITY -- two panes on this path are one file. */
  readonly path: string;
  /** Relative to its session's root where that is known; the path otherwise. */
  readonly label: string;
};

/** What main is told. Matches `src/main/quit/unsaved.ts`'s `UnsavedReport`. */
export type UnsavedReportSink = (report: {
  readonly count: number;
  readonly names: readonly string[];
}) => void;

/**
 * The unsaved set of one tab, encoded as a STRING.
 *
 * A string because `FilesTab` derives this set on every render -- `buffers`
 * gets a new identity on every keystroke -- and the effect that pushes it must
 * fire when the SET changes, not when a character is typed into a file that
 * was already dirty. A value React can compare with `===` is what makes that
 * a dependency array rather than a ref and a manual diff.
 *
 * JSON rather than a delimiter: a path may legally contain a tab or a newline,
 * and a hand-rolled split would turn one such file into two nonexistent ones
 * in a dialog whose whole job is to be specific. Sorted, so the same set
 * always encodes to the same string whatever order the buffers came in.
 */
export function encodeUnsaved(files: readonly UnsavedFile[]): string {
  const pairs = files.map((file): [string, string] => [file.path, file.label]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(pairs);
}

/** `encodeUnsaved([])`, as a constant: "this tab is holding nothing". */
export const NO_UNSAVED_FILES = '[]';

/** slot (one mounted `FilesTab`) → its own encoded unsaved set. */
const slots = new Map<string, string>();

function decode(encoded: string): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(encoded);
    return Array.isArray(parsed) ? (parsed as [string, string][]) : [];
  } catch {
    // Unreachable through `encodeUnsaved`, which is the only producer. Total
    // anyway: a parse failure here must not take down the tab the operator is
    // typing into, and "this pane holds nothing" is the safe reading -- the
    // OTHER panes' slots are still counted.
    return [];
  }
}

/** The union: how many distinct files, and their labels in name order. */
export function unsavedUnion(): { readonly count: number; readonly names: readonly string[] } {
  const byPath = new Map<string, string>();
  for (const encoded of slots.values()) {
    for (const [path, label] of decode(encoded)) {
      byPath.set(path, label);
    }
  }
  const names = [...byPath.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { count: byPath.size, names };
}

/**
 * Pushes the whole union, never one slot's share of it -- main holds a single
 * answer and replaces it wholesale, the same bargain `setPrRepoOverrides`
 * makes with the prefs map and for the same reason: a merge could not express
 * a file that stopped being dirty.
 *
 * A throwing sink is swallowed. The bridge failing is not a reason for a
 * keystroke in the editor to raise, and the preload's own member is already
 * fire-and-forget; this is the second half of that same promise.
 */
function push(sink: UnsavedReportSink | undefined): void {
  if (sink === undefined) return;
  try {
    sink(unsavedUnion());
  } catch {
    // Nothing to do and nowhere to say it: the operator is typing, and the
    // only consequence is that main's copy is one push stale.
  }
}

/**
 * This tab is holding `encoded`. Called on mount too, with whatever that tab
 * holds -- including nothing, which is what corrects main's copy after a
 * reload (the renderer that reported is gone; this one says what is true now).
 */
export function publishUnsaved(
  slot: string,
  encoded: string,
  sink: UnsavedReportSink | undefined,
): void {
  slots.set(slot, encoded);
  push(sink);
}

/** This tab is gone. Its buffers went with it, so its slot does too. */
export function releaseUnsaved(slot: string, sink: UnsavedReportSink | undefined): void {
  slots.delete(slot);
  push(sink);
}

/** For tests, and for nothing else: the registry is module-wide. */
export function resetUnsavedRegistry(): void {
  slots.clear();
}
