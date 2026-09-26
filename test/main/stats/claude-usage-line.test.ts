/**
 * Reading ONE Claude Code transcript line for its token usage — real-shaped
 * fixtures (measured against the operator's own machine, values invented),
 * malformed lines included: a truncated tail line, a line that is valid JSON
 * but not an object, and ordinary lines this scanner has nothing to learn
 * from (a `user` line, a `last-prompt` marker). Every one of those must be
 * SKIPPED rather than thrown on, and the malformed ones must be
 * DISTINGUISHABLE from "not a usage line" so a scan can count them.
 */
import { describe, expect, it } from 'vitest';
import { parseClaudeUsageLine } from '../../../src/main/stats/claude-usage-line.js';

const assistantLine = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-04T08:12:31.919Z',
    sessionId: 'd2bfee91-90d4-4b72-95e2-34550cc6ea63',
    message: {
      model: 'claude-3-5-sonnet-20241022',
      role: 'assistant',
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 13069,
        cache_read_input_tokens: 26448,
        output_tokens: 239,
        output_tokens_details: { thinking_tokens: 41 },
      },
    },
    ...over,
  });

describe('parseClaudeUsageLine', () => {
  it('reads an assistant line into a usage event', () => {
    const result = parseClaudeUsageLine(assistantLine());
    expect(result.kind).toBe('usage');
    if (result.kind !== 'usage') throw new Error('unreachable');
    expect(result.event).toEqual({
      atMs: Date.parse('2026-09-04T08:12:31.919Z'),
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 2,
      outputTokens: 239,
      cacheWriteTokens: 13069,
      cacheReadTokens: 26448,
      reasoningTokens: 41,
    });
  });

  it('treats missing token fields as zero, never as a malformed line', () => {
    const result = parseClaudeUsageLine(
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-04T08:12:31.919Z',
        message: { model: 'claude-3-5-sonnet-20241022', usage: { input_tokens: 5 } },
      }),
    );
    expect(result.kind).toBe('usage');
    if (result.kind !== 'usage') throw new Error('unreachable');
    expect(result.event.outputTokens).toBe(0);
    expect(result.event.cacheWriteTokens).toBe(0);
    expect(result.event.cacheReadTokens).toBe(0);
    expect(result.event.reasoningTokens).toBe(0);
  });

  it('is "other" for a user line — a real line this scanner learns nothing from', () => {
    const result = parseClaudeUsageLine(
      JSON.stringify({ type: 'user', timestamp: '2026-09-04T08:12:00.000Z', message: {} }),
    );
    expect(result.kind).toBe('other');
  });

  it('is "other" for an assistant line with no usage object at all', () => {
    const result = parseClaudeUsageLine(
      JSON.stringify({ type: 'assistant', message: { model: 'x' } }),
    );
    expect(result.kind).toBe('other');
  });

  it('is "other" for a blank line', () => {
    expect(parseClaudeUsageLine('').kind).toBe('other');
    expect(parseClaudeUsageLine('   ').kind).toBe('other');
  });

  it('is "malformed" for a truncated tail line — the ordinary shape of the last line of a file being appended to', () => {
    const truncated = assistantLine().slice(0, 40);
    expect(parseClaudeUsageLine(truncated).kind).toBe('malformed');
  });

  it('is "malformed" for valid JSON that is not an object', () => {
    expect(parseClaudeUsageLine('42').kind).toBe('malformed');
    expect(parseClaudeUsageLine('"just a string"').kind).toBe('malformed');
    expect(parseClaudeUsageLine('[1,2,3]').kind).toBe('malformed');
  });

  it('is "other" for an assistant line missing a usable timestamp, since there is nothing to bucket it by', () => {
    const result = parseClaudeUsageLine(assistantLine({ timestamp: undefined }));
    expect(result.kind).toBe('other');
  });
});
