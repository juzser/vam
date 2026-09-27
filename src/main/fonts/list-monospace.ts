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
 * against a fixed, non-configurable list of paths.
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
 * INJECTED `fs` AND `platform`/`homedir`, NEVER THE REAL ONES — the same
 * `ZoomLockable`-shaped narrow-interface pattern `main/zoom.ts` and
 * `main/clipboard/ipc.ts` already use, so this is testable without a real
 * filesystem and without `vi.mock('node:fs')`.
 */

/** The slice of `node:fs` this needs. */
export type FontsFsLike = {
  readdirSync(path: string): readonly string[];
};

export type ListMonospaceFontsDeps = {
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly fs: FontsFsLike;
};

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

const HINTS_LOWER = MONOSPACE_HINTS.map((hint) => hint.toLowerCase());

/**
 * The well-known font directories for a platform, system-wide first and the
 * operator's own second -- so a de-duplicating caller sees the system
 * version of a name shadowed by nothing, and a font installed only for this
 * account is still found.
 *
 * AN UNRECOGNISED PLATFORM READS AS LINUX'S OWN LIST, on the same "read as
 * the safe default" rule `readTerminalThemeId` and every other total reader
 * in this codebase follows -- `fontconfig`'s own paths are the closest thing
 * to a cross-UNIX convention, and a platform this file has never heard of is
 * far more likely to be UNIX-like than not.
 */
export function fontDirectoriesFor(platform: NodeJS.Platform, homedir: string): string[] {
  switch (platform) {
    case 'darwin':
      return ['/System/Library/Fonts', '/Library/Fonts', `${homedir}/Library/Fonts`];
    case 'win32':
      return ['C:\\Windows\\Fonts', `${homedir}\\AppData\\Local\\Microsoft\\Windows\\Fonts`];
    default:
      return [
        '/usr/share/fonts',
        '/usr/local/share/fonts',
        `${homedir}/.local/share/fonts`,
        `${homedir}/.fonts`,
      ];
  }
}

/** Font file extensions this bothers to look at. Anything else in a font
 *  directory (a `.txt`, a `.DS_Store`) is not a font this can name. */
const FONT_EXTENSION = /\.(ttf|ttc|otf|otc|woff2?)$/i;

/**
 * A COMMON STYLE SUFFIX, STRIPPED SO `Menlo-Regular` AND `Menlo-Bold` READ AS
 * ONE FAMILY. Ordered longest-first so `BoldItalic` is not left as a stray
 * `Italic` once `Bold` has already been cut. Deliberately conservative: a
 * suffix this list does not recognise is left in the name rather than
 * guessed at, which duplicates a family across weights but never merges two
 * families that happen to share a stem.
 */
const STYLE_SUFFIX =
  /[- _](BoldItalic|SemiBoldItalic|BoldOblique|Bold|SemiBold|ExtraBold|Black|Heavy|Light|ExtraLight|Thin|Medium|Regular|Italic|Oblique|Book)$/i;

/** One filename, reduced to the family name a picker would show -- or `null`
 *  for anything that is not plausibly a font file at all. */
function familyFromFilename(filename: string): string | null {
  if (!FONT_EXTENSION.test(filename)) {
    return null;
  }
  const stem = filename.replace(FONT_EXTENSION, '');
  const withoutStyle = stem.replace(STYLE_SUFFIX, '');
  const spaced = withoutStyle.replace(/[-_]+/g, ' ').trim();
  return spaced.length === 0 ? null : spaced;
}

function looksMonospace(family: string): boolean {
  const lower = family.toLowerCase();
  return HINTS_LOWER.some((hint) => lower.includes(hint));
}

/**
 * Every monospace-looking family name this machine's well-known font
 * directories carry, sorted for a picker that must not depend on directory
 * order. TOTAL: a directory that does not exist, or that this process may
 * not read, costs that ONE directory and nothing else -- the same "one bad
 * element cannot unfold the rest" posture `readIdsBySource` states in
 * `prefs.ts`.
 */
export function listMonospaceFontFamilies(deps: ListMonospaceFontsDeps): string[] {
  const families = new Set<string>();
  for (const dir of fontDirectoriesFor(deps.platform, deps.homedir)) {
    let entries: readonly string[];
    try {
      entries = deps.fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const family = familyFromFilename(entry);
      if (family !== null && looksMonospace(family)) {
        families.add(family);
      }
    }
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}
