/**
 * WHICH TURN AN ANSWER BELONGS TO.
 *
 * Operator: "the agent did answer from the terminal, but vam prints `this turn
 * ended without an answer` -- there will almost never be a turn with no
 * output."
 *
 * The reading was right and the cause was one wrong assumption in
 * `transcript.ts`: that `type:'last-prompt'` OPENS a turn. It does not. It is
 * a STATE SNAPSHOT the CLI flushes on its own schedule -- "the prompt this
 * session is currently on" -- and the flush lands wherever it lands. Measured
 * over the 546 real transcripts on this machine written since 2026-09-01:
 *
 *   - The newest turn carried NO answer in 16 of the 41 sessions that had any
 *     turn at all (39%), including one whose entire prompt was `hello` and one
 *     that read `Reply with exactly: PROBE-ONE`. Both were answered.
 *   - In the smallest of them the whole file is 12 lines, in this order:
 *     `user` (the prompt), `assistant` (the answer), `last-prompt`. The marker
 *     is written AFTER the answer, so the turn it opened could never contain
 *     it.
 *   - The marker is not always late: another session wrote `user`, then
 *     `last-prompt`, then the answer. BOTH orders are real, which is why
 *     neither line can be read as the boundary on its own.
 *
 * So the answer went to the WRONG TURN, not just to no turn: with the marker
 * late, an answer emitted before it overwrote the PREVIOUS turn's output --
 * every turn in the pane showing the next prompt's reply, and the newest
 * showing none. That is the defect these tests pin.
 *
 * THE BOUNDARY IS THE OPERATOR'S OWN `user` LINE. It is written once, at the
 * moment the prompt is sent, and everything after it belongs to the new turn.
 * `last-prompt` keeps its one real job -- naming a turn whose `user` line is
 * above the top of the window -- which is why turn ids are untouched here.
 *
 * WHAT A `user` LINE IS NOT, measured over the full corpus (68,697 of them):
 *   - 64,293 carry `tool_result` parts. Those are the session's own working.
 *   - 1,501 carry `isCompactSummary` -- the "this session is being continued"
 *     text auto-compaction injects mid-turn. One long session wrote four of
 *     them WITHOUT the operator typing anything.
 *   -   89 carry `isMeta`, and 1,287 carry `promptSource:'system'` -- task
 *     notifications the CLI posts to itself.
 *   - 1,225 carry `promptSource` of `typed`, `suggestion_accepted`, `queued`
 *     or `sdk`. Those are the operator, and so are the 302 older lines that
 *     predate the field and carry none of the three exclusions.
 *
 * The fixtures are shaped like the real record and invented whole: no
 * transcript content, no home paths, no usernames.
 */

import { describe, expect, it } from 'vitest';
import { summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';

type Json = Record<string, unknown>;

const jsonl = (...lines: Json[]) => lines.map((line) => JSON.stringify(line)).join('\n');

/** The operator's own line, as the CLI writes it when a prompt is sent. */
const typed = (text: string): Json => ({
  type: 'user',
  promptId: 'p1',
  promptSource: 'typed',
  message: { role: 'user', content: text },
});

/** The state snapshot. NOT a turn boundary -- see the header. */
const marker = (lastPrompt: string): Json => ({ type: 'last-prompt', lastPrompt });

const reply = (text: string): Json => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
});

const outputs = (text: string): (string | null)[] =>
  summarizeTranscript(text, 's').decisions.map((decision) => decision.output);

describe('an answer belongs to the turn that was open when it was written', () => {
  it('keeps the answer of a turn whose marker is flushed after it', () => {
    // The 12-line session, in its real order.
    const text = jsonl(typed('hello'), reply('Hello! Ready when you are.'), marker('hello'));

    expect(outputs(text)).toEqual(['Hello! Ready when you are.']);
  });

  it('keeps the answer of a turn whose marker is flushed before it', () => {
    // The other real order, which already worked and must go on working.
    const text = jsonl(typed('hello'), marker('hello'), reply('Hello! Ready when you are.'));

    expect(outputs(text)).toEqual(['Hello! Ready when you are.']);
  });

  it('gives each turn its own answer rather than the next turn’s', () => {
    const text = jsonl(
      typed('first'),
      reply('the first answer'),
      marker('first'),
      typed('second'),
      reply('the second answer'),
      marker('second'),
    );

    // Newest first, as `decisions` is ordered.
    expect(outputs(text)).toEqual(['the second answer', 'the first answer']);
  });

  it('does not let a later answer overwrite a turn the operator has left', () => {
    // The marker for `second` never flushed -- the file ends on the answer.
    // `first` must still show ITS answer, not the one written after the
    // operator had already moved on.
    const text = jsonl(
      typed('first'),
      reply('the first answer'),
      marker('first'),
      typed('second'),
      reply('the second answer'),
    );

    expect(outputs(text)[outputs(text).length - 1]).toBe('the first answer');
  });
});

