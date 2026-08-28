import { describe, expect, it } from 'vitest';
import { type ChordState, EMPTY_CHORD, resolveChord } from '../../src/keyboard/chords.js';

/** Feed a whole sequence and return the actions it produced, in order. */
function type(keys: string[], from: ChordState = EMPTY_CHORD) {
  let state = from;
  const actions = [];
  for (const key of keys) {
    const step = resolveChord(state, key);
    state = step.state;
    if (step.action !== null) {
      actions.push(step.action);
    }
  }
  return { state, actions };
}

describe('resolveChord — single keys', () => {
  it('maps hjkl to the four directions', () => {
    expect(type(['h']).actions).toEqual([{ kind: 'move', direction: 'left' }]);
    expect(type(['j']).actions).toEqual([{ kind: 'move', direction: 'down' }]);
    expect(type(['k']).actions).toEqual([{ kind: 'move', direction: 'up' }]);
    expect(type(['l']).actions).toEqual([{ kind: 'move', direction: 'right' }]);
  });

  it('maps the standalone keys from §4', () => {
    expect(type(['f']).actions).toEqual([{ kind: 'jump' }]);
    expect(type(['G']).actions).toEqual([{ kind: 'last' }]);
    expect(type(['/']).actions).toEqual([{ kind: 'search' }]);
    expect(type(['n']).actions).toEqual([{ kind: 'searchNext' }]);
    expect(type(['N']).actions).toEqual([{ kind: 'searchPrev' }]);
    expect(type(['Enter']).actions).toEqual([{ kind: 'open' }]);
    expect(type(['Escape']).actions).toEqual([{ kind: 'cancel' }]);
  });

  it('ignores a key that means nothing here', () => {
    expect(type(['q']).actions).toEqual([]);
  });
});

describe('resolveChord — two-key chords', () => {
  it('gg goes to the first node', () => {
    expect(type(['g', 'g']).actions).toEqual([{ kind: 'first' }]);
  });

  it('gt and gT step between projects', () => {
    expect(type(['g', 't']).actions).toEqual([{ kind: 'project', delta: 1 }]);
    expect(type(['g', 'T']).actions).toEqual([{ kind: 'project', delta: -1 }]);
  });

  it('yy copies the commands', () => {
    expect(type(['y', 'y']).actions).toEqual([{ kind: 'copy' }]);
  });

  it('emits nothing on the first key of a chord', () => {
    const { actions, state } = type(['g']);
    expect(actions).toEqual([]);
    expect(state.pending).toBe('g');
  });

  it('clears the chord once it completes, so ggg is not gg twice', () => {
    const { actions, state } = type(['g', 'g', 'g']);
    expect(actions).toEqual([{ kind: 'first' }]);
    expect(state.pending).toBe('g');
  });
});

describe('resolveChord — abandoning a chord', () => {
  it('drops an unfinished chord rather than acting on its second key', () => {
    // `gj` is not a binding. It must do nothing at all — silently falling
    // through to plain `j` would move the cursor somewhere the person did not
    // ask to go, which is worse than ignoring the key.
    const { actions, state } = type(['g', 'j']);
    expect(actions).toEqual([]);
    expect(state.pending).toBeNull();
  });

  it('lets the next key work normally after an abandoned chord', () => {
    expect(type(['g', 'j', 'j']).actions).toEqual([{ kind: 'move', direction: 'down' }]);
  });

  it('Escape cancels a half-typed chord and reports the cancel', () => {
    const { actions, state } = type(['g', 'Escape']);
    expect(actions).toEqual([{ kind: 'cancel' }]);
    expect(state.pending).toBeNull();
  });

  it('y then g does not become a g chord', () => {
    const { actions, state } = type(['y', 'g']);
    expect(actions).toEqual([]);
    expect(state.pending).toBeNull();
  });
});

describe('resolveChord — purity', () => {
  it('never mutates the state it is handed', () => {
    const before: ChordState = { pending: 'g' };
    resolveChord(before, 'g');
    expect(before.pending).toBe('g');
  });
});
