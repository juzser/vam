/**
 * The operator's own Claude Code sessions.
 *
 * TWO SOURCES OF TRUTH, each used for what it actually knows:
 *
 *  - `claude agents --json` is the SESSION LIST and the STATUS. It knows which
 *    processes are alive; nothing on disk does.
 *  - the transcript at `~/.claude/projects/<slug>/<sessionId>.jsonl` is the
 *    CONTENT: the newest turns, the branch, the current tool call.
 *
 * The list used to come from the directory instead, which is why this file
 * says so: walking the transcripts yields every session that ever existed --
 * 30 within a two-week window on this machine against 5 processes actually
 * running -- and showing the operator a canvas of mostly-dead sessions is the
 * complaint this source exists to answer. The CLI answers it exactly.
 *
 * `<slug>` is a lossy flattening of the working directory and is never parsed;
 * it is only walked, to find which file a session id lives in. `cwd` comes
 * from the CLI, which reports the real path.
 *
 * SUBAGENTS ARE NOT SESSIONS. `<sessionId>/subagents/agent-*.jsonl` (486 files
 * here, against 54 transcripts) is work happening *under* a session, and the
 * model is explicit that it surfaces as `runningAgents` and never as a row --
 * rows are things the operator owns. The other half of that decision: inline
 * `isSidechain: true` lines, which older transcripts used for the same
 * purpose, measure zero in every current session file.
 *
 * THIS MODULE IS MAIN-PROCESS ONLY. It reads the filesystem and spawns a
 * subprocess, so the browser build cannot use it and does not import it; the
 * web target is unaffected.
 */

import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Project, Session } from '../../../renderer/domain/model.js';
import type { SourceDescriptor } from '../../../shared/preload-api.js';
import type { MainSource } from '../source.js';
import { type LiveAgent, listLiveAgents } from './agents.js';
import { deliverPromptViaCli, deliverToSession } from './deliver.js';
import { createBranchLookup } from './repo-branch.js';
import { defaultSessionsRoot, readStatusUpdatedAt } from './session-status.js';
import {
  compactAge,
  EMPTY_FACTS,
  summarizeTranscript,
  type TranscriptFacts,
} from './transcript.js';

/**
 * The read budget. Only sessions the CLI reported are opened -- single digits
 * in practice -- and each is read for its last `TAIL_BYTES` and no more, so
 * `load()` costs kilobytes against the 814 MB of transcripts on this disk,
 * independent of how large any one of them is. A transcript shared by two
 * resumed processes is read once.
 *
 * The per-process status files are the one read that is per ROW rather than
 * per session -- there is no sharing them, since telling two rows apart is
 * exactly what they are for. Each is a single small JSON document (a few
 * hundred bytes, read whole), so a canvas of single-digit rows costs
 * single-digit kilobytes on top of the tails.
 */
const TAIL_BYTES = 128 * 1024;

/** A subagent transcript touched this recently belongs to an agent still working. */
const RUNNING_WINDOW_MS = 5 * 60_000;

/** Where Claude Code keeps transcripts. Derived, never a literal home path. */
export const defaultTranscriptRoot = (): string => join(homedir(), '.claude', 'projects');

/** The last `bytes` of a file, decoded loosely -- a cut token is the parser's problem. */
async function readTail(path: string, size: number, bytes: number): Promise<string> {
  const length = Math.min(size, bytes);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, size - length));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Where each session id's transcript lives, by walking the slug directories
 * once. Names only -- no file is opened and nothing is stat'd here, so an
 * index over 54 transcripts costs ten `readdir` calls.
 */
async function indexTranscripts(root: string): Promise<Map<string, string>> {
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

/** Subagent transcripts written within the running window: agents still working. */
async function countRunningAgents(transcriptPath: string, nowMs: number): Promise<number> {
  const dir = join(`${transcriptPath.slice(0, -'.jsonl'.length)}`, 'subagents');
  let running = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const info = await stat(join(dir, entry.name));
      if (nowMs - info.mtimeMs <= RUNNING_WINDOW_MS) running += 1;
    }
  } catch {
    // No subagents directory: this session never spawned one.
  }
  return running;
}

type TranscriptRead = {
  readonly facts: TranscriptFacts;
  readonly runningAgents: number;
  /** Last activity, which `startedAt` is not. `null` when there is no file. */
  readonly mtimeMs: number | null;
};

