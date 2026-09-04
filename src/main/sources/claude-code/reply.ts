/**
 * Where Enter goes.
 *
 * THE BUG THIS MODULE EXISTS FOR. `recordPrompt` ran `claude --resume <id> -p`
 * and nothing else. That CLI declines while the target session is RUNNING --
 * `deliver.ts` says so in its own header and calls it the common case -- and a
 * session the operator wants to reply to is running by definition. So Enter
 * produced a refusal every time, which reads from the outside as Enter doing
 * nothing.
 *
 * WHAT CHANGED. vam now starts sessions itself, in tmux panes it owns
 * (`create-session.ts`), and typing into a pane vam owns is a real channel
 * into a running session. So the reply is routed: the pane when vam has one it
 * can prove belongs to this row, the CLI otherwise.
 *
 * THE PROOF IS TWO CONDITIONS AND BOTH ARE NECESSARY. tmux records a PROJECT
 * on the session it created (`VAM_PROJECT_OPTION`), never a Claude session id
 * -- the session inside the pane is started by the pane and its id is not
 * known here. So a project match alone does not say this row is that pane:
 * a second `claude` in the same directory would be typed into by mistake, and
 * a reply delivered to the wrong session is the worst outcome available. The
 * pane is used only when
 *
 *   1. exactly ONE tmux session vam started carries this project, and
 *   2. exactly ONE live session in the whole list sits in this project,
 *
 * which together leave no second candidate on either side. Anything else falls
 * back to the CLI, which addresses the session id exactly and refuses in
 * Claude Code's own words when it cannot.
 *
 * WHAT IS STILL NOT HERE, stated so nobody has to rediscover it: the
 * operator's own sessions cannot be typed into. They are children of their
 * login shell and no process may take over another's controlling TTY. There
 * IS a real channel for them -- each live session publishes a unix socket at
 * `messagingSocketPath` with a token beside it in `~/.claude/sessions` -- and
 * it is not spoken here; see the task report. Until it is, the CLI's refusal
 * is what the operator sees, and it says what happened rather than claiming a
 * delivery.
 */

import type { SourceError } from '../../ipc/channels.js';
import { sendEnterArgv, sendTextArgv } from '../tmux/argv.js';
import {
  classifyTmuxFailure,
  listVamSessions,
  type TmuxRun,
  type TmuxSession,
} from '../tmux/spawn.js';
import type { DeliverFn } from './deliver.js';
import { sessionIdOf } from './deliver.js';
import { projectIdOf } from './project-id.js';

/** The part of a live row this module needs. `LiveAgent` satisfies it. */
export type ReplyRow = {
  readonly key: string;
  readonly sessionId: string;
  readonly cwd: string;
};

/**
 * The pane this row can be PROVEN to be running in, or `null`.
 *
 * TWO PROOFS, AND THE PUBLISHED ONE WINS. `panes` is what the sessions
 * themselves report -- Claude Code writes its own tmux pane into
 * `~/.claude/sessions/<pid>.json` beside its session id, so the pairing is per
 * SESSION and comes from the process that is in the pane (`session-pane.ts`).
 * It is preferred because the project tag below cannot answer the case the
 * operator actually hits: two sessions vam started in one project fail both of
 * its conditions, so neither row can be replied to, closed, or drawn.
 *
 * The published name is still checked against `sessions`, which is vam's own
 * prefix filtered (`listVamSessions`). So a session the operator started in
 * their own tmux publishes a pane here and is still never acted on, and a pane
 * that has ended since falls through to the tag rather than being typed into.
 *
 * THE PUBLISHED PANE BYPASSES THE COUNTS, it does not merely outrank them.
 * The fallback demands exactly one live row in the project, and measured on a
 * real machine that is UNSATISFIABLE for an operator who runs several sessions
 * per project: three live sessions share one cwd against one vam pane, so the
 * count vetoes every row and close refuses all three. Consulting it after a
 * pairing has been proven would keep that veto.
 *
 * THE TAG REMAINS, unchanged, for a session whose file carries no `tmux` field
 * -- one not under tmux, or an older Claude Code that did not publish it. Its
 * two conditions are the whole of the safety argument in that case: exactly
 * one tagged tmux session for this project, and exactly one live row in it --
 * and, per the paragraph above, it answers `null` for every row in a cwd that
 * holds more than one live session. That is correct (nothing in the project
 * scheme says which row is in the pane) and it is why this defect stayed
 * invisible: the pairing was not wrong, it was unanswerable.
 *
 * Exported for the test that pins both: a routing rule that is only tested
 * through the spawn is a rule nobody can see.
 */
