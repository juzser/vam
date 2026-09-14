/**
 * THE OPERATOR TALKS TO A SUBAGENT, AND THE SESSION'S OWN TRANSCRIPT NEVER
 * HEARS IT.
 *
 * Reported from use: the vam row for a live session showed an IN from hours
 * earlier. Measured, not inferred -- the session's own `.jsonl` had gone quiet
 * nine minutes before, and of the 43 text-bearing `user` lines in its last
 * 4 MB, ZERO were operator prompts: every one was a task notification, a meta
 * line or a CLI envelope. The operator's four most recent messages appeared in
 * that file exactly zero times. They were all in
 * `<sessionId>/subagents/agent-<id>.jsonl`, a directory `source.ts` deliberately
 * does not read.
 *
 * ── WHY THE SESSION PARSER CANNOT SIMPLY BE POINTED AT THAT FILE ──────────
 * It would get BOTH ends wrong, and this is the whole reason this module
 * exists rather than a wider window:
 *
 *   - The first `user` line of a subagent transcript is the TASK BRIEF, written
 *     by the parent agent. It is `isMeta: false` with no `promptSource`, which
 *     is exactly the shape `transcript.ts` classifies as an operator prompt --
 *     so the row would show a 7,000-character agent brief as the operator's
 *     own words.
 *   - The operator's real message arrives as `isMeta: true`, which
 *     `transcript.ts` EXCLUDES. So the one line that matters is the one line it
 *     would skip.
 *
 * ── THREE ENVELOPES, ONE OPERATOR ────────────────────────────────────────
 * Measured over a real 42 MB agent transcript, the `isMeta` user lines are of
 * exactly three kinds, and only the first is a person:
 *
 *   12x  "The user sent a new message while you were working: …"
 *    4x  "The coordinator sent a message while you were working: …"
 *    1x  "[SYSTEM NOTIFICATION - NOT USER INPUT] …"
 *
 * The second is another AGENT, and the third says what it is in its own first
 * four words. A row that showed either as the operator's prompt would be the
 * defect this repo keeps finding: two different things drawn as one.
 *
 * Every fixture below is invented. No line here came off a real transcript.
 */

import { describe, expect, it } from 'vitest';
import {
  agentTurnWins,
  MAX_LIVE_AGENTS_READ,
  OPERATOR_HANDOFF,
  operatorHandoff,
  ownPromptOf,
  readLiveAgentTurn,
  readOperatorTurn,
  scanAgentWindow,
} from '../../src/main/sources/claude-code/subagent.js';
import { readWindowOf } from '../../src/main/sources/claude-code/window.js';

const TRAILER =
  'This is how Claude Code surfaces messages the user sends mid-turn — within the running ' +
  'turn, often alongside the next tool result, rather than as a separate conversation turn. ' +
  'Address the message above as you continue this turn.';

/** The shape Claude Code really writes, reproduced with invented words. */
const handoff = (words: string) => `${OPERATOR_HANDOFF}\n${words}\n\n${TRAILER}`;

const userLine = (text: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'user',
    isSidechain: true,
    message: { role: 'user', content: [{ type: 'text', text }] },
    timestamp: '2026-01-01T00:00:00.000Z',
    ...over,
  });

const assistantLine = (text: string, at: string) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    timestamp: at,
  });

const toolLine = (name: string, at: string) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    message: { role: 'assistant', content: [{ type: 'tool_use', name, input: {} }] },
    timestamp: at,
  });

