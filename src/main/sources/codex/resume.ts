/**
 * REOPENING A CODEX THREAD: start `codex resume <uuid>` in the thread's own
 * directory, in a tmux session vam tags exactly as it tags the ones it
 * creates, and let the ordinary discovery path find it.
 *
 * `docs/design/reopening-a-session.md` wrote the rules for Claude Code and
 * they hold word for word here. Codex is the easier half of that spec: the CLI
 * already has the verb, and `threads` already carries the `cwd` to run it in,
 * so nothing has to be reversed out of a slug.
 *
 * ── WHAT WAS MEASURED ─────────────────────────────────────────────────────
 *
 * codex-cli 0.153.2, on a private `-L` tmux socket in a throwaway directory:
 * `codex resume <uuid>` replayed the thread's own turns and took the SAME
 * uuid's writer lock. So a reopened thread is the same thread, it is live by
 * `liveness.ts`'s own test the moment it starts, and `source.ts` draws it
 * without being told anything.
 *
 * ── THE REFUSALS, AND WHY EACH IS HERE RATHER THAN ONLY IN THE UI ─────────
 *
 * The control is not drawn for a live session, which is 409 §3's first rule.
 * But a control that is merely not drawn is not a refusal: the renderer's idea
 * of liveness is one poll old, and `Canvas.tsx` is not the only caller of a
 * source's write surface -- the phone's HTTP routes are another. So every rule
 * is enforced HERE, where the spawn is, and the UI's job is only to avoid
 * offering what this would refuse.
 *
 * `unknown` is refused as loudly as `live`. vam may not claim a thread has
 * ended on the strength of not having looked -- that is `liveness.ts`'s whole
 * distinction, and spawning a second Codex onto a live thread is exactly the
 * hazard the rule exists to prevent.
 *
 * ── NO FORK ───────────────────────────────────────────────────────────────
 *
 * 409 §3 refuses `--fork-session` for Claude Code because forking silently
 * mints a second id for one history. `codex resume <uuid>` addresses the
 * thread itself and there is no fork flag in this command; a test asserts that
 * nothing else is ever passed beside the uuid.
 */

import { existsSync } from 'node:fs';
import type { SourceError } from '../../ipc/channels.js';
import { vamSessionName } from '../tmux/argv.js';
import { createVamSession, type TmuxRun } from '../tmux/spawn.js';
import type { Liveness } from './liveness.js';
import { codexProjectId } from './source.js';
import type { ThreadRow } from './store.js';

/**
 * THE THIRD WORD IS THE ONE NOBODY ELSE CHECKS.
 *
 * `newSessionArgv` refuses a command whose FIRST word looks like an option,
 * and the first word here is always `codex`. The thread id is not: it comes
 * out of a database vam does not own and never validates on write, and it is
 * about to be handed to a CLI as an argument. A bare uuid is the only shape
 * this will build a command out of -- the same gate `liveness.ts` puts in
 * front of a path join, for the same reason.
 */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function codexResumeCommand(threadId: string): readonly string[] | null {
  if (!UUID.test(threadId)) return null;
  return ['codex', 'resume', threadId];
}

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

/**
 * Reopen one thread, or say why not.
 *
 * `threads`, `liveness` and `exists` are injected for the reason everything in
 * this directory is: a test must never be pointed at the operator's own
 * `~/.codex`, and no test may spawn tmux.
 */
export async function resumeThread(input: {
  readonly threadId: string;
  readonly threads: () => Promise<readonly ThreadRow[]>;
  readonly liveness: (threadId: string) => Liveness;
  readonly exists?: (path: string) => boolean;
  readonly run: TmuxRun;
  /** Fixed by a test; a real call takes the random tail `vamSessionName` adds. */
  readonly name?: string;
}): Promise<SourceError | null> {
  const command = codexResumeCommand(input.threadId);
  if (command === null) {
    return refused(
      'unknown-thread',
      `vam has no Codex thread called ${input.threadId}, and will not ask Codex to resume it`,
    );
  }

  const row = (await input.threads()).find((candidate) => candidate.id === input.threadId);
  if (row === undefined) {
    return refused(
      'unknown-thread',
      `Codex’s store has no thread ${input.threadId}; it may have been deleted or archived since this list was drawn`,
    );
  }

  // LIVENESS IS ASKED AGAIN, HERE, however recently the canvas asked. See the
  // header: a drawn control is a fact about the last poll.
  const alive = input.liveness(row.id);
  if (alive === 'live') {
    return refused(
      'already-running',
      'a Codex is already writing this thread, and resuming it would start a second one on the same conversation; vam will not do that',
    );
  }
  if (alive === 'unknown') {
    return refused(
      'liveness-unknown',
      'vam could not check whether a Codex is still writing this thread, and it will not start a second one on a guess',
    );
  }

  const exists = input.exists ?? existsSync;
  if (!exists(row.cwd)) {
    return refused(
      'directory-missing',
      `this thread ran in ${row.cwd}, and that directory is no longer there; Codex has to be resumed somewhere`,
    );
  }

  return await createVamSession(input.run, {
    name: input.name ?? vamSessionName(row.name ?? row.id.slice(0, 8)),
    cwd: row.cwd,
    command,
    projectId: codexProjectId(row.cwd),
  });
}
