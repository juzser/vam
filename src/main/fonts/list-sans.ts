/**
 * THE UI FONT PICKER'S OWN SCAN (settings-views restructure, item G).
 *
 * Operator: "UI Font and Terminal Font settings become dropdowns ... desktop
 * shows only installed fonts (extend scan for sans names)." `list-
 * monospace.ts`'s own mechanism (`font-scan.ts`, factored out for exactly
 * this) reads the SAME well-known font directories; what differs here is the
 * word list.
 *
 * `SANS_HINTS` IS THE CURATED LIST, NOT A SET OF GENERIC TERMS. A monospace
 * family's name reliably carries a shared word ("mono", "code", "console");
 * a UI/display font has no such vocabulary -- nothing links "Optima" and
 * "Futura" by name. So this scan does not try to DISCOVER an unknown sans
 * font by guessing at a naming convention; it checks whether each of the
 * eight names the operator's own brief listed is actually present on this
 * machine, the same names `shared/fonts.ts` offers unconditionally in a
 * browser build that cannot scan at all.
 */

import {
  type FontsFsLike,
  familyFromFilename,
  fontDirectoriesFor,
  matchesHint,
  type ScanFontFamiliesDeps,
  scanFontFamilies,
} from './font-scan.js';

export type { FontsFsLike };
export type ListSansFontsDeps = ScanFontFamiliesDeps;
export { familyFromFilename, fontDirectoriesFor };

/**
 * The eight curated UI/display names, spelled once here -- `shared/
 * fonts.ts`'s own `UI_FONT_CURATED` is this SAME list (a renderer-safe
 * module cannot import from `src/main/`), and `test/shared/fonts.test.ts`
 * holds the two in step rather than trusting a human to keep them so.
 */
export const SANS_HINTS: readonly string[] = [
  'SF Pro',
  'Helvetica Neue',
  'Avenir Next',
  'Gill Sans',
  'Futura',
  'Optima',
  'Verdana',
  'Trebuchet MS',
];

function looksSans(family: string): boolean {
  return SANS_HINTS.some((hint) => matchesHint(family, hint));
}

/**
 * Every curated UI family name this machine's well-known font directories
 * actually carry, sorted for a picker that must not depend on directory
 * order. TOTAL: see `scanFontFamilies`'s own comment in `font-scan.ts`.
 */
export function listSansFontFamilies(deps: ListSansFontsDeps): string[] {
  return scanFontFamilies(deps, looksSans);
}