describe('operatorHandoff — which lines are the operator speaking', () => {
  it('takes the words out of a handoff and leaves the machinery behind', () => {
    expect(operatorHandoff(handoff('try the other ordering instead'))).toBe('try the other ordering instead');
  });

  it('keeps a multi-line message whole', () => {
    const words = '- the first of two things asked at once\n- and the second one under it';
    expect(operatorHandoff(handoff(words))).toBe(words);
  });

  /**
   * THE OTHER TWO ENVELOPES ARE NOT PEOPLE. A coordinator is an agent, and the
   * system notification says so in its own first four words. Showing either as
   * the operator's prompt would put another process's words in a row captioned
   * as the operator's.
   */
  it('refuses a message from another agent', () => {
    expect(
      operatorHandoff('The coordinator sent a message while you were working:\nGo ahead.'),
    ).toBeNull();
  });

  it('refuses a system notification', () => {
    expect(
      operatorHandoff('[SYSTEM NOTIFICATION - NOT USER INPUT]\nAn agent finished.'),
    ).toBeNull();
  });

  it('refuses a task brief, which is the parent agent writing', () => {
    expect(operatorHandoff('Two related dark-theme fixes in vam. Work ONLY in…')).toBeNull();
  });

  /**
   * ANCHORED AT THE START, NEVER MERELY CONTAINED -- and this is not a
   * hypothetical. While measuring this defect, a shell command whose output
   * quoted the envelope was recorded into the transcript as a tool result, and
   * a substring search reported five operator messages that did not exist. The
   * first structural run found one.
   */
  it('refuses a line that merely quotes the envelope', () => {
    const quoted = `I grepped for "${OPERATOR_HANDOFF}" and found five.`;
    expect(operatorHandoff(quoted)).toBeNull();
  });

  /**
   * THE SECOND LOCK, ON THE LINE'S SHAPE. Counted over all 869 agent
   * transcripts on this machine, 58 lines mention the envelope and only 44 are
   * really handoffs: 8 are `assistant` lines, 1 is an `attachment`, and 5 are
   * `type:'user'` lines WITHOUT `isMeta`. All 44 real ones carry
   * `isMeta: true` and a timestamp; none of the 14 impostors starts with the
   * envelope, so today either lock alone would hold -- which is exactly why
   * this one is tested rather than trusted.
   */
  it('refuses a handoff on a user line that is not marked meta', () => {
    const line = JSON.parse(
      userLine(handoff('not really from a person'), { isMeta: undefined }),
    ) as Record<string, unknown>;
    expect(scanAgentWindow(JSON.stringify(line)).prompt).toBeNull();
  });

  it('refuses a handoff carrying no words', () => {
    expect(operatorHandoff(`${OPERATOR_HANDOFF}\n\n${TRAILER}`)).toBeNull();
  });

  it('survives a handoff with no trailer at all', () => {
    expect(operatorHandoff(`${OPERATOR_HANDOFF}\njust this`)).toBe('just this');
  });
});

