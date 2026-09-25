/**
 * THE CODEX SOURCE: the operator's own Codex threads, read from
 * `~/.codex/state_5.sqlite` and their rollout files, with one write --
 * `codex queue`.
 *
 * Stage 1 of `docs/design/a-second-source.md`, and the first source vam has
 * that DELIVERS WITHOUT OWNING A PANE. Everything awkward about the Claude
 * Code integration -- the pairing rule, the keystroke strip, reading a model
 * off a status line the operator can redefine -- exists because Claude Code
 * offers no channel into a running session. Codex has one, so this source says
 * `deliverPrompt: true` and `terminal: false` in the same breath, which no
 * source has said before.
 *
 * ── WHAT IT DECLINES, AND WHY EACH DECLINE IS THE FEATURE ─────────────────
 *
 * The operator will meet a session that looks different from the ones they
 * know: no Terminal tab, no keystroke strip, no model picker, no live mark.
 * Each of those is a capability withdrawn with the source's own words
 * attached, and the words are the whole explanation an operator gets. They are
 * not polish here.
 *
 * ── STAGE 3: LIVENESS IS READ NOW, AND THE RECENCY WINDOW IS GONE ─────────
 *
 * This source used to say "liveness is the one vam refuses to guess", draw
 * every thread of the last seven days, and paint all of them neutral. The
 * experiment `a-second-source.md` §Experiments asked for has since run, and
 * `liveness.ts` carries what it measured: a live Codex holds an exclusive
 * `flock` on `~/.codex/thread-writer-locks/<uuid>.lock`, while the stale file
 * a killed one leaves behind probes free. So vam can see which threads are
 * running, and §Stage 3 is built rather than deferred.
 *
 * THE SEVEN-DAY WINDOW WAS NEVER A WINDOW. It was a stand-in for liveness,
 * chosen when liveness was believed unreadable, and a bad one: measured on the
 * operator's own machine it drew 12 rows of which ONE was live, minted 8
 * project rows to hold that one session, and sorted the live row THIRD because
 * `recency_at_ms DESC` is the only order the store offers. That is the
 * operator's complaint -- "it makes managing active sessions harder" -- and
 * the proxy is what caused it. A row is drawn now because it is live; the
 * ended ones are kept behind the sidebar's own filter toggle.
 *
 * ── WHAT A ROW'S STATUS CLAIMS, AND WHAT IT STILL DOES NOT ────────────────
 *
 * `idle` for a live thread is no longer PR 429's least-wrong neutral; it is
 * `SessionStatus`'s own definition -- "alive, ... simply between turns" -- and
 * vam has now measured the first half of it. `done` for a thread whose lock
 * nobody holds is that same union's "a job that ENDED", equally measured. The
 * one word of `idle`'s definition this source does not earn is "attached,
 * stoppable", and it does not pretend to: `terminal` and `closeSession` are
 * both withdrawn with this source's own sentence on them.
 *
 * What the lock does NOT say is whether a live thread is mid-turn or waiting
 * on the operator, so `running` and `waiting` remain guesses and remain
 * unmade. An amber row per thread is the false alarm `model.ts`'s own header
 * records `idle` being invented to stop.
 *
 * `unknown` STAYS A REAL ANSWER. Where the probe cannot run -- a platform
 * without the flag, a lock directory vam may not read -- every row is unknown,
 * and this source draws exactly the list it drew before Stage 3 rather than an
 * empty canvas, which would read as "you have no Codex sessions".
 *
 * ── NEVER AN EMPTY LIST FOR A STORE VAM COULD NOT READ ────────────────────
 *
 * `load()` RESOLVES to whatever it read and never rejects, and that is not the
 * same as swallowing a failure. A store vam cannot read becomes an
 * `unavailable` in `store.ts`'s own words, and this source turns that into a
 * DESCRIPTOR that withdraws everything with the reason attached -- computed
 * once, at startup, where the descriptor is read. What it must never become is
 * an empty project list on its own, which reads as "you have no Codex
 * sessions" and is the one lie this source must not tell. That rule is
 * `pull-requests.ts`'s first rule, verbatim.
 *
 * Not rejecting also matters to `combineSources`: a Codex store that is not
 * there must not take the operator's Claude Code rows off the canvas with it.
 */

