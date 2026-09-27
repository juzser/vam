/**
 * THE TERMINAL SCREEN'S OWN FONT — alongside its already-shipped SIZE
 * (`terminal-font.ts`), which this file borrows its whole shape from.
 *
 * ── WHY A STORE, LIKE THE SIZE BESIDE IT ─────────────────────────────────
 * `TerminalStreamTab.tsx`'s xterm instance takes `fontFamily` as a literal
 * string, both at construction and as a live `term.options.fontFamily`
 * write — never as a custom property, because `--font-mono` is INLINED into
 * the `font-mono` utility at build time (`terminal-font.ts`'s own header
 * argues the identical point for the size). So the resolved family has to
 * reach React, which means a store with a snapshot and a subscription, the
 * shape `useSyncExternalStore` already asks for here.
 *
 * ── ONE FAMILY NAME STORED, NEVER A WHOLE STACK ──────────────────────────
 * The operator picks (or types) the one font they want tried FIRST.
 * `resolveTerminalFontFamily` is what appends vam's own shipped fallback
 * (`TERMINAL_FONT_FAMILY`) behind it, so a name the operating system does
 * not actually have still leaves the pane readable — it falls through to
 * Geist Mono / SF Mono / Menlo / Consolas / monospace exactly as it always
 * has, rather than to whatever the browser engine's own generic guess is.
 * Unset (`''`) resolves to the shipped stack alone: an operator who never
 * opens the picker sees no change at all.
 *
 * ── WHY QUOTES ARE STRIPPED ON READ ───────────────────────────────────────
 * The resolved string is spliced, verbatim, into a CSS `font-family` value
 * (xterm.js's own option, and the settings preview card's inline style). A
 * hand-edited payload — or a font-enumeration result main mis-parsed — is not
 * trusted to be one bare family name, so a `'` cannot reach either splice
 * point: this is the read a corrupted or malicious payload arrives by, same
 * posture as every other field's `readX` in `prefs.ts`.
 */

import { TERMINAL_FONT_FAMILY } from './terminal-font.js';

/** Unset — the shipped stack, untouched. What every payload predating this
 *  field reads back as. */
export const DEFAULT_TERMINAL_FONT_FAMILY = '';

/** Well past any real font family name (`SF Mono Semi-Condensed Bold`, the
 *  longest system name on this machine, is under 40) and far short of a
 *  pasted essay reaching xterm as a "font". */
export const MAX_TERMINAL_FONT_FAMILY_LENGTH = 100;

/**
 * Total, like `readTerminalFontSize`: a number, an object, an all-blank
 * string — none of them may reach xterm, and this is the read a hand-edited
 * payload arrives by. Quotes are dropped rather than the whole value
 * refused, the same "one bad element cannot unfold the rest" posture
 * `readIdsBySource` states in `prefs.ts` — a font name that merely HAD a
 * stray quote in it is still mostly the operator's own choice.
 */
export function readTerminalFontFamily(raw: unknown): string {
  if (typeof raw !== 'string') {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }
  const trimmed = raw.trim().replace(/['"]/g, '');
  if (trimmed.length === 0 || trimmed.length > MAX_TERMINAL_FONT_FAMILY_LENGTH) {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }
  return trimmed;
}

/**
 * The family a real renderer can use: the operator's own choice first, the
 * shipped stack behind it as a safety net — or the shipped stack alone, for
 * unset. Quoted the way a multi-word CSS family name always is; `readTerminal
 * FontFamily` is what keeps a `'` from ever reaching this splice.
 */
export function resolveTerminalFontFamily(pref: string): string {
  return pref === '' ? TERMINAL_FONT_FAMILY : `'${pref}', ${TERMINAL_FONT_FAMILY}`;
}

/**
 * THE RESOLVED FAMILY IN FORCE, module state rather than a prop, for
 * `terminalFontSize`'s own reason: `Canvas.tsx` mounts one `TerminalStreamTab`
 * per split leaf with no dialogue in which a pane opened by a keystroke could
 * be asked.
 */
let active: string = resolveTerminalFontFamily(DEFAULT_TERMINAL_FONT_FAMILY);
const listeners = new Set<() => void>();

/** The snapshot `useSyncExternalStore` compares by identity — a string, so it
 *  is stable by construction. */
export function activeTerminalFontFamily(): string {
  return active;
}

/**
 * Put a family in force, resolved. Called by `activatePrefs`, which every
 * read and every write goes through.
 *
 * A CHANGE, NOT EVERY WRITE, like `setActiveTerminalFontSize`: every listener
 * that wakes re-measures its pane, so telling them all about an unrelated
 * write would refit every open terminal for a setting nobody touched.
 */
export function setActiveTerminalFontFamily(raw: unknown): void {
  const resolved = resolveTerminalFontFamily(readTerminalFontFamily(raw));
  if (resolved === active) return;
  active = resolved;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  contract, the shape `subscribeTerminalFontSize` already has. */
export function subscribeTerminalFontFamily(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
