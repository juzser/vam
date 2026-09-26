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

import { PROVIDERS } from '../../../shared/providers.js';
import type { SourceError } from '../../ipc/channels.js';
import { withConciseLead } from '../../terminal/concise.js';
import { plain } from '../../terminal/plain.js';
import { promptKeystrokes, sendEnterArgv } from '../tmux/argv.js';
import { isShellCommand } from '../tmux/shell.js';
import {
  classifyTmuxFailure,
  listVamSessions,
  readPane,
  type TmuxRun,
  type TmuxSession,
} from '../tmux/spawn.js';
import { sessionIdOf } from './deliver.js';
import { projectIdOf } from './project-id.js';
import { claimedPanes } from './session-pane.js';

/**
 * Every command a DIFFERENT configured provider runs, read off
 * `shared/providers.ts` -- the one table of runnable commands vam has, so a
 * pane found running one of them is PROVEN to be running a foreign provider.
 *
 * A BLOCKLIST, NOT AN ALLOWLIST OF CLAUDE CODE'S OWN COMMAND -- and that was
 * this veto's first shape, and it was wrong. MEASURED against a real native
 * install, private `-L` socket, tmux 3.7b: `~/.local/bin/claude` symlinks to
 * `~/.local/share/claude/versions/2.1.282`, and tmux's OWN
 * `#{pane_current_command}` resolves the symlink and reports the TARGET's
 * name -- `2.1.282`, never `claude` (`ps -o comm`, which reads argv[0] rather
 * than the resolved path, still answers `claude`; the two disagree). An
 * allowlist checked against `'claude'` refused every legitimate native-install
 * pane on this exact tier -- the common case on a machine using the official
 * installer -- a regression worse than the mispairing it fixed. There is no
 * vocabulary of "what Claude Code's own command can look like" this file can
 * enumerate and stay correct across install methods and versions, so it does
 * not try to: it only vetoes a command PROVEN to be someone else's. Codex's
 * own install keeps `codex` as its resolved binary's name at every hop of its
 * own symlink chain, measured the same way, so the one other provider vam
 * currently ships is reliably named. Should a third provider ever join
 * `shared/providers.ts`, its command joins this list with no edit here.
 */
const OTHER_PROVIDER_COMMANDS: ReadonlySet<string> = new Set(
  PROVIDERS.filter((provider) => provider.id !== 'claude-code')
    .map((provider) => provider.command[0])
    .filter((command): command is string => command !== undefined),
);

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
  //
  // AND A SECOND VETO OF THE SAME SHAPE: a pane whose foreground is a SHELL
  // has nothing running in it, so it cannot be the pane this row is in --
  // whatever the count said. This tier was written when a vam pane always
  // held an agent from its first frame; since a new session is a shell
  // (`tmux/shell.ts`), the one live row in a project may be an agent in the
  // operator's own terminal and the one tagged pane an empty shell vam just
  // opened beside it, and the old inference would have typed the next reply
  // into a shell prompt. Applied LAST and only ever to `null`, like the claim
  // above; silence (no `command` in the listing) vetoes nothing.
  if (claimedPanes(panes).has(only.name)) return null;
  if (isShellCommand(only.command)) return null;
  // A THIRD VETO, OF THE SAME SHAPE: a pane already carrying vam's OWN bonus
  // proof of who is in it -- `@vam-session`, `VAM_SESSION_OPTION` -- for a
  // DIFFERENT session is not silence, it is a pane already spoken for. The
  // project tag is stamped once, at creation, and never re-derived from
  // whatever later runs in the pane (`create-session.ts`), so a project's one
  // tagged pane can go on to host any session or any provider at all; this is
  // the one place left that still knows, once vam has written it once
  // (`source.ts`'s own write-back, right after this proof is first made).
  // Absent, or agreeing with this row, vetoes nothing -- the ordinary case for
  // a pane no id has been written onto yet.
  if (
    only.vamSessionId !== undefined &&
    only.vamSessionId !== '' &&
    only.vamSessionId !== row.sessionId
  ) {
    return null;
  }
  // A FOURTH VETO: a pane whose foreground is PROVABLY a different,
  // configured provider is proven to be running something else, and the two
  // counts above say nothing about WHAT is in the pane, only how many
  // candidates there are. See `OTHER_PROVIDER_COMMANDS`'s own doc for why
  // this is a blocklist of what is provably someone else's rather than an
  // allowlist of Claude Code's own command -- the shape that once refused a
  // real native-install pane. A command absent from that list -- including
  // Claude Code's own, whatever shape it takes, and a program vam simply does
  // not recognise -- vetoes nothing here; the `vamSessionId` veto above is
  // what actually closes the reported scenario once a pairing has ever been
  // proven for this pane.
  if (only.command !== undefined && OTHER_PROVIDER_COMMANDS.has(only.command)) return null;
  return only.name;
}