import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Project, Session } from '../../../renderer/domain/model.js';
import type { SourceDescriptor } from '../../../shared/preload-api.js';
import type { SourceError } from '../../ipc/channels.js';
import { isAgentWorktreeCwd } from '../agent-worktree.js';
import { fileTranscriptSource } from '../claude-code/window.js';
import type { MainSource } from '../source.js';
import { createTmuxRunner, listVamSessions, type TmuxRun } from '../tmux/spawn.js';
import { type Liveness, livenessOf, type ProbeLock, probeLockViaOpen } from './liveness.js';
import { queueMessage, type RunCodex, runCodexViaCli } from './queue.js';
import { resumeThread } from './resume.js';
import { readRolloutTail, threadStartOf } from './rollout.js';
import {
  codexHome,
  type RunSqlite,
  readSidecars,
  readThreads,
  runSqliteViaCli,
  STORE_SCAN_LIMIT,
  type StoreRead,
  stateDbPath,
  type ThreadRow,
} from './store.js';

export const CODEX_SOURCE_ID = 'codex';

/**
 * HOW MANY ENDED THREADS THE SIDEBAR WILL HOLD once the operator asks to see
 * them, and the number the source's label discloses.
 *
 * It caps the ENDED rows only. A live thread is a Codex process on this
 * machine, there are never many, and there is no honest rule for which of the
 * sessions that may need you to drop -- so live rows are never capped.
 */
export const ENDED_ROW_LIMIT = 12;

/** One thread, with what vam measured about its writer. */
export type Selection = {
  /** The rows to draw, live ones first. */
  readonly drawn: readonly ThreadRow[];
  readonly live: number;
  readonly ended: number;
  readonly unknown: number;
};

/**
 * WHICH THREADS REACH THE SIDEBAR.
 *
 * Live first and all of them; then, up to `endedLimit`, the most recently
 * touched of the rest. The input arrives in `recency_at_ms DESC` order and
 * this is a stable partition of it, so recency still orders within each half
 * -- what it no longer does is decide which half a row is in.
 *
 * AN `unknown` ROW IS NOT SPENT AGAINST THE ENDED CAP. Where the probe cannot
 * answer, every row is unknown, and charging them to a cap meant for finished
 * conversations would silently shrink the list on exactly the platform where
 * vam knows least. Unknown rows are drawn after the live ones and before the
 * ended ones, which is also the order of how much vam can say about them.
 */
export function selectThreads(input: {
  readonly threads: readonly ThreadRow[];
  readonly liveness: (threadId: string) => Liveness;
  readonly endedLimit?: number;
}): Selection {
  const cap = Math.max(0, input.endedLimit ?? ENDED_ROW_LIMIT);
  const live: ThreadRow[] = [];
  const unknown: ThreadRow[] = [];
  const ended: ThreadRow[] = [];
  for (const row of input.threads) {
    const answer = input.liveness(row.id);
    if (answer === 'live') live.push(row);
    else if (answer === 'unknown') unknown.push(row);
    else ended.push(row);
  }
  return {
    drawn: [...live, ...unknown, ...ended.slice(0, cap)],
    live: live.length,
    ended: ended.length,
    unknown: unknown.length,
  };
}

/** `SessionStatus` for what the lock said. See the header for each word. */
export function statusFor(liveness: Liveness): Session['status'] {
  if (liveness === 'live') return 'idle';
  if (liveness === 'ended') return 'done';
  return 'idle';
}

/**
 * THE PROJECT ID IS SOURCE-NAMESPACED, exactly as `claude-code/project-id.ts`
 * mints `claude-code:<name>-<digest>`, and the namespace is what keeps two
 * sources reading the SAME directory from colliding into one project row with
 * two owners. A digest disambiguates two checkouts that share a basename
 * without rendering the operator's home directory into the DOM of a public
 * application.
 */
