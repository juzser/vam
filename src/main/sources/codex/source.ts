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
 * LIVENESS IS THE ONE VAM REFUSES TO GUESS. `threads` has no `status` and no
 * pid column; `~/.codex/thread-writer-locks/<uuid>.lock` files exist and were
 * STALE for threads long finished. So every Codex row is drawn without a live
 * mark, `status` is the neutral one, `runningAgents` is 0, and the decline
 * says vam cannot tell. `a-second-source.md` §Stage 3 is where that changes,
 * after the experiment that says what liveness can be read from.
 *
 * `status: 'idle'` IS A CHOICE BETWEEN FIVE WRONG WORDS AND IT IS THE LEAST
 * WRONG. `SessionStatus` has no "vam cannot tell" arm. `running` would claim
 * the thing this source refuses to guess; `done` would claim a thread ENDED,
 * which vam equally cannot see; `waiting` paints amber, and an amber row per
 * thread is exactly the false alarm `model.ts`'s own header records `idle`
 * being invented to stop. `idle` paints neutral, and neutral is the state of
 * vam's knowledge.
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
import { fileTranscriptSource } from '../claude-code/window.js';
import type { MainSource } from '../source.js';
import { queueMessage, type RunCodex, runCodexViaCli } from './queue.js';
import { readRolloutTail } from './rollout.js';
import {
  codexHome,
  MAX_THREADS,
  type RunSqlite,
  readSidecars,
  readThreads,
  runSqliteViaCli,
  type StoreRead,
  stateDbPath,
  type ThreadRow,
} from './store.js';

export const CODEX_SOURCE_ID = 'codex';

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

const descriptorFor = (store: StoreRead | null, threads: number): SourceDescriptor => {
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
      },
      viewerScope: {
        kind: 'connection',
        note: 'Codex keeps its threads in this operating-system account’s own home directory; the OS account is the identity',
      },
    };
  }
  return {
    id: CODEX_SOURCE_ID,
    // THE CAP IS IN THE LABEL, because a truncated list that does not say it
    // is truncated is the same lie as an empty one. The label is drawn in the
    // status bar (`Canvas.tsx`'s `SourceReadout`).
    label: `Codex — the ${Math.min(threads, MAX_THREADS)} most recent threads`,
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
async function sessionFor(row: ThreadRow, nowMs: number): Promise<Session> {
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
  return {
    // THE BARE THREAD UUID. The same string is `threads.id`, the rollout
    // filename and `--thread`, so no `#pid` suffix is needed -- contrast
    // `claude-code/agents.ts:198`, where a session id alone collapses two rows
    // because one session can be running twice.
    id: row.id,
    title: titleOf(row),
    icon: null,
    epic: null,
    // See the header: the union has no "vam cannot tell" arm and `idle` is the
    // only neutral paint.
    status: 'idle',
    // NOT A GUESS AND NOT A ZERO-BY-DEFAULT: vam has no agent surface on this
    // source at all, so it reports no agents running, which is what `0` with
    // `agentRoster: false` beside it says.
    runningAgents: 0,
    activity: facts?.activity ?? null,
    age: row.recencyAtMs === null ? null : compactAge(nowMs - row.recencyAtMs),
    branch: row.branch,
    decisions: facts?.decisions ?? [],
    source: CODEX_SOURCE_ID,
    // ABSENT, NOT EMPTY, on `Session.agents`' own rule: empty is a source that
    // looked and found none; this source cannot look.
    // (no `agents` key, deliberately)
    //
    // FALSE, AND IT IS A POSITIVE FACT RATHER THAN A SHRUG: vam starts nothing
    // on Codex today, so vam did not start this. That is the claim the mode
    // chip, the model picker, the keystroke strip and `remove-project.ts` all
    // read -- "vam holds this session's pane" -- and it is false for every
    // Codex row. It is NOT the other claim the same flag used to stand for:
    // whether vam can REACH the session, which is `deliverPrompt` above and is
    // true.
    vamControlled: false,
    // WHAT MODEL THIS THREAD IS ON, from `threads.model` -- a fact the store
    // holds, so vam does not have to read a status line to find it and cannot
    // offer to change it.
    model: row.model,
  };
}

/** Threads grouped into projects by their `cwd`, newest project first. */
export async function projectsFrom(
  threads: readonly ThreadRow[],
  nowMs: number,
): Promise<readonly Project[]> {
  const byProject = new Map<string, { cwd: string; sessions: Session[] }>();
  const order: string[] = [];
  const sessions = await Promise.all(threads.map((row) => sessionFor(row, nowMs)));
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
}): MainSource {
  const path = stateDbPath(input.home ?? codexHome());
  const now = input.now ?? (() => Date.now());
  const descriptor = descriptorFor(input.probe ?? null, MAX_THREADS);

  return {
    descriptor,
    load: async () => {
      const read = await readThreads({
        path,
        exists: input.exists,
        sidecars: readSidecars,
        run: input.runSqlite,
        now: now(),
      });
      // NEVER A REJECTION, and never a silent empty list either: the reason is
      // already on the descriptor, which the source cell draws. See the header.
      if (read.kind === 'unavailable') return [];
      return await projectsFrom(read.threads, now());
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