describe('scanAgentWindow — what one window of a subagent transcript says', () => {
  const window = [
    userLine('The task brief the parent wrote, which is not the operator.'),
    userLine(handoff('the first thing they said'), {
      isMeta: true,
      timestamp: '2026-01-01T10:00:00.000Z',
    }),
    assistantLine('answering the first', '2026-01-01T10:00:10.000Z'),
    userLine(handoff('the newest thing they said'), {
      isMeta: true,
      timestamp: '2026-01-01T11:00:00.000Z',
    }),
    toolLine('Bash', '2026-01-01T11:00:05.000Z'),
    assistantLine('the answer so far', '2026-01-01T11:00:20.000Z'),
  ].join('\n');

  it('takes the NEWEST handoff, not the first', () => {
    expect(scanAgentWindow(window).prompt).toBe('the newest thing they said');
  });

  it('carries when it was said, so a caller can compare it with the session', () => {
    expect(scanAgentWindow(window).at).toBe('2026-01-01T11:00:00.000Z');
  });

  /**
   * THE ANSWER BELONGS TO THAT PROMPT. `transcript.ts` learned this the
   * expensive way: showing turn N's prompt beside turn N+1's answer made every
   * turn in the pane describe the next one. Everything after the newest
   * handoff is that handoff's turn, so the newest assistant text IS its answer
   * -- and the answer to the OLDER handoff must not be what is shown.
   */
  it('answers with the text that came after it', () => {
    expect(scanAgentWindow(window).output).toBe('the answer so far');
  });

  it('reports the newest tool call as the activity', () => {
    expect(scanAgentWindow(window).activity).toBe('Bash');
  });

  it('is nothing for a background agent the operator never spoke to', () => {
    const quiet = [
      userLine('a task brief'),
      toolLine('Read', '2026-01-01T09:00:00.000Z'),
      assistantLine('done', '2026-01-01T09:01:00.000Z'),
    ].join('\n');
    expect(scanAgentWindow(quiet).prompt).toBeNull();
  });

  it('is nothing for an empty or unparseable window', () => {
    expect(scanAgentWindow('').prompt).toBeNull();
    expect(scanAgentWindow('{ not json\nalso not json').prompt).toBeNull();
  });

  /**
   * A HANDOFF WITH NOTHING AFTER IT is the common live case: the operator has
   * just spoken and the agent has not answered yet. The turn is still real --
   * it is exactly what the operator wants to see on the row -- and its answer
   * is honestly absent rather than borrowed from the turn before.
   */
  it('shows a prompt that has not been answered yet, with no answer', () => {
    const fresh = [
      assistantLine('older answer', '2026-01-01T10:00:00.000Z'),
      userLine(handoff('just asked'), { isMeta: true, timestamp: '2026-01-01T12:00:00.000Z' }),
    ].join('\n');
    const turn = scanAgentWindow(fresh);
    expect(turn.prompt).toBe('just asked');
    expect(turn.output).toBeNull();
  });
});

/**
 * THE BACKWARD SCAN, AND WHY THERE HAS TO BE ONE.
 *
 * Measured over all 869 subagent transcripts on this machine: exactly 2 carry
 * an operator handoff at all -- the operator rarely talks to an agent -- and
 * of those two, one has its newest handoff 4 KiB from the end and the other
 * has it 1,505,373 bytes back. A 128 KiB tail, which is what `source.ts`
 * spends on a session, finds ONE of the two. The one it misses is the reported
 * defect: an agent that has written a megabyte and a half of tool output since
 * the operator last spoke.
 *
 * So the tail is read first and the file is walked back only when the tail
 * does not answer -- and the walk LOCATES rather than parses, then stops at
 * the moment the session itself last heard from the operator, because nothing
 * older than that could beat what the session already shows.
 */