export function codexProjectId(cwd: string): string {
  return `codex:${basename(cwd)}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
}

const NO_PANE =
  'vam did not start this Codex session and has no pane into it: the prompt is queued for the thread with `codex queue`, not typed';
const NOT_OURS =
  'this is the operator’s own Codex thread, started outside vam; vam can queue a message for it and nothing else';
const NO_SURFACE = 'Codex keeps no such thing that vam has found a way to read';

/** At most this many characters of a preview become a row title. */
const MAX_TITLE = 72;

function titleOf(row: ThreadRow): string {
  if (row.name !== null) return row.name;
  // `threads.title` is the WHOLE first prompt -- measured, a 4 KB multi-line
  // brief on the most recent row here -- so it is never the title. `preview`
  // is Codex's own short form and the first line of it is what fits.
  const firstLine =
    row.preview
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? '';
  if (firstLine === '') return row.id.slice(0, 8);
  return firstLine.length <= MAX_TITLE ? firstLine : `${firstLine.slice(0, MAX_TITLE - 1)}…`;
}

/** `2m`, `3h`, `4d` -- the shape `claude-code/transcript.ts` already prints. */
export function compactAge(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const descriptorFor = (store: StoreRead | null, livenessReadable: boolean): SourceDescriptor => {
  const unavailable = store !== null && store.kind === 'unavailable' ? store : null;
  if (unavailable !== null) {
    // EVERYTHING WITHDRAWN, WITH THE READER'S OWN SENTENCE ON EVERY ONE. The
    // operator is told once, in the source cell, and again anywhere a control
    // would have been.
    const every = unavailable.message;
    return {
      id: CODEX_SOURCE_ID,
      label: `Codex — unavailable (${unavailable.code})`,
      capabilities: {
        liveUpdates: false,
        recordPrompt: false,
        deliverPrompt: false,
        promptAttachments: false,
        slashCommands: false,
        renameSession: false,
        closeSession: false,
        createSession: false,
        governance: false,
        pullRequests: false,
        terminal: false,
        agentRoster: false,
        resumeSession: false,
      },
      declines: {
        liveUpdates: every,
        recordPrompt: every,
        deliverPrompt: every,
        promptAttachments: every,
        slashCommands: every,
        renameSession: every,
        closeSession: every,
        createSession: every,
        governance: every,
        pullRequests: every,
        terminal: every,
        agentRoster: every,
        resumeSession: every,
      },
      viewerScope: {
        kind: 'connection',
        note: 'Codex keeps its threads in this operating-system account’s own home directory; the OS account is the identity',
      },
    };
  }
  return {
    id: CODEX_SOURCE_ID,
    // WHAT THE LABEL MUST NOT DO IS CLAIM THE OLD CAP. PR 429 put "the 12 most
    // recent threads" here because that was the whole list; the list is now
    // "every live thread", and the 12 binds only the ended rows the filter
    // toggle reveals. A label that still said 12 would be disclosing a limit
    // that no longer applies to the rows the operator is looking at -- the
    // same lie as not disclosing one, told backwards.
    //
    // The platform arm is not hedging: `liveness.ts` cannot probe off darwin,
    // and there the list really is the recent one, so it says so.
    label: livenessReadable
      ? `Codex — live threads, plus the ${ENDED_ROW_LIMIT} most recent ended ones when asked`
      : `Codex — the ${ENDED_ROW_LIMIT} most recent threads; vam cannot tell which are running on this platform`,
    capabilities: {
      // Nothing watches the store or the rollouts; this source re-reads on the
      // canvas's poll. A live badge with no event behind it is a promise
      // nothing keeps.
      liveUpdates: false,
      // `codex queue --thread <uuid> --message <text>`, measured against a
      // live TUI on a private socket with no daemon running. See `queue.ts`.
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      // `codex archive` and `codex delete` exist and NEITHER is what closing
      // means here: vam did not start the process, so there is nothing of
      // vam's to stop, and deleting the operator's thread is not the same act
      // wearing a different name.
      closeSession: false,
      // Stage 2 of the design, not this one: a `'codex'` row in `PROVIDERS`
      // whose command is `codex`. Until it exists, offering it would be a
      // control that cannot act.
      createSession: false,
      governance: false,
      pullRequests: false,
      // THE ONE THAT MAKES THIS SOURCE DIFFERENT. It delivers and it has no
      // pane, which no source has said before.
      terminal: false,
      agentRoster: false,
      // `codex resume <uuid>`, measured: it replayed the thread's own turns
      // and took the SAME uuid's writer lock, so a reopened thread is the
      // same thread and `load()` finds it live on the next poll.
      //
      // TRUE WHILE `createSession` IS FALSE, and the pair is the point: vam
      // cannot START a Codex thread yet (Stage 2 of `a-second-source.md`) and
      // can return to one that exists. Folding the two into one boolean would
      // have cost the operator this.
      resumeSession: true,
    },
    declines: {
      liveUpdates:
        'this source re-reads Codex’s own store on demand; nothing watches it, and nothing tells vam when a thread changes',
      promptAttachments:
        '`codex queue` takes a message; vam has not measured how an image reaches a queued turn, so it does not offer one',
      slashCommands: NO_SURFACE,
      renameSession: NOT_OURS,
      closeSession: NOT_OURS,
      createSession:
        'vam can read and queue for the Codex threads that already exist; starting one is the next stage of this source and is not built yet',
      governance: NO_SURFACE,
      pullRequests:
        'vam reads pull requests through `gh` in a session’s own directory, and it has not been wired for this source yet; `threads.git_branch` is what it would use',
      terminal: NO_PANE,
      agentRoster: NO_SURFACE,
    },
    viewerScope: {
      kind: 'connection',
      note: 'Codex keeps its threads in this operating-system account’s own home directory; the OS account is the identity, and there is no other viewer',
    },
  };
};

/**
 * One thread, as a row. Every field is either read from the store, read from
 * the rollout, or a documented absence.
 */
async function sessionFor(
  row: ThreadRow,
  nowMs: number,
  liveness: Liveness,
  // `null` is "vam could not ask tmux at all" -- see `vamControlled` below.
  // The default is an EMPTY set rather than `null`, deliberately: a caller
  // that passes nothing is the shape every fixture in this suite predates,
  // and it must read as "vam asked and found no match" (`false`), not as "vam
  // could not ask" (absent) -- the same distinction `TmuxSession.pid`'s own
  // header draws between an unset option and one nobody could read at all.
  vamSessionIds: ReadonlySet<string> | null = new Set(),
  // Stamped onto the row verbatim when the caller's own tmux read failed this
  // load -- see `Session.vamListingGap`. `null` is the ordinary case.
  vamListingGap: { readonly code: string; readonly message: string } | null = null,
  // Same seam `claude-code/source.ts`'s own parameter of the same name is.
  isAgentWorktreeOf: (cwd: string, branch: string | null) => Promise<boolean> = isAgentWorktreeCwd,
): Promise<Session> {
  let facts: Awaited<ReturnType<typeof readRolloutTail>> | null = null;
  try {
    facts = await readRolloutTail(fileTranscriptSource(row.rolloutPath), `codex-${row.id}`);
  } catch {
    // A rollout vam could not open. NOT the same as a thread with no turns,
    // and `decisions: []` beside `activity: null` is how this source says "vam
    // read nothing here" -- the row still exists, because the STORE says it
    // does and that read succeeded.
    facts = null;
  }
  const isAgentWorktree = await isAgentWorktreeOf(row.cwd, row.branch);
  return {
    // THE BARE THREAD UUID. The same string is `threads.id`, the rollout
    // filename and `--thread`, so no `#pid` suffix is needed -- contrast
    // `claude-code/agents.ts:198`, where a session id alone collapses two rows
    // because one session can be running twice.
    id: row.id,
    title: titleOf(row),
    epic: null,
    // WHAT THE WRITER LOCK SAID, and nothing beyond it. See the header: `idle`
    // is alive-and-between-turns, `done` is a job that ended, and the neutral
    // paint is what an unreadable probe still earns.
    status: statusFor(liveness),
    // THE SAME FACT, ASKED THE OTHER WAY, and the one the sidebar's filter
    // reads. Set ONLY where the probe answered: `unknown` leaves it off, on
    // `Session.ended`'s own rule that an absence must never be read as a
    // measurement. This is what keeps a finished Codex thread off the live
    // list without also hiding Claude Code's finished background agents,
    // which are `done` too and are not what the operator asked to lose.
    ...(liveness === 'ended' ? { ended: true } : {}),
    // NOT A GUESS AND NOT A ZERO-BY-DEFAULT: vam has no agent surface on this
    // source at all, so it reports no agents running, which is what `0` with
    // `agentRoster: false` beside it says.
    runningAgents: 0,
    activity: facts?.activity ?? null,
    age: row.recencyAtMs === null ? null : compactAge(nowMs - row.recencyAtMs),
    branch: row.branch,
    // NEVER `row.recencyAtMs` -- `docs/design/vam-owns-the-session.md`'s own
    // trap, restated: a recency moves on every touch and is not a start
    // time. `threadStartOf` reads the instant Codex itself embedded in the
    // rollout's own file name (`rollout.ts`), so this costs no read of the
    // file at all.
    createdAt: threadStartOf(row.rolloutPath),
    decisions: facts?.decisions ?? [],
    source: CODEX_SOURCE_ID,
    // ABSENT, NOT EMPTY, on `Session.agents`' own rule: empty is a source that
    // looked and found none; this source cannot look.
    // (no `agents` key, deliberately)
    //
    // A REAL PAIRING NOW, not the old unconditional `false`.
    // `docs/design/vam-owns-the-session.md` Stage 1: a resume writes
    // `@vam-session` with the thread's own uuid the moment it has one
    // (`resume.ts`), so a thread whose id vam finds among the ids currently
    // recorded on its own tmux sessions is one vam started and can still
    // reach a pane for. THREE STATES, the shape `vamControlled` itself
    // documents: `true` is a proven pairing, `false` is vam having asked
    // tmux and found no match, and ABSENT -- `vamSessionIds === null` --
    // is vam not being able to ask tmux at all, which must never collapse
    // into `false`. This is NOT the other claim the same flag used to stand
    // for: whether vam can REACH the session, which is `deliverPrompt` above
    // and is true regardless.
    ...(vamSessionIds === null ? {} : { vamControlled: vamSessionIds.has(row.id) }),
    // WHAT MODEL THIS THREAD IS ON, from `threads.model` -- a fact the store
    // holds, so vam does not have to read a status line to find it and cannot
    // offer to change it.
    model: row.model,
    ...(vamListingGap === null ? {} : { vamListingGap }),
    ...(isAgentWorktree ? { isAgentWorktree: true } : {}),
  };
}

