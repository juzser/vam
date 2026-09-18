/**
 * THE TOOL CALLS OF A TURN, in the order they were made.
 *
 * Operator: "show the whole progress when focus view is off." What the column
 * drew when it was off was one line per turn reading `✓ claude-code` -- the
 * turn's mark and the agent's name -- because that is all a `Decision` carried
 * about its own working. The working itself was in the transcript the whole
 * time and this module threw it away: every `tool_use` part was read (that is
 * where `activity` comes from) and only the NEWEST one, across the whole
 * window, survived.
 *
 * So a turn now carries its calls. `errorCount` is untouched and stays a
 * COUNT: it answers "did anything blow up in this turn" for a folded line,
 * which a list cannot do, and it counts failures vam could not attribute to a
 * call it read besides.
 *
 * ── WHAT IS READ AND WHAT IS NOT ──────────────────────────────────────────
 * READ: the part's `name`, its `input.description` where the tool wrote one,
 * and the `is_error` of the `tool_result` that answered it, matched by
 * `tool_use_id`. NOT read: the input itself (a file's whole contents rides in
 * there), the result's content, or any timing. A progress row is a NAME, not a
 * transcript viewer.
 *
 * ── MEASURED BEFORE IT WAS WRITTEN, over the 77 real session transcripts on
 * this machine (863 subagent sidechains beside them are never opened by vam):
 *  - 63,622 `tool_use` parts, ALL 63,622 carrying an `id`;
 *  - 1,221 `tool_result` parts with `is_error:true`, ALL 1,221 naming a
 *    `tool_use_id` that matches a call in the same file -- so matching by id
 *    is a reading rather than a heuristic;
 *  - per turn, inside one 128 KiB window: median 3 calls, p90 8, largest 20
 *    (387 turns). A turn that SPANS the window -- the case `history.ts`
 *    widens for -- runs to a median of 30 and a largest of 2,144, which is
 *    why the COLUMN caps what it draws. This module caps nothing: the window
 *    is the budget, exactly as it is for `MAX_DECISIONS`.
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

/** An assistant line whose content carries tool calls, as the CLI writes it. */
const calls = (...parts: { id: string; name: string; description?: string }[]): Json => ({
  type: 'assistant',
  message: {
    content: parts.map((part) => ({
      type: 'tool_use',
      id: part.id,
      name: part.name,
      input: part.description === undefined ? {} : { description: part.description },
    })),
  },
});

/** The result that answers one call. */
const result = (id: string, isError: boolean): Json => ({
  type: 'user',
  message: {
    content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'x' }],
  },
});

const facts = (tail: string) => summarizeTranscript(tail, 'k');
const stepsOf = (tail: string) => facts(tail).decisions[0]?.steps ?? null;

