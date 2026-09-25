/**
 * THE SAVE-TIME NORMALISER.
 *
 * The operator's own ask: "on save, trim spaces and create an empty line at
 * the bottom." `FilesTab.tsx`'s `saveFile` runs this on `content` before it
 * ever reaches `write` — every save path goes through that one function
 * (`Mod-s` from the editor, `Mod-s` from the markdown preview; there is no
 * third), so this is the one place the rule has to live.
 *
 * WHAT IT DOES, ON EVERY LINE:
 *   * trailing spaces and tabs are trimmed — a whitespace-only line becomes
 *     empty, not deleted (its position in the file is not "blank runs" the
 *     way `files-format.ts`'s `formatIni` collapses them, except at the very
 *     end — see below);
 *   * the file ends with exactly one final newline — several trailing blank
 *     lines collapse to that one, and a missing one is added.
 *
 * AN EMPTY FILE STAYS EMPTY. There is no line to anchor a final newline to,
 * and a lone `"\n"` would be a byte an empty file never had — the operator
 * asked for tidying, not for inventing content. A file that is ENTIRELY
 * whitespace normalises the same way: every line trims to empty, the
 * trailing-blank-run collapse removes them all, and what is left is nothing.
 *
 * CRLF STAYS CRLF. `files-format.ts`'s own heuristic — any `\r` anywhere in
 * the file means CRLF — is reused rather than invented a second time
 * (`formatFile`'s "a CRLF file cannot be formatted... " guard); every
 * emitted line ending matches whichever the source used.
 *
 * NOT CARVED OUT FOR `.env`/`.ini`, ON PURPOSE, AND WORTH SAYING SO. This is
 * the one place this normaliser disagrees with `files-format.ts`'s own
 * argument: `formatIni`'s comment holds that a trailing space on a DATA line
 * is data-adjacent and must survive untouched, because vam cannot know which
 * reader will parse the file, and a shell's word-splitting disagrees with a
 * reader that takes the line verbatim. This function trims trailing
 * whitespace on every line regardless of file type — the operator's save-time
 * ask named no exception, and most editors' own "trim trailing whitespace on
 * save" setting makes exactly this trade for every file type at once. Flagged
 * here rather than silently decided, so a future ask to exempt `.env`/`.ini`
 * the way Format already does has an obvious place to land.
 */

/** Trailing spaces and tabs, and nothing else — never a line's own content. */
const TRAILING_BLANK = /[ \t]+$/;

export function normalizeForSave(content: string): string {
  const eol = content.includes('\r') ? '\r\n' : '\n';
  const lines = content.split(/\r\n|\r|\n/).map((line) => line.replace(TRAILING_BLANK, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length === 0 ? '' : `${lines.join(eol)}${eol}`;
}