/**
 * Threads grouped into projects by their `cwd`, newest project first.
 *
 * `liveness` defaults to "vam could not ask", which is the honest answer for
 * any caller that has not probed -- never `ended`, which would claim a thread
 * had finished on no evidence at all.
 */
export async function projectsFrom(
  threads: readonly ThreadRow[],
  nowMs: number,
  liveness: (threadId: string) => Liveness = () => 'unknown',
  // See `sessionFor`'s own doc for the three states this carries through.
  vamSessionIds: ReadonlySet<string> | null = new Set(),
  vamListingGap: { readonly code: string; readonly message: string } | null = null,
  // See `sessionFor`'s own doc.
  isAgentWorktreeOf: (cwd: string, branch: string | null) => Promise<boolean> = isAgentWorktreeCwd,
): Promise<readonly Project[]> {
  const byProject = new Map<string, { cwd: string; sessions: Session[] }>();
  const order: string[] = [];
  const sessions = await Promise.all(
    threads.map((row) =>
      sessionFor(row, nowMs, liveness(row.id), vamSessionIds, vamListingGap, isAgentWorktreeOf),
    ),
  );
  threads.forEach((row, index) => {
    const id = codexProjectId(row.cwd);
    let bucket = byProject.get(id);
    if (bucket === undefined) {
      bucket = { cwd: row.cwd, sessions: [] };
      byProject.set(id, bucket);
      order.push(id);
    }
    const session = sessions[index];
    if (session !== undefined) bucket.sessions.push(session);
  });
  return order.map((id) => {
    const bucket = byProject.get(id) as { cwd: string; sessions: Session[] };
    return {
      id,
      // The directory's own name, which is what the operator calls the repo.
      // A `cwd` that no longer exists still has one, and 17 of the 30 distinct
      // directories measured on this machine no longer exist -- a thread
      // outlives its worktree, and vam draws the thread either way.
      name: basename(bucket.cwd),
      source: CODEX_SOURCE_ID,
      sessions: bucket.sessions,
    };
  });
}

