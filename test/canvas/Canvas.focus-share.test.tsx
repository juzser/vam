// @vitest-environment happy-dom

/**
 * The stored focus zoom share has to reach the VIEWPORT, not just the store.
 *
 * A test that clicked the slider and then asserted
 * `prefs.focusViewportShare === 0.9` would pass with the entire wiring
 * deleted — the constant would still be what the canvas framed with. So this
 * one spies on `fitView` and compares against `focusPadding` called on the
 * stored share, never a hand-copied number: the criterion survives a change to
 * the formula and fails the moment the derivation goes back to the constant.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/** Typed with the two fields the assertions read, so `mock.calls` is not an
 *  empty tuple the compiler refuses to index. */
type FitViewOptions = { readonly nodes?: readonly string[]; readonly padding?: number };
const fitView = vi.fn((_options?: FitViewOptions) => Promise.resolve(true));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), fitView }),
  };
});

const { Canvas, focusPadding, FOCUS_VIEWPORT_SHARE } = await import(
  '../../src/renderer/canvas/Canvas.js'
);
type Model = import('../../src/renderer/domain/model.js').CanvasModel;
type Session = import('../../src/renderer/domain/model.js').Session;

function session(id: string): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: Model = {
  projects: [{ id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1')] }],
};

const KEY = 'vam.prefs.v1';

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  fitView.mockClear();
});

function paddingOfFocusFit(): number | undefined {
  // The row fit is the call that names nodes; the toolbar's bare `fitView()` is
  // not it, and asserting on the wrong one would read the default padding.
  return fitView.mock.calls.find((args) => args[0]?.nodes !== undefined)?.[0]?.padding;
}

describe('the focus zoom share reaches fitView', () => {
  it('frames the row with the padding derived from a stored 0.9', () => {
    localStorage.setItem(KEY, JSON.stringify({ focusViewportShare: 0.9 }));
    render(<Canvas model={MODEL} />);
    press('j');
    expect(paddingOfFocusFit()).toBe(focusPadding(0.9));
    // The two shares must actually differ, or the assertion above would pass
    // against the untouched constant.
    expect(focusPadding(0.9)).not.toBe(focusPadding(FOCUS_VIEWPORT_SHARE));
  });

  it('falls back to the shipped 0.6 when nothing is stored', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    expect(FOCUS_VIEWPORT_SHARE).toBe(0.6);
    expect(paddingOfFocusFit()).toBe(focusPadding(FOCUS_VIEWPORT_SHARE));
  });
});