describe('readOperatorTurn — reaching back for a handoff the tail missed', () => {
  const source = (text: string) => {
    const bytes = Buffer.from(text, 'utf8');
    return {
      size: async () => bytes.length,
      read: async (from: number, to: number) => readWindowOf(bytes, from, to),
      reads: [] as number[],
    };
  };

  /** Filler an agent writes between the handoff and now: big, and not a handoff. */
  const filler = (n: number, at: string) =>
    Array.from({ length: n }, (_, i) => toolLine(`Read${i}`, at)).join('\n');

  it('finds a handoff that is inside the tail', async () => {
    const text = [
      userLine(handoff('inside the tail'), { isMeta: true, timestamp: '2026-01-01T10:00:00.000Z' }),
      assistantLine('the answer', '2026-01-01T10:00:05.000Z'),
    ].join('\n');
    const { turn } = await readOperatorTurn(source(text), null);
    expect(turn?.prompt).toBe('inside the tail');
    expect(turn?.output).toBe('the answer');
  });

  /**
   * THE REPORTED CASE, in miniature: the handoff is off the top of the tail
   * and everything since is tool noise. The prompt has to come from the walk
   * and the answer from the tail, because that is where each of them IS.
   */
  it('reaches a handoff buried behind more output than one window holds', async () => {
    const text = [
      userLine(handoff('buried behind the noise'), {
        isMeta: true,
        timestamp: '2026-01-01T10:00:00.000Z',
      }),
      filler(400, '2026-01-01T10:30:00.000Z'),
      assistantLine('still working on it', '2026-01-01T11:00:00.000Z'),
    ].join('\n');
    const { turn } = await readOperatorTurn(source(text), null, 2048, 1024 * 1024);
    expect(turn?.prompt).toBe('buried behind the noise');
    expect(turn?.at).toBe('2026-01-01T10:00:00.000Z');
    expect(turn?.output).toBe('still working on it');
  });

  /**
   * BOUNDED BY THE BUDGET. An agent the operator never spoke to is the common
   * case -- 867 of the 869 files here -- and it must not cost a walk of the
   * whole transcript on every ten-second poll.
   */
  it('gives up inside its budget rather than walking the whole file', async () => {
    const text = [
      userLine(handoff('too far back to be worth finding'), {
        isMeta: true,
        timestamp: '2026-01-01T10:00:00.000Z',
      }),
      filler(4000, '2026-01-01T10:30:00.000Z'),
    ].join('\n');
    expect((await readOperatorTurn(source(text), null, 2048, 8192)).turn).toBeNull();
  });

  /**
   * AND BOUNDED BY THE CLOCK, which is the bound that actually costs nothing:
   * the walk stops as soon as it is reading lines OLDER than the last thing
   * the session itself heard from the operator. A handoff older than that
   * cannot beat what the row already shows, so reading further back would be
   * spending I/O to lose a comparison.
   */
  it('stops walking once it is older than what the session already knows', async () => {
    const text = [
      userLine(handoff('said before the session heard from them'), {
        isMeta: true,
        timestamp: '2026-01-01T09:00:00.000Z',
      }),
      filler(400, '2026-01-01T09:30:00.000Z'),
      assistantLine('working', '2026-01-01T09:40:00.000Z'),
    ].join('\n');
    const horizon = '2026-01-01T10:00:00.000Z';
    expect((await readOperatorTurn(source(text), horizon, 2048, 1024 * 1024)).turn).toBeNull();
  });

  /**
   * THE PREFILTER IS A SUPERSET, AND THE WALK SURVIVES IT. A step back is
   * searched as raw text before it is parsed, so a tool result that merely
   * QUOTES the envelope matches -- which is exactly the false positive that
   * reported five operator messages during the diagnosis. It must cost a parse
   * and nothing else: the walk keeps going and finds the real one behind it.
   */
  it('walks past a tool result that only quotes the envelope', async () => {
    const text = [
      userLine(handoff('the real one, further back'), {
        isMeta: true,
        timestamp: '2026-01-01T10:00:00.000Z',
      }),
      filler(40, '2026-01-01T10:10:00.000Z'),
      assistantLine(
        `I grepped for "${OPERATOR_HANDOFF}" and found five.`,
        '2026-01-01T10:20:00.000Z',
      ),
      filler(40, '2026-01-01T10:30:00.000Z'),
    ].join('\n');
    const { turn } = await readOperatorTurn(source(text), null, 2048, 1024 * 1024);
    expect(turn?.prompt).toBe('the real one, further back');
  });

  /**
   * WHAT IT COSTS WHEN THE ANSWER IS NO, which is 867 of the 869 agent
   * transcripts here and therefore the number that actually matters. One
   * window, and the clock ends it -- not a walk of the file.
   */
  it('spends one window on an agent whose handoff is older than the session knows', async () => {
    const text = [
      userLine(handoff('old news'), { isMeta: true, timestamp: '2026-01-01T09:00:00.000Z' }),
      filler(400, '2026-01-01T09:30:00.000Z'),
    ].join('\n');
    const scan = await readOperatorTurn(
      source(text),
      '2026-01-01T10:00:00.000Z',
      2048,
      1024 * 1024,
    );
    expect(scan.turn).toBeNull();
    expect(scan.bytesRead).toBeLessThanOrEqual(2048);
  });

  /**
   * THE CLOCK STOPS THE WALK TOO, not only the first window. A busy agent can
   * fill several windows with output NEWER than the moment the session last
   * heard from the operator; the walk crosses into older ground a step or two
   * back, and that is where it has to stop -- having read part of the file and
   * not all of it.
   */
  it('stops mid-walk at the moment the session last heard from the operator', async () => {
    const text = [
      userLine(handoff('said before the session heard from them'), {
        isMeta: true,
        timestamp: '2026-01-01T09:00:00.000Z',
      }),
      filler(200, '2026-01-01T09:30:00.000Z'),
      filler(200, '2026-01-01T11:00:00.000Z'),
    ].join('\n');
    const whole = Buffer.byteLength(text, 'utf8');
    const scan = await readOperatorTurn(
      source(text),
      '2026-01-01T10:00:00.000Z',
      2048,
      1024 * 1024,
    );
    expect(scan.turn).toBeNull();
    expect(scan.bytesRead).toBeLessThan(whole);
  });

  /**
   * A WINDOW WITH NO LINE BOUNDARY IN IT MUST STILL ADVANCE -- AND BE SEEN TO.
   *
   * `trimToLineStart` answers an empty window whose start EQUALS its end when
   * the range holds no newline, which is what a JSONL line longer than one
   * window looks like from the back; agent transcripts are full of enormous
   * tool results. A walk that stepped to that start would step to where it
   * already was, and the first run of the budget test below HUNG there.
   *
   * Termination alone is too weak a thing to ask for, though, and this is the
   * second version of this test: once the byte count was fixed, a walk that
   * never advanced still ENDED -- by burning the whole budget one window at a
   * time, and the mutation that reintroduced it passed. The bound that says it
   * moved is that it spent no more than there is to spend.
   */
  it('never reads more bytes than the transcript holds', async () => {
    const one = userLine(`a tool result of ${'x'.repeat(4000)}`);
    const scan = await readOperatorTurn(source(one), null, 64, 1024 * 1024);
    expect(scan.turn).toBeNull();
    expect(scan.bytesRead).toBeLessThanOrEqual(Buffer.byteLength(one, 'utf8') + 64);
  });

  it('is nothing for an empty transcript', async () => {
    expect(await readOperatorTurn(source(''), null)).toEqual({ turn: null, bytesRead: 0 });
  });

  /**
   * A READ THAT THROWS COSTS THIS AGENT AND NOTHING ELSE -- the rule
   * `agent-roster.ts` states for the directory beside it. The session is live
   * and the operator must still see its row.
   */
  it('answers nothing when the transcript cannot be read', async () => {
    const broken = {
      size: async () => 4096,
      read: async () => {
        throw new Error('gone');
      },
    };
    expect(await readOperatorTurn(broken, null)).toEqual({ turn: null, bytesRead: 0 });
  });
});

