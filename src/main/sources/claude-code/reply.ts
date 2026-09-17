/**
 * Where Enter goes -- and it goes to exactly one place.
 *
 * THE RULE. vam is a projection of the terminal (the operator's own design
 * call): the pane a session vam started is the base, and the Response view is
 * a chat UI over the data that pane produces. So a reply is TYPED into that
 * pane, and the turn appears in the view when the session's own transcript
 * records it. There is one channel, and this module is it.
 *
 * WHY THERE IS NO SECOND CHANNEL, recorded so nobody restores it as an
 * improvement. `recordPrompt` once ran `claude --resume <id> -p` when no pane
 * could be proven. That path is retired (`deliver.ts` carries the full
 * argument): it refused while the target session was running -- which is every
 * session the operator wants to reply to -- and it could not resume a session
 * that had never taken a turn at all, answering a fresh session's reply with
 * the CLI's "No conversation found" rather than anything the operator could
 * act on. A channel that fails precisely when it is wanted is not a fallback
 * worth keeping alongside one that works.
 *
 * SO A ROW WITH NO PANE IS REFUSED, NOT REROUTED. The refusal says what is true
 * -- vam has no terminal it owns for this session -- and points at the remedy,
 * opening it in a vam terminal. It never claims a delivery. This is the same
 * answer for a session vam did not start (the operator's own `claude`, a child
 * of their login shell, whose TTY no process may take over) as for one vam
 * started but cannot yet pair to a pane.
 *
 * THE PANE MUST BE PROVEN, and `paneForRow` below is the whole of that proof:
 * the pane the session published about itself, else the pid vam recorded at
 * creation, else -- only when a project holds exactly one live row and one
 * tagged session -- the project tag. When none of those answers, there is no
 * pane this row can be PROVEN to own, and typing into a guessed one would land
 * the operator's words in another agent. That is the worst outcome available,
 * so the answer is `null` and the refusal above.
 */

import type { SourceError } from '../../ipc/channels.js';
import { promptKeystrokes, sendEnterArgv } from '../tmux/argv.js';
import {
  classifyTmuxFailure,
  listVamSessions,
  type TmuxRun,
  type TmuxSession,
} from '../tmux/spawn.js';
import { sessionIdOf } from './deliver.js';
import { projectIdOf } from './project-id.js';
import { claimedPanes } from './session-pane.js';

/** The part of a live row this module needs. `LiveAgent` satisfies it. */
export type ReplyRow = {
  readonly key: string;
  readonly sessionId: string;
  readonly cwd: string;
  /**
   * The OS pid `claude agents --json` reported for this row -- `LiveAgent`'s
   * own field, satisfied structurally by every production caller. OPTIONAL,
   * for the same reason `StoppableAgent.pid` is: a caller with nothing to
   * give (most existing tests, and a row the CLI itself reported with no
   * pid) keeps the pre-existing behaviour rather than being forced to
   * fabricate a value -- `paneForRow` treats an absent pid exactly like a
   * `null` one, and either just skips the pid tier below.
   */
  readonly pid?: number | null;
};

