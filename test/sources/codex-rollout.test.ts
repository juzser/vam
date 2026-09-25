/**
 * Reading a Codex rollout: which lines a turn comes from, and what a bounded
 * backwards read does at each of its edges.
 *
 * EVERY FIXTURE HERE IS INVENTED, on this directory's own rule
 * (`claude-code-tail-window.test.ts`): no transcript content, thread id, home
 * path or user name from the machine running this reaches a fixture. The
 * SHAPES below were measured against real rollouts -- `event_msg` /
 * `item_completed` / `item.type`, the `text` / `Text` spellings, the injected
 * `response_item` / `message` lines -- and every value is made up.
 */

import { describe, expect, it } from 'vitest';
import { readWindowOf, type TranscriptSource } from '../../src/main/sources/claude-code/window.js';
import {
  parseRolloutLines,
  readRolloutTail,
  threadStartOf,
  turnsFromLines,
} from '../../src/main/sources/codex/rollout.js';

const TURN = 'turn-1';

const userItem = (text: string, turnId = TURN, at = '2020-01-01T00:00:00.000Z') =>
  JSON.stringify({
    timestamp: at,
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: turnId,
      item: { type: 'UserMessage', id: 'i1', content: [{ type: 'text', text }] },
    },
  });

const agentItem = (text: string, turnId = TURN, at = '2020-01-01T00:01:00.000Z') =>
  JSON.stringify({
    timestamp: at,
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: turnId,
      item: { type: 'AgentMessage', id: 'i2', content: [{ type: 'Text', text }] },
    },
  });

/**
 * The measured `CommandExecution` shape: `command` is an ARRAY, and every one
 * observed is a login-shell wrapper around a script.
 */
const commandItem = (script: string, exitCode = 0) =>
  JSON.stringify({
    timestamp: '2020-01-01T00:00:30.000Z',
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: TURN,
      item: {
        type: 'CommandExecution',
        id: 'i3',
        command: ['/bin/zsh', '-lc', script],
        exit_code: exitCode,
      },
    },
  });

/** The measured `Extension` shape: a `kind` and a `query`. */
const extensionItem = (kind: string, query: string) =>
  JSON.stringify({
    timestamp: '2020-01-01T00:00:40.000Z',
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: TURN,
      item: { type: 'Extension', kind, id: 'i4', query, action: {}, results: [] },
    },
  });

/** The measured `Reasoning` shape, which has nothing an operator can act on. */
const reasoningItem = () =>
  JSON.stringify({
    timestamp: '2020-01-01T00:00:45.000Z',
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: TURN,
      item: { type: 'Reasoning', id: 'i5', summary_text: [], raw_content: [] },
    },
  });

/** The injected context a naive reader would print as the operator's prompt. */
const injectedMessage = (role: string, text: string) =>
  JSON.stringify({
    timestamp: '2020-01-01T00:00:00.000Z',
    type: 'response_item',
    payload: { type: 'message', role, content: [{ type: 'input_text', text }] },
  });

const facts = (lines: readonly string[]) =>
  turnsFromLines(parseRolloutLines(lines.join('\n')), 'd');

