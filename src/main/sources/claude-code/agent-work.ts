/**
 * Reading ONE subagent's work off disk, for the Agents pane's detail side.
 *
 * The Agents tab was a flat list of rows; the operator asked for the list to
 * become a navigator with the selected agent's work beside it, "with
 * in/out/progress". `subagent.ts`'s `agentTurns` turns a window of an agent
 * transcript into `Decision`s; this is the I/O that decides WHICH windows.
 *
 * ── TWO WINDOWS, AND THE MEASUREMENT THAT FORCED THE SECOND ──────────────
 * Over all 872 subagent transcripts on this machine: median 453 KB, p90
 * 1.4 MB, largest 46 MB, and only 52 of them -- SIX PER CENT -- fit inside the
 * 128 KiB window a session tail is read with. The brief is the FIRST line of
 * the file and the current work is the LAST, so a tail alone would show 94 of
 * every 100 agents doing something with no sign of what they were asked.
 *
 * So: one read when the whole file fits, and two ends when it does not, with
 * `whole: false` saying out loud that the middle was not read. Never a walk of
 * the file -- a 46 MB agent costs exactly what a 40 KB one costs.
 *
 * ── ON DEMAND, NEVER ON THE POLL ─────────────────────────────────────────
 * `source.ts`'s budget is a 128 KiB tail per LIVE SESSION every ten seconds,
 * and a session here has up to 460 agent transcripts beside it. Reading them
 * on that poll is the exact cost that budget exists to refuse. This is asked
 * for by a person who opened a tab and picked a row -- the rule `history.ts`
 * states for scrolling back, and the reason both are separate channels.
 *
 * MAIN-PROCESS ONLY: it reads the filesystem.
 */

import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { SourceError } from '../../../renderer/sources/port.js';
import type { AgentWork } from '../../../shared/agent-work.js';
import { subagentsDirOf } from './agent-roster.js';
import { agentTurns } from './subagent.js';
import { readTranscriptWindow } from './window.js';

/**
 * How much of an agent transcript one end is read with. The same 128 KiB
 * `source.ts` spends on a session tail and `history.ts` on a page back, for
 * the same reason: it is the size at which a real transcript yields turns
 * without the read being felt.
 */
export const AGENT_WORK_WINDOW_BYTES = 128 * 1024;

/**
 * `refused` is vam declining to look -- an id that is not an agent's name.
 * `unreachable` is vam having looked and been unable to read. `port.ts` gives
 * the two arms and the distinction matters here: one is the caller's fault and
 * one is the disk's, and the pane says different sentences for them.
 */
const refused = (code: string, message: string): AgentWork => ({
  kind: 'unavailable',
  error: { kind: 'refused', code, message } satisfies SourceError,
});

const unreachable = (code: string, message: string): AgentWork => ({
  kind: 'unavailable',
  error: { kind: 'unreachable', code, message } satisfies SourceError,
});

/**
 * An agent id is a FILE NAME and nothing else.
 *
 * It arrives over IPC from a renderer, so it is checked rather than trusted:
 * `basename` collapses any path in it, and an id that is not identical to its
 * own basename was trying to be a path. That refuses `../secret` and
 * `/etc/hosts` alike, and it refuses them by DISAGREEMENT rather than by a
 * blocklist of the separators and escapes a caller might think of.
 *
 * THERE WAS A `.`-PREFIX CHECK HERE AND IT IS GONE, because mutating it away
 * changed no outcome: `basename('..')` is `'..'`, so those ids survive this
 * check anyway and go on to name `<subagents>/...jsonl`, a file inside the
 * directory that does not exist -- the read refuses them one line later and
 * for a better reason. A guard that cannot be made to fail is not protecting
 * anything, and keeping it would have implied `..` was dangerous here when the
 * basename check is what makes it harmless.
 */
function fileNameOf(agentId: string): string | null {
  if (agentId === '') return null;
  return basename(agentId) === agentId ? agentId : null;
}

/**
 * What one subagent was asked and what it has done.
 *
 * `transcriptPath` is the SESSION's transcript -- the same string `source.ts`
 * indexes and `readAgentRoster` walks beside -- because that is what names the
 * directory the agent lives in, and deriving it twice is one place too many
 * (`subagentsDirOf`).
 */
export async function readAgentWork(
  transcriptPath: string,
  agentId: string,
  windowBytes: number = AGENT_WORK_WINDOW_BYTES,
): Promise<AgentWork> {
  const name = fileNameOf(agentId);
  if (name === null) {
    return refused('agent:bad-id', 'that is not the name of an agent this session ran');
  }
  const path = join(subagentsDirOf(transcriptPath), `${name}.jsonl`);

  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return unreachable('agent:unreadable', 'vam could not open this agent’s transcript');
  }
  if (size === 0) {
    // A zero-byte transcript is a file that exists and says nothing. Drawing it
    // as "no turns" would put an agent on screen with an empty pane beside it
    // and no reason given; this says vam looked and there was nothing to read.
    return unreachable('agent:empty', 'this agent’s transcript is empty');
  }

  try {
    const tail = await readTranscriptWindow(path, size - windowBytes, size);
    const whole = tail.start === 0;
    const turns = agentTurns(tail.text, whole ? `${name}:all` : `${name}:tail`);
    if (whole) return { kind: 'work', turns, brief: null, whole: true };

    // THE OTHER END OF THE FILE, for the brief alone. Read second and kept
    // separate: joining the two would claim the agent went straight from its
    // brief to its newest turn, and `whole: false` is what says otherwise.
    const head = await readTranscriptWindow(path, 0, windowBytes);
    const opening = agentTurns(head.text, `${name}:head`)[0] ?? null;
    return { kind: 'work', turns, brief: opening, whole: false };
  } catch {
    return unreachable('agent:unreadable', 'vam could not read this agent’s transcript');
  }
}
