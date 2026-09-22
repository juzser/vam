/**
 * REOPENING A CLAUDE CODE SESSION: `claude --resume <sessionId>`, started in
 * the session's own directory and tagged exactly as `createSessionInProject`
 * tags one, so the ordinary discovery path picks it up on the next poll.
 *
 * `docs/design/reopening-a-session.md` §3, built. Its rules, in its words:
 * never offered for a session that is live; the cwd is the session's own and a
 * missing directory is refused BY NAME; reuse the existing spawn; and no
 * `--fork-session`, because reopening means continuing the same conversation
 * and a fork would silently mint a second id for one history.
 *
 * ── THE COLLISION RULE, SHARPER THAN THE SPEC STATED IT ───────────────────
 *
 * The spec says "never offered for a session that is LIVE" and explains why:
 * `--resume` on a running session starts a copy, and two processes on one
 * session id is a hazard this tree has been bitten by -- `agents.ts` warns
 * that keying a row by session id alone collapses one, which once made Close
 * kill the wrong tmux session.
 *
 * But a row is not a session id. `agents.ts` documents the measured state
 * where ONE session id is listed twice, with two pids: two rows, one
 * transcript. So "this row has finished" is not enough. What has to be true is
 * that NOTHING is live on that session id -- the finished row beside a running
 * one is exactly the case where resuming would put a second process onto a
 * conversation another process is holding, and it is the case a per-row check
 * would wave through.
 *
 * ── WHY THE REFUSALS LIVE HERE AND NOT ONLY IN THE UI ─────────────────────
 *
 * A control that is not drawn is not a refusal. The renderer's idea of what is
 * running is one poll old, and `Canvas.tsx` is not the only caller of a
 * source's write surface -- the phone's HTTP routes are another. So the rules
 * are enforced at the spawn, and the UI's job is only to avoid offering what
 * this would refuse.
 *
 * An agent list vam could NOT read is refused rather than treated as empty.
 * Falling through to "nothing is running" would start a second process at
 * precisely the moment vam has lost sight of the first.
 */

import { existsSync } from 'node:fs';
import { resolveProvider } from '../../../shared/providers.js';
import type { SourceError } from '../../ipc/channels.js';
import { vamSessionName } from '../tmux/argv.js';
import { createVamSession, type TmuxRun } from '../tmux/spawn.js';
import type { AgentsResult, LiveAgent } from './agents.js';
import { projectIdOf } from './project-id.js';

/**
 * THE SESSION ID IS ABOUT TO BECOME AN ARGUMENT, so it is checked first.
 *
 * `newSessionArgv` refuses a command whose FIRST word looks like an option,
 * and the first word here is always the provider's own. The id is not: a value
 * such as `--dangerously-skip-permissions` sitting where the session id goes
 * would reach `claude` as a flag. Every session id measured is a uuid, and a
 * uuid is the only shape this will build a command out of -- the same gate
 * `codex/liveness.ts` puts in front of a path join.
 */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function claudeResumeCommand(sessionId: string): readonly string[] | null {
  if (!UUID.test(sessionId)) return null;
  // The provider's own command, so a `claude` that is invoked differently on
  // this machine stays invoked that way -- `providers.ts` is the one table.
  return [...resolveProvider('claude-code').command, '--resume', sessionId];
}

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

/** Is this agent one that could still be writing its transcript? */
const isLive = (candidate: LiveAgent): boolean =>
  candidate.status !== 'done' && candidate.status !== 'failed';

export async function resumeClaudeSession(input: {
  /** The ROW id, `<sessionId>#<pid>` -- what the canvas holds. */
  readonly rowId: string;
  readonly agents: () => Promise<AgentsResult>;
  readonly exists?: (path: string) => boolean;
  readonly run: TmuxRun;
  /** Fixed by a test; a real call takes the random tail `vamSessionName` adds. */
  readonly name?: string;
}): Promise<SourceError | null> {
  const listed = await input.agents();
  if (listed.kind === 'unavailable') {
    return refused(
      listed.code,
      `vam could not check what is running before reopening this session, and will not start a second one blind: ${listed.message}`,
    );
  }

  const row = listed.agents.find((candidate) => candidate.key === input.rowId);
  if (row === undefined) {
    return refused(
      'unknown-session',
      `vam has no session ${input.rowId} to reopen; it may have been closed since this list was drawn`,
    );
  }

  const command = claudeResumeCommand(row.sessionId);
  if (command === null) {
    return refused(
      'unknown-session',
      `vam will not ask Claude Code to resume ${row.sessionId}: that is not a session id`,
    );
  }

  // SESSION ID, NOT ROW. See the header: a finished row can sit beside a live
  // one on the same conversation.
  const stillLive = listed.agents.filter(
    (candidate) => candidate.sessionId === row.sessionId && isLive(candidate),
  );
  if (stillLive.length > 0) {
    const another = stillLive.some((candidate) => candidate.key !== row.key);
    return refused(
      'already-running',
      another
        ? 'another process is already running this conversation, and `--resume` would start a copy of it; vam will not do that'
        : 'this session is still running, and `--resume` would start a copy of it rather than returning to it',
    );
  }

  const exists = input.exists ?? existsSync;
  if (!exists(row.cwd)) {
    return refused(
      'directory-missing',
      `this session ran in ${row.cwd}, and that directory is no longer there; Claude Code has to be resumed somewhere`,
    );
  }

  return await createVamSession(input.run, {
    name: input.name ?? vamSessionName(row.name ?? row.sessionId.slice(0, 8)),
    cwd: row.cwd,
    command,
    projectId: projectIdOf(row.cwd),
    // `docs/design/vam-owns-the-session.md` §2, step 1: the id is already in
    // hand -- it is what `command` was just built from -- so it is written
    // now, for free, rather than guessed later.
    sessionId: row.sessionId,
  });
}
