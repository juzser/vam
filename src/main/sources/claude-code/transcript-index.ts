/**
 * WHICH FILE A SESSION'S TURNS LIVE IN -- the one place that answers it.
 *
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`, where `<slug>` is a LOSSY
 * flattening of the working directory: both `/` and `.` become `-`, so two
 * different directories can flatten onto the same slug and a slug cannot be
 * turned back into a path. It is therefore never parsed -- only walked, to
 * find which directory a session id's file is in. `source.ts` states that rule
 * for the source as a whole; this module is where it is kept.
 *
 * EXTRACTED BECAUSE THERE ARE FOUR READERS NOW, not two. Scrolling back
 * (`readClaudeCodeHistory`), opening one of a session's agents
 * (`readClaudeCodeAgentWork`), the live load itself and -- since the model
 * button gained a second source -- `transcript-model.ts`. The `#` rule below
 * is subtle enough that a second copy of it would be a second thing to get
 * wrong, which is what `source.ts` said when it had two callers.
 *
 * MAIN-PROCESS ONLY: it reads the filesystem, so the browser build cannot use
 * it and does not import it.
 */

import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where Claude Code keeps transcripts. Derived, never a literal home path. */
export const defaultTranscriptRoot = (): string => join(homedir(), '.claude', 'projects');

/**
 * Where each session id's transcript lives, by walking the slug directories
 * once. Names only -- no file is opened and nothing is stat'd here, so an
 * index over 54 transcripts costs ten `readdir` calls.
 */
export async function indexTranscripts(root: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // No transcript root: Claude Code has never run for this user, or this is
    // a machine without it. Live sessions can still be listed, with no turns.
    return index;
  }
  for (const dir of dirs) {
    try {
      for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          index.set(entry.name.slice(0, -'.jsonl'.length), join(root, dir, entry.name));
        }
      }
    } catch {
      // A directory that vanished between the two reads.
    }
  }
  return index;
}

/**
 * Which FILE a row's turns live in, and which session that row is.
 *
 * A ROW IS A PROCESS AND A SESSION IS A FILE, so a row key is
 * `<sessionId>#<pid>` (`deliver.ts`) and two rows can share one transcript.
 * The index is consulted BEFORE the `#` is trusted, because a session id
 * containing one would otherwise be cut in half by a rule meant for the
 * suffix.
 */
export async function locateTranscript(
  root: string,
  rowId: string,
): Promise<{ readonly sessionId: string; readonly path: string | undefined }> {
  const index = await indexTranscripts(root);
  const hash = rowId.lastIndexOf('#');
  const sessionId = index.has(rowId) || hash === -1 ? rowId : rowId.slice(0, hash);
  return { sessionId, path: index.get(sessionId) };
}
