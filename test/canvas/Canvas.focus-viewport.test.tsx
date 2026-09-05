// @vitest-environment happy-dom

/**
 * Following focus INSIDE one session pans. It does not zoom.
 *
 * This file was written when the automatic zoom was removed wholesale, and its
 * subject has since been narrowed rather than dropped: the operator asked for
 * framing back, but for the whole session and on arriving in one. Within a
 * session nothing has changed and nothing may -- every node of it is already
 * on screen, so a scale change there could only fight a zoom the operator set
 * by hand, which is the complaint this file exists for. Crossing INTO a
 * session is `Canvas.session-fit.test.tsx`.
 *
 * The two assertions are still a pair on purpose. "The scale does not change"
 * alone would pass with the whole follow deleted; "the viewport moves" alone
 * would pass with nothing deleted at all.
 *
 * Both moved from `j`/`k` to `l`/`h` -- the keys that walk a session's own row,
 * card to step to step -- because `j`/`k` cross sessions and framing them is
 * now the wanted behaviour, not the bug. `fitBounds` joins `fitView` in the
 * "not called" assertion: it is the call the framing actually makes, and
 * without it that assertion would go quietly vacuous.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type CenterOptions = { readonly zoom?: number; readonly duration?: number };
type FitViewOptions = { readonly nodes?: readonly { readonly id: string }[] };
type Rect = { readonly x: number; readonly y: number };

const fitView = vi.fn((_options?: FitViewOptions) => Promise.resolve(true));
const fitBounds = vi.fn((_bounds: Rect, _options?: { readonly padding?: number }) =>
  Promise.resolve(true),
);
const setCenter = vi.fn((_x: number, _y: number, _options?: CenterOptions) =>
  Promise.resolve(true),
);

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), fitView, fitBounds, setCenter }),
  };
});

const { Canvas } = await import('../../src/renderer/canvas/Canvas.js');
type Model = import('../../src/renderer/domain/model.js').CanvasModel;
type Session = import('../../src/renderer/domain/model.js').Session;
type Decision = import('../../src/renderer/domain/model.js').Decision;

function decision(id: string): Decision {
  return { id, label: `step-${id}`, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

function session(id: string, decisions: Decision[] = []): Session {
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
    decisions,
  };
}

const MODEL: Model = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [session('a1', [decision('d1'), decision('d2')]), session('a2')],
    },
  ],
};

/** `l` walks off the first session's card onto its first step, `h` walks back
 *  — one session's own row, and the canvas must follow both ways. */
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
  fitBounds.mockClear();
  setCenter.mockClear();
});

describe('moving focus within one session', () => {
  it('does not change the zoom level', () => {
    render(<Canvas model={MODEL} />);
    press('l');
    press('h');

    // Framing a set of nodes is a scale change by construction: it picks
    // whatever zoom makes them fit. Inside a session nothing but the
    // operator's own controls may do that, so no automatic fit at all.
    expect(fitView).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
    // And the pan must not smuggle one in through the optional argument.
    for (const [, , options] of setCenter.mock.calls) {
      expect(options?.zoom).toBeUndefined();
    }
  });

  it('still brings the focused node into view', () => {
    render(<Canvas model={MODEL} />);
    press('l');
    const first = setCenter.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    press('h');
    // A second node, a second centring — on a different point, or the
    // canvas did not actually follow the cursor anywhere.
    expect(setCenter.mock.calls.length).toBeGreaterThan(first);
    const before = setCenter.mock.calls.at(first - 1)?.slice(0, 2);
    const after = setCenter.mock.calls.at(-1)?.slice(0, 2);
    expect(before).not.toEqual(after);
  });
});
