/**
 * The questions a session asked through the `AskUserQuestion` tool.
 *
 * An earlier census concluded that nothing vam reads records what a session is
 * asking. That was too broad: a FREE-FORM question written in prose has no
 * structure to read, but a question asked through the tool is recorded in
 * full -- the text, a short header, whether several options may be picked, and
 * every option with its label and description.
 *
 * The one rule that carries the feature is openness, and it is derived, never
 * guessed: a `tool_use` block carries an id, its answer arrives later as a
 * `tool_result` naming that id, so a question is OPEN exactly while no such
 * result exists. The fixtures below are shaped like the real record and
 * invented whole -- no transcript content, no home paths, no usernames.
 */

import { describe, expect, it } from 'vitest';
import { summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';

type Json = Record<string, unknown>;

const jsonl = (...lines: Json[]) => lines.map((line) => JSON.stringify(line)).join('\n');

const ask = (id: string, questions: unknown): Json => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] },
});

const answer = (id: string, content: unknown): Json => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
});

const PROVIDERS = {
  question: 'Which providers should vam support beyond Claude Code?',
  header: 'Providers',
  multiSelect: true,
  options: [
    { label: 'Codex CLI', description: 'a second CLI agent, read the same way' },
    { label: 'Aider', description: 'a local editor agent' },
  ],
};

const facts = (tail: string) => summarizeTranscript(tail, 'k');

describe('AskUserQuestion, as the transcript records it', () => {
  it('reads the question, its header, its multiSelect flag and every option', () => {
    const [question, ...rest] = facts(jsonl(ask('toolu_1', [PROVIDERS]))).questions;
    expect(rest).toHaveLength(0);
    expect(question?.question).toBe(PROVIDERS.question);
    expect(question?.header).toBe('Providers');
    expect(question?.multiSelect).toBe(true);
    expect(question?.options).toEqual([
      { label: 'Codex CLI', description: 'a second CLI agent, read the same way' },
      { label: 'Aider', description: 'a local editor agent' },
    ]);
  });

  it('leaves a question with no matching tool_result OPEN', () => {
    expect(facts(jsonl(ask('toolu_1', [PROVIDERS]))).questions[0]?.answer).toBeNull();
  });

  it('closes a question whose tool_result names its id, and keeps the answer', () => {
    const tail = jsonl(ask('toolu_1', [PROVIDERS]), answer('toolu_1', 'Providers: Codex CLI'));
    expect(facts(tail).questions[0]?.answer).toBe('Providers: Codex CLI');
  });

  it('does not close a question because SOME other tool_result arrived', () => {
    const tail = jsonl(ask('toolu_1', [PROVIDERS]), answer('toolu_9', 'unrelated'));
    expect(facts(tail).questions[0]?.answer).toBeNull();
  });

  it('reads an answer delivered as content blocks rather than a string', () => {
    const tail = jsonl(
      ask('toolu_1', [PROVIDERS]),
      answer('toolu_1', [{ type: 'text', text: 'Codex CLI' }]),
    );
    expect(facts(tail).questions[0]?.answer).toBe('Codex CLI');
  });

  it('records a single-select question as single-select', () => {
    const single = { ...PROVIDERS, multiSelect: false };
    expect(facts(jsonl(ask('toolu_1', [single]))).questions[0]?.multiSelect).toBe(false);
    // Absent is not "true": the flag has to be stated to be believed.
    const silent = { question: 'Ship it?', options: [{ label: 'Yes' }] };
    expect(facts(jsonl(ask('toolu_2', [silent]))).questions[0]?.multiSelect).toBe(false);
  });

  it('gives every question of one tool_use its own id, and shares its openness', () => {
    const second = { ...PROVIDERS, question: 'Which one first?', multiSelect: false };
    const ids = facts(jsonl(ask('toolu_1', [PROVIDERS, second]))).questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('AskUserQuestion, malformed -- data we do not have, never a throw', () => {
  const survives = (tail: string) => expect(() => facts(tail)).not.toThrow();

  it('ignores a tool_use whose input carries no questions array', () => {
    survives(jsonl(ask('toolu_1', undefined)));
    expect(facts(jsonl(ask('toolu_1', undefined))).questions).toEqual([]);
    expect(facts(jsonl(ask('toolu_1', 'Providers?'))).questions).toEqual([]);
  });

  it('drops a question with no text, and an option with no label', () => {
    expect(facts(jsonl(ask('toolu_1', [{ header: 'Providers', options: [] }]))).questions).toEqual(
      [],
    );
    const ragged = {
      question: 'Pick one',
      options: [{ description: 'no label' }, { label: 'ok' }],
    };
    expect(facts(jsonl(ask('toolu_1', [ragged]))).questions[0]?.options).toEqual([
      { label: 'ok', description: null },
    ]);
  });

  it('drops a question that offers no option at all -- there is nothing to render', () => {
    expect(facts(jsonl(ask('toolu_1', [{ question: 'Pick one', options: [] }]))).questions).toEqual(
      [],
    );
  });

  it('ignores a tool_use cut in half by the tail window', () => {
    const tail = `{"type":"assistant","message":{"content":[{"type":"tool_u\n${jsonl(
      ask('toolu_2', [PROVIDERS]),
    )}`;
    expect(facts(tail).questions).toHaveLength(1);
  });

  it('reports no questions for the common case -- a session that asked none', () => {
    expect(facts(jsonl({ type: 'assistant', message: { content: 'hello' } })).questions).toEqual(
      [],
    );
    expect(facts('').questions).toEqual([]);
  });
});
