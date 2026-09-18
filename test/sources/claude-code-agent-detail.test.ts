/**
 * WHAT ONE SUBAGENT IS DOING, for the Agents pane's detail side.
 *
 * The Agents tab used to be a flat list of rows -- a dot, a type and a
 * description -- and the operator asked for the list to become a navigator
 * with the selected agent's work beside it, "with in/out/progress". That is
 * the same three things a session's turn carries, so this produces `Decision`s
 * and the pane reuses the turn renderer it already has.
 *
 * ── WHY `transcript.ts` CANNOT BE POINTED AT AN AGENT FILE ────────────────
 * Measured before this was written, over 250 of the 872 subagent transcripts
 * on this machine: ZERO contain a `type:'last-prompt'` line, and
 * `summarizeTranscript` returns ZERO turns for all 250 of them. That is not a
 * bug in it -- a turn there is opened by the operator's line and NAMED by the
 * marker that follows, and an agent's thread has no markers at all, so every
 * turn it opens is correctly dropped as unnamed. Reusing it would have drawn
 * an empty pane for every agent on the machine.
 *
 * So a turn HERE is opened by what was said TO the agent, and there are
 * exactly two kinds of that:
 *
 *   - the TASK BRIEF, the first `user` line, written by the parent that
 *     spawned it;
 *   - an OPERATOR HANDOFF, `isMeta: true`, which is the person speaking
 *     mid-turn (`subagent.ts` says how those are told apart from the two other
 *     envelopes that look like them).
 *
 * Every fixture below is invented. No line here came off a real transcript.
 */

import { describe, expect, it } from 'vitest';
import { agentTurns, OPERATOR_HANDOFF } from '../../src/main/sources/claude-code/subagent.js';

const TRAILER =
  'This is how Claude Code surfaces messages the user sends mid-turn — within the running ' +
  'turn, often alongside the next tool result, rather than as a separate conversation turn. ' +
  'Address the message above as you continue this turn.';

const handoff = (words: string) => `${OPERATOR_HANDOFF}\n${words}\n\n${TRAILER}`;

const brief = (text: string, at = '2026-01-01T10:00:00.000Z') =>
  JSON.stringify({
    type: 'user',
    isSidechain: true,
    timestamp: at,
    message: { role: 'user', content: [{ type: 'text', text }] },
  });

const fromOperator = (words: string, at: string) =>
  JSON.stringify({
    type: 'user',
    isMeta: true,
    isSidechain: true,
    timestamp: at,
    message: { role: 'user', content: [{ type: 'text', text: handoff(words) }] },
  });

const said = (text: string, at: string) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    timestamp: at,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });

const called = (name: string, at: string, id = 'tu-1', description?: string) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    timestamp: at,
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id, name, input: description === undefined ? {} : { description } },
      ],
    },
  });

const result = (id: string, failed: boolean) =>
  JSON.stringify({
    type: 'user',
    isSidechain: true,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: 'x' }],
    },
  });

