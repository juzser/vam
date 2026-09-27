/**
 * THE SAVE-TIME NORMALISER.
 *
 * The operator's own ask: "on save, trim spaces and add a trailing empty
 * line." `FilesTab.tsx`'s `saveFile` runs this on `content` before it ever
 * reaches `write` — every save path goes through that one function (`Mod-s`
 * from the editor, `Mod-s` from the markdown preview; there is no third), so
 * this is the one place the rule has to live.
 *
 * WHAT IT DOES, ON EVERY LINE OF EVERY FILE:
 *   * the file ends with exactly one final newline — several trailing blank
 *     lines collapse to that one, and a missing one is added.
 *
 * WHAT IT DOES ADDITIONALLY, EXCEPT FOR THE EXEMPT EXTENSIONS BELOW:
 *   * trailing spaces and tabs are trimmed — a whitespace-only line becomes
 *     empty, not deleted (its position in the file is not "blank runs" the
 *     way `files-format.ts`'s `formatIni` collapses them, except at the very
 *     end).
 *
 * AN EMPTY FILE STAYS EMPTY. There is no line to anchor a final newline to,
 * and a lone `"\n"` would be a byte an empty file never had — the operator
 * asked for tidying, not for inventing content. A file that is ENTIRELY
 * whitespace normalises the same way: every line trims to empty (or, for an
 * exempt extension, is simply blank already), the trailing-blank-run
 * collapse removes them all, and what is left is nothing.
 *
 * CRLF STAYS CRLF. `files-format.ts`'s own heuristic — any `\r` anywhere in
 * the file means CRLF — is reused rather than invented a second time
 * (`formatFile`'s "a CRLF file cannot be formatted... " guard); every
 * emitted line ending matches whichever the source used.
 *
 * THE PER-LINE TRIM IS EXEMPT FOR A NAMED FEW EXTENSIONS (X-SET-1, the
 * cross-provider review's own finding), because for these the trailing
 * whitespace IS the content rather than incidental keystrokes:
 *
 *   * `.md`/`.markdown`/`.mdx` — two or more trailing spaces before a
 *     newline is CommonMark's hard line break. Trimming it silently turns an
 *     intentional line break into an ordinary soft wrap.
 *   * `.patch`/`.diff` — a unified diff's context and `-`/`+` lines quote the
 *     file they touch byte for byte; a line that legitimately ends in a
 *     space (because the line it quotes did) would no longer apply the same
 *     way if trimmed.
 *   * `.snap` — a Jest/Vitest inline snapshot serialises the value under
 *     test, including any trailing whitespace it happens to contain;
 *     trimming it would make the snapshot disagree with its own
 *     serialisation.
 *
 * `.env`/`.ini` ARE DELIBERATELY NOT ON THAT LIST, even though
 * `files-format.ts`'s own `formatIni` refuses to touch a trailing space on a
 * DATA line there (`A=1   ` and `A="1   "` are not the same value). This
 * normaliser trims them anyway, on the operator's own explicit save-time ask
 * — the same trade the "trim trailing whitespace on save" setting most
 * editors ship makes for every file type at once, and the one place this
 * normaliser still disagrees with Format on purpose.
 */

import { baseName, extensionOf } from './files-editor-text.js';

/** Trailing spaces and tabs, and nothing else — never a line's own content. */
const TRAILING_BLANK = /[ \t]+$/;

/** See this file's own header for why each of these is exempt from the
 *  per-line trim. Matched by `extensionOf`, so it is the FULL final
 *  extension, lower-cased, dot included. */
const NO_LINE_TRIM_EXTS = new Set(['.md', '.markdown', '.mdx', '.patch', '.diff', '.snap']);

function trimsTrailingWhitespace(path: string): boolean {
  const ext = extensionOf(baseName(path));
  return ext === null || !NO_LINE_TRIM_EXTS.has(ext);
}

/** One line of the ORIGINAL content, and where it sat. `eolLength` is the
 *  width of whatever line ending followed it — 0 for the last line, which
 *  nothing follows. */
