/**
 * ONE CHOICE: how the sidebar's own surface paints, next to whatever the
 * Terminal and the response views are doing.
 *
 * Operator, modelled on Orca's own Window & Sidebar settings: `Default` keeps
 * the shipped `--vam-sidebar` token untouched; `Match Terminal` points it at
 * the CURRENT terminal scheme's own background (`terminal-scheme.ts`'s
 * `resolveTerminalScheme(...).background`), so the sidebar and the pane read
 * as one continuous surface for an operator who lives in the Terminal tab;
 * `Tinted` points it at `--vam-sidebar-tinted`, a fixed literal per theme
 * defined in `styles.css` (13.1: every colour comes from a token, and that
 * file is the one place a hex literal is allowed to live) -- the same
 * convention `palette-templates.ts` uses for a preset rather than a computed
 * blend, without a hex literal anywhere in THIS file.
 *
 * A file of its own for the reason every other one-flag preference here is:
 * the default is a decision worth finding by name.
 */

export type SidebarAppearance = 'default' | 'match-terminal' | 'tinted';

/** Unchanged paint for everyone who never opens Settings. */
export const DEFAULT_SIDEBAR_APPEARANCE: SidebarAppearance = 'default';

const CHOICES: readonly SidebarAppearance[] = ['default', 'match-terminal', 'tinted'];

/** A stored word, or the shipped appearance -- the same total read every
 *  enum preference in this file takes. */
export function readSidebarAppearance(raw: unknown): SidebarAppearance {
  return CHOICES.includes(raw as SidebarAppearance)
    ? (raw as SidebarAppearance)
    : DEFAULT_SIDEBAR_APPEARANCE;
}

/** The token `--vam-sidebar` is set to for `Tinted` -- see `styles.css`'s own
 *  comment on `--vam-sidebar-tinted` for the two literal values this points
 *  at, one per theme. */
export const TINTED_SIDEBAR_VAR = 'var(--vam-sidebar-tinted)';

/** The custom property `Match Terminal`/`Tinted` override, and the property
 *  `Default` clears. Named once so `applySidebarAppearance` below and any
 *  future reader of it cannot spell it two ways. */
export const SIDEBAR_VAR = '--vam-sidebar';

/**
 * Put the chosen appearance on the document, as an override of
 * `--vam-sidebar` on the root -- the same mechanism `applyPalette`/
 * `applyOutFontSize` (`prefs.ts`) already use for a value nothing React owns.
 * `matchTerminalValue` is the CALLER's job to resolve (`resolveTerminalScheme
 * (prefs.terminalScheme, effectiveTheme(prefs.theme)).background`,
 * `terminal-scheme.ts`) -- this module has no opinion on which theme is on
 * screen, only on what to do once told.
 */
export function applySidebarAppearance(
  appearance: SidebarAppearance,
  matchTerminalValue: string,
  root: HTMLElement | null = globalThis.document?.documentElement ?? null,
): void {
  if (root === null) return;
  if (appearance === 'default') {
    root.style.removeProperty(SIDEBAR_VAR);
    return;
  }
  root.style.setProperty(
    SIDEBAR_VAR,
    appearance === 'tinted' ? TINTED_SIDEBAR_VAR : matchTerminalValue,
  );
}