describe('the lines that are not the operator', () => {
  const injected = (line: Json): Json => ({ ...line, message: { role: 'user', content: 'x' } });

  it('a compaction summary does not end the open turn', () => {
    const text = jsonl(
      typed('go on'),
      marker('go on'),
      injected({ type: 'user', promptId: 'p2', isCompactSummary: true }),
      reply('still the same turn'),
    );

    expect(outputs(text)).toEqual(['still the same turn']);
  });

  it('a task notification does not end the open turn', () => {
    const text = jsonl(
      typed('go on'),
      marker('go on'),
      injected({ type: 'user', promptId: 'p2', promptSource: 'system' }),
      reply('still the same turn'),
    );

    expect(outputs(text)).toEqual(['still the same turn']);
  });

  it('a tool result does not end the open turn, even carrying text beside it', () => {
    // THE TEXT PART IS THE POINT. A `tool_result`-only line is already refused
    // by `messageText`, which finds no `{type:'text'}` part and answers null
    // -- so a fixture without this text block passes whether the tool_result
    // test exists or not, and proves nothing about it. All 64,384 tool_result
    // lines in the corpus are result-only, but the message schema permits the
    // mixed shape and `promptSource:'sdk'` is in `OPERATOR_PROMPTS`, so an SDK
    // caller can write one. What makes a `user` line the session's working is
    // that it carries results, whatever else it carries.
    const text = jsonl(
      typed('go on'),
      marker('go on'),
      {
        type: 'user',
        promptId: 'p2',
        promptSource: 'sdk',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1' },
            { type: 'text', text: 'and here is what that produced' },
          ],
        },
      },
      reply('still the same turn'),
    );

    expect(outputs(text)).toEqual(['still the same turn']);
  });

  it('a bash-mode echo does not end the open turn', () => {
    // 276 `user` lines in the corpus are the CLI's own envelope rather than
    // the operator: `<bash-input>`/`<bash-stdout>` (235), `<command-name>` and
    // `<command-message>` (29), `<local-command-*>` (11), `<bash-stderr>` (1).
    // Every one of them lacks `promptSource`, and the pair below is what a
    // single `!` command writes -- two lines, so read as prompts they cut one
    // turn into three.
    const text = jsonl(
      typed('run the tests'),
      marker('run the tests'),
      {
        type: 'user',
        promptId: 'p2',
        message: { role: 'user', content: '<bash-input>npm test</bash-input>' },
      },
      {
        type: 'user',
        promptId: 'p3',
        message: { role: 'user', content: '<bash-stdout>ok</bash-stdout>' },
      },
      reply('still the same turn'),
    );

    expect(outputs(text)).toEqual(['still the same turn']);
  });

  it('an interruption notice does not end the open turn', () => {
    // What the CLI writes when the operator presses Escape. It is a `user`
    // line with no `promptSource`, on the CURRENT CLI (version 2.1.267 in the
    // corpus) as well as the old ones -- 24 of them, every one either
    // `[Request interrupted by user]` or `[Request interrupted by user for
    // tool use]`. Read as a prompt it opened a second turn on the SAME text
    // the marker was already on, and the pane drew the newer, empty one.
    const text = jsonl(
      typed('login'),
      reply('the answer'),
      marker('login'),
      {
        type: 'user',
        promptId: 'p2',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '[Request interrupted by user]' }],
        },
      },
      marker('login'),
    );

    expect(outputs(text)).toEqual(['the answer']);
  });

  it('still reads a slash command as a prompt', () => {
    // The other half of the promptSource-less population: `/compact` and
    // `/code-review`, typed by the operator and answered like anything else.
    const text = jsonl(
      { type: 'user', promptId: 'p1', message: { role: 'user', content: '/code-review' } },
      reply('the review'),
      marker('/code-review'),
    );

    expect(outputs(text)).toEqual(['the review']);
  });

  it('a meta line does not end the open turn', () => {
    const text = jsonl(
      typed('go on'),
      marker('go on'),
      injected({ type: 'user', promptId: 'p2', isMeta: true }),
      reply('still the same turn'),
    );

    expect(outputs(text)).toEqual(['still the same turn']);
  });
});

describe('a window that opens in the middle of a turn', () => {
  it('still names the turn from the marker, with no operator line to read', () => {
    // What `load()` sees when the 128 KiB tail begins after the `user` line:
    // the marker re-emits the prompt in full, and it is the only thing that
    // can open this turn at all.
    const text = jsonl(marker('a long turn'), reply('the answer'), marker('a long turn'));

    expect(outputs(text)).toEqual(['the answer']);
  });
});
