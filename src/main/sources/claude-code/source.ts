/**
 * The operator's own Claude Code sessions, read off disk.
 *
 * Layout, measured rather than assumed: `~/.claude/projects/<slug>/<id>.jsonl`
 * is a session the operator opened, and
 * `~/.claude/projects/<slug>/<id>/subagents/agent-*.jsonl` is one subagent of
 * it. On this machine that is 54 sessions and 486 subagent files, 814 MB in
 * all, with a single transcript of 165 MB. Only the 54 become rows: the model
 * is explicit that a subagent is work happening *under* a session, surfaced as
 * `runningAgents`, and never a session of its own -- turning them into rows
 * would replace a list of things the operator owns with ten times as many they
 * do not. (The other half of that decision: inline `isSidechain: true` lines,
 * which older transcripts used for the same purpose, measure zero in every
 * current session file. Subagent traffic is entirely out-of-band now.)
 *
 * `<slug>` is a lossy flattening of the path and is never read: `cwd`, recorded
 * inside the file, is the real working directory and the thing that groups
 * sessions into a project.
 *
 * THIS MODULE IS MAIN-PROCESS ONLY. It reads the filesystem, so the browser
 * build cannot use it and does not import it; the web target keeps whatever
 * source it was already given.
 */

import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Project, Session } from '../../../renderer/domain/model.js';
import type { SourceDescriptor } from '../../../shared/preload-api.js';
import type { MainSource } from '../source.js';
import { summarizeTranscript, type TranscriptSummary } from './transcript.js';

/**
 * The read budget, and the whole reason `load()` is affordable.
 *
 * Sessions are chosen by mtime -- a `stat` per file, never a read -- and only
 * the survivors are opened, each for its last `TAIL_BYTES` and no more. Worst
 * case is `MAX_SESSIONS * TAIL_BYTES` = 5 MB of reads against 814 MB on disk,
 * independent of how large any one transcript is.
 *
 * `RECENCY_WINDOW_MS` is a product decision as much as a budget one: a canvas
 * showing every session the operator ever opened is the complaint this source
 * exists to answer. Two weeks is where the measured distribution puts the
 * sessions still being resumed.
 */
const TAIL_BYTES = 128 * 1024;
const MAX_SESSIONS = 40;
const RECENCY_WINDOW_MS = 14 * 86_400_000;

/** Matches `transcript.ts`: a subagent file this fresh is a live agent. */
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

/** Subagent transcripts written within the running window, i.e. agents still working. */
async function countRunningAgents(dir: string, nowMs: number): Promise<number> {
  let running = 0;
  try {
    const entries = await readdir(join(dir, 'subagents'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const info = await stat(join(dir, 'subagents', entry.name));
      if (nowMs - info.mtimeMs <= RUNNING_WINDOW_MS) running += 1;
    }
  } catch {
    // No subagents directory: this session never spawned one.
  }
  return running;
}

type Candidate = {
  readonly path: string;
  readonly id: string;
  readonly mtimeMs: number;
  readonly size: number;
};

/** Every session transcript under the root, newest first, already budget-capped. */
async function findCandidates(root: string, nowMs: number): Promise<Candidate[]> {
  let projectDirs: string[];
  try {
    projectDirs = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // No transcript root at all: Claude Code has never run here. Not an error.
    return [];
  }

  const found: Candidate[] = [];
  for (const dir of projectDirs) {
    let entries: string[];
    try {
      entries = (await readdir(join(root, dir), { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const name of entries) {
      const path = join(root, dir, name);
      try {
        const info = await stat(path);
        if (nowMs - info.mtimeMs > RECENCY_WINDOW_MS) continue;
        found.push({
          path,
          id: name.replace(/\.jsonl$/, ''),
          mtimeMs: info.mtimeMs,
          size: info.size,
        });
      } catch {
        // Deleted between readdir and stat.
      }
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSIONS);
}

/**
 * A stable project id that carries no path.
 *
 * The last segment alone would merge two genuinely different checkouts that
 * happen to share a directory name, and the full path would render the
 * operator's home directory into the DOM. A digest of the path disambiguates
 * without disclosing it.
 */
function projectId(cwd: string): string {
  return `claude-code:${basename(cwd)}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
}

export async function loadClaudeCodeProjects(
  root: string,
  nowMs: number = Date.now(),
): Promise<readonly Project[]> {
  const candidates = await findCandidates(root, nowMs);

  const summaries: TranscriptSummary[] = [];
  for (const candidate of candidates) {
    try {
      const tail = await readTail(candidate.path, candidate.size, TAIL_BYTES);
      const runningAgents = await countRunningAgents(candidate.path.replace(/\.jsonl$/, ''), nowMs);
      const summary = summarizeTranscript(tail, {
        fallbackId: candidate.id,
        mtimeMs: candidate.mtimeMs,
        nowMs,
        runningAgents,
      });
      // No `cwd` anywhere in the tail means nothing to group it under; a row
      // in a project vam had to invent is worse than no row.
      if (summary?.cwd != null) summaries.push(summary);
    } catch {
      // An unreadable transcript costs its own row, never the whole load.
    }
  }

  const grouped = new Map<string, { cwd: string; sessions: Session[] }>();
  for (const { cwd, session } of summaries) {
    const key = cwd as string;
    const group = grouped.get(key) ?? { cwd: key, sessions: [] };
    group.sessions.push(session);
    grouped.set(key, group);
  }

  // Candidates were already newest-first, so each group's order is preserved.
  return [...grouped.values()].map((group) => ({
    id: projectId(group.cwd),
    name: basename(group.cwd),
    // Deprecated on the model, and still set: the launched-app harness asserts
    // that what main serves has the same key set as the browser demo model,
    // and dropping an optional field here is a shape divergence it catches.
    source: 'claude-code',
    sessions: group.sessions,
  }));
}

const READ_ONLY =
  'this source reads Claude Code transcript files and never writes to them; a transcript is the record of a session, not a channel into one';
const NO_CHANNEL =
  'vam holds no connection to a running Claude Code process, so it has nothing to send this to';
const NOT_RECORDED = 'a Claude Code transcript records nothing that answers this';

const DESCRIPTOR: SourceDescriptor = {
  id: 'claude-code',
  label: 'Claude Code (local transcripts, read-only)',
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
    // No watch is implemented, so no live badge is claimed. Flipping this on
    // without one gives the canvas a badge no event ever arrives at.
    liveUpdates: 'this source re-reads on demand; nothing watches the transcript directory yet',
    recordPrompt: READ_ONLY,
    deliverPrompt: NO_CHANNEL,
    promptAttachments: NO_CHANNEL,
    slashCommands: NO_CHANNEL,
    renameSession: READ_ONLY,
    closeSession: NO_CHANNEL,
    createSession: NO_CHANNEL,
    governance: NOT_RECORDED,
    pullRequests: NOT_RECORDED,
    terminal: NO_CHANNEL,
    agentRoster: NOT_RECORDED,
  },
  /**
   * `connection`, and the connection is the operating-system user. These files
   * live in this account's home directory and are readable only by it, so the
   * set of sessions returned is exactly the set this person opened -- there is
   * no second identity in the store to filter against, and none to leak to.
   */
  viewerScope: {
    kind: 'connection',
    note: "these are files in the running user's own home directory; the OS account is the identity, and there is no other viewer in the store",
  },
};

export const CLAUDE_CODE_SOURCE: MainSource = {
  descriptor: DESCRIPTOR,
  load: () => loadClaudeCodeProjects(defaultTranscriptRoot()),
};
