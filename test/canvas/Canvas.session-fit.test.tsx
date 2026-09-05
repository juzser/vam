// @vitest-environment happy-dom

/**
 * Focusing a session FRAMES THE SESSION -- root card and step nodes together.
 *
 * The operator's words: the canvas should not zoom to the root node but to the
 * whole session, its step nodes included, by a share of the canvas width they
 * can set.
 *
 * This is a deliberate partial reversal. An earlier fit was removed because it
 * fought a zoom the operator had set by hand, and the reason it could is that
 * it fired on EVERY focus move -- including the ones inside a session, where
 * the framing was already right and the only thing a re-fit could do was
 * undo whatever the operator had just done. So the two halves are pinned
 * separately here: crossing into another session frames it, moving about
 * inside one does not touch the scale at all.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Rect = { readonly x: number; readonly y: number; width: number; height: number };
type FitOptions = { readonly padding?: number; readonly duration?: number };
type CenterOptions = { readonly zoom?: number; readonly duration?: number };

const fitBounds = vi.fn((_bounds: Rect, _options?: FitOptions) => Promise.resolve(true));
const setCenter = vi.fn((_x: number, _y: number, _o?: CenterOptions) => Promise.resolve(true));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), fitBounds, setCenter }),
  };
});

const { Canvas, focusPadding, FOCUS_VIEWPORT_SHARE } = await import(
  '../../src/renderer/canvas/Canvas.js'
);
const { layoutCanvas } = await import('../../src/renderer/canvas/layout.js');
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

/** Two sessions, the first with steps: one `j` crosses sessions, one `l` walks
 *  the first session's own row from its card onto a step. */
const MODEL: Model = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [session('a1', [decision('d1'), decision('d2')]), session('a2', [decision('e1')])],
    },
  ],
};

const KEY = 'vam.prefs.v1';

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** The rectangle the last framing used. */
function framed(): Rect | undefined {
  return fitBounds.mock.calls.at(-1)?.[0];
}

function paddingUsed(): number | undefined {
  return fitBounds.mock.calls.at(-1)?.[1]?.padding;
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
  fitBounds.mockClear();
  setCenter.mockClear();
});

describe('focusing another session frames the whole session', () => {
  it('fits a rectangle holding the step nodes, not just the root card', () => {
    render(<Canvas model={MODEL} />);
    press('j');

    const box = framed();
    expect(box).toBeDefined();
    if (box === undefined) return;

    // The step's own laid-out rectangle, from the module that places it --
    // never from the function under test, which would make this a tautology.
    const steps = layoutCanvas(MODEL).nodes.filter(
      (n) => n.kind === 'step' && n.entry.session.id === 'a2',
    );
    expect(steps).toHaveLength(1);
    for (const step of steps) {
      expect(step.position.x).toBeGreaterThanOrEqual(box.x);
      expect(step.position.x + step.size.width).toBeLessThanOrEqual(box.x + box.width);
      expect(step.position.y).toBeGreaterThanOrEqual(box.y);
      expect(step.position.y + step.size.height).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it('frames to the stored share, not to a constant', () => {
    localStorage.setItem(KEY, JSON.stringify({ focusViewportShare: 0.9 }));
    render(<Canvas model={MODEL} />);
    press('j');
    expect(paddingUsed()).toBe(focusPadding(0.9));
    // The two must really differ, or the assertion would pass against the
    // shipped default and say nothing about the stored value reaching here.
    expect(focusPadding(0.9)).not.toBe(focusPadding(FOCUS_VIEWPORT_SHARE));
  });

  it('changing the setting changes the framing', () => {
    localStorage.setItem(KEY, JSON.stringify({ focusViewportShare: 0.4 }));
    render(<Canvas model={MODEL} />);
    press('j');
    const tight = paddingUsed();

    cleanup();
    fitBounds.mockClear();
    localStorage.setItem(KEY, JSON.stringify({ focusViewportShare: 0.95 }));
    render(<Canvas model={MODEL} />);
    press('j');

    expect(tight).toBe(focusPadding(0.4));
    expect(paddingUsed()).toBe(focusPadding(0.95));
    expect(paddingUsed()).not.toBe(tight);
  });
});

describe('the framing fires when the SESSION changes, and only then', () => {
  it('leaves the scale alone while focus moves within one session', () => {
    render(<Canvas model={MODEL} />);
    fitBounds.mockClear();
    // `l` walks the focused session's own row, card to step: the framing is
    // already correct, so re-fitting could only fight a zoom the operator set.
    press('l');
    expect(fitBounds).not.toHaveBeenCalled();
    // It still follows, and still without a scale change -- the behaviour the
    // focus-viewport pair pins.
    expect(setCenter.mock.calls.length).toBeGreaterThan(0);
    for (const [, , options] of setCenter.mock.calls) {
      expect(options?.zoom).toBeUndefined();
    }
  });

  it('does not frame on the opening render, which owns its own viewport', () => {
    // Focus lands on a session shortly after mount without anybody moving it.
    // That is not a move between sessions, and the opening zoom is not this
    // effect's to set.
    render(<Canvas model={MODEL} />);
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe('the share can be turned off', () => {
  it('never frames when the stored share is off, but still follows focus', () => {
    localStorage.setItem(KEY, JSON.stringify({ focusViewportShare: 0 }));
    render(<Canvas model={MODEL} />);
    press('j');
    press('l');
    expect(fitBounds).not.toHaveBeenCalled();
    expect(setCenter.mock.calls.length).toBeGreaterThan(0);
  });
});