interface RawLine {
  readonly text: string;
  readonly start: number;
  readonly eolLength: number;
}

function splitLinesWithOffsets(content: string): RawLine[] {
  const lines: RawLine[] = [];
  const eolPattern = /\r\n|\r|\n/g;
  let start = 0;
  let match: RegExpExecArray | null = eolPattern.exec(content);
  while (match !== null) {
    lines.push({ text: content.slice(start, match.index), start, eolLength: match[0].length });
    start = match.index + match[0].length;
    match = eolPattern.exec(content);
  }
  lines.push({ text: content.slice(start), start, eolLength: 0 });
  return lines;
}

export interface NormalizedSave {
  /** The normalised text — what `normalizeForSave` alone answers. */
  readonly value: string;
  /**
   * Maps an offset into the ORIGINAL content to the same logical position in
   * `value` — moved left by whatever was removed strictly before it, rather
   * than merely clamped to the new, shorter length. A caret sitting inside
   * text that got trimmed away lands just past the nearest surviving
   * character; a caret on a line dropped entirely by the trailing-blank-run
   * collapse lands at the very end of `value`.
   */
  readonly mapOffset: (offset: number) => number;
}

/**
 * The full computation behind `normalizeForSave`, plus the offset map a
 * caret restore needs (`FilesTab.tsx`'s `onNormalizedBeforeSave`, S3 in the
 * cross-provider review). Kept as ONE function rather than two so the value
 * and the map can never drift apart by being computed twice, differently.
 */
export function normalizeForSaveWithMap(content: string, path = ''): NormalizedSave {
  const eol = content.includes('\r') ? '\r\n' : '\n';
  const trim = trimsTrailingWhitespace(path);
  const rawLines = splitLinesWithOffsets(content);
  const trimmedTexts = rawLines.map((line) =>
    trim ? line.text.replace(TRAILING_BLANK, '') : line.text,
  );

  // How many leading lines survive the trailing-blank-run collapse — the
  // rest (indices `keep..length`) are dropped entirely, not merely emptied.
  let keep = trimmedTexts.length;
  while (keep > 0 && (trimmedTexts[keep - 1] ?? '').trim() === '') keep -= 1;

  const keptLines = trimmedTexts.slice(0, keep);
  const value = keptLines.length === 0 ? '' : `${keptLines.join(eol)}${eol}`;

  const newLineStarts: number[] = [];
  let acc = 0;
  for (const line of keptLines) {
    newLineStarts.push(acc);
    acc += line.length + eol.length;
  }

  const mapOffset = (offset: number): number => {
    const clamped = Math.max(0, Math.min(offset, content.length));
    // Walks every raw line, keeping the last one visited. An offset exactly
    // at the end of the content never satisfies the strict `<` below (there
    // is no "next line" for it to roll onto), so the walk runs off the end
    // and `matched` is left holding the last line — the right answer.
    let matched: RawLine | undefined;
    let index = -1;
    for (const [i, line] of rawLines.entries()) {
      matched = line;
      index = i;
      // Strict `<`: an offset sitting exactly at the START of the NEXT line
      // (right after this one's own EOL is fully consumed) belongs to that
      // next line, not to this one — `<=` here would misfile column 0 of
      // every line but the first as the previous line's own trailing edge.
      if (clamped < line.start + line.text.length + line.eolLength) break;
    }
    // `rawLines` is never empty (`splitLinesWithOffsets` always pushes at
    // least one entry) — this is defensive only, for the type checker.
    if (matched === undefined) return value.length;
    if (index >= keep) return value.length; // this line was dropped entirely
    const column = Math.min(clamped - matched.start, matched.text.length);
    const newColumn = Math.min(column, (keptLines[index] ?? '').length);
    return (newLineStarts[index] ?? 0) + newColumn;
  };

  return { value, mapOffset };
}

export function normalizeForSave(content: string, path = ''): string {
  return normalizeForSaveWithMap(content, path).value;
}
