/**
 * A stable project id that carries no path.
 *
 * The last segment alone would merge two genuinely different checkouts that
 * happen to share a directory name, and the full path would render the
 * operator's home directory into the DOM of a public application. A digest
 * disambiguates without disclosing.
 *
 * It lives in its own module because two things now need it: `source.ts`,
 * which mints the ids, and `create-session.ts`, which must map one back to a
 * working directory -- and a digest is one-way, so the only honest way back is
 * to re-derive the id for each known directory and compare.
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export function projectIdOf(cwd: string): string {
  return `claude-code:${basename(cwd)}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
}
