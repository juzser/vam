/**
 * WHEN THE PROMPT WAS RECORDED, AND WHEN THE WORK UNDER IT WAS.
 *
 * The In bubble pins a turn's prompt at the top of the column while the
 * activity line below it stays live. On a long turn those two are hours apart
 * and nothing said so, so an old prompt read as the current one -- two
 * different things looking the same, which is this pane's oldest defect.
 *
 * TWO FACTS, BOTH READ. The operator's own `user` line carries a `timestamp`
 * and so does every `assistant` line, measured across the corpus at 100% of
 * 1,236 prompt lines and 100% of 124,404 assistant lines. `type:'last-prompt'`
 * carries NONE -- 0 of 25,259 -- which is why this is attached to the turn the
 * operator's line opened and is null for a turn a marker opened alone. vam
 * does not invent a time for a line that has none.
 *
 * WHAT IT IS NOT. It is not a claim that the session is stalled, that the
 * operator has gone quiet, or that anything is wrong: a turn that runs for an
 * hour is ordinary here (measured: median 9.3 minutes, p75 28, p90 77). It is
 * two timestamps vam already read, reported rather than left implicit.
 *
 * The fixtures are shaped like the real record and invented whole: no
 * transcript content, no home paths, no usernames.
 */

import { describe, expect, it } from 'vitest';
import { summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';

type Json = Record<string, unknown>;

const jsonl = (...lines: Json[]) => lines.map((line) => JSON.stringify(line)).join('\n');

const typed = (text: string, timestamp: string): Json => ({
  type: 'user',
  promptId: 'p1',
  promptSource: 'typed',
  timestamp,
  message: { role: 'user', content: text },
});

const marker = (lastPrompt: string): Json => ({ type: 'last-prompt', lastPrompt });

const working = (timestamp: string): Json => ({
  type: 'assistant',
  timestamp,
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] },
});

const reply = (text: string, timestamp: string): Json => ({
  type: 'assistant',
  timestamp,
  message: { content: [{ type: 'text', text }] },
});

const newest = (text: string) => summarizeTranscript(text, 's').decisions[0];

describe('the turn carries when it was asked and when it last did anything', () => {
  it('reads both from the lines that have them', () => {
    const text = jsonl(
      typed('go on', '2026-09-14T01:00:00.000Z'),
      marker('go on'),
      working('2026-09-14T01:00:30.000Z'),
      working('2026-09-14T04:20:00.000Z'),
    );

    expect(newest(text)?.promptedAt).toBe('2026-09-14T01:00:00.000Z');
    expect(newest(text)?.latestAt).toBe('2026-09-14T04:20:00.000Z');
  });

  it('counts an answer as activity, not only a tool call', () => {
    const text = jsonl(
      typed('go on', '2026-09-14T01:00:00.000Z'),
      marker('go on'),
      reply('done', '2026-09-14T01:05:00.000Z'),
    );

    expect(newest(text)?.latestAt).toBe('2026-09-14T01:05:00.000Z');
  });

  /**
   * THE MARKER HAS NO CLOCK. 0 of 25,259 `last-prompt` lines carry a
   * timestamp, so a turn whose operator line is above the top of the window
   * has no honest time to report -- and reporting the first thing that
   * happened AFTER it would be reporting the answer's time as the question's.
   */
  it('reports no prompt time for a turn the marker opened alone', () => {
    const text = jsonl(marker('a long turn'), working('2026-09-14T04:20:00.000Z'));

    expect(newest(text)?.promptedAt).toBeNull();
    expect(newest(text)?.latestAt).toBe('2026-09-14T04:20:00.000Z');
  });

  it('reports no activity time for a turn that has not done anything yet', () => {
    const text = jsonl(typed('go on', '2026-09-14T01:00:00.000Z'), marker('go on'));

    expect(newest(text)?.promptedAt).toBe('2026-09-14T01:00:00.000Z');
    expect(newest(text)?.latestAt).toBeNull();
  });

  it('keeps each turn’s own pair, rather than the session’s newest', () => {
    const text = jsonl(
      typed('first', '2026-09-14T01:00:00.000Z'),
      marker('first'),
      reply('done', '2026-09-14T01:01:00.000Z'),
      typed('second', '2026-09-14T02:00:00.000Z'),
      marker('second'),
      working('2026-09-14T02:30:00.000Z'),
    );

    const all = summarizeTranscript(text, 's').decisions;
    // Newest first.
    expect(all.map((d) => d.promptedAt)).toEqual([
      '2026-09-14T02:00:00.000Z',
      '2026-09-14T01:00:00.000Z',
    ]);
    expect(all.map((d) => d.latestAt)).toEqual([
      '2026-09-14T02:30:00.000Z',
      '2026-09-14T01:01:00.000Z',
    ]);
  });

  it('ignores a line whose timestamp is not a string', () => {
    const text = jsonl(
      { ...typed('go on', '2026-09-14T01:00:00.000Z'), timestamp: 12345 },
      marker('go on'),
      { type: 'assistant', timestamp: null, message: { content: [{ type: 'text', text: 'x' }] } },
    );

    expect(newest(text)?.promptedAt).toBeNull();
    expect(newest(text)?.latestAt).toBeNull();
  });
});
