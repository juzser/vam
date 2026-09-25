/**
 * REOPENING A CLAUDE CODE SESSION: a shell started in the session's own
 * directory, tagged exactly as `createSessionInProject` tags one, with
 * `claude --resume <sessionId>` typed into it the instant the shell exists --
 * so the ordinary discovery path picks it up on the next poll.
 *
 * `docs/design/reopening-a-session.md` §3, built. Its rules, in its words:
 * never offered for a session that is live; the cwd is the session's own and a
 * missing directory is refused BY NAME; reuse the existing spawn; and no
 * `--fork-session`, because reopening means continuing the same conversation
 * and a fork would silently mint a second id for one history.
 *
 * ── SHELL, THEN TYPED -- NOT SPAWNED DIRECTLY, AND THIS WAS A REAL BUG ─────
 *
 * This used to hand `claudeResumeCommand(row.sessionId)` straight to
 * `new-session`, exactly as `createSessionInDirectory` once did, and for the
 * same reason it was wrong: `newSessionArgv` spreads the command across
 * tmux's own argv so tmux execs it directly with nothing in front, and with
 * `remain-on-exit` off (tmux's default) the pane -- and, being the session's
 * only pane, the session -- dies the instant that one process does. The
 * operator's report was exactly this: pressing Ctrl+C in the terminal shut
 * the whole session down. MEASURED, on a private `-L` socket, real
 * `claude` 2.1.280: spawned straight into the pane, two Ctrl-C ended it and
 * `list-sessions` answered "no server running" a moment later. Spawned into a
 * shell instead (`loginShellCommand`), with `claude` typed in after
 * (`typeThenEnter`), the identical two Ctrl-C left the pane alive with the
 * shell in its foreground. `--resume` does not change which binary is
 * running or how it reads Ctrl-C, so that measurement is what this function
 * now relies on rather than re-measures with a real resumed session, which
 * would need a real conversation already on disk -- see `create-session.ts`'s
 * header for the fuller measurement this shares.
 *
 * WHAT THIS COSTS THE PID PAIRING, AND WHY IT IS NOT A LOSS. `@vam-pid`, set
 * at `createVamSession`'s own `new-session` call, now names the SHELL, not
 * `claude` -- `pane-row.ts`'s own note on the project path applies here
 * verbatim. `paneForRow`'s pid tier (`reply.ts`) therefore never fires for a
 * resumed row either: `row.pid`, the pid `claude agents --json` reports for
 * the process the resume actually started, is a CHILD of the shell `@vam-pid`
 * now names, and a pid tier that compares them finds no match, exactly as it
 * already does not for the (already shell-first) project path. That tier was
 * always a bonus proof, not the primary one (`VAM_PID_OPTION`'s own header):
 * the published pane (`session-pane.ts`) is what actually pairs, and it comes
 * from Claude Code's OWN read of what pane it is in -- via the `TMUX`
 * environment variable a shell inherits and passes to its own children
 * exactly as tmux set it for the shell itself -- which does not care whether
 * its immediate parent is tmux or a shell tmux started. That is the same fact
 * the shipped project path already relies on for the identical shape; this
 * resume path now has the identical shape.
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
import { loginShellCommand } from '../tmux/shell.js';
import { createVamSession, type TmuxRun } from '../tmux/spawn.js';
import type { AgentsResult, LiveAgent } from './agents.js';
import { projectIdOf } from './project-id.js';
import { typeThenEnter } from './start-in-pane.js';

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

  const name = input.name ?? vamSessionName(row.name ?? row.sessionId.slice(0, 8));
  const spawned = await createVamSession(input.run, {
    name,
    cwd: row.cwd,
    // THE SHELL, NOT `command` -- see the header on why a direct spawn shut
    // the whole session down on Ctrl+C. What still runs `command` is the type
    // below, the instant the shell exists.
    command: loginShellCommand(),
    projectId: projectIdOf(row.cwd),
    // `docs/design/vam-owns-the-session.md` §2, step 1: the id is already in
    // hand -- it is what `command` was just built from -- so it is written
    // now, for free, rather than guessed later. Unaffected by the shell: this
    // tags the SESSION, not the pane's foreground process.
    sessionId: row.sessionId,
  });
  if (spawned !== null) return spawned;
  return typeThenEnter(input.run, name, command.join(' '));
}
