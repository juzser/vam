/**
 * The answer channel across the bridge: what main accepts from a renderer, and
 * what the preload sends.
 *
 * The renderer is the least trusted process in the app, and this is the
 * channel that ends a tool call in someone's running agent. So the ask is
 * validated by SHAPE here, again, rather than trusted because the preload
 * built it -- and every refusal answers `unaimed`, which is the honest word
 * for an ask that never got as far as a session.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { createTerminalApi } from '../../../src/preload/api.js';
import {
  isAnswerRequest,
  MAX_ANSWER_LABELS,
  MAX_ANSWER_STEPS,
} from '../../../src/shared/answer.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const ATLAS = 'claude-code:atlas-11111111';

const step = (over: Record<string, unknown> = {}) => ({
  question: 'Which colour do you prefer?',
  labels: ['Crimson'],
  multiSelect: false,
  ...over,
});

describe('what the bridge will accept as an answer', () => {
  it('takes a one-question set, and a set of several', () => {
    expect(isAnswerRequest({ steps: [step()] })).toBe(true);
    expect(isAnswerRequest({ steps: [step(), step({ question: 'And a fruit?' })] })).toBe(true);
  });

  it('refuses a single-select step carrying two labels', () => {
    // Two labels would step the picker twice and commit the second, silently.
    expect(isAnswerRequest({ steps: [step({ labels: ['Crimson', 'Cobalt'] })] })).toBe(false);
  });

  it('refuses a step with no question text, which is the whole identity check', () => {
    expect(isAnswerRequest({ steps: [step({ question: '' })] })).toBe(false);
    expect(isAnswerRequest({ steps: [step({ question: 7 })] })).toBe(false);
    expect(isAnswerRequest({ steps: [step({ question: 'x'.repeat(401) })] })).toBe(false);
  });

  it('refuses an empty set, an unbounded one, and anything that is not steps', () => {
    expect(isAnswerRequest({ steps: [] })).toBe(false);
    expect(isAnswerRequest({ steps: Array(MAX_ANSWER_STEPS + 1).fill(step()) })).toBe(false);
    expect(isAnswerRequest({ steps: [step({ labels: [] })] })).toBe(false);
    expect(
      isAnswerRequest({ steps: [step({ labels: Array(MAX_ANSWER_LABELS + 1).fill('x') })] }),
    ).toBe(false);
    expect(isAnswerRequest({ steps: [step({ labels: [''] })] })).toBe(false);
    expect(isAnswerRequest({ steps: [step({ labels: [7] })] })).toBe(false);
    expect(isAnswerRequest({ steps: [step({ multiSelect: undefined })] })).toBe(false);
    expect(isAnswerRequest({ labels: ['a'], multiSelect: false })).toBe(false);
    expect(isAnswerRequest(null)).toBe(false);
  });
});

describe('the answer handler', () => {
  function harness(run: TmuxRun) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerTerminalIpc(
      { handle: (channel, handler) => void handlers.set(channel, handler) },
      run,
      async () => new Map(),
    );
    const answer = handlers.get(CHANNELS.terminalAnswer);
    if (answer === undefined) throw new Error('the answer channel was never registered');
    return answer;
  }

  const silent: TmuxRun = async () => ok('');

  it('registers itself on its own channel', () => {
    expect(() => harness(silent)).not.toThrow();
  });

  it('refuses a malformed ask without ever asking tmux anything', async () => {
    const argvs: (readonly string[])[] = [];
    const answer = harness(async (argv) => {
      argvs.push(argv);
      return ok('');
    });
    expect(await answer(null, ATLAS, { steps: [] })).toEqual({
      kind: 'unaimed',
    });
    expect(await answer(null, 7, { steps: [step()] })).toEqual({
      kind: 'unaimed',
    });
    expect(await answer(null, ATLAS)).toEqual({ kind: 'unaimed' });
    expect(argvs).toEqual([]);
  });

  it('carries a well-formed ask through to the pairing guard, which refuses it', async () => {
    const argvs: (readonly string[])[] = [];
    const answer = harness(async (argv) => {
      argvs.push(argv);
      return ok('');
    });
    expect(await answer(null, ATLAS, { steps: [step()] })).toEqual({
      kind: 'unaimed',
    });
    // It got as far as looking, which the malformed asks above never did.
    expect(argvs.map((argv) => argv[0])).toEqual(['list-sessions']);
  });
});

describe('the preload member', () => {
  it('invokes the answer channel, and passes a row id only when there is one', async () => {
    const calls: unknown[][] = [];
    const api = createTerminalApi({
      invoke: async (...args: unknown[]) => {
        calls.push(args);
        return { kind: 'sent', answer: 'Crimson' };
      },
    });
    const request = { steps: [step()] };
    expect(await api.answer(ATLAS, request)).toEqual({ kind: 'sent', answer: 'Crimson' });
    await api.answer(ATLAS, request, 's1');
    expect(calls).toEqual([
      [CHANNELS.terminalAnswer, ATLAS, request],
      [CHANNELS.terminalAnswer, ATLAS, request, 's1'],
    ]);
  });
});