const NO_TRANSCRIPT: TranscriptRead = { facts: EMPTY_FACTS, runningAgents: 0, mtimeMs: null };

async function readTranscript(
  path: string,
  sessionId: string,
  nowMs: number,
): Promise<TranscriptRead> {
  try {
    const info = await stat(path);
    const tail = await readTail(path, info.size, TAIL_BYTES);
    return {
      facts: summarizeTranscript(tail, sessionId),
      runningAgents: await countRunningAgents(path, nowMs),
      mtimeMs: info.mtimeMs,
    };
  } catch {
    // An unreadable transcript costs its own turns, never the whole load: the
    // session is live and the operator should still see it.
    return NO_TRANSCRIPT;
  }
}

/**
 * A stable project id that carries no path.
 *
 * The last segment alone would merge two genuinely different checkouts that
 * happen to share a directory name, and the full path would render the
 * operator's home directory into the DOM of a public application. A digest
 * disambiguates without disclosing.
 */
function projectId(cwd: string): string {
  return `claude-code:${basename(cwd)}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
}

export async function loadClaudeCodeProjects(
  root: string,
  agents: readonly LiveAgent[],
  nowMs: number = Date.now(),
  // Cached per call to this function -- one `load()` worth of sessions -- per
  // `repo-branch.ts`'s contract. Injectable so tests never touch a real
  // directory on the machine running them.
  branchOf: (cwd: string) => Promise<string | null> = createBranchLookup(),
  // Injectable for the same reason as `branchOf`: tests read invented pids
  // under a temp directory, never the operator's own `~/.claude/sessions`.
  sessionsRoot: string = defaultSessionsRoot(),
): Promise<readonly Project[]> {
  const index = await indexTranscripts(root);

  // Read each transcript once, however many processes resumed it.
  const reads = new Map<string, TranscriptRead>();
  for (const sessionId of new Set(agents.map((a) => a.sessionId))) {
    const path = index.get(sessionId);
    reads.set(
      sessionId,
      path === undefined ? NO_TRANSCRIPT : await readTranscript(path, sessionId, nowMs),
    );
  }

  const grouped = new Map<string, { cwd: string; sessions: Session[] }>();
  for (const agent of agents) {
    const read = reads.get(agent.sessionId) ?? NO_TRANSCRIPT;
    // Per row, because a row is a process. See the age comment below.
    const statusUpdatedAt =
      agent.pid === null ? null : await readStatusUpdatedAt(sessionsRoot, agent.pid);
    const session: Session = {
      id: agent.key,
      // The CLI's name is the operator's own; the generated title is only a
      // fallback, and the session id a fallback for that.
      title: agent.name ?? read.facts.aiTitle ?? agent.sessionId,
      icon: null,
      // The branch is the second label: it is what actually distinguishes two
      // sessions on the same project at a glance.
      epic: read.facts.branch,
      status: agent.status,
      runningAgents: read.runningAgents,
      activity: agent.status === 'running' ? read.facts.activity : null,
      // Age is LAST ACTIVITY, per PROCESS. `~/.claude/sessions/<pid>.json`'s
      // `statusUpdatedAt` is the only surface that answers per process: two
      // processes that resumed one session share a transcript, so the mtime
      // below gives them one identical age where their real ones differed by
      // 18 hours on the machine this was measured on. The rest of the chain
      // is unchanged and still ordered for its own reasons: the transcript's
      // mtime is real last activity, while `startedAt` is when the process
      // launched -- for a session resumed all day that reads as days old
      // while it is answering right now, so it stands last, because a row
      // with neither a status file nor a transcript has nothing better.
      age: compactAge(nowMs - (statusUpdatedAt ?? read.mtimeMs ?? agent.startedAt ?? nowMs)),
      // TRANSCRIPT FIRST, `.git/HEAD` AS FALLBACK. `read.facts.branch` is
      // `gitBranch` as Claude Code itself recorded it per turn -- the branch
      // the session actually ran on, and it costs nothing extra since the
      // transcript is already read. `.git/HEAD` only stands in when there is
      // no transcript yet, or an older one that never wrote `gitBranch`.
      branch: read.facts.branch ?? (await branchOf(agent.cwd)),
      decisions: read.facts.decisions,
      source: 'claude-code',
      // An INTERACTIVE row is a terminal a person is sitting in front of, so
      // `human` is a fact there. A BACKGROUND row is not: measured against
      // the real CLI, `--all` lists background sessions living under
      // `.claude/worktrees/`, and nothing on the row says whether a person
      // launched it or an agent spawned it. This used to claim `human` for
      // both. `unknown` is what vam actually knows, and `session-filter.ts`
      // keeps unknown VISIBLE by design -- hiding what you did not check is
      // how a filter loses work -- so the honest value costs no row on
      // screen. Agent traffic proper (`<sessionId>/subagents/`) still never
      // becomes a row at all.
      //
      // `promptCount` stays null: a tail cannot count a whole session's
      // turns, and a partial count would read as a true one.
      origin: {
        startedBy: agent.kind === 'interactive' ? 'human' : 'unknown',
        promptCount: null,
      },
    };
    const group = grouped.get(agent.cwd) ?? { cwd: agent.cwd, sessions: [] };
    group.sessions.push(session);
    grouped.set(agent.cwd, group);
  }

  return [...grouped.values()].map((group) => ({
    id: projectId(group.cwd),
    name: basename(group.cwd),
    // Deprecated on the model, and still set: the launched-app harness asserts
    // that what main serves carries at least the key set the browser demo
    // model does, and dropping an optional field is a shape divergence.
    source: 'claude-code',
    sessions: group.sessions,
  }));
}

/** Why each remaining `false` is false. */
const NOT_YET_WRITTEN =
  'this round reads only; the CLI does support resuming a session with a prompt, so this is unimplemented rather than impossible';
const NOT_RECORDED = 'a Claude Code transcript records nothing that answers this';
const NO_SURFACE = 'the CLI exposes no such operation on a session, so vam has nothing to call';

const DESCRIPTOR: SourceDescriptor = {
  id: 'claude-code',
  label: 'Claude Code (local sessions, read-only)',
  capabilities: {
    liveUpdates: false,
    // Both true, and they mean different things. `deliverPrompt` is the real
    // claim: `claude --resume <id> -p` appends the turn to the running
    // session's own history, so what vam sends is ANSWERED, not filed. The
    // port makes `recordPrompt` the only required member of a write surface,
    // so delivering is only reachable through it -- which is why it is true
    // as well. See the note on `recordPrompt` below: for this source the two
    // are one operation, and the weaker word is the one that is misleading.
    recordPrompt: true,
    deliverPrompt: true,
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
    // No watch is implemented, so no live badge is claimed: flipping this on
    // without one gives the canvas a badge no event ever arrives at.
    liveUpdates:
      'this source re-reads on demand; nothing watches the session list or the transcripts yet',
    // No entry for recordPrompt or deliverPrompt: a decline is written only
    // for a capability that is false, and both are now true.
    promptAttachments: NOT_YET_WRITTEN,
    slashCommands: NOT_YET_WRITTEN,
    renameSession: NO_SURFACE,
    closeSession: NOT_YET_WRITTEN,
    createSession: NOT_YET_WRITTEN,
    governance: NOT_RECORDED,
    pullRequests: NOT_RECORDED,
    terminal: 'vam holds no PTY, and attaching to a session needs one',
    agentRoster: NOT_RECORDED,
  },
  /**
   * `connection`, and the connection is the operating-system user. The CLI
   * lists this account's own processes and the transcripts live in its own
   * home directory, so what comes back is exactly the set of sessions this
   * person is running -- there is no second identity in the store to filter
   * against, and none to leak to.
   */
  viewerScope: {
    kind: 'connection',
    note: "the CLI lists the running user's own sessions and the transcripts are files in their own home directory; the OS account is the identity, and there is no other viewer",
  },
};

export const CLAUDE_CODE_SOURCE: MainSource = {
  descriptor: DESCRIPTOR,
  load: async () => loadClaudeCodeProjects(defaultTranscriptRoot(), await listLiveAgents()),
  /**
   * The live list is re-asked here rather than cached from `load()`: it is
   * where the session's working directory comes from, and a canvas drawn
   * minutes ago may name a session that has since exited. Asking again costs
   * one subprocess and is the difference between refusing a dead session and
   * delivering into the wrong directory.
   */
  recordPrompt: async (sessionId, prompt) =>
    deliverToSession(await listLiveAgents(), sessionId, prompt, deliverPromptViaCli),
};
