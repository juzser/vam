/**
 * `src/foo/bar.ts:42` -- THE ARTIFACT AGENTS ACTUALLY PRODUCE, read back out
 * of the prose they wrote it into.
 *
 * WHAT THIS IS NOT. It is not a path resolver and it is not an authorisation
 * check. It answers one question -- "does this run of characters claim to be a
 * file and a line" -- and nothing else. Whether that file exists, whether it
 * is inside the session's own project, and what it really resolves to through
 * a symlink are decided in MAIN, against the real filesystem
 * (`src/main/files/resolve-ipc.ts`). That is why `../../etc/passwd:1` PARSES
 * here rather than being filtered out: a reference the renderer silently
 * declines to draw is one whose refusal the operator never gets to read, and
 * the house rule is that a control which can only refuse says so.
 *
 * SHARED, FOR `src/shared/link.ts`'S REASON. Main parses the reference it is
 * handed with this same function rather than trusting a path and a line the
 * renderer split apart, so the renderer's parse is a convenience and main's is
 * the decision. One copy, so the two cannot disagree about where the path ends
 * and the line begins.
 *
 * THE HARD PART IS THE FALSE POSITIVES, not the matches. An answer is full of
 * things shaped like a reference: `10:30` is a time, `1.5:30` is a ratio,
 * `Note:` is a heading, and `https://host:443/x` contains `//host:443`, which
 * has a slash and a number after a colon. A button made out of any of those
 * turns a paragraph into a minefield, so the rules below are deliberately
 * narrow and every one of them is a test:
 *
 *  * A LINE IS REQUIRED. A bare `src/foo.ts` is left as text -- in prose it is
 *    indistinguishable from a word with a dot in it, and the Files tab's own
 *    tree and filter box are the way to open a file by name. `path:line` is
 *    what was asked for and what an agent writes when it means "look here".
 *  * THE PATH MUST CONTAIN A LETTER, which is what excludes `10:30` and `3/4:2`.
 *  * IT MUST LOOK LIKE A PATH: a `/` in it, or a filename extension that
 *    starts with a letter. `Note:42` has neither.
 *  * NOTHING MAY CARRY A SCHEME. `:` is not a path character here at all, so
 *    `https://example.test/a/b.ts:42` cannot match as a whole -- and the
 *    scanner additionally refuses a match whose preceding character is a
 *    colon or another path character, which is what stops it finding
 *    `//host:443` in the middle of one.
 */

/**
 * The bound on a reference. Far past any real path -- macOS stops at 1,024
 * bytes for a single path component and 4,096 for a whole one -- and small
 * enough that a compromised renderer cannot park a large string on main's
 * single event loop, which is `MAX_ISSUE_FIELD`'s reasoning one directory
 * over.
 */
export const MAX_FILE_REF_LENGTH = 1_024;

/** A path an agent named, and the line it pointed at. */
export type FileRef = {
  readonly path: string;
  /** 1-based, as every editor and every agent counts. Never 0. */
  readonly line: number;
};

/**
 * The characters a path may be made of here. Deliberately narrow: no colon
 * (so no scheme and no `host:port` can ever be inside one), no space, no
 * backslash, no quote, no NUL. A real path can hold far more than this; a
 * reference vam refuses to linkify is still perfectly readable text, which is
 * the safe direction to be wrong in.
 */
const PATH_CHARS = 'A-Za-z0-9._\\-/@+~';

/** `path:line`, optionally `:column`, and nothing else on either side. */
const WHOLE = new RegExp(`^([${PATH_CHARS}]+):(\\d{1,7})(?::\\d{1,7})?$`);

/** The same shape, hunted for inside a sentence. */
const SCAN = new RegExp(`[${PATH_CHARS}]+:\\d{1,7}(?::\\d{1,7})?`, 'g');

/** A character that cannot sit immediately before a reference: see the header. */
const BOUNDARY = new RegExp(`[${PATH_CHARS}:]`);

/** Must start with a letter, so `1.5` is not an "extension". */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/**
 * Reads one token as a reference, or answers null.
 *
 * Takes `unknown` for `checkLink`'s reason: main calls it on an argument the
 * renderer chose, so "not a string at all" is an answer rather than a type
 * error somebody else was supposed to have caught.
 */
export function parseFileRef(token: unknown): FileRef | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_FILE_REF_LENGTH) {
    return null;
  }
  const match = WHOLE.exec(token);
  if (match === null) return null;
  const path = match[1] ?? '';
  const line = Number(match[2]);
  // A line of 0 is not a line, and `Number` has already refused anything that
  // is not seven digits or fewer.
  if (!Number.isInteger(line) || line < 1) return null;
  if (!/[A-Za-z]/.test(path)) return null;
  if (!path.includes('/') && !EXTENSION.test(path)) return null;
  return { path, line };
}

/** One run of an answer's text: plain, or a reference to draw as a control. */
export type FileRefSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'ref'; readonly text: string; readonly ref: FileRef };

/**
 * Splits a run of text into plain parts and references.
 *
 * EVERY CHARACTER SURVIVES: the segments rejoin to the input exactly, which is
 * the property that keeps a scanner from quietly eating a model's punctuation.
 * A candidate the scanner finds but `parseFileRef` declines stays inside a text
 * segment rather than becoming one of its own, and a candidate whose preceding
 * character disqualifies it (the `//host:443` case) does the same.
 */
export function splitFileRefs(text: string): readonly FileRefSegment[] {
  const segments: FileRefSegment[] = [];
  let cursor = 0;
  SCAN.lastIndex = 0;
  for (let match = SCAN.exec(text); match !== null; match = SCAN.exec(text)) {
    const start = match.index;
    const token = match[0];
    const before = start === 0 ? '' : text[start - 1];
    if (before !== undefined && before !== '' && BOUNDARY.test(before)) continue;
    const ref = parseFileRef(token);
    if (ref === null) continue;
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    segments.push({ kind: 'ref', text: token, ref });
    cursor = start + token.length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}
