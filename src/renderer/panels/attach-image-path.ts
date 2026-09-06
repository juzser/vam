/**
 * Beside `attachIntoDraft`, for the other kind of file.
 *
 * The measured mechanism (`state/artifacts/vam-image-attach/findings.md`)
 * needs only a bare path on its own line -- Claude Code's own agent chooses
 * to read whatever path-shaped token it recognises in the prompt. That is
 * narrower than what `attachIntoDraft` does for text: there is no "end of
 * attached content" the way there is for an inlined block, so this writes
 * one line and reads it back by content rather than reusing `ATTACH_BLOCK`,
 * which is specific to the fenced text convention and one-file-at-a-time.
 */

/** The path this module appended to `draft`, or `null`. */
export function readImagePath(draft: string): string | null {
  for (const line of draft.split('\n')) {
    if (line.startsWith('/')) return line;
  }
  return null;
}

/**
 * Put `path` on its own line at the end of `draft`. A newline in the path is
 * stripped rather than escaped -- a picker never hands back a multi-line
 * path, so any newline present is either untrustworthy or a mistake, and
 * either way a second line is not this function's to create.
 */
export function appendImagePath(draft: string, path: string): string {
  const cleaned = path.replace(/[\r\n]+/g, '');
  return draft === '' ? cleaned : `${draft}\n${cleaned}`;
}

/** Take the appended line back out, leaving the rest of the draft untouched. */
export function removeImagePath(draft: string, path: string): string {
  const cleaned = path.replace(/[\r\n]+/g, '');
  return draft
    .split('\n')
    .filter((line) => line !== cleaned)
    .join('\n');
}