/**
 * THE HINT CLAUDE CODE 2.1.277+ PRINTS INSTEAD OF SUBMITTING, when the prompt
 * carried invisible Unicode formatting or a tag character.
 *
 * MEASURED on a real `claude` 2.1.280, private tmux socket: pasting a prompt
 * with a zero-width space and pressing Enter once did not send it. The pane
 * repainted with the CLEANED text still sitting in the input box and this
 * line in its footer -- a second Enter is what actually submits. Before this,
 * one Enter always submitted; now some prompts silently need two, and a reply
 * built for the old rule would leave the words sitting there while vam
 * reported a delivery.
 *
 * NO CHARACTER CLASS IS GUESSED HERE, deliberately -- the same argument
 * `model.ts` and `transcript-model.ts` make about vocabularies going stale.
 * vam does not enumerate which characters the CLI now calls "invisible" or a
 * "tag character"; it reads the CLI's OWN screen for the sentence that says a
 * second Enter is still owed. A future CLI that cleans a wider set costs
 * nothing here.
 */
const REVIEW_GATE_HINT = /review and press enter to send/i;

/**
 * Press Enter a second time when the screen says the first one only opened a
 * review, never a guess from the prompt's own text.
 *
 * READ-THEN-ACT, the same rule `answer.ts` states for a picker: the pane is
 * asked what is actually on it rather than trusted to have taken the
 * keystroke that was meant for it. A read that fails is not a second
 * question -- `pane.kind !== 'ok'` answers `false`, which leaves the reply
 * exactly as honest as it was before this gate existed: vam already could not
 * confirm a submit from an echo, and refusing to guess here does not make
 * that any less true.
 */
async function reviewGateOpen(run: TmuxRun, name: string): Promise<boolean> {
  const pane = await readPane(run, name);
  return pane.kind === 'ok' && REVIEW_GATE_HINT.test(plain(pane.text));
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
 *
 * EXPORTED for `start-in-pane.ts`'s `typeIntoOwnPane`, the ONE other caller
 * that ever addresses a pane by NAME rather than through `paneForRow`'s proof
 * (see that module's own header). Once its pane is confirmed to be running a
 * KNOWN provider (`identifyRunningProvider`, `tmux/shell.ts`), the text
 * reaching it is an operator's PROMPT, not a shell command, and it must land
 * through the identical multi-line-safe, review-gate-aware channel a reply
 * to a live agent already uses -- never the raw, single-line `typeThenEnter`
 * that command started as a shell.
 */
export async function typeIntoPane(
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
  // THE REVIEW GATE. One Enter used to always submit; Claude Code 2.1.277+
  // spends it on cleaning invisible characters instead when the prompt
  // carried one, and leaves the cleaned text sitting unsent until a second
  // Enter -- see `REVIEW_GATE_HINT`. Checked after every reply rather than
  // only ones vam suspects, because the check is a read of the CLI's own
  // screen and not a guess from the prompt's bytes.
  if (await reviewGateOpen(run, name)) {
    const resubmit = await run(sendEnterArgv(name));
    if (resubmit.failure !== null) {
      const error = classifyTmuxFailure({
        failure: resubmit.failure,
        stderr: resubmit.stderr,
        action: `submitting a reply in session ${name}`,
      });
      return {
        ...error,
        message: `the reply was typed into ${name} but Claude Code opened its invisible-character review and vam could not press the second Return, so it is sitting there unsent: ${error.message}`,
      };
    }
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
    /**
     * THE CONCISE-OUTPUT RULES, IF THE OPERATOR HAS THEM ON AND THIS SESSION
     * HAS NOT BEEN TOLD YET.
     *
     * HERE, AND NOT IN THE CALLER. This is the last point at which the prompt
     * is still a string and the first at which vam knows there IS a pane to
     * type into: `recordPrompt` above could not tell a delivery from a refusal
     * without re-deriving the pairing, and the composer in the renderer
     * could not tell either. It is `main/terminal/concise.ts`'s decision --
     * what the rules say, who has had them, what the switch does -- and this
     * line is only the seam it is applied at.
     *
     * KEYED BY THE SESSION ID rather than by `rowId`: the row carries the pid
     * of the process serving it (`<sessionId>#<pid>`) and a session resumed by
     * a second process is the same conversation with the same context. Priming
     * per row would type the rules into a context that already has them.
     *
     * `delivered()` IS CALLED ONLY ON A CLEAN SEND. `typeIntoPane` answers
     * non-null when a keystroke failed -- including the case where the text
     * landed but Return did not -- and in every one of those the session has
     * not read anything, so the rules must still be waiting for the prompt
     * that does arrive.
     */
    const lead = withConciseLead(sessionId, prompt);
    const error = await typeIntoPane(run, pane, lead.prompt);
    if (error === null) lead.delivered();
    return error;
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