/**
 * The pane this row can be PROVEN to be running in, or `null`.
 *
 * THREE PROOFS, TRIED IN ORDER, AND EACH BYPASSES THE COUNTS BELOW IT RATHER
 * THAN MERELY OUTRANKING THEM. `panes` is what the sessions themselves report
 * -- Claude Code writes its own tmux pane into `~/.claude/sessions/<pid>.json`
 * beside its session id, so the pairing is per SESSION and comes from the
 * process that is in the pane (`session-pane.ts`). It is tried first because
 * neither of the other two can answer the case the operator actually hits:
 * two sessions vam started in one project fail both of the project tag's
 * conditions below, so neither row could be replied to, closed, or drawn.
 *
 * THE SECOND PROOF IS VAM'S OWN, sourced independently of anything Claude
 * Code publishes: `createVamSession` (`tmux/spawn.ts`) records the pid of
 * each pane's process on its tmux session AT CREATION, as `VAM_PID_OPTION`.
 * `row.pid` is the same OS pid `claude agents --json` reports for this exact
 * row (`agents.ts`), and a pid names at most one LIVE process at any moment,
 * so a tagged session recorded with THIS row's pid is this row's pane
 * regardless of how many other rows or tagged sessions share the project --
 * see `VAM_PID_OPTION`'s own doc for why that holds for the tmux session's
 * whole life, not merely at the instant it is written. It is tried second,
 * after the published pane and before the project-tag count, because a row
 * that published something said so ITSELF and a disagreement there is
 * evidence of a corrupt pairing (see below) -- vam's own creation-time record
 * must not override what the row says about itself, only stand in when the
 * row said nothing.
 *
 * The published name is still checked against `sessions`, which is vam's own
 * prefix filtered (`listVamSessions`). So a session the operator started in
 * their own tmux publishes a pane here and is still never acted on, and a pane
 * that has ended since falls through to the tag rather than being typed into.
 *
 * THE PUBLISHED PANE AND THE PID TAG BOTH BYPASS THE COUNTS, neither merely
 * outranks them. The fallback demands exactly one live row in the project,
 * and measured on a real machine that is UNSATISFIABLE for an operator who
 * runs several sessions per project: three live sessions share one cwd
 * against one vam pane, so the count vetoes every row and close refuses all
 * three. Consulting it after a pairing has been proven would keep that veto.
 *
 * THE PROJECT TAG REMAINS -- vetoed by one rule -- for a session that neither
 * of the two proofs above could place: one not under tmux, an older Claude
 * Code that never publishes a `tmux` field, or a pid tag that was never
 * recorded (`VAM_PID_OPTION` degrades silently rather than refusing when
 * that happens). Its two conditions are the whole of the safety argument in
 * that case: exactly one tagged tmux session for this project, and exactly
 * one live row in it -- and it answers `null` for every row in a cwd that
 * holds more than one live session and no other proof. That is correct
 * (nothing in the project scheme alone says which row is in the pane) and it
 * is why this defect stayed invisible for as long as it did: the pairing was
 * not wrong, it was unanswerable without a proof one of the two tiers above
 * now supplies for the common case.
 *
 * THE VETO: a tagged session that some row has PUBLISHED itself into belongs
 * to that row, and handing it to a silent neighbour -- which is what happened,
 * since most sessions publish nothing -- types into another agent. It is a
 * veto and not a narrowing, and the distinction is load-bearing: the claim is
 * applied AFTER the single-candidate count, so it can only ever turn an answer
 * into `null`. Subtracting claimed sessions first and counting the remainder
 * would answer confidently for a project holding two tagged sessions of which
 * one is claimed -- inventing certainty out of the exact ambiguity the
 * published field exists to resolve.
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
  const projectId = projectIdOf(row.cwd);
  // An unset option reads back as the empty string, so an empty id would
  // sweep up every session vam did NOT start. Checked before the published
  // path as well as the tag one: it disqualifies both.
  if (projectId === '') return null;
  // Keyed by `row.key` (`<sessionId>#<pid>`), not `row.sessionId`: two
  // processes can resume the same session (`agents.ts`), each with its own
  // pid and its own published pane, and looking this up by session id alone
  // would let one row's claim answer for the other's.
  const published = panes?.get(row.key);
  if (published !== undefined) {
    // A PUBLISHED VALUE THAT DISAGREES IS EVIDENCE OF A CORRUPT PAIRING, NOT
    // THE ABSENCE OF EVIDENCE -- and that distinction is the whole of this
    // branch. No published value means "nobody said", so the tag path below
    // gets its chance. A published value naming a session that is not tagged
    // for THIS row's project means something about this row is wrong: stale,
    // crossed, or a session that has moved. The only safe answer is to stop.
    //
    // Falling through instead was a defect with a bigger blast radius than
    // the one it replaced. The tag path asks a different question -- one
    // agent in this project, one session tagged for it -- and in the fixture
    // that found this, it answers with a DIFFERENT, healthy session: so a row
    // whose published pairing was wrong got another project's session typed
    // into before, and its own project's other session KILLED after. Both are
    // the ambiguity the published field was added to resolve.
    return sessions.some((session) => session.name === published && session.project === projectId)
      ? published
      : null;
  }
  // VAM'S OWN CREATION-TIME PROOF -- see the header for why it is tried here,
  // between the published pane and the project-tag count. `row.pid` skipped
  // entirely (falls through to the count below) when it is `null` or absent:
  // a row vam did not spawn, or one the CLI reported with no pid, has nothing
  // for this tier to match against, which is the honest answer for it.
  if (row.pid !== null && row.pid !== undefined) {
    const pid = String(row.pid);
    const own = sessions.find((session) => session.project === projectId && session.pid === pid);
    if (own !== undefined) {
      // Same claim veto as the tag path below, applied LAST so it can only
      // veto -- see the header on `claimedPanes` there. Not reachable under
      // normal operation (the session this pid names can only be the one
      // process this row IS), kept for the same defence-in-depth reason the
      // rest of this function never trusts a single proof unchecked.
      return claimedPanes(panes).has(own.name) ? null : own.name;
    }
  }
  const here = agents.filter((agent) => projectIdOf(agent.cwd) === projectId);
  if (here.length !== 1) return null;
  // A PANE ANOTHER ROW PUBLISHED IS SPOKEN FOR, and withholding it here is the
  // same rule `targetSession` applies to the read and the resize -- shared as
  // `claimedPanes` rather than written twice, because two copies of a pairing
  // rule are two answers to "whose terminal is this". This row published
  // nothing, so every claim in the set is somebody else's, and the tag may not
  // hand it their session. An unclaimed one still answers, which is the whole
  // point of keeping the fallback.
  const tagged = sessions.filter((session) => session.project === projectId);
  const [only] = tagged;
  if (tagged.length !== 1 || only === undefined) return null;
  // LAST, SO IT CAN ONLY VETO. Filtering the claims out before the count would
  // let two tagged sessions minus one claim look like a single confident
  // candidate; see the header, and `matchVamSession`, which orders it the same
  // way for the same reason.
  return claimedPanes(panes).has(only.name) ? null : only.name;
}

/**
 * Type the whole prompt into a pane, then press Return once to submit.
 *
 * TYPE, THEN SUBMIT, AND THE ORDER IS THE POINT. The prompt goes through
 * `promptKeystrokes`, which types each line literally (`-l`, so tmux cannot
 * read `Escape` or a leading `-` as anything but characters) and breaks every
 * INTERNAL newline with the REPL's own `\`+Enter escape rather than a bare
 * submit. The FINAL submit is a single interpreted Enter here, after the whole
 * prompt has landed. When any keystroke fails, that final Return is NOT sent --
 * pressing Return into a pane that only got half the prompt would submit half a
 * message, and the operator would not know which half.
 *
 * WHAT VAM CAN HONESTLY CLAIM WHEN THIS RETURNS `null`: the text was typed into
 * the pane vam owns and Return was pressed. Nothing more. There is no echo the
 * old `--output-format json` gave (`deliver.ts`), so vam does not know the REPL
 * accepted the submit or that an answer is coming -- that shows up when the
 * transcript does, which is the projection the whole design rests on.
 */