describe('a turn carries the calls it made', () => {
  it('keeps one step per tool call, oldest first', () => {
    const steps = stepsOf(
      jsonl(
        userPrompt('build it'),
        calls({ id: 't1', name: 'Read' }),
        calls({ id: 't2', name: 'Edit' }),
        reply('done'),
      ),
    );
    expect(steps?.map((s) => s.label)).toEqual(['Read', 'Edit']);
  });

  it('keeps EVERY call of a line, not only the first', () => {
    // `activity` reads the first part of a line and always has. A turn's
    // working is the other question: parallel calls are one line, and three
    // of them drawn as one is a progress list that lies about the work.
    const steps = stepsOf(
      jsonl(
        userPrompt('build it'),
        calls({ id: 't1', name: 'Read' }, { id: 't2', name: 'Grep' }, { id: 't3', name: 'Glob' }),
      ),
    );
    expect(steps?.map((s) => s.label)).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('says what the call was for, where the tool wrote its own description', () => {
    const steps = stepsOf(
      jsonl(
        userPrompt('build it'),
        calls({ id: 't1', name: 'Bash', description: 'run the tests' }),
      ),
    );
    expect(steps?.[0]?.label).toBe('Bash: run the tests');
  });

  it('cuts a long description at the same limit the activity line uses', () => {
    // 228 of the corpus's labels run past 80 characters and the longest is
    // 1,057. One row of a progress list is a NAME; the pane truncates what it
    // draws, but a payload carrying a kilobyte per call is paid on every poll.
    const steps = stepsOf(
      jsonl(
        userPrompt('build it'),
        calls({ id: 't1', name: 'Bash', description: 'x'.repeat(400) }),
      ),
    );
    expect(steps?.[0]?.label.length).toBe(80);
  });

  it('gives every step of a turn an id of its own, so a list can key on it', () => {
    const steps = stepsOf(
      jsonl(userPrompt('build it'), calls({ id: 't1', name: 'Read' }, { id: 't1', name: 'Read' })),
    );
    // THE SAME ID TWICE IS THE TEST, not a typo: the ids in this record are
    // the provider's, and a list keyed on a value vam does not mint is a list
    // that collapses two rows the day one repeats.
    expect(new Set(steps?.map((s) => s.id)).size).toBe(2);
  });

  it('is an empty list on a turn that called nothing, never absent', () => {
    // The same two-unknowns rule `errorCount` carries: this source CAN report
    // calls, so zero here is a reading. Absent is reserved for a source that
    // cannot look at all.
    const steps = stepsOf(jsonl(userPrompt('just answer'), reply('no tools needed')));
    expect(steps).toEqual([]);
  });
});

describe('a step that failed says so, and only on the evidence', () => {
  it('marks the call whose result came back is_error', () => {
    const steps = stepsOf(
      jsonl(
        userPrompt('build it'),
        calls({ id: 't1', name: 'Read' }, { id: 't2', name: 'Bash' }),
        result('t2', true),
      ),
    );
    expect(steps?.map((s) => s.failed)).toEqual([false, true]);
  });

  it('leaves a call whose result succeeded alone', () => {
    const steps = stepsOf(
      jsonl(userPrompt('build it'), calls({ id: 't1', name: 'Read' }), result('t1', false)),
    );
    expect(steps?.[0]?.failed).toBe(false);
  });

  it('leaves a call with no result at all alone -- it is running, not broken', () => {
    const steps = stepsOf(jsonl(userPrompt('build it'), calls({ id: 't1', name: 'Bash' })));
    expect(steps?.[0]?.failed).toBe(false);
  });

  it('never guesses from a truthy is_error', () => {
    // `deliver.ts` and `toolErrors` both read `=== true`; a string or a 1 is
    // damaged or adversarial data, and a failure badge is not worth guessing.
    const damaged: Json = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: 'yes' }] },
    };
    const steps = stepsOf(
      jsonl(userPrompt('build it'), calls({ id: 't1', name: 'Bash' }), damaged),
    );
    expect(steps?.[0]?.failed).toBe(false);
  });

  it('still counts a failure it cannot attribute to a call it read', () => {
    // The window opened after the call but before its result. `errorCount` is
    // the count of what was READ and does not depend on the list -- which is
    // the whole reason the count survives the list existing.
    const [turn] = facts(jsonl(userPrompt('build it'), result('gone', true))).decisions;
    expect(turn?.errorCount).toBe(1);
    expect(turn?.steps).toEqual([]);
  });
});

describe('attribution, which is the same rule the count already keeps', () => {
  it('charges a call to the turn that was open when it was made', () => {
    const { decisions } = facts(
      jsonl(
        userPrompt('first'),
        calls({ id: 't1', name: 'Read' }),
        userPrompt('second'),
        calls({ id: 't2', name: 'Edit' }),
      ),
    );
    // `decisions` is newest first.
    expect(decisions[0]?.steps?.map((s) => s.label)).toEqual(['Edit']);
    expect(decisions[1]?.steps?.map((s) => s.label)).toEqual(['Read']);
  });

  it('charges a call made before any prompt in the window to nothing', () => {
    // The window began mid-turn with its prompt off the top. Attributing the
    // call to the NEXT prompt would put working under a turn that had not
    // started -- the defect `turns read` exists to refuse.
    const { decisions } = facts(
      jsonl(calls({ id: 't0', name: 'Read' }), userPrompt('build it'), reply('done')),
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.steps).toEqual([]);
  });

  it('leaves the activity line reading the newest call, as it always did', () => {
    const { activity } = facts(
      jsonl(
        userPrompt('build it'),
        calls({ id: 't1', name: 'Read' }),
        calls({ id: 't2', name: 'Edit' }),
      ),
    );
    expect(activity).toBe('Edit');
  });
});
