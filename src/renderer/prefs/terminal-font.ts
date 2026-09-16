/**
 * HOW BIG THE TMUX SCREEN IS DRAWN — and why that is a setting at all.
 *
 * The pane shipped at 10.5px, hard-coded, with a comment calling it "the one
 * literal size left in the renderer" and defending it as a MEASUREMENT rather
 * than a style choice (`terminal-size.ts`: the wrapper's pixels become columns
 * by dividing by the advance of one character rendered at that size). That
 * defence was right about the mechanism and wrong about the conclusion: the
 * fit is measured whatever the size is, so the size was never the thing making
 * it work — it was simply the size nobody could change. 10.5px is markedly
 * smaller than what any terminal emulator ships, and the operator had no way
 * to say so.
 *
 * ── WHY A SHORT LIST AND NOT A SLIDER ────────────────────────────────────
 * `outFontSize` is a stepper over 10..20 because `out` is prose and every
 * integer in that range is a legible paragraph. This is a MONOSPACE GRID whose
 * width is quantised into columns: between two sizes a pane one column wider
 * or narrower is the only difference a person sees, and most of the steps
 * produce no change at all at a typical pane width. Four named sizes is the
 * whole useful range, and a short list is also what lets the dialog show which
 * one is in force instead of a number nobody can rank.
 *
 * 10.5 IS ON THE LIST DELIBERATELY. It is under the renderer's 11px type floor
 * (`test/renderer/type-scale.test.ts`) and it is what the pane drew at before
 * this file existed. Shipping a larger default must not take the old size away
 * from an operator who preferred the density — the floor exists to stop
 * captions being tuned smaller by eye, not to overrule someone choosing their
 * own terminal.
 *
 * ── WHY A STORE AND NOT A CUSTOM PROPERTY ────────────────────────────────
 * `out`'s size is pushed onto the document root as `--vam-out-font-size` and
 * nothing re-renders for it, which is correct there: only the paint depends on
 * it. THIS SIZE DECIDES HOW MANY COLUMNS TMUX IS TOLD TO COMPOSE AT. A custom
 * property would repaint the screen at the new size and leave the pane still
 * asking tmux for the old column count — the pane's own box never moved, so
 * its `ResizeObserver` never fires — and tmux would keep wrapping lines for a
 * width that no longer exists. That is the exact defect this setting could
 * introduce, and it is invisible: the screen looks fine, and long lines wrap
 * in the wrong place. So the size has to reach React, which is a store with a
 * snapshot and a subscription, the shape `useSyncExternalStore` asks for and
 * the shape `progress.ts`, `submit-key.ts` and `editor.ts` already have.
 */

/**
 * The sizes offered, smallest first. THE ONLY LIST — the dialog maps over
 * this, the reader validates against it and the tests derive from it, because
 * two lists of sizes is how a fifth size comes to exist in one of them.
 */
export const TERMINAL_FONT_SIZES = [10.5, 11.5, 12.5, 14] as const;

/**
 * 12.5px, which is two points up from what shipped.
 *
 * It moves for everyone who never touched the dialog, which is the intent:
 * nobody chose 10.5, it was simply what was written. Anyone who DOES choose a
 * size keeps it — a stored value is read back and only this default is
 * consulted when there is none.
 */
export const DEFAULT_TERMINAL_FONT_SIZE = 12.5;

/**
 * The line box, as a RATIO of the size — 1.55, up from the 1.45 that shipped
 * beside the 10.5.
 *
 * A ratio and not a pixel count, unlike the type scale's paired line heights,
 * because this one has to hold at four sizes rather than at one: `leading-16px`
 * under a 14px screen is 1.14, which is tighter than any terminal sets and is
 * where a block-drawing character starts touching the row above it. The extra
 * 0.1 over the shipped ratio is the same request as the size — the screen was
 * set denser than a terminal is read at.
 */
export const TERMINAL_LINE_HEIGHT = 1.55;

/**
 * A stored value, reduced to one of the offered sizes.
 *
 * EXACT OR DEFAULT, not nearest, and that is the one decision in this
 * function. The list IS the vocabulary of this setting, so a stored 13 —
 * hand-edited, or written by a vam that offered a different list — is a value
 * the dialog could not show as chosen. Snapping it to 12.5 would leave the
 * operator looking at a pressed button they never pressed; answering the
 * default says the same thing honestly and costs them one click.
 *
 * Total, like `clampOutFontSize` and `clampEditorIndent`: a string an older
 * vam wrote, a `NaN` from a hand edit, an `Infinity` from devtools — none of
 * them may reach the pane, and this is the read a hand-edited payload arrives
 * by.
 */
export function readTerminalFontSize(raw: unknown): number {
  return TERMINAL_FONT_SIZES.some((size) => size === raw)
    ? (raw as number)
    : DEFAULT_TERMINAL_FONT_SIZE;
}

/**
 * THE SIZE IN FORCE, module state rather than a prop, for the reason
 * `submit-key.ts` gives at length: `Canvas.tsx` owns the prefs and mounts one
 * `DetailPanel` — hence one `TerminalTab` — per split leaf, `PhoneShell`
 * mounts another, and a pane opened by a keystroke has no dialogue in which it
 * could be asked. Drilling a prop through both shells for a global reading
 * preference is the arrangement this store exists to avoid.
 */
let active: number = DEFAULT_TERMINAL_FONT_SIZE;
const listeners = new Set<() => void>();

/** The snapshot `useSyncExternalStore` compares by identity — a number, so it
 *  is stable by construction and no cache is needed. */
export function activeTerminalFontSize(): number {
  return active;
}

/**
 * Put a size in force. Called by `activatePrefs`, which every read and every
 * write goes through.
 *
 * A CHANGE, NOT EVERY WRITE, and here that rule is load-bearing rather than an
 * optimisation: every listener that wakes re-measures its pane and may spawn a
 * `tmux resize-window`, so telling them all about a theme flip would resize
 * the operator's sessions for a setting nobody touched.
 */
export function setActiveTerminalFontSize(next: number): void {
  const size = readTerminalFontSize(next);
  if (size === active) return;
  active = size;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  contract, and the shape `subscribeEditorSettings` already has here. */
export function subscribeTerminalFontSize(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
