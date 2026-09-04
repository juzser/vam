/**
 * Turning the TAIL of one Claude Code transcript into the few facts the canvas
 * draws: the branch, the newest turns, the current tool call, and a fallback
 * name.
 *
 * Pure -- it is handed a string and returns data -- so every rule below is
 * testable against a fixture instead of against the operator's home
 * directory. The file walk and the byte budget live in `source.ts`.
 *
 * IT DERIVES NO STATUS. It used to: mtime plus the shape of the last message
 * gave a plausible-looking `running`/`waiting`, and it was a guess. The CLI
 * knows which processes are alive, so status comes from `agents.ts` and this
 * module does not offer a second opinion that could disagree with it.
 *
 * WHY ONLY A TAIL. A transcript is an append-only JSONL log and the operator's
 * largest is 165 MB / 75k lines. Nothing here needs the beginning: the branch,
 * the title, the newest turns and the current tool call are all re-stated near
 * the end. So this function is written to work on a byte suffix and to
 * tolerate the consequences of one -- a first line cut mid-token, and a window
 * that may open in the middle of a turn whose prompt is off-screen.
 *
 * The type-only import of the renderer's model is required: main may name the
 * renderer's types, never load its code.
 */

import type { Decision } from '../../../renderer/domain/model.js';
import { extractCommands } from './commands.js';

/** The canvas shows three; carrying more costs parsing and buys nothing. */
const MAX_DECISIONS = 3;

/** One line's worth of meaning, per `Session.activity`. */
const ACTIVITY_LIMIT = 80;

export type TranscriptFacts = {
  /** The generated session title, used only when the CLI reports no name. */
  readonly aiTitle: string | null;
  readonly branch: string | null;
  /** The newest tool call, for the activity line. */
  readonly activity: string | null;
  /** Newest first, at most `MAX_DECISIONS`. */
  readonly decisions: readonly Decision[];
};

export const EMPTY_FACTS: TranscriptFacts = {
  aiTitle: null,
  branch: null,
  activity: null,
  decisions: [],
};

type Line = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function parseLines(tail: string): Line[] {
  const out: Line[] = [];
  // The first line of a byte suffix is almost always a fragment. It is not
  // special-cased -- it simply fails to parse, like any other damaged line.
  for (const raw of tail.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === 'object' && value !== null) out.push(value as Line);
    } catch {
      // A partial or non-JSON line is data we do not have, not an error.
    }
  }
  return out;
}

/** The `{type:'text'}` parts of a message, joined; `null` if it has none. */
function messageText(line: Line): string | null {
  const message = line['message'];
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Line)['content'];
  if (typeof content === 'string') return str(content);
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((p): p is Line => typeof p === 'object' && p !== null)
    .filter((p) => p['type'] === 'text')
    .map((p) => str(p['text']) ?? '')
    .join('\n')
    .trim();
  return text === '' ? null : text;
}

/** The first `{type:'tool_use'}` part of an assistant message, if any. */
function toolUse(line: Line): string | null {
  const message = line['message'];
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Line)['content'];
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Line;
    if (p['type'] !== 'tool_use') continue;
    const input = p['input'];
    const description =
      typeof input === 'object' && input !== null ? str((input as Line)['description']) : null;
    const name = str(p['name']) ?? 'tool';
    return `${name}${description === null ? '' : `: ${description}`}`.slice(0, ACTIVITY_LIMIT);
  }
  return null;
}

/** `2m`, `6h`, `3d` -- the compact form the sidebar right-aligns. */
export function compactAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function summarizeTranscript(tail: string, decisionIdPrefix: string): TranscriptFacts {
  const lines = parseLines(tail);

  let branch: string | null = null;
  let aiTitle: string | null = null;
  let agentName: string | null = null;
  let activity: string | null = null;

  // Turns, oldest first. A prompt opens one; every later assistant text
  // overwrites that turn's answer, so what survives is the LAST thing the
  // session said before the operator spoke again -- its final response for
  // that turn, which is what `Decision.output` is defined to be. vam cannot
  // tell an interim narration from a final answer inside a turn still in
  // flight; it shows the newest text and lets `status` carry "still working".
  const turns: { input: string; output: string | null }[] = [];

  for (const line of lines) {
    branch = str(line['gitBranch']) ?? branch;

    const type = line['type'];
    if (type === 'ai-title') aiTitle = str(line['aiTitle']) ?? aiTitle;
    else if (type === 'agent-name') agentName = str(line['agentName']) ?? agentName;
    else if (type === 'last-prompt') {
      const prompt = str(line['lastPrompt']);
      // Re-emitted on every resume, so an unchanged value is the same turn.
      if (prompt !== null && turns.at(-1)?.input !== prompt) {
        turns.push({ input: prompt, output: null });
      }
    } else if (type === 'assistant') {
      const text = messageText(line);
      if (text !== null) {
        const open = turns.at(-1);
        if (open !== undefined) turns[turns.length - 1] = { ...open, output: text };
      }
      activity = toolUse(line) ?? activity;
    }
  }

  const decisions: readonly Decision[] = turns
    .slice(-MAX_DECISIONS)
    .reverse()
    .map((turn, index) => {
      const id = `${decisionIdPrefix}:${index}`;
      return {
        id,
        label: agentName ?? 'claude-code',
        input: turn.input,
        output: turn.output,
        // Claude Code hands commands back as prose inside an answer, not as
        // structured data, so `commands.ts` reads the fenced blocks of that
        // answer under a rule tuned to accept nothing it cannot vouch for.
        // The prefix is the decision's OWN id, so no two decisions mint the
        // same command id -- the canvas finds a command by id to copy it.
        commands: turn.output === null ? [] : extractCommands(turn.output, id),
      };
    });

  return { aiTitle, branch, activity, decisions };
}
