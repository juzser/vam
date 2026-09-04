// @vitest-environment happy-dom

/**
 * Following focus PANS. It does not zoom.
 *
 * The operator asked for the automatic zoom onto a node or a session to go,
 * and only that: walking with `j`/`k` must still bring the focused session
 * into view, because a canvas that does not follow the cursor is the bug the
 * follow behaviour was added to fix in the first place.
 *
 * The two assertions are a pair on purpose. "The scale does not change" alone
 * would pass with the whole follow deleted; "the viewport moves" alone would
 * pass with nothing deleted at all. Only together do they pin the one thing
 * that was removed.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type CenterOptions = { readonly zoom?: number; readonly duration?: number };
type FitViewOptions = { readonly nodes?: readonly { readonly id: string }[] };

const fitView = vi.fn((_options?: FitViewOptions) => Promise.resolve(true));
const setCenter = vi.fn((_x: number, _y: number, _options?: CenterOptions) => Promise.resolve(true));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), fitView, setCenter }),
  };
});

const { Canvas } = await import('../../src/renderer/canvas/Canvas.js');
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
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [session('a1'), session('a2')],
    },
  ],
};

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
  setCenter.mockClear();
});

describe('moving focus between sessions', () => {
  it('does not change the zoom level', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    press('j');

    // Framing a set of nodes is a scale change by construction: it picks
    // whatever zoom makes them fit. Nothing but the operator's own controls
    // may do that, so no automatic fit at all.
    expect(fitView).not.toHaveBeenCalled();
    // And the pan must not smuggle one in through the optional argument.
    for (const [, , options] of setCenter.mock.calls) {
      expect(options?.zoom).toBeUndefined();
    }
  });

  it('still brings the focused session into view', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    const first = setCenter.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    press('j');
    // A second session, a second centring — on a different point, or the
    // canvas did not actually follow the cursor anywhere.
    expect(setCenter.mock.calls.length).toBeGreaterThan(first);
    const [ax, ay] = setCenter.mock.calls[first - 1];
    const [bx, by] = setCenter.mock.calls[setCenter.mock.calls.length - 1];
    expect([ax, ay]).not.toEqual([bx, by]);
  });
});