/**
 * WHICH OF THE TWO THE ROW SHOWS.
 *
 * The rule the operator approved: the row shows the newest thing THE OPERATOR
 * said in this session, wherever they said it. So an agent's turn has to beat
 * the session's own on the clock, and "cannot tell" loses -- a session's own
 * prompt is never displaced by something that merely might be newer.
 */
describe('agentTurnWins — the agent turn never costs the session its own prompt', () => {
  const turn = (at: string) => ({ prompt: 'p', at, output: null, activity: null, latestAt: null });

  it('wins when the operator said it after the session last heard from them', () => {
    expect(
      agentTurnWins(
        { present: true, at: '2026-01-01T10:00:00.000Z' },
        turn('2026-01-01T11:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('loses to a session prompt that is newer', () => {
    expect(
      agentTurnWins(
        { present: true, at: '2026-01-01T12:00:00.000Z' },
        turn('2026-01-01T11:00:00.000Z'),
      ),
    ).toBe(false);
  });

  /**
   * THE REPORTED CASE. Measured on the real transcript: of the 43 text-bearing
   * `user` lines in the session's last 4 MB, ZERO were operator prompts, so
   * the session had nothing of its own to lose -- and an agent turn is then
   * strictly better than the hours-old marker the row was showing.
   */
  it('wins when the session has no operator prompt of its own at all', () => {
    expect(agentTurnWins({ present: false, at: null }, turn('2026-01-01T11:00:00.000Z'))).toBe(
      true,
    );
  });

  /**
   * CANNOT TELL, SO DOES NOT TOUCH IT. A turn opened by `last-prompt` alone
   * carries no clock -- 0 of 25,259 of those lines have a timestamp
   * (`transcript.ts`) -- and displacing a prompt whose age is unknown would be
   * guessing with the operator's own words.
   */
  it('loses to a session prompt whose time is unknown', () => {
    expect(agentTurnWins({ present: true, at: null }, turn('2026-01-01T11:00:00.000Z'))).toBe(
      false,
    );
  });

  it('loses when its own time is unreadable', () => {
    expect(agentTurnWins({ present: false, at: null }, turn(''))).toBe(false);
    expect(agentTurnWins({ present: false, at: null }, turn('not a date'))).toBe(false);
  });
});

/**
 * SEVERAL AGENTS AT ONCE, AND NO ARBITRATION BETWEEN THEM.
 *
 * Bucketing every agent mtime on this machine into five-minute windows puts
 * the busiest moment any session ever had at 5 concurrent agents. The rule
 * needs no tie-break for them: a person can only have spoken last once, so
 * the newest operator message wins and the row changes only when the operator
 * speaks -- never because two agents are writing concurrently.
 */
describe('readLiveAgentTurn — several live agents, one shared budget', () => {
  const sourceOf = (text: string) => {
    const bytes = Buffer.from(text, 'utf8');
    return {
      size: async () => bytes.length,
      read: async (f: number, t: number) => readWindowOf(bytes, f, t),
    };
  };
  const spoke = (words: string, at: string) =>
    sourceOf(userLine(handoff(words), { isMeta: true, timestamp: at }));

  const quiet = sourceOf(userLine('a task brief nobody answered'));
  const files: Record<string, ReturnType<typeof sourceOf>> = {
    older: spoke('the older ask', '2026-01-01T10:00:00.000Z'),
    newer: spoke('the newer ask', '2026-01-01T11:00:00.000Z'),
    quiet,
  };
  const sourceFor = (id: string) => files[id] ?? quiet;

  it('takes the newest thing the operator said, whichever agent heard it', async () => {
    const turn = await readLiveAgentTurn(['older', 'newer'], sourceFor, {
      present: false,
      at: null,
    });
    expect(turn?.prompt).toBe('the newer ask');
  });

  it('does not care which order the agents arrive in', async () => {
    const turn = await readLiveAgentTurn(['newer', 'older'], sourceFor, {
      present: false,
      at: null,
    });
    expect(turn?.prompt).toBe('the newer ask');
  });

  it('leaves the row alone when the session itself heard something newer', async () => {
    const own = { present: true, at: '2026-01-01T12:00:00.000Z' };
    expect(await readLiveAgentTurn(['older', 'newer'], sourceFor, own)).toBeNull();
  });

  it('is nothing for a session with no live agent at all', async () => {
    expect(await readLiveAgentTurn([], sourceFor, { present: false, at: null })).toBeNull();
  });

  it('is nothing when no live agent was ever spoken to', async () => {
    expect(await readLiveAgentTurn(['quiet'], sourceFor, { present: false, at: null })).toBeNull();
  });

  /**
   * ONE BUDGET BETWEEN THEM. A session running six agents must not cost six
   * times a session running one, so an exhausted budget stops the walk -- and
   * what it skips is always the least recently written agent.
   */
  it('stops opening agents once the shared budget is gone', async () => {
    const opened: string[] = [];
    const costly = (id: string) => {
      opened.push(id);
      return sourceOf(userLine(`filler for ${id} ${'y'.repeat(2000)}`));
    };
    const many = Array.from({ length: 12 }, (_, i) => `a${i}`);
    await readLiveAgentTurn(many, costly, { present: false, at: null }, 256, 512);
    expect(opened.length).toBeLessThanOrEqual(2);
  });

  /**
   * AND A CAP ON TOP OF IT, because the budget cannot bound what costs
   * nothing: a directory of empty or vanished agent transcripts would
   * otherwise be opened all the way down. The busiest moment any session on
   * this machine ever had was 5 concurrent agents -- bucketing all 869 agent
   * mtimes into five-minute windows -- so six opens covers it.
   */
  it('opens no more than its cap even when every agent is free to read', async () => {
    const opened: string[] = [];
    const free = (id: string) => {
      opened.push(id);
      return { size: async () => 0, read: async () => ({ text: '', start: 0 }) };
    };
    const many = Array.from({ length: 12 }, (_, i) => `a${i}`);
    await readLiveAgentTurn(many, free, { present: false, at: null }, 64, 1024 * 1024);
    expect(opened).toHaveLength(MAX_LIVE_AGENTS_READ);
  });
});

/**
 * WHEN THE SESSION CANNOT SAY WHEN IT WAS ASKED.
 *
 * `transcript.ts` leaves `promptedAt` null for a turn that `last-prompt`
 * opened alone -- the operator's own `user` line is above the top of the
 * 128 KiB window -- because that marker carries no clock at all (0 of 25,259
 * measured). Refusing to compare in that case looked like the careful choice
 * and was measured to be the inert one: of the 69 sessions on this machine
 * whose tail holds a turn, 40 carry a dated newest prompt and 29 do NOT, and
 * the single session with a live agent at the moment of measuring was one of
 * the 29. The fix would have done nothing for the case that reported it.
 *
 * So the fallback is `latestAt`, the newest thing that turn recorded. A prompt
 * precedes its own turn's steps, so this is an UPPER bound on when it was
 * asked -- which makes the agent's message clear a HIGHER bar, not a lower
 * one. It can only refuse a turn that deserved to win; it can never promote
 * one that did not. All 29 of the undated turns carry it.
 */
describe('ownPromptOf — what the session says about its own newest ask', () => {
  const facts = (decisions: unknown[]) =>
    ({ aiTitle: null, branch: null, activity: null, questions: [], decisions }) as never;
  const turn = (over: Record<string, unknown>) => ({
    id: 'd1',
    label: 'claude-code',
    input: 'x',
    output: null,
    commands: [],
    ...over,
  });

  it('uses the moment the operator asked, when the source recorded one', () => {
    expect(
      ownPromptOf(
        facts([
          turn({ promptedAt: '2026-01-01T10:00:00.000Z', latestAt: '2026-01-01T11:00:00.000Z' }),
        ]),
      ),
    ).toEqual({ present: true, at: '2026-01-01T10:00:00.000Z' });
  });

  it('falls back to the newest step of that turn when it did not', () => {
    expect(
      ownPromptOf(facts([turn({ promptedAt: null, latestAt: '2026-01-01T11:00:00.000Z' })])),
    ).toEqual({ present: true, at: '2026-01-01T11:00:00.000Z' });
  });

  it('has nothing to compare when the turn carries neither clock', () => {
    expect(ownPromptOf(facts([turn({ promptedAt: null, latestAt: null })]))).toEqual({
      present: true,
      at: null,
    });
  });

  it('is absent, not undated, for a session with no turn at all', () => {
    expect(ownPromptOf(facts([]))).toEqual({ present: false, at: null });
  });

  /** Only the NEWEST turn decides it -- the ones under it are already older. */
  it('reads the newest turn and not the ones beneath it', () => {
    expect(
      ownPromptOf(
        facts([
          turn({ promptedAt: null, latestAt: '2026-01-01T11:00:00.000Z' }),
          turn({ promptedAt: '2026-01-01T08:00:00.000Z', latestAt: '2026-01-01T09:00:00.000Z' }),
        ]),
      ).at,
    ).toBe('2026-01-01T11:00:00.000Z');
  });
});
