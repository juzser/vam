import { describe, expect, it } from 'vitest';
import { buildActions, clampIndex } from '../../src/renderer/canvas/actions.js';

describe('buildActions', () => {
  it('is the prompt, and only the prompt', () => {
    // The one action that does not depend on the step having proposed
    // anything, so `I` always has somewhere to land.
    expect(buildActions().map((a) => a.kind)).toEqual(['prompt']);
  });

  it('holds nothing the pane does not draw', () => {
    // It used to hold two stops per waivable finding and two per lesson
    // candidate, from a governance queue the pane had stopped rendering. The
    // cursor walked them invisibly and `Enter` filed a real decision with the
    // factory. It then held one per proposed command, until the operator asked
    // for the command strip to go: those commands are now offered by the `!`
    // typeahead inside the prompt box, which exists only while it is being
    // typed into and so is nowhere a pane cursor can rest. The rule is the
    // same one either way -- an action nothing draws is an invisible button --
    // and test/panels/action-parity.test.tsx checks it against the DOM.
    expect(buildActions().map((a) => a.id)).toEqual(['prompt']);
  });

  it('gives every action a distinct id', () => {
    const actions = buildActions();
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
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
