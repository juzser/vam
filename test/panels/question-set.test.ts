/**
 * Grouping the questions of one `AskUserQuestion` call.
 *
 * The pane drew one question per session and the model has always carried a
 * set: `<tool_use id>:<position>`, closed by one `tool_result`. For a
 * two-question call that meant the first question was never on screen -- not
 * collapsed, not summarised, absent.
 */

import { describe, expect, it } from 'vitest';
import type { AgentQuestion } from '../../src/renderer/domain/model.js';
import { newestSet, toolUseOf } from '../../src/renderer/panels/question-set.js';

const q = (id: string, answer: string | null = null): AgentQuestion => ({
  id,
  header: null,
  question: `Q ${id}`,
  multiSelect: false,
  options: [{ label: 'a', description: null }],
  answer,
});

describe('the call an id belongs to', () => {
  it('is everything before the position', () => {
    expect(toolUseOf('toolu_01ABC:0')).toBe('toolu_01ABC');
    expect(toolUseOf('toolu_01ABC:11')).toBe('toolu_01ABC');
  });

  it('is the whole id when there is no position, rather than an empty key', () => {
    // An empty key would make every such question one set with every other.
    expect(toolUseOf('bare')).toBe('bare');
  });
});

describe('the set the card draws', () => {
  it('is every question of the call holding the newest open one, in asking order', () => {
    const set = newestSet([q('a:0'), q('b:0'), q('b:1'), q('b:2')]);
    expect(set.map((one) => one.id)).toEqual(['b:0', 'b:1', 'b:2']);
  });

  it('prefers a call that is still open over a newer one that is settled', () => {
    const set = newestSet([q('a:0'), q('a:1'), q('b:0', 'done'), q('b:1', 'done')]);
    expect(set.map((one) => one.id)).toEqual(['a:0', 'a:1']);
  });

  it('falls back to the newest settled call when nothing is open', () => {
    const set = newestSet([q('a:0', 'x'), q('b:0', 'y'), q('b:1', 'z')]);
    expect(set.map((one) => one.id)).toEqual(['b:0', 'b:1']);
  });

  it('is empty for a session that has asked nothing', () => {
    expect(newestSet([])).toEqual([]);
  });
});