/**
 * The source itself.
 *
 * THE DESCRIPTOR IS COMPUTED ONCE, AT CONSTRUCTION, because a descriptor is
 * read once at factory time and cannot be changed afterwards -- the bridge
 * deep-freezes what it copies (`shared/preload-api.ts`). So the question it
 * answers is "could vam read this Codex when it started", which is exactly the
 * question a version decline answers: `state_5.sqlite` being absent or
 * renamed is a fact about the INSTALLATION, not about this minute.
 */
export function createCodexSource(input: {
  readonly home?: string;
  readonly exists: (path: string) => boolean;
  readonly runSqlite: RunSqlite;
  readonly runCodex: RunCodex;
  readonly now?: () => number;
  readonly probe?: StoreRead | null;
  /**
   * How this source asks whether a thread has a live writer. Injected for the
   * same reason every filesystem read in this tree is: a test must never be
   * pointed at the operator's own `~/.codex`.
   */
  readonly probeLock?: ProbeLock;
  /**
   * Whether the lock probe can answer AT ALL here, which is a fact about the
   * platform and therefore a construction-time one -- so the label can say it.
   */
  readonly livenessReadable?: boolean;
  /** Injected so no test spawns tmux. */
  readonly runTmux?: TmuxRun;
}): MainSource {
  const path = stateDbPath(input.home ?? codexHome());
  const home = input.home ?? codexHome();
  const now = input.now ?? (() => Date.now());
  const probeLock = input.probeLock ?? probeLockViaOpen();
  const descriptor = descriptorFor(
    input.probe ?? null,
    input.livenessReadable ?? process.platform === 'darwin',
  );

  return {
    descriptor,
    load: async () => {
      const read = await readThreads({
        path,
        exists: input.exists,
        sidecars: readSidecars,
        run: input.runSqlite,
      });
      // NEVER A REJECTION, and never a silent empty list either: the reason is
      // already on the descriptor, which the source cell draws. See the header.
      if (read.kind === 'unavailable') return [];
      // One probe per scanned row, and the answer is REMEMBERED rather than
      // asked twice: `selectThreads` decides which rows are drawn and
      // `projectsFrom` paints each row's status, and the two must not be able
      // to disagree -- a thread that ended between the two calls would
      // otherwise be sorted as live and painted as done in the same list.
      const answers = new Map<string, Liveness>();
      const liveness = (threadId: string): Liveness => {
        const remembered = answers.get(threadId);
        if (remembered !== undefined) return remembered;
        const fresh = livenessOf(threadId, probeLock, home);
        answers.set(threadId, fresh);
        return fresh;
      };
      const chosen = selectThreads({ threads: read.threads, liveness });
      // WHICH OF VAM'S OWN TMUX SESSIONS THIS THREAD'S UUID IS RECORDED ON --
      // `docs/design/vam-owns-the-session.md` Stage 1's own line: "Codex rows
      // get a real vamControlled." Asked once per load, exactly as the
      // Claude Code source already does for its own pairing.
      const listed = await listVamSessions(input.runTmux ?? createTmuxRunner());
      const vamSessionIds =
        listed.kind === 'ok'
          ? new Set(
              listed.sessions
                .map((s) => s.vamSessionId)
                .filter((id): id is string => id !== undefined && id !== ''),
            )
          : null;
      const vamListingGap =
        listed.kind === 'ok' ? null : { code: listed.error.code, message: listed.error.message };
      return await projectsFrom(chosen.drawn, now(), liveness, vamSessionIds, vamListingGap);
    },
    recordPrompt: async (sessionId, prompt) => {
      if (!descriptor.capabilities.recordPrompt) {
        const error: SourceError = {
          kind: 'refused',
          code: 'unavailable',
          message: descriptor.declines.recordPrompt ?? 'vam cannot reach this Codex',
        };
        return error;
      }
      return await queueMessage({ threadId: sessionId, message: prompt, run: input.runCodex });
    },
    /**
     * `codex resume <uuid>` in the thread's own directory.
     *
     * The store AND the writer lock are both re-read here rather than trusted
     * from the last `load()`: a thread the canvas drew as finished ten seconds
     * ago may have been resumed from a terminal since, and starting a second
     * Codex on one conversation is the thing this must never do. See
     * `./resume.ts`.
     */
    resumeSession: async (sessionId) =>
      await resumeThread({
        threadId: sessionId,
        threads: async () => {
          const read = await readThreads({
            path,
            exists: input.exists,
            sidecars: readSidecars,
            run: input.runSqlite,
          });
          return read.kind === 'threads' ? read.threads : [];
        },
        liveness: (threadId) => livenessOf(threadId, probeLock, home),
        run: input.runTmux ?? createTmuxRunner(),
      }),
  };
}

/**
 * The source main serves, probed once at startup.
 *
 * THE PROBE IS SYNCHRONOUS AND CHEAP: it asks whether the file is there, which
 * is the version question in its commonest form. A store that is present but
 * whose SCHEMA has moved is not caught here -- that answer needs a query, and
 * it arrives on the first `load()` as an empty list with the reason recorded
 * in main's log. Naming that gap rather than pretending the probe closes it.
 */
export function defaultCodexSource(exists: (path: string) => boolean): MainSource {
  const path = stateDbPath();
  return createCodexSource({
    exists,
    runSqlite: runSqliteViaCli(),
    runCodex: runCodexViaCli(),
    probe: exists(path)
      ? null
      : {
          kind: 'unavailable',
          code: 'no-store',
          message: `this Codex keeps its sessions somewhere vam does not know: there is no ${path}`,
        },
  });
}

/** Where the rollout files live, for a reader that has only a thread id. */
export const rolloutRoot = (home = codexHome()): string => join(home, 'sessions');