describe('turnsFromLines', () => {
  it('pairs a question with its answer', () => {
    const read = facts([userItem('what is the branch?'), agentItem('a-branch')]);
    expect(read.decisions).toHaveLength(1);
    expect(read.decisions[0]).toMatchObject({
      input: 'what is the branch?',
      output: 'a-branch',
      label: 'codex',
    });
    expect(read.starved).toBe(false);
  });

  it('never reads an injected block as something the operator typed', () => {
    // Measured shape: a real rollout carries `<recommended_plugins>` as
    // `response_item/message` with role `user`, beside the `developer` lines
    // holding the skills instructions. A reader keyed on that would show an
    // operator a prompt they never wrote.
    const read = facts([
      injectedMessage('developer', '<skills_instructions>…</skills_instructions>'),
      injectedMessage('user', '<recommended_plugins>…</recommended_plugins>'),
      userItem('the real question'),
      agentItem('the real answer'),
    ]);
    expect(read.decisions).toHaveLength(1);
    expect(read.decisions[0]?.input).toBe('the real question');
  });

  it('answers newest first, the order Session.decisions is in', () => {
    const read = facts([
      userItem('first', 'turn-a'),
      agentItem('first answer', 'turn-a'),
      userItem('second', 'turn-b'),
      agentItem('second answer', 'turn-b'),
    ]);
    expect(read.decisions.map((d) => d.input)).toEqual(['second', 'first']);
  });

  it('keeps an answer whose question is above the top of the window', () => {
    const read = facts([agentItem('an answer with no question in the window')]);
    expect(read.decisions).toHaveLength(1);
    expect(read.decisions[0]).toMatchObject({ input: '', output: expect.any(String) });
  });

  it('leaves output null on a turn that has not answered yet', () => {
    const read = facts([userItem('still working on it')]);
    expect(read.decisions[0]?.output).toBeNull();
  });

  it('reports starvation rather than a turn that ended without an answer', () => {
    const read = facts([commandItem('ls -la'), commandItem('git status')]);
    expect(read.starved).toBe(true);
    expect(read.decisions).toEqual([]);
  });

  it('carries the thread’s working as steps and the newest one as activity', () => {
    const read = facts([userItem('do it'), commandItem('pnpm test'), agentItem('done')]);
    expect(read.activity).toBe('pnpm test');
    expect(read.decisions[0]?.steps?.map((s) => s.label)).toEqual(['pnpm test']);
    // READ, NEVER INFERRED: a zero exit code is a call that did not fail.
    expect(read.decisions[0]?.steps?.every((s) => s.failed === false)).toBe(true);
  });

  it('prints the script a command ran, not the login shell wrapping it', () => {
    // Every measured `CommandExecution` is `[<shell>, "-lc", "<script>"]`;
    // printing the first two words would put `/bin/zsh -lc` on the activity
    // line of every call vam draws.
    const read = facts([userItem('do it'), commandItem('pnpm test')]);
    expect(read.activity).toBe('pnpm test');
  });

  it('marks a failed call from its exit code and counts it on the turn', () => {
    const read = facts([userItem('do it'), commandItem('pnpm test', 1), agentItem('it broke')]);
    expect(read.decisions[0]?.steps?.[0]?.failed).toBe(true);
    // ZERO IS A READING and absent would be "cannot report" -- so a turn with
    // a failure must carry the count, and one without must carry 0.
    expect(read.decisions[0]?.errorCount).toBe(1);
    expect(facts([userItem('x'), commandItem('ok')])[`decisions`][0]?.errorCount).toBe(0);
  });

  it('names a web search by its kind and its terms', () => {
    const read = facts([userItem('look it up'), extensionItem('web.search', 'some terms')]);
    expect(read.activity).toBe('web.search: some terms');
  });

  it('gives Reasoning no label at all, rather than the word "Reasoning"', () => {
    const read = facts([userItem('think'), commandItem('pnpm test'), reasoningItem()]);
    // The activity line stays on the last call that said something an
    // operator could act on.
    expect(read.activity).toBe('pnpm test');
    expect(read.decisions[0]?.steps?.map((s) => s.label)).toEqual(['pnpm test']);
  });

  it('invents no label for a shape vam has never seen', () => {
    const unknown = JSON.stringify({
      timestamp: '2020-01-01T00:00:50.000Z',
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        turn_id: TURN,
        item: { type: 'SomethingCodexShipsNextMonth', id: 'i6' },
      },
    });
    const read = facts([userItem('x'), unknown]);
    expect(read.activity).toBeNull();
    expect(read.decisions[0]?.steps).toEqual([]);
  });

  it('records when the operator asked and when the turn last did anything', () => {
    const read = facts([
      userItem('ask', TURN, '2020-01-01T09:00:00.000Z'),
      agentItem('answer', TURN, '2020-01-01T09:05:00.000Z'),
    ]);
    expect(read.decisions[0]?.promptedAt).toBe('2020-01-01T09:00:00.000Z');
    expect(read.decisions[0]?.latestAt).toBe('2020-01-01T09:05:00.000Z');
  });

  it('namespaces ids by thread, so two threads’ turns cannot collide', () => {
    const one = turnsFromLines(parseRolloutLines(userItem('x')), 'thread-a');
    const two = turnsFromLines(parseRolloutLines(userItem('x')), 'thread-b');
    expect(one.decisions[0]?.id).not.toBe(two.decisions[0]?.id);
  });
});

