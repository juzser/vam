import { describe, expect, it } from 'vitest';
import { buildActions, clampIndex } from '../../src/renderer/canvas/actions.js';
import type { Command } from '../../src/renderer/domain/model.js';

const command = (id: string): Command => ({ id, label: id, command: `run ${id}` });

describe('buildActions', () => {
  it('always ends with the prompt, even with nothing else to do', () => {
    // The one action that does not depend on the step having proposed
    // anything, so `I` always has somewhere to land.
    expect(buildActions([]).map((a) => a.kind)).toEqual(['prompt']);
  });

  it('holds nothing the pane does not draw', () => {
    // It used to hold two stops per waivable finding and two per lesson
    // candidate, from a governance queue the pane had stopped rendering. The
    // cursor walked them invisibly and `Enter` filed a real decision with the
    // factory. Only commands and the prompt are drawn, so only those are here;
    // test/panels/action-parity.test.tsx checks that against the DOM.
    const kinds = new Set(buildActions([command('c-1'), command('c-2')]).map((a) => a.kind));
    expect([...kinds].sort()).toEqual(['command', 'prompt']);
  });

  it('keeps one stop per command, in the order they were proposed', () => {
    // A command has one thing to do, and the order matches the DOM so `j`
    // moves down the screen rather than around it.
    const actions = buildActions([command('c-1'), command('c-2')]);
    expect(actions.map((a) => a.id)).toEqual(['command:c-1', 'command:c-2', 'prompt']);
  });

  it('gives every action a distinct id, and names the row it belongs to', () => {
    // `i` puts the keyboard on rowId's own control.
    const actions = buildActions([command('c-1'), command('c-2')]);
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
    expect(actions[0]?.rowId).toBe('c-1');
    expect(actions[2]?.rowId).toBeNull();
  });
});

describe('clampIndex', () => {
  it('leaves an index that is already in range alone', () => {
    expect(clampIndex(1, 3)).toBe(1);
  });

  it('pulls a dangling index back onto the last entry', () => {
    // A step with fewer commands shortens the list. An index past the end
    // silently becomes "nothing selected", so Enter would do nothing and the
    // pane would look broken rather than empty.
    expect(clampIndex(5, 3)).toBe(2);
  });

  it('never goes below zero', () => {
    expect(clampIndex(-2, 3)).toBe(0);
  });

  it('answers 0 for an empty list rather than -1', () => {
    expect(clampIndex(2, 0)).toBe(0);
  });
});
