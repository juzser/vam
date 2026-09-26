/**
 * Reading ONE Codex rollout line for its token usage and its active model.
 *
 * Codex splits what Claude Code's transcript carries on one line across two:
 * a top-level `turn_context` line names the MODEL a turn is about to run
 * (read once, remembered by the caller — `currentModel`), and a nested
 * `event_msg`/`token_count` line carries the DELTA since the previous
 * reading (`payload.info.last_token_usage`) with no model field of its own.
 * Fixtures below are real-shaped, measured against a rollout on this
 * machine; every id and path is invented.
 */
import { describe, expect, it } from 'vitest';
import { parseCodexLine } from '../../../src/main/stats/codex-usage-line.js';

const turnContext = (model: string) =>
  JSON.stringify({
    timestamp: '2026-09-23T10:02:00.000Z',
    type: 'turn_context',
    payload: { turn_id: 't1', model },
  });

const tokenCount = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    timestamp: '2026-09-23T10:02:56.019Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 20610,
          cached_input_tokens: 12928,
          cache_write_input_tokens: 0,
          output_tokens: 69,
          reasoning_output_tokens: 17,
          total_tokens: 20679,
        },
        last_token_usage: {
          input_tokens: 500,
          cached_input_tokens: 200,
          cache_write_input_tokens: 10,
          output_tokens: 69,
          reasoning_output_tokens: 17,
          total_tokens: 569,
        },
        ...over,
      },
    },
  });

describe('parseCodexLine', () => {
  it('reads a turn_context line as a model announcement', () => {
    const result = parseCodexLine(turnContext('gpt-5-codex'), null);
    expect(result).toEqual({ kind: 'model', model: 'gpt-5-codex' });
  });

  it('reads a token_count line as the LAST (delta) usage, tagged with the caller-supplied current model', () => {
    const result = parseCodexLine(tokenCount(), 'gpt-5-codex');
    expect(result.kind).toBe('usage');
    if (result.kind !== 'usage') throw new Error('unreachable');
    expect(result.event).toEqual({
      atMs: Date.parse('2026-09-23T10:02:56.019Z'),
      model: 'gpt-5-codex',
      inputTokens: 500,
      outputTokens: 69,
      cacheWriteTokens: 10,
      cacheReadTokens: 200,
      reasoningTokens: 17,
    });
  });

  it('carries a null model when no turn_context has been seen yet — tokens still counted, cost simply unpriced', () => {
    const result = parseCodexLine(tokenCount(), null);
    expect(result.kind).toBe('usage');
    if (result.kind !== 'usage') throw new Error('unreachable');
    expect(result.event.model).toBeNull();
  });

  it('is "other" for a session_meta line and every other event this scanner learns nothing from', () => {
    expect(
      parseCodexLine(
        JSON.stringify({
          timestamp: '2026-09-23T10:00:00.000Z',
          type: 'session_meta',
          payload: {},
        }),
        null,
      ).kind,
    ).toBe('other');
    expect(
      parseCodexLine(
        JSON.stringify({
          timestamp: '2026-09-23T10:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        null,
      ).kind,
    ).toBe('other');
  });

  it('is "malformed" for a truncated tail line', () => {
    const truncated = tokenCount().slice(0, 30);
    expect(parseCodexLine(truncated, null).kind).toBe('malformed');
  });

  it('is "malformed" for valid JSON that is not an object', () => {
    expect(parseCodexLine('[]', null).kind).toBe('malformed');
    expect(parseCodexLine('"x"', null).kind).toBe('malformed');
  });

  it('is "other" for a blank line', () => {
    expect(parseCodexLine('', null).kind).toBe('other');
  });

  it('is "other" for a token_count line missing last_token_usage entirely', () => {
    const result = parseCodexLine(tokenCount({ last_token_usage: undefined }), 'gpt-5-codex');
    expect(result.kind).toBe('other');
  });
});