describe('parseRolloutLines', () => {
  it('skips a line that will not parse rather than failing the read', () => {
    // A tail read cuts its first line in half BY CONSTRUCTION, so this is the
    // common case at both edges of every window, not an error.
    const lines = parseRolloutLines(`{"broken": tru\n${userItem('after the cut')}\n{"half`);
    expect(lines).toHaveLength(1);
  });

  it('skips a line that parses to something that is not an object', () => {
    expect(parseRolloutLines('null\n42\n"a string"')).toEqual([]);
  });
});

describe('readRolloutTail', () => {
  const sourceOf = (text: string): TranscriptSource => {
    const bytes = Buffer.from(text, 'utf8');
    return {
      size: async () => bytes.length,
      read: async (from, to) => readWindowOf(bytes, from, to),
    };
  };

  it('widens backwards until the window holds a question AND an answer', async () => {
    // A step that holds about one line, so the read really has to widen.
    const text = `${userItem('the question')}\n${agentItem('the answer')}\n`;
    const read = await readRolloutTail(sourceOf(text), 'd', 300);
    expect(read.starved).toBe(false);
    expect(read.decisions[0]).toMatchObject({ input: 'the question', output: 'the answer' });
  });

  it('steps over a single line larger than the whole window', async () => {
    // Measured: the largest single line in the 40 most recent rollouts on this
    // machine is 1,903,452 bytes -- a tool result, which is neither a prompt
    // nor an answer. It must cost bytes off the ceiling and nothing else.
    const huge = JSON.stringify({ type: 'response_item', payload: { blob: 'y'.repeat(4000) } });
    const text = `${userItem('above the giant')}\n${agentItem('also above it')}\n${huge}\n`;
    const read = await readRolloutTail(sourceOf(text), 'd', 256);
    expect(read.decisions[0]).toMatchObject({ input: 'above the giant' });
  });

  it('stops at the budget and says it read no conversation, rather than inventing one', async () => {
    const filler = Array.from({ length: 40 }, () => commandItem('a command')).join('\n');
    const text = `${userItem('far above')}\n${agentItem('far above')}\n${filler}\n`;
    const read = await readRolloutTail(sourceOf(text), 'd', 64, 128);
    expect(read.starved).toBe(true);
    expect(read.decisions).toEqual([]);
  });

  it('reads a whole short rollout from byte 0 without widening past it', async () => {
    const read = await readRolloutTail(sourceOf(`${userItem('only a question')}\n`), 'd', 1024);
    expect(read.starved).toBe(false);
    expect(read.decisions[0]?.output).toBeNull();
  });
});

/**
 * `Session.createdAt`'s Codex source: THE THREAD'S START, not
 * `recency_at_ms` -- `docs/design/vam-owns-the-session.md`'s own trap ("a
 * recency moves every poll and is not a start time"). Codex embeds the
 * instant it began right into the rollout's own file name --
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl`, e.g.
 * `rollout-2026-08-11T18-49-11-019ff0a7-b87e-...jsonl`, measured against
 * real files on the machine this was written for -- so this never opens the
 * file at all.
 */
describe('threadStartOf', () => {
  it('reads the instant Codex embedded in the rollout’s own file name', () => {
    const path =
      '/home/op/.codex/sessions/2026/08/11/rollout-2026-08-11T18-49-11-019ff0a7-b87e-72e1-a90b-c35b1c66c45d.jsonl';
    expect(threadStartOf(path)).toBe('2026-08-11T18:49:11.000Z');
  });

  it('is null for a name Codex never writes, rather than a guess', () => {
    expect(threadStartOf('/home/op/.codex/sessions/2026/08/11/not-a-rollout.jsonl')).toBeNull();
  });

  it('is null for an empty string, never throws', () => {
    expect(threadStartOf('')).toBeNull();
  });
});
