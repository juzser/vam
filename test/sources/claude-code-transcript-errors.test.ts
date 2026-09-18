/**
 * FAILED TOOL CALLS, counted per turn.
 *
 * The collapsed progress line said "12 turns read ✓" over a run where three
 * tools blew up, because a turn's mark was binary -- `output === null` or not.
 * Collapsing may cost the operator detail; it must never cost them alarm.
 *
 * THE DATA IS THERE, EXPLICITLY, and this is not an inference from something
 * that merely correlates with failure. A failed tool call is recorded as a
 * `{type:'tool_result', is_error:true}` part inside a `type:'user'` line --
 * the same `is_error` field `deliver.ts` in this codebase already reads to
 * tell a refusal from a delivery. Verified before this was written, by
 * parsing the operator's real transcripts: across 190 files carrying one, all
 * 506 occurrences of `is_error:true` sat on a `tool_result` part of a `user`
 * line, with no exceptions of either kind.
 *
 * ATTRIBUTION. A tool result arrives after the prompt that opened the turn and
 * before the next one, so it belongs to the turn open when it is read. A
 * result with no open turn -- the window began mid-turn, its prompt off the
 * top -- is counted nowhere, which is the same honesty `turns read` already
 * carries: this is a count of what was READ, never a claim about the run.
 *
 * The fixtures are shaped like the real record and invented whole: no
 * transcript content, no home paths, no usernames.
 */

import { describe, expect, it } from 'vitest';
import { summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';

type Json = Record<string, unknown>;

const jsonl = (...lines: Json[]) => lines.map((line) => JSON.stringify(line)).join('\n');

const userPrompt = (lastPrompt: string): Json => ({ type: 'last-prompt', lastPrompt });

const reply = (text: string): Json => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
});

/** A tool result, failed or not, exactly as the CLI writes it. */
const result = (id: string, isError: boolean, content = 'Exit code 1'): Json => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] },
});

const facts = (tail: string) => summarizeTranscript(tail, 'k');

describe('a turn counts the tool calls that failed inside it', () => {
  it('counts a failed call against the turn that was open', () => {
    const [turn] = facts(
      jsonl(userPrompt('build it'), result('t1', true), reply('done')),
    ).decisions;
    expect(turn?.errorCount).toBe(1);
  });

  it('does not count a call that succeeded', () => {
    const [turn] = facts(
      jsonl(userPrompt('build it'), result('t1', false), reply('done')),
    ).decisions;
    expect(turn?.errorCount).toBe(0);
  });

  it('counts every failure in the turn, not just the first', () => {
    const [turn] = facts(
      jsonl(userPrompt('build it'), result('t1', true), result('t2', true), result('t3', true)),
    ).decisions;
    expect(turn?.errorCount).toBe(3);
  });

  it('keeps each turn’s failures to itself', () => {
    // `decisions` is newest first, so the second prompt is `[0]`.
    const { decisions } = facts(
      jsonl(
        userPrompt('first'),
        result('t1', true),
        reply('one'),
        userPrompt('second'),
        reply('two'),
      ),
    );
    expect(decisions[0]?.errorCount).toBe(0);
    expect(decisions[1]?.errorCount).toBe(1);
  });

  it('counts several failed parts inside one result line', () => {
    const line: Json = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'x' },
          { type: 'tool_result', tool_use_id: 'b', is_error: true, content: 'y' },
        ],
      },
    };
    expect(facts(jsonl(userPrompt('go'), line)).decisions[0]?.errorCount).toBe(2);
  });

  it('drops a failure whose turn is off the top of the window', () => {
    // The tail may open mid-turn. There is no turn to charge it to, and
    // inventing one would put a prompt on screen that was never read.
    const { decisions } = facts(jsonl(result('t1', true), userPrompt('later'), reply('ok')));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.errorCount).toBe(0);
  });

  it('ignores an is_error that is not the literal true', () => {
    // `is_error` is a boolean in every real record; a string "true" is
    // damaged or adversarial data, and a badge is not worth guessing for.
    const line: Json = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: 'true' }] },
    };
    expect(facts(jsonl(userPrompt('go'), line)).decisions[0]?.errorCount).toBe(0);
  });

  it('leaves a clean turn at zero rather than absent', () => {
    // Zero is a READING -- vam looked and found none. The field is optional
    // on the type for sources that cannot report it at all; this source can,
    // so it always answers.
    expect(facts(jsonl(userPrompt('go'), reply('fine'))).decisions[0]?.errorCount).toBe(0);
  });
});
