/**
 * Turning the TAIL of one Claude Code transcript into one `Session`.
 *
 * Pure: it is handed a string and returns data, so every rule below is
 * testable against a fixture instead of against the operator's home
 * directory. The file walk, the byte budget and the clock all live in
 * `source.ts`.
 *
 * WHY ONLY A TAIL. A transcript is an append-only JSONL log and the operator's
 * largest is 165 MB / 75k lines. Nothing the canvas draws needs the beginning:
 * the working directory, the branch, the title, the newest turns and the
 * current tool call are all re-stated near the end. So this function is
 * written to work on a suffix and to tolerate the consequences of one --
 * a first line cut mid-token, and a window that may open in the middle of a
 * turn whose prompt is off-screen.
 *
 * The type-only import of the renderer's model is deliberate and required:
 * main may name the renderer's types, never load its code.
 */

import type { Decision, Session, SessionStatus } from '../../../renderer/domain/model.js';

export type TranscriptContext = {
  /** Used as the session id when the tail carries none. */
  readonly fallbackId: string;
  readonly mtimeMs: number;
  readonly nowMs: number;
  readonly runningAgents: number;
};

export type TranscriptSummary = {
  /** The real working directory, which groups sessions into a project. */
  readonly cwd: string | null;
  readonly session: Session;
};

/**
 * How recently the file must have been written for `running` to be credible.
 *
 * A transcript records no session end -- a process killed mid-tool-call
 * leaves a file byte-identical to one whose tool is still executing -- so
 * "mid-turn" alone would report a session abandoned three weeks ago as
 * running forever. Five minutes is generous for a long build and short
 * enough that yesterday's corpse is not green.
 */
const RUNNING_WINDOW_MS = 5 * 60_000;

/** The canvas shows three; carrying more costs parsing and buys nothing. */
const MAX_DECISIONS = 3;

/** One line's worth of meaning, per `Session.activity`. */
const ACTIVITY_LIMIT = 80;

type Line = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function parseLines(tail: string): Line[] {
  const out: Line[] = [];
  // The first line of a byte-suffix is almost always a fragment. It is not
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

/** The newest `{type:'tool_use'}` part of an assistant message, if any. */
function toolUse(line: Line): { name: string; description: string | null } | null {
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
    return { name: str(p['name']) ?? 'tool', description };
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

export function summarizeTranscript(
  tail: string,
  ctx: TranscriptContext,
): TranscriptSummary | null {
  const lines = parseLines(tail);
  if (lines.length === 0) return null;

  let cwd: string | null = null;
  let branch: string | null = null;
  let sessionId: string | null = null;
  let aiTitle: string | null = null;
  let customTitle: string | null = null;
  let agentName: string | null = null;
  let apiErrored = false;
  let midTurn = false;
  let activity: string | null = null;

  // Turns, oldest first. A prompt opens one; every later assistant text
  // overwrites that turn's answer, so what survives is the LAST thing the
  // session said before the operator spoke again -- its final response for
  // that turn, which is what `Decision.output` is defined to be.
  const turns: { input: string; output: string | null }[] = [];

  for (const line of lines) {
    cwd = str(line['cwd']) ?? cwd;
    branch = str(line['gitBranch']) ?? branch;
    sessionId = str(line['sessionId']) ?? sessionId;

    const type = line['type'];
    if (type === 'ai-title') aiTitle = str(line['aiTitle']) ?? aiTitle;
    else if (type === 'custom-title') customTitle = str(line['customTitle']) ?? customTitle;
    else if (type === 'agent-name') agentName = str(line['agentName']) ?? agentName;
    else if (type === 'last-prompt') {
      const prompt = str(line['lastPrompt']);
      // Re-emitted on every resume, so an unchanged value is the same turn.
      if (prompt !== null && turns.at(-1)?.input !== prompt) {
        turns.push({ input: prompt, output: null });
      }
    } else if (type === 'assistant') {
      apiErrored = line['isApiErrorMessage'] === true;
      const text = messageText(line);
      const tool = toolUse(line);
      if (text !== null) {
        const open = turns.at(-1);
        if (open !== undefined) turns[turns.length - 1] = { ...open, output: text };
      }
      // Whether the session owes itself the next move. A tool call is the
      // last word only until its result arrives; a plain answer ends the turn.
      midTurn = tool !== null;
      activity =
        tool === null
          ? null
          : `${tool.name}${tool.description === null ? '' : `: ${tool.description}`}`.slice(
              0,
              ACTIVITY_LIMIT,
            );
    } else if (type === 'user') {
      // A tool result: the ball is back with the model, still inside the turn.
      if (messageText(line) === null) midTurn = true;
    }
  }

  const fresh = ctx.nowMs - ctx.mtimeMs <= RUNNING_WINDOW_MS;
  /**
   * The status rule, and what it cannot see.
   *
   *  - `failed`   the newest assistant line is an API error. Narrow on
   *               purpose: a failing *command* inside a session is normal
   *               work, not a failed session.
   *  - `running`  the transcript stops mid-turn AND was written within
   *               `RUNNING_WINDOW_MS`.
   *  - `waiting`  everything else. Correct by the model's own definition --
   *               "the ball is with you" -- for a finished answer and for a
   *               turn abandoned mid-tool-call alike: in both, only the
   *               operator can move next.
   *  - `done`     NEVER EMITTED. Claude Code writes no end-of-session record,
   *               so a transcript the operator finished and one they walked
   *               away from are byte-identical. Rather than infer closure
   *               from staleness -- which would mark every old session done
   *               and quietly hide real unfinished work -- this source
   *               collapses `done` into `waiting` and says so here.
   *
   * Failure modes, stated rather than hidden: a session whose tool has run
   * for longer than the window reads `waiting` while it is genuinely running;
   * a session interrupted seconds ago reads `running` for five minutes after
   * it died; and a model that answers and then stops without a tool call is
   * indistinguishable from one that finished the whole task.
   */
  const status: SessionStatus = apiErrored ? 'failed' : midTurn && fresh ? 'running' : 'waiting';

  const id = sessionId ?? ctx.fallbackId;
  const decisions: readonly Decision[] = turns
    .slice(-MAX_DECISIONS)
    .reverse()
    .map((turn, index) => ({
      id: `${id}:${index}`,
      label: agentName ?? 'claude-code',
      input: turn.input,
      output: turn.output,
      // Claude Code hands commands back as prose inside an answer, not as
      // structured data, and guessing which fenced block is meant for a human
      // to run would put words in the agent's mouth.
      commands: [],
    }));

  return {
    cwd,
    session: {
      id,
      title: customTitle ?? aiTitle ?? id,
      icon: null,
      // The branch is the second label: it is what actually distinguishes two
      // sessions on the same project at a glance.
      epic: branch,
      status,
      runningAgents: status === 'running' ? ctx.runningAgents : 0,
      activity: status === 'running' ? activity : null,
      age: compactAge(ctx.nowMs - ctx.mtimeMs),
      decisions,
      source: 'claude-code',
      // A transcript at the top of a project directory is one a PERSON
      // opened -- agent traffic lives in `<sessionId>/subagents/`, which this
      // source never turns into a row. So `human` is a fact here, not a
      // default, and the sidebar's hide-agent-made filter keeps these visible.
      // `promptCount` stays null: a tail cannot count a whole session's turns,
      // and a partial count would read as a true one.
      origin: { startedBy: 'human', promptCount: null },
    },
  };
}
