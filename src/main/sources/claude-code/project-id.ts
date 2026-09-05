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
 *
 * VOCABULARY. The "project" this mints an id for is the CODE's project -- one
 * cwd -- which the UI labels "repo"; the UI's word "project" belongs to the
 * grouping layer above it, which has no cwd and mints its own local id. See
 * the vocabulary table in `renderer/domain/model.ts` for why the two words are
 * allowed to cross, and why this function keeps its name: the value it returns
 * is what `@vam-project` records on running tmux sessions and what three prefs
 * buckets on the operator's disk are keyed by.
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export function projectIdOf(cwd: string): string {
  return `claude-code:${basename(cwd)}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
}