export function paneForRow(
  sessions: readonly TmuxSession[],
  agents: readonly ReplyRow[],
  row: ReplyRow,
  panes?: ReadonlyMap<string, string>,
): string | null {
  const published = panes?.get(row.sessionId);
  if (published !== undefined && sessions.some((session) => session.name === published)) {
    return published;
  }
  const projectId = projectIdOf(row.cwd);
  // An unset option reads back as the empty string, so an empty id would
  // sweep up every session vam did NOT start.
  if (projectId === '') return null;
  const here = agents.filter((agent) => projectIdOf(agent.cwd) === projectId);
  if (here.length !== 1) return null;
  const tagged = sessions.filter((session) => session.project === projectId);
  const [only] = tagged;
  return tagged.length === 1 && only !== undefined ? only.name : null;
}

/**
 * Type the prompt into a pane and press Return.
 *
 * TWO CALLS, AND THE ORDER IS THE POINT. The text goes literally (`-l`), so
 * tmux cannot read `Escape` or a leading `-` as anything but characters; the
 * Return has to be interpreted, which `-l` forbids, so it is sent on its own.
 * When the text fails, the Return is NOT sent -- pressing Return into a pane
 * that never received the prompt would submit whatever the operator had
 * already typed there.
 */
async function typeIntoPane(
  run: TmuxRun,
  name: string,
  prompt: string,
): Promise<SourceError | null> {
  const typed = await run(sendTextArgv(name, prompt));
  if (typed.failure !== null) {
    return classifyTmuxFailure({
      failure: typed.failure,
      stderr: typed.stderr,
      action: `typing a reply into session ${name}`,
    });
  }
  const entered = await run(sendEnterArgv(name));
  if (entered.failure !== null) {
    const error = classifyTmuxFailure({
      failure: entered.failure,
      stderr: entered.stderr,
      action: `submitting a reply in session ${name}`,
    });
    return {
      ...error,
      message: `the reply was typed into ${name} but vam could not press Return, so it is sitting there unsent: ${error.message}`,
    };
  }
  return null;
}

/**
 * Deliver `prompt` to the session `rowId` names. `null` means it landed.
 *
 * Never throws, for the reason every write path here does not: main's IPC
 * handler turns a thrown error into a generic `unreachable/source-failed` and
 * the refusal would lose both the code a consumer branches on and the message
 * it renders.
 */
export async function replyToSession(input: {
  agents: readonly ReplyRow[];
  rowId: string;
  prompt: string;
  run: TmuxRun;
  deliver: DeliverFn;
  /** What the sessions published about themselves; see `paneForRow`. */
  panes?: ReadonlyMap<string, string>;
}): Promise<SourceError | null> {
  const { agents, rowId, prompt, run, deliver } = input;
  const sessionId = sessionIdOf(rowId);
  const row =
    agents.find((agent) => agent.key === rowId) ??
    agents.find((agent) => agent.sessionId === sessionId);
  if (row === undefined) {
    return {
      kind: 'refused',
      code: 'unknown-session',
      message: `vam has no live session ${rowId}; it may have exited since the canvas was drawn`,
    };
  }

  const listed = await listVamSessions(run);
  // A tmux vam could not ask is not a reason to stop: the CLI path is still
  // there and is the only one that was ever available before.
  const pane = listed.kind === 'ok' ? paneForRow(listed.sessions, agents, row, input.panes) : null;
  if (pane !== null) {
    return typeIntoPane(run, pane, prompt);
  }
  return deliver({ sessionId: row.sessionId, prompt, cwd: row.cwd });
}
