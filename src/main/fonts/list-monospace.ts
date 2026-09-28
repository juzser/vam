/**
 * FONT ENUMERATION, THE "SAFE LOCAL MECHANISM" THE BRIEF ASKED FOR.
 *
 * There is no Electron or Node API that lists installed fonts. Chromium's own
 * `queryLocalFonts()` (the Local Font Access API) IS one, but it is a
 * RENDERER-side, permission-gated web API meant for a page asking a PERSON
 * for consent to read their whole font catalogue — the wrong shape for a
 * desktop app's own Settings row (a permission prompt for a picker that is
 * already inside a trusted app), and it does not exist at all over Tailscale
 * Serve on a browser that has not separately granted it. So this reads the
 * FILESYSTEM instead: the well-known font directories for whichever platform
 * `main/index.ts` is running on, filtered to filenames that LOOK monospace
 * by name — no shelled-out command, no new dependency, just `fs.readdirSync`
 * against a fixed, non-configurable list of paths (`font-scan.ts`).
 *
 * A HEURISTIC, NAMED AS ONE. Answering "is this font fixed-pitch" for real
 * means parsing the font's own `post` table (`isFixedPitch`), which is out
 * of scope for a Settings row whose OTHER half is a free-text fallback for
 * exactly the fonts this misses (`prefs/terminal-font-family.ts`).
 * `MONOSPACE_HINTS` is a curated list of terms every mainstream monospace
 * family's name carries; the picker degrades gracefully when this list finds
 * nothing at all — free text still works, and the shipped fallback stack
 * (`TERMINAL_FONT_FAMILY`) still renders something.
 *
 * `font-scan.ts` CARRIES THE MECHANISM THIS FILE ONCE HAD ALONE -- the
 * directory list, the filename-to-family cleanup, the total directory walk
 * -- factored out when `list-sans.ts` (settings-views restructure, item G)
 * needed the identical mechanism for a different word list. What stays here
 * is `MONOSPACE_HINTS` itself and the one predicate it answers.
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
export type ListMonospaceFontsDeps = ScanFontFamiliesDeps;
export { familyFromFilename, fontDirectoriesFor };

/**
 * Terms a mainstream monospace family's name carries, matched case-
 * insensitively as a SUBSTRING of the cleaned-up family name -- never of the
 * raw filename, which still has its extension and separators in it.
 *
 * DELIBERATELY A FLAT LIST RATHER THAN A REGEX WITH ALTERNATION: a name added
 * here is a name a reviewer can read as data, and the sweep test below
 * proves every one of them actually matches something.
 */
export const MONOSPACE_HINTS: readonly string[] = [
  'mono',
  'code',
  'console',
  'courier',
  'consolas',
  'menlo',
  'monaco',
  'terminal',
  'cascadia',
  'hack',
  'inconsolata',
  'anonymous pro',
  'ubuntu mono',
  'dejavu sans mono',
  'liberation mono',
  'nimbus mono',
  'andale mono',
  'lucida console',
  'pragmata',
  'iosevka',
];

function looksMonospace(family: string): boolean {
  return MONOSPACE_HINTS.some((hint) => matchesHint(family, hint));
}

/**
 * Every monospace-looking family name this machine's well-known font
 * directories carry, sorted for a picker that must not depend on directory
 * order. TOTAL: see `scanFontFamilies`'s own comment in `font-scan.ts`.
 */
export function listMonospaceFontFamilies(deps: ListMonospaceFontsDeps): string[] {
  return scanFontFamilies(deps, looksMonospace);
}
