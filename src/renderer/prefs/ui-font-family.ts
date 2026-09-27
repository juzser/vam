/**
 * THE APP CHROME'S OWN FONT — every label, button and pane header, separate
 * from the terminal's own face (`terminal-font-family.ts`) and applied a
 * different way, for a reason worth stating once.
 *
 * ── A DOM SIDE EFFECT, NOT A STORE ────────────────────────────────────────
 * `terminal-font-family.ts` needs a live React value because xterm.js takes
 * `fontFamily` as a construction option and a later write. Nothing here reads
 * a React value at all: the whole app already gets its font through ordinary
 * CSS inheritance from `body { font-family: var(--font-sans) }` (`styles.
 * css`), the same cascade `applyOutFontSize`'s custom property and
 * `applyPalette`'s overrides already ride. So this is a plain DOM write --
 * `activatePrefs`'s own side-effect list -- not a subscription.
 *
 * ── `body`, NOT `:root` ────────────────────────────────────────────────────
 * `--font-sans` is INLINED into the `font-sans` utility at Tailwind build
 * time (`terminal-font.ts`'s header argues the identical point for
 * `--font-mono`) -- there is no custom property a script could set that any
 * rule actually reads back. What DOES work is an inline style on the SAME
 * element `body`'s own rule is written against: an inline style always
 * outranks its own element's stylesheet rule, cascade-wise, regardless of
 * specificity. That reaches every ordinary label through inheritance and
 * deliberately leaves the handful of elements wearing an EXPLICIT `font-sans`
 * class of their own untouched -- `ShortcutTip.tsx`'s `⌘` glyph chips are
 * pinned to the shipped face on purpose (`font-mono` draws a visibly
 * narrower ⌘ than `font-sans` at the same size), and a change here must not
 * reopen that with an arbitrary chosen font whose glyph shape was never
 * measured.
 */

/** Unset — the shipped face, untouched. What every payload predating this
 *  field reads back as, and the value `applyUiFontFamily` clears the
 *  document back to. */
export const DEFAULT_UI_FONT_FAMILY = '';

/** Well past any real font family name and far short of a pasted essay
 *  reaching `body`'s own style attribute as a "font" -- the same bound
 *  `terminal-font-family.ts` sets for the identical reason. */
export const MAX_UI_FONT_FAMILY_LENGTH = 100;

/**
 * `styles.css`'s own `--font-sans` value, copied -- the same unavoidable copy
 * `TERMINAL_FONT_FAMILY` is, and held to the stylesheet by the same kind of
 * test (`prefs.ui-font-family.test.ts`'s sibling assertion in
 * `terminal-font.test.ts` is the precedent).
 */
export const UI_FONT_FAMILY_STACK =
  "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** Total, like `readTerminalFontFamily`: a number, an object, an all-blank
 *  string -- none of them may reach `body`'s style attribute, and quotes are
 *  dropped rather than the whole value refused, for the identical reason. */
export function readUiFontFamily(raw: unknown): string {
  if (typeof raw !== 'string') {
    return DEFAULT_UI_FONT_FAMILY;
  }
  const trimmed = raw.trim().replace(/['"]/g, '');
  if (trimmed.length === 0 || trimmed.length > MAX_UI_FONT_FAMILY_LENGTH) {
    return DEFAULT_UI_FONT_FAMILY;
  }
  return trimmed;
}

/**
 * The family the document can use: the operator's own choice first, the
 * shipped stack behind it -- or the empty string for unset, which
 * `applyUiFontFamily` reads as "clear the override, let the stylesheet
 * answer".
 */
export function resolveUiFontFamily(pref: string): string {
  return pref === '' ? '' : `'${pref}', ${UI_FONT_FAMILY_STACK}`;
}

/**
 * Put the chosen face on `body`'s own inline style -- the mechanism
 * `applyOutFontSize` and `applyPalette` use for their own tokens, adapted for
 * a property Tailwind never leaves a custom property behind for. Clamped and
 * resolved here too, this being the last gate before the DOM.
 */
export function applyUiFontFamily(
  pref: string,
  root: HTMLElement | null = globalThis.document?.body ?? null,
): void {
  if (root === null) {
    return;
  }
  const resolved = resolveUiFontFamily(readUiFontFamily(pref));
  if (resolved === '') {
    root.style.removeProperty('font-family');
  } else {
    root.style.setProperty('font-family', resolved);
  }
}
