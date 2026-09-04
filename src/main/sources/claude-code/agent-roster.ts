/**
 * The subagents a session spawned: `<sessionId>/subagents/agent-*.jsonl` and
 * the `agent-*.meta.json` written beside each one.
 *
 * WHY THIS FILE EXISTS. `source.ts` already walked this directory to count the
 * transcripts touched inside the running window, and threw away everything
 * else it had opened -- while the meta file sitting next to each one names the
 * agent type and what it was asked to do. That is the whole of the Agents tab,
 * available with no new source and nothing invented.
 *
 * Split the way `session-status.ts` and `transcript.ts` are split, and for the
 * same reason: the parsing is a pure function over text, testable against
 * fixtures rather than against whatever the operator's home directory holds,
 * and the reader adds only the I/O.
 *
 * NOTHING HERE IS ALLOWED TO THROW OUT OF `load()`. A subagent directory is a
 * side channel: an unreadable meta file must cost that agent its two labels
 * and nothing more, never the agent, never the session, never the canvas.
 *
 * MAIN-PROCESS ONLY -- it reads the filesystem.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionAgent } from '../../../renderer/domain/model.js';

/** A subagent transcript touched this recently belongs to an agent still working. */
const RUNNING_WINDOW_MS = 5 * 60_000;

/**
 * How many agents the roster carries at most.
 *
 * Measured: 486 subagent transcripts under 54 sessions on the machine this was
 * written on, so the whole history of a long-lived session is neither worth a
 * meta read each nor worth rendering into a 408px pane. The newest are the
 * ones worth naming.
 *
 * The cap STRETCHES to the running count (`readAgentRoster` below): the badge
 * counts every transcript inside the window, and a roster that hid one of
 * those would contradict the number printed on the tab. Since the ordering is
 * by modification time and "running" IS "modified recently", the running
 * agents are the first entries anyway -- the stretch only matters for a
 * session running more than `ROSTER_LIMIT` agents at once.
 */
export const ROSTER_LIMIT = 20;

/** What a meta file is worth to the pane: two labels, either of which may be absent. */
export type AgentMeta = {
  readonly agentType: string | null;
  readonly description: string | null;
};

const NO_META: AgentMeta = { agentType: null, description: null };

/**
 * The two labels out of one `agent-*.meta.json` text.
 *
 * `null` for anything the pane cannot render: unparseable JSON, a document
 * that is not an object, an absent field, or one that is not a string. Never
 * an error -- the agent still exists and the pane still lists it, saying what
 * it does not know.
 */
export function parseAgentMeta(text: string): AgentMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_META;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return NO_META;
  const record = parsed as Record<string, unknown>;
  const str = (key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' && value !== '' ? value : null;
  };
  return { agentType: str('agentType'), description: str('description') };
}

export type AgentRoster = {
  /** Newest first, capped -- see `ROSTER_LIMIT`. */
  readonly agents: readonly SessionAgent[];
  /**
   * How many transcripts sit inside the running window, counted over the WHOLE
   * directory before the cap. This is the `●N` badge, and it is the same
   * number this walk has always produced.
   */
  readonly running: number;
};

const EMPTY_ROSTER: AgentRoster = { agents: [], running: 0 };

/**
 * One session's roster, off the directory beside its transcript.
 *
 * The stat pass is the count that was already here; the meta reads are new and
 * are bounded by the cap, so a session with 486 agents behind it costs at most
 * `ROSTER_LIMIT` extra small reads.
 */
export async function readAgentRoster(transcriptPath: string, nowMs: number): Promise<AgentRoster> {
  const dir = join(transcriptPath.slice(0, -'.jsonl'.length), 'subagents');
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => e.name);
  } catch {
    // No subagents directory: this session never spawned one.
    return EMPTY_ROSTER;
  }

  const found: { id: string; mtimeMs: number; running: boolean }[] = [];
  for (const name of names) {
    try {
      const info = await stat(join(dir, name));
      found.push({
        id: name.slice(0, -'.jsonl'.length),
        mtimeMs: info.mtimeMs,
        running: nowMs - info.mtimeMs <= RUNNING_WINDOW_MS,
      });
    } catch {
      // A file that vanished between the readdir and the stat.
    }
  }
  const running = found.filter((f) => f.running).length;

  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const listed = found.slice(0, Math.max(ROSTER_LIMIT, running));

  const agents: SessionAgent[] = [];
  for (const entry of listed) {
    let meta = NO_META;
    try {
      meta = parseAgentMeta(await readFile(join(dir, `${entry.id}.meta.json`), 'utf8'));
    } catch {
      // No meta file, or an unreadable one: the id and the running state are
      // still facts, and the pane says the rest is unknown.
    }
    agents.push({
      id: entry.id,
      type: meta.agentType,
      description: meta.description,
      running: entry.running,
    });
  }
  return { agents, running };
}