async function typeIntoPane(
  run: TmuxRun,
  name: string,
  prompt: string,
): Promise<SourceError | null> {
  for (const keystroke of promptKeystrokes(name, prompt)) {
    const typed = await run(keystroke);
    if (typed.failure !== null) {
      return classifyTmuxFailure({
        failure: typed.failure,
        stderr: typed.stderr,
        action: `typing a reply into session ${name}`,
      });
    }
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
 * Type `prompt` into the pane the session `rowId` names, or refuse. `null`
 * means it landed in the pane; anything else is a `SourceError` that says why
 * and never claims a delivery.
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
  /** What the sessions published about themselves; see `paneForRow`. */
  panes?: ReadonlyMap<string, string>;
}): Promise<SourceError | null> {
  const { agents, rowId, prompt, run } = input;
  const sessionId = sessionIdOf(rowId);
  const row =
    agents.find((agent) => agent.key === rowId) ??
    agents.find((agent) => agent.sessionId === sessionId);
  if (row === undefined) {
    return {
      kind: 'refused',
      code: 'unknown-session',
      message: `vam has no live session ${rowId}; it may have exited since the session list was drawn`,
    };
  }

  const listed = await listVamSessions(run);
  const pane = listed.kind === 'ok' ? paneForRow(listed.sessions, agents, row, input.panes) : null;
  if (pane !== null) {
    return typeIntoPane(run, pane, prompt);
  }
  // NO PANE, NO DELIVERY, AND THE REFUSAL SAYS SO. There is no second channel
  // to fall through to (see the header): a session vam did not start, or one it
  // cannot yet pair to a pane, has no terminal vam owns to type into. When
  // `listVamSessions` itself failed, that is why -- vam could not even ask
  // tmux -- and the message carries the tmux reason after vam's own so the
  // operator sees both. Either way, nothing was sent and nothing is claimed.
  const because =
    listed.kind === 'ok' ? '' : ` (vam could not reach tmux to check: ${listed.error.message})`;
  return {
    kind: 'refused',
    code: 'no-terminal',
    message: `vam has no terminal it owns for session ${sessionId}, so there is nothing to type into${because}. Open it in a vam terminal to reply here.`,
  };
}