describe('agentTurns — the work of one subagent, as turns', () => {
  it('opens the first turn on the brief the parent wrote', () => {
    const turns = agentTurns(brief('Find every caller of this function.'), 'a1');
    expect(turns).toHaveLength(1);
    expect(turns[0]?.input).toBe('Find every caller of this function.');
  });

  /**
   * THE OPERATOR'S OWN MESSAGE OPENS ONE TOO. It is the only other thing ever
   * said TO an agent, and an Agents pane that dropped it would be missing the
   * half of the conversation the operator is most likely looking for.
   */
  it('opens a turn on what the operator said mid-run', () => {
    const turns = agentTurns(
      [brief('the brief'), fromOperator('do the other one first', '2026-01-01T11:00:00.000Z')].join(
        '\n',
      ),
      'a1',
    );
    expect(turns.map((t) => t.input)).toEqual(['the brief', 'do the other one first']);
  });

  /**
   * OLDEST FIRST, like `TranscriptPage`'s turns and unlike a session row's
   * `decisions`. The pane reads top to bottom: a brief, then what happened.
   */
  it('reports turns oldest first', () => {
    const turns = agentTurns(
      [
        brief('the brief'),
        fromOperator('second', '2026-01-01T11:00:00.000Z'),
        fromOperator('third', '2026-01-01T12:00:00.000Z'),
      ].join('\n'),
      'a1',
    );
    expect(turns.map((t) => t.input)).toEqual(['the brief', 'second', 'third']);
  });

  it('answers a turn with the last thing said inside it', () => {
    const turns = agentTurns(
      [
        brief('the brief'),
        said('thinking about it', '2026-01-01T10:01:00.000Z'),
        said('here is the answer', '2026-01-01T10:02:00.000Z'),
      ].join('\n'),
      'a1',
    );
    expect(turns[0]?.output).toBe('here is the answer');
  });

  /**
   * AND AN ANSWER BELONGS TO THE TURN THAT WAS OPEN. `transcript.ts` learned
   * this the expensive way: a turn shown beside the next turn's answer makes
   * every turn in the pane describe the one after it.
   */
  it('does not let one turn answer for the turn before it', () => {
    const turns = agentTurns(
      [
        brief('the brief'),
        said('answering the brief', '2026-01-01T10:01:00.000Z'),
        fromOperator('now do this', '2026-01-01T11:00:00.000Z'),
        said('answering the operator', '2026-01-01T11:01:00.000Z'),
      ].join('\n'),
      'a1',
    );
    expect(turns.map((t) => t.output)).toEqual(['answering the brief', 'answering the operator']);
  });

  it('is still a turn while nothing has answered it yet', () => {
    const turns = agentTurns(
      [brief('the brief'), fromOperator('just asked', '2026-01-01T11:00:00.000Z')].join('\n'),
      'a1',
    );
    expect(turns[1]?.output).toBeNull();
  });

  describe('the progress under a turn', () => {
    it('lists the calls a turn made, oldest first, named as the tool named them', () => {
      const turns = agentTurns(
        [
          brief('the brief'),
          called('Read', '2026-01-01T10:01:00.000Z', 'tu-1'),
          called('Bash', '2026-01-01T10:02:00.000Z', 'tu-2', 'run the tests'),
        ].join('\n'),
        'a1',
      );
      expect(turns[0]?.steps?.map((s) => s.label)).toEqual(['Read', 'Bash: run the tests']);
    });

    it('charges a call to the turn that was open when it was made', () => {
      const turns = agentTurns(
        [
          brief('the brief'),
          called('Read', '2026-01-01T10:01:00.000Z', 'tu-1'),
          fromOperator('now this', '2026-01-01T11:00:00.000Z'),
          called('Grep', '2026-01-01T11:01:00.000Z', 'tu-2'),
        ].join('\n'),
        'a1',
      );
      expect(turns.map((t) => t.steps?.map((s) => s.label))).toEqual([['Read'], ['Grep']]);
    });

    /**
     * READ, NOT INFERRED, and `=== true` rather than truthy -- the rule
     * `model.ts` states for `TurnStep.failed`, because a false failure badge is
     * worse than none.
     */
    it('marks the call whose result came back an error, and only that one', () => {
      const turns = agentTurns(
        [
          brief('the brief'),
          called('Read', '2026-01-01T10:01:00.000Z', 'tu-1'),
          called('Bash', '2026-01-01T10:02:00.000Z', 'tu-2'),
          result('tu-2', true),
        ].join('\n'),
        'a1',
      );
      expect(turns[0]?.steps?.map((s) => s.failed)).toEqual([false, true]);
    });

    it('counts the failures of the turn that was open', () => {
      const turns = agentTurns(
        [
          brief('the brief'),
          called('Bash', '2026-01-01T10:01:00.000Z', 'tu-1'),
          result('tu-1', true),
        ].join('\n'),
        'a1',
      );
      expect(turns[0]?.errorCount).toBe(1);
    });

    /**
     * ZERO IS A READING. `model.ts` reserves absence for a source that cannot
     * report a thing -- this one can look, so it always answers.
     */
    it('answers zero failures and an empty list rather than nothing at all', () => {
      const turns = agentTurns(brief('the brief'), 'a1');
      expect(turns[0]?.errorCount).toBe(0);
      expect(turns[0]?.steps).toEqual([]);
    });

    /**
     * A TOOL RESULT IS NOT A TURN BOUNDARY EVEN IF IT LEARNS TO TALK.
     *
     * Today the shape below does not occur: measured over 120 agent
     * transcripts, all 4,676 `user` lines carrying a `tool_result` carry NO
     * text part beside it, so the empty-text check alone would hold and this
     * guard would be dead. It is kept live by this test because the day a
     * result arrives with a sentence attached, the failure is not a missing
     * row -- it is a tool's output drawn as something the operator said.
     */
    it('is not a boundary even when a result carries text beside it', () => {
      const talkative = JSON.stringify({
        type: 'user',
        isSidechain: true,
        timestamp: '2026-01-01T10:02:00.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu-1', is_error: false, content: 'x' },
            { type: 'text', text: 'and a sentence the tool attached' },
          ],
        },
      });
      const turns = agentTurns(
        [brief('the brief'), called('Read', '2026-01-01T10:01:00.000Z', 'tu-1'), talkative].join(
          '\n',
        ),
        'a1',
      );
      expect(turns).toHaveLength(1);
    });

    /** A tool result is not a turn boundary -- it is the answer to a call. */
    it('does not open a turn on a tool result', () => {
      const turns = agentTurns(
        [
          brief('the brief'),
          called('Read', '2026-01-01T10:01:00.000Z', 'tu-1'),
          result('tu-1', false),
        ].join('\n'),
        'a1',
      );
      expect(turns).toHaveLength(1);
    });
  });

  describe('the clocks and the ids', () => {
    it('carries when the turn was asked and when it last did anything', () => {
      const turns = agentTurns(
        [
          brief('the brief', '2026-01-01T10:00:00.000Z'),
          said('done', '2026-01-01T10:05:00.000Z'),
        ].join('\n'),
        'a1',
      );
      expect(turns[0]?.promptedAt).toBe('2026-01-01T10:00:00.000Z');
      expect(turns[0]?.latestAt).toBe('2026-01-01T10:05:00.000Z');
    });

    it('gives every turn an id of its own, and every step one inside it', () => {
      const turns = agentTurns(
        [
          brief('the brief'),
          called('Read', '2026-01-01T10:01:00.000Z', 'tu-1'),
          fromOperator('next', '2026-01-01T11:00:00.000Z'),
          called('Read', '2026-01-01T11:01:00.000Z', 'tu-1'),
        ].join('\n'),
        'a1',
      );
      const ids = [
        ...turns.map((t) => t.id),
        ...turns.flatMap((t) => t.steps ?? []).map((s) => s.id),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });

    /**
     * THE SAME CALL ID TWICE IS THE PROVIDER'S BUSINESS, NOT A KEY. `model.ts`
     * says why a step is keyed on its position and not on `tool_use.id`: a list
     * keyed on a value vam does not mint collapses two rows the day one
     * repeats, and the fixture above repeats one deliberately.
     */
    it('keeps two rows when the provider reuses a call id', () => {
      const turns = agentTurns(
        [
          brief('the brief'),
          called('Read', '2026-01-01T10:01:00.000Z', 'tu-1'),
          called('Read', '2026-01-01T10:02:00.000Z', 'tu-1'),
        ].join('\n'),
        'a1',
      );
      expect(turns[0]?.steps).toHaveLength(2);
    });
  });

  describe('what it refuses to draw', () => {
    it('is nothing for an empty or unparseable window', () => {
      expect(agentTurns('', 'a1')).toEqual([]);
      expect(agentTurns('{ not json\nalso not json', 'a1')).toEqual([]);
    });

    /**
     * A WINDOW THAT OPENS MID-RUN has no brief above it, and the calls before
     * its first turn belong to a turn vam never read. Charging them to the
     * next one would draw working under a turn that had not started -- the
     * rule `transcript.ts` keeps for exactly this case.
     */
    it('drops the working that happened before the first turn it can see', () => {
      const turns = agentTurns(
        [
          called('Read', '2026-01-01T09:00:00.000Z', 'tu-0'),
          fromOperator('the first thing in the window', '2026-01-01T11:00:00.000Z'),
          called('Grep', '2026-01-01T11:01:00.000Z', 'tu-1'),
        ].join('\n'),
        'a1',
      );
      expect(turns).toHaveLength(1);
      expect(turns[0]?.steps?.map((s) => s.label)).toEqual(['Grep']);
    });

    /**
     * THE COORDINATOR AND THE SYSTEM ARE NOT THE OPERATOR, and neither opens a
     * turn. `subagent.ts` counts all three envelopes and says why only one of
     * them is a person.
     */
    it('does not open a turn on another agent speaking', () => {
      const turns = agentTurns(
        [
          brief('the brief'),
          JSON.stringify({
            type: 'user',
            isMeta: true,
            timestamp: '2026-01-01T11:00:00.000Z',
            message: {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'The coordinator sent a message while you were working:\nGo ahead.',
                },
              ],
            },
          }),
        ].join('\n'),
        'a1',
      );
      expect(turns).toHaveLength(1);
    });
  });
});
