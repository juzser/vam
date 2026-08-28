import { describe, expect, it } from 'vitest';
import type { ApiFinding, ApiLesson } from '../../src/adapter/api.js';
import { buildActions, clampIndex } from '../../src/canvas/actions.js';
import type { Command } from '../../src/domain/model.js';

const finding = (fingerprint: string): ApiFinding => ({
  findingId: `f-${fingerprint}`,
  taskId: 't-1',
  fingerprint,
  severity: 'S3-minor',
  findingStatus: 'raised',
  summary: 's',
  foundBy: 'reviewer',
  waiverId: null,
});

const lesson = (lessonId: string): ApiLesson => ({
  lessonId,
  sessionId: 's1',
  lessonType: 'rule',
  lessonScope: 'stack-wide',
  lessonStatus: 'candidate',
  statement: 'st',
});

const command = (id: string): Command => ({ id, label: id, command: `run ${id}` });

describe('buildActions', () => {
  it('always ends with the prompt, even with nothing else to do', () => {
    // The one action that does not depend on the factory having asked
    // anything, so `I` always has somewhere to land.
    expect(buildActions([], [], []).map((a) => a.kind)).toEqual(['prompt']);
  });

  it('gives each row two stops, conservative verdict first', () => {
    // `j` from above stops on the answer that changes nothing; reaching the one
    // that accepts a defect takes one more deliberate press.
    expect(buildActions([finding('fp-1')], [], []).map((a) => a.id)).toEqual([
      'waiver:fp-1:denied',
      'waiver:fp-1:granted',
      'prompt',
    ]);
    expect(buildActions([], [lesson('l-1')], []).map((a) => a.id)).toEqual([
      'lesson:l-1:reject',
      'lesson:l-1:approve',
      'prompt',
    ]);
  });

  it('orders waivers, then lessons, then commands, then the prompt', () => {
    // The order the pane draws them, so `j` moves down the screen rather than
    // around it.
    const actions = buildActions([finding('fp-1')], [lesson('l-1')], [command('c-1')]);
    expect(actions.map((a) => a.kind)).toEqual([
      'waiver',
      'waiver',
      'lesson',
      'lesson',
      'command',
      'prompt',
    ]);
  });

  it('gives every action a distinct id, and names the row it belongs to', () => {
    // `i` opens the note box on rowId, and two buttons share one row.
    const actions = buildActions([finding('fp-1')], [], []);
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
    expect(actions[0]?.rowId).toBe('fp-1');
    expect(actions[1]?.rowId).toBe('fp-1');
  });

  it('keeps one stop per command, because a command has one thing to do', () => {
    const actions = buildActions([], [], [command('c-1'), command('c-2')]);
    expect(actions.map((a) => a.id)).toEqual(['command:c-1', 'command:c-2', 'prompt']);
  });
});

describe('clampIndex', () => {
  it('leaves an index that is already in range alone', () => {
    expect(clampIndex(1, 3)).toBe(1);
  });

  it('pulls a dangling index back onto the last entry', () => {
    // Answering a queue row removes it. An index past the end silently becomes
    // "nothing selected", so Enter would do nothing and the pane would look
    // broken rather than answered.
    expect(clampIndex(5, 3)).toBe(2);
  });

  it('never goes below zero', () => {
    expect(clampIndex(-2, 3)).toBe(0);
  });

  it('answers 0 for an empty list rather than -1', () => {
    expect(clampIndex(2, 0)).toBe(0);
  });
});
