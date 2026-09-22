/**
 * What macOS will carry in a notification body, and the cut that keeps vam
 * inside it.
 *
 * Electron documents the limit: "on macOS, the body is truncated at 256
 * bytes" (https://www.electronjs.org/docs/latest/api/notification). BYTES,
 * not characters -- so a body of two-byte characters is cut at 128 of them,
 * and a cut made by character count would tear the last one in half and hand
 * the notification centre a broken sequence. The cut here is made on the
 * encoded form and walked back to a character boundary.
 *
 * Handled at the seam rather than discovered later: the body is composed in
 * the renderer from a project name the operator chose, and there is no bound
 * on how long that is.
 */

export const NOTIFICATION_BODY_BYTES = 256;

const ELLIPSIS = '…';
const ELLIPSIS_BYTES = Buffer.byteLength(ELLIPSIS, 'utf8');

/** `text`, or as much of it as fits in `NOTIFICATION_BODY_BYTES` with an ellipsis. */
export function truncateBody(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= NOTIFICATION_BODY_BYTES) {
    return text;
  }
  const budget = NOTIFICATION_BODY_BYTES - ELLIPSIS_BYTES;
  let kept = '';
  let used = 0;
  // Iterating the string yields code points, never a lone surrogate, so a
  // character is either wholly in or wholly out.
  for (const char of text) {
    const bytes = Buffer.byteLength(char, 'utf8');
    if (used + bytes > budget) break;
    kept += char;
    used += bytes;
  }
  return kept + ELLIPSIS;
}
