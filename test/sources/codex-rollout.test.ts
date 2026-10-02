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
import { columnOf, retainLeft } from '../../src/renderer/panels/transcript-history.js';
import type { Decision } from '../../src/shared/model.js';

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
 * A TURN KEEPS ONE ID AS THE WINDOW SLIDES (vam-ux-3 task-47). Five turns
 * T1..T5, each a UserMessage, a CommandExecution and an AgentMessage, read
 * through the REAL `readRolloutTail` with an explicit `step`.
 */
describe('Codex turn ids across window slides', () => {
  const P = 'd';
  const msg = (kind: string, n: number, turnId: string | null, text: string, extra = {}) =>
    JSON.stringify({
      timestamp: `2020-01-01T00:${String(n).padStart(2, '0')}:${kind === 'UserMessage' ? '00' : '59'}.000Z`,
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        ...(turnId === null ? {} : { turn_id: turnId }),
        item: { type: kind, id: 'i', content: [{ type: 'text', text }], ...extra },
      },
    });
  /** One turn's three lines; `ids` false drops every `turn_id`. */
  const turnLines = (n: number, ids: boolean): string[] => {
    const id = ids ? `turn-${n}` : null;
    return [
      // T1's prompt holds a non-ASCII character: a character offset would be wrong after it.
      msg('UserMessage', n, id, n === 1 ? 'question 1 café ✓' : `question ${n}`),
      msg('CommandExecution', n, id, '', { command: ['/bin/zsh', '-lc', 'ls'], exit_code: 0 }),
      msg('AgentMessage', n, id, `answer ${n}`),
    ];
  };
  const fixture = (ids: boolean) => {
    const lines = [1, 2, 3, 4, 5].flatMap((n) => turnLines(n, ids));
    const startOf = (i: number) => Buffer.byteLength(`${lines.slice(0, i).join('\n')}\n`);
    return { lines, startOf, text: (to: number) => `${lines.slice(0, to).join('\n')}\n` };
  };
  /** Line index of turn n's U (0), C (1) or A (2). */
  const at = (n: number, part: 0 | 1 | 2) => (n - 1) * 3 + part;

  /** `readRolloutTail` over `text`, its window opening at line index `from`. */
  const readFrom = async (text: string, fromByte: number) => {
    const bytes = Buffer.from(text, 'utf8');
    let start = -1;
    const source: TranscriptSource = {
      size: async () => bytes.length,
      read: async (a, b) => {
        const w = readWindowOf(bytes, a, b);
        if (start < 0) start = w.start;
        return w;
      },
    };
    const facts = await readRolloutTail(source, P, Math.max(1, bytes.length - fromByte));
    return { decisions: facts.decisions, start };
  };

  /**
   * The reads every case compares: `a` (T3,T4) then `b` (T4,T5) slide one turn;
   * `early` (T2,T3) then `late` (opens at T3's command, so T3 is answer-opened)
   * are the EC-104 pair. Poll order for EC-107 is early, late, b.
   */
  const reads = async (ids: boolean) => {
    const f = fixture(ids);
    const turn = f.startOf(at(4, 0)) - f.startOf(at(3, 0));
    const a = await readFrom(f.text(at(4, 2) + 1), f.startOf(at(4, 0)) - turn - 100);
    const b = await readFrom(f.text(15), f.startOf(at(4, 0)) - 100);
    const early = await readFrom(f.text(at(3, 2) + 1), f.startOf(at(3, 0)) - turn - 100);
    const late = await readFrom(f.text(at(4, 2) + 1), f.startOf(at(3, 1)));
    return { f, a, b, early, late };
  };
  const numberOf = (d: Decision) =>
    Number(/(\d)$/.exec(d.input === '' ? (d.output ?? '') : d.input)?.[1]);

  it('EC-103: a turn present in two reads has the same id in both, <prefix>-<turn_id>', async () => {
    const { a, b } = await reads(true);
    expect(b.start).toBeGreaterThan(a.start);
    for (const r of [a, b]) {
      expect(r.decisions.length).toBeGreaterThanOrEqual(2);
      expect(new Set(r.decisions.map((d) => d.id)).size).toBe(r.decisions.length);
    }
    const idsA = a.decisions.map((d) => d.id);
    const idsB = b.decisions.map((d) => d.id);
    expect(idsA).toEqual(['d-turn-4', 'd-turn-3']);
    expect(idsB).toEqual(['d-turn-5', 'd-turn-4']);
  });

  it('EC-104: a turn whose question slid out keeps its id and is flagged answer-opened', async () => {
    const { early: earlier, late: later } = await reads(true);
    const before = earlier.decisions.find((d) => d.output === 'answer 3');
    const after = later.decisions.find((d) => d.output === 'answer 3');
    expect(after).toMatchObject({ id: 'd-turn-3', input: '', openedMidTurn: true });
    expect(before?.id).toBe('d-turn-3');
    expect(before?.openedMidTurn).toBeUndefined();
  });

  it('EC-105: without turn_id, ids are the opening line byte offset', async () => {
    const { f, a, b, early, late } = await reads(false);
    expect(f.lines[0]).toContain('é');
    expect(a.decisions.map((d) => d.id)).toEqual([
      `d:@${f.startOf(at(4, 0))}`,
      `d:@${f.startOf(at(3, 0))}`,
    ]);
    expect(b.decisions.map((d) => d.id)).toEqual([
      `d:@${f.startOf(at(5, 0))}`,
      `d:@${f.startOf(at(4, 0))}`,
    ]);
    const was = early.decisions.find((d) => d.output === 'answer 3');
    const now = late.decisions.find((d) => d.output === 'answer 3');
    expect(now).toMatchObject({ id: `d:@${f.startOf(at(3, 2))}`, openedMidTurn: true });
    expect(was?.id).toBe(`d:@${f.startOf(at(3, 0))}`);
    for (const r of [a, b, early, late]) {
      expect(new Set(r.decisions.map((d) => d.id)).size).toBe(r.decisions.length);
      const flagged = r.decisions.filter((d) => d.openedMidTurn).map((d) => d.output);
      expect(flagged).toEqual(r === late ? ['answer 3'] : []);
    }
  });

  describe('EC-106: a steered UserMessage joins the open turn', () => {
    const X = 'turn-x';
    const six = [
      msg('UserMessage', 1, X, 'U1'),
      msg('AgentMessage', 2, X, 'A1'),
      msg('UserMessage', 3, X, 'U2'),
      msg('AgentMessage', 4, X, 'A2'),
    ];
    const run = async (from: number) => {
      const text = `${six.join('\n')}\n`;
      const off = Buffer.byteLength(`${six.slice(0, from).join('\n')}${from === 0 ? '' : '\n'}`);
      return (await readFrom(text, off)).decisions;
    };

    it('(i) a read holding U1..A2 is one turn', async () => {
      const d = await run(0);
      expect(d).toMatchObject([{ id: 'd-turn-x', input: 'U1\n\nU2', output: 'A1\n\nA2' }]);
    });

    it('(ii) an answer-opened turn takes the steered text alone', async () => {
      const d = await run(1);
      expect(d).toMatchObject([
        { id: 'd-turn-x', input: 'U2', promptedAt: null, openedMidTurn: true },
      ]);
      expect(d[0]?.latestAt).toBe('2020-01-01T00:04:59.000Z');
    });

    it('(iii) a window opening after A1 is one turn opened by U2', async () => {
      const d = await run(2);
      expect(d).toMatchObject([{ id: 'd-turn-x', input: 'U2', output: 'A2' }]);
    });

    it('a steered message with no text keeps the input and advances latestAt', async () => {
      const lines = [msg('UserMessage', 1, X, 'U1'), msg('UserMessage', 3, X, '')];
      const d = (await readFrom(`${lines.join('\n')}\n`, 0)).decisions;
      expect(d).toMatchObject([{ input: 'U1', latestAt: '2020-01-01T00:03:00.000Z' }]);
    });

    it('a turn_id reused by a non-adjacent turn takes the offset form', async () => {
      const lines = [
        msg('UserMessage', 1, X, 'a'),
        msg('UserMessage', 2, 'turn-y', 'b'),
        msg('UserMessage', 3, X, 'c'),
      ];
      const d = (await readFrom(`${lines.join('\n')}\n`, 0)).decisions;
      const third = Buffer.byteLength(`${lines.slice(0, 2).join('\n')}\n`);
      expect(d.map((x) => x.id)).toEqual([`d:@${third}`, 'd-turn-y', 'd-turn-x']);
    });
  });

  describe('EC-107: retention folds the polls with no duplicate and no loss', () => {
    for (const ids of [true, false]) {
      it(`${ids ? 'with' : 'without'} turn_id`, async () => {
        const { early, late, b } = await reads(ids);
        let older: readonly Decision[] = [];
        let previous: readonly Decision[] = [];
        for (const live of [early, late, b].map((r) => r.decisions)) {
          older = retainLeft(previous, live, older);
          previous = live;
        }
        const column = columnOf(previous, older).map(numberOf);
        expect(column).toEqual([5, 4, 3, 2]);
      });
    }
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
