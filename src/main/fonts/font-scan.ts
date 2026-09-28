/**
 * THE SHARED HALF OF FONT ENUMERATION -- the well-known directories, the
 * filename-to-family cleanup, and the total directory walk. `list-
 * monospace.ts`'s own header explains why this reads the filesystem at all
 * rather than Chromium's `queryLocalFonts()`; this file is that same
 * mechanism, factored out so `list-sans.ts` (settings-views restructure,
 * item G: "UI Font ... desktop shows only installed fonts, extend scan for
 * sans names") reads it rather than re-typing it. NEITHER family's own
 * matching rule lives here -- `looksMonospace`/`looksSans` stay in their own
 * files, because the WORD LIST is the one thing genuinely specific to each.
 */

/** The slice of `node:fs` this needs. */
export type FontsFsLike = {
  readdirSync(path: string): readonly string[];
};

export type ScanFontFamiliesDeps = {
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly fs: FontsFsLike;
};

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

/**
 * A HINT MATCHES A FAMILY IGNORING SPACES ON BOTH SIDES -- macOS's own font
 * files are the reason this exists: `HelveticaNeue.ttc` and `AndaleMono.ttf`
 * carry no `-`/`_` between their two words at all, so `familyFromFilename`
 * (which only turns THOSE separators back into spaces) leaves the family
 * run together as one word, while a multi-word hint like `'andale mono'` is
 * spelled with one. A plain substring check would then never match a REAL
 * machine's own file, only the hyphenated one a test constructs by hand --
 * measured, against this exact case, before this function existed.
 */
export function matchesHint(family: string, hint: string): boolean {
  const strip = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  return strip(family).includes(strip(hint));
}

/** One filename, reduced to the family name a picker would show -- or `null`
 *  for anything that is not plausibly a font file at all. */
export function familyFromFilename(filename: string): string | null {
  if (!FONT_EXTENSION.test(filename)) {
    return null;
  }
  const stem = filename.replace(FONT_EXTENSION, '');
  const withoutStyle = stem.replace(STYLE_SUFFIX, '');
  const spaced = withoutStyle.replace(/[-_]+/g, ' ').trim();
  return spaced.length === 0 ? null : spaced;
}

/**
 * Every family name this machine's well-known font directories carry, run
 * through `matches` and sorted for a picker that must not depend on
 * directory order. TOTAL: a directory that does not exist, or that this
 * process may not read, costs that ONE directory and nothing else -- the
 * same "one bad element cannot unfold the rest" posture `readIdsBySource`
 * states in `prefs.ts`.
 */
export function scanFontFamilies(
  deps: ScanFontFamiliesDeps,
  matches: (family: string) => boolean,
): string[] {
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
      if (family !== null && matches(family)) {
        families.add(family);
      }
    }
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}
