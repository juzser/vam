/**
 * The pane a Claude Code session PUBLISHES about itself.
 *
 * WHY THIS SUPERSEDES THE PROJECT TAG. vam's original pairing (`tmux/argv.ts`,
 * `VAM_PROJECT_OPTION`) records a PROJECT id on the tmux session it creates,
 * because at creation time no Claude session exists yet to record. Read back,
 * that answers "which project is this pane" and not "which session" -- so two
 * sessions vam started in one project collapse into `ambiguous`: the Terminal
 * tab draws nothing and `vamControlled` is false, which makes closing refuse.
 *
 * Claude Code itself publishes the better answer. A session running under tmux
 * writes its own pane into its per-process file as
 *
 *     tmux: '<tmux-session>:@<window>.%<pane>'
 *
 * beside the `sessionId` it belongs to. That is per SESSION, comes from the
 * process that is actually in the pane, and survives a tmux rename -- so where
 * it exists it WINS, and the project tag stays as the fallback for a session
 * whose file carries no `tmux` field (an older Claude Code, or a session not
 * under tmux at all). See `paneForRow` in `reply.ts`, where the two meet.
 *
 * WHAT IS STILL ENFORCED. A published name is only ever used after it is found
 * in `listVamSessions`, which filters to vam's own prefix. So the operator's
 * own tmux sessions publish their panes here and are still never typed into,
 * killed, or drawn: vam only acts on sessions it started.
 *
 * THE SAME FILES `session-status.ts` READS, and deliberately not a second read
 * path for them -- that module answers per pid because its caller has a pid,
 * this one enumerates because its caller has a session id. The directory also
 * holds `<pid>.<hash>.key` files, which are secret material: only names ending
 * in `.json` are opened here, so a key file is never read at all.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One session's published pane. */
export type PublishedPane = {
  readonly sessionId: string;
  /** The tmux SESSION, which is all any tmux verb vam runs is addressed by. */
  readonly tmuxSession: string;
};

/**
 * One file's text to the pairing it publishes, or `null` for anything a caller
 * cannot use: unparseable JSON, a document that is not an object, a missing or
 * non-string `sessionId`, an absent `tmux` field (the common case -- a session
 * outside tmux has no pane to report), or a `tmux` value with no session name
 * before the `:`. `null` is never an error; it means this file says nothing
 * about a pane, and the caller has the project tag for exactly that.
 */
export function parsePublishedPane(text: string): PublishedPane | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const sessionId = record.sessionId;
  const tmux = record.tmux;
  if (typeof sessionId !== 'string' || sessionId === '' || typeof tmux !== 'string') return null;
  // Everything from the `:` on is the window and pane within the session, and
  // vam addresses sessions. A value with nothing before the `:` names no
  // session and is dropped rather than matched against as an empty string --
  // which is what an unset project option reads back as, and would sweep up
  // every session vam did not start.
  const [name] = tmux.split(':');
  const tmuxSession = name === undefined ? '' : name.trim();
  return tmuxSession === '' ? null : { sessionId, tmuxSession };
}

/**
 * Every session id in `sessionsRoot` that published a pane, mapped to it.
 *
 * Never throws, for the reason `readStatusUpdatedAt` does not: a missing or
 * unreadable directory means vam has no published pairing to prefer, which is
 * the fallback's case and not a failure worth a load.
 *
 * The cost is one `readdir` plus one small JSON document per live process --
 * the same files the per-row status read already opens, on the same order of
 * bytes.
 */
export async function readPublishedPanes(
  sessionsRoot: string,
): Promise<ReadonlyMap<string, string>> {
  const panes = new Map<string, string>();
  let names: string[];
  try {
    names = (await readdir(sessionsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name);
  } catch {
    return panes;
  }
  for (const name of names) {
    try {
      const published = parsePublishedPane(await readFile(join(sessionsRoot, name), 'utf8'));
      if (published !== null) panes.set(published.sessionId, published.tmuxSession);
    } catch {
      // A file that vanished between the listing and the read, or one this
      // user cannot open. One unreadable file costs its own pairing, never
      // the whole map.
    }
  }
  return panes;
}

/**
 * The tmux sessions that some row has PUBLISHED itself into -- the claim set.
 *
 * A PUBLISHED PANE IS AN EXCLUSIVE CLAIM, and this is the one place that
 * sentence is turned into a value, because both pairing rules need it and two
 * copies of it would drift. `targetSession` (`terminal/pane.ts`) draws and
 * resizes by it; `paneForRow` (`reply.ts`) types and closes by it.
 *
 * WHAT IT FIXES. The published branch of both rules already refuses a value
 * that DISAGREES -- a disagreement is evidence of a corrupt pairing rather
 * than absence of evidence. Absence itself was read as "nobody has an opinion,
 * guess by project": measured on a real machine, three of four live sessions
 * published no `tmux` field, and the tag found for each of them the single vam
 * session in that project -- the one the FOURTH session had published. vam
 * drew that screen under another row's name and had already reflowed it to
 * fit another row's window.
 *
 * The tag path is NOT removed, and that is why this is a filter rather than a
 * deletion: an UNCLAIMED vam session -- one whose Claude Code is too old to
 * publish the field, or one not under tmux -- is exactly what the fallback
 * exists for and still resolves through it.
 *
 * A claim is not checked against liveness. A pane claimed by a session that
 * has exited leaving its file behind stays claimed, because nothing here can
 * tell that apart from a session vam simply is not drawing -- and the cost of
 * being wrong in the safe direction is an empty tab, against a keystroke in
 * somebody else's agent.
 */
export function claimedPanes(panes: ReadonlyMap<string, string> | undefined): ReadonlySet<string> {
  return new Set(panes === undefined ? [] : panes.values());
}
