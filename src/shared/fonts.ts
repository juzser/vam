/**
 * THE CURATED FONT LISTS, WHERE BOTH PROCESSES CAN READ THEM.
 *
 * Renderer-safe: no `electron`, no `node:` import, `update.ts`/`adhd-
 * skill.ts`'s own standing here. `src/main/fonts/list-sans.ts` carries the
 * IDENTICAL eight names as `SANS_HINTS` (a scan predicate, main-only, reads
 * `node:fs`) -- `test/shared/fonts.test.ts` holds the two lists in step
 * rather than trusting a human edit to one to remember the other.
 *
 * ── DESKTOP SCANS, A BROWSER CANNOT (settings-views restructure, item G) ──
 * Operator: "UI Font and Terminal Font settings become dropdowns ... desktop
 * shows only installed fonts ... browser shows curated macOS lists." A
 * browser tab and a paired phone have no `window.api.fonts` at all -- no
 * filesystem to enumerate -- so `SettingsOverlay.tsx`'s picker falls back to
 * these SAME curated names, offered unconditionally rather than filtered by
 * a presence check no browser build can perform. They are also the base
 * candidate set a desktop scan itself checks against
 * (`list-sans.ts`/`list-monospace.ts`'s own `MONOSPACE_HINTS`) -- "curated"
 * describes the SOURCE of a name, not whether a machine happens to have it.
 *
 * `''` IS "SYSTEM DEFAULT" IN BOTH LISTS, not a ninth/sixth curated name --
 * the same sentinel `ui-font-family.ts`'s `DEFAULT_UI_FONT_FAMILY` and
 * `terminal-font-family.ts`'s own default already give an unset preference.
 * The picker draws it as the first option; neither array below repeats it.
 */

/** The eight names `list-sans.ts`'s own `SANS_HINTS` scans for, verbatim --
 *  a browser build's unconditional UI-font menu, and desktop's own search
 *  space before a presence check narrows it. */
export const UI_FONT_CURATED: readonly string[] = [
  'SF Pro',
  'Helvetica Neue',
  'Avenir Next',
  'Gill Sans',
  'Futura',
  'Optima',
  'Verdana',
  'Trebuchet MS',
];

/**
 * THE FIVE NAMES A BROWSER BUILD OFFERS FOR TERMINAL, unconditionally --
 * common macOS/cross-platform monospace faces an operator is likely to
 * already have, offered as a guess rather than a verified fact (no scan is
 * possible there at all). Desktop does not read this array: its own picker
 * is `main/fonts/list-monospace.ts`'s live scan, over `MONOSPACE_HINTS` --
 * a wider, unbounded set (also finds `JetBrains Mono`, `Fira Code`,
 * `Cascadia Code`, `Source Code Pro`, `Hack`, `IBM Plex Mono`, `Iosevka` and
 * anything else on this machine that looks monospace by name), gated on
 * actually being found on THIS disk rather than assumed.
 */
export const TERMINAL_FONT_CURATED: readonly string[] = [
  'SF Mono',
  'Menlo',
  'Monaco',
  'Courier New',
  'Andale Mono',
];
