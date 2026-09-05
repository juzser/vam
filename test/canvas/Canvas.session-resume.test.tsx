// @vitest-environment happy-dom

/**
 * Coming back to where you were, through the component and not just the store.
 *
 * WHAT A RELAUNCH ACTUALLY LOSES, measured before any of this was written: not
 * the sessions. vam starts each one in a tmux session it owns, the tmux server
 * is a process vam's exit does not touch, the project tag vam writes on that
 * session survives both the client exiting and a rename, and `useSourceModel`
 * re-reads the source on mount. The work is still there when vam comes back.
 * The CURSOR is what is lost -- focus and the showing tab are React state
 * seeded to a constant -- so the operator returns to their sessions and not to
 * their place in them.
 *
 * A remount is the relaunch. `readPrefs` runs in the `useState` initialiser, so
 * unmounting and rendering again against the same storage is exactly the path a
 * fresh launch takes, and it is the only way to prove the two halves are
 * WIRED: the store round trip was already green while nothing wrote the field,
 * which is the state a stored-and-defended pointer nobody reads leaves you in.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

function decision(id: string): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

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
    decisions: [decision(`d-${id}`)],
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1'), session('a2')] },
  ],
};

/** The same model with the second session ended -- what a relaunch finds when
 *  the remembered session finished while vam was closed. */
const WITHOUT_A2: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1')] }],
};

const PREFS_KEY = 'vam.prefs.v1';

function seed(payload: Record<string, unknown>) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
}

/** Which session the keyboard is on, read off the detail pane's header -- the
 *  same hook `Canvas.keyboard.test.tsx` reads, for its reason. */
const focused = () => document.querySelector('[data-prompt-target]')?.textContent ?? '';

const currentTab = () =>
  document.querySelector('[data-tab][aria-pressed="true"]')?.getAttribute('data-tab') ?? null;

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

// The same three shims the other Canvas tests install, for the same reason:
// ReactFlow measures, and this happy-dom has neither a layout engine nor a
// `localStorage`.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  globalThis.localStorage ??= (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  })() as unknown as Storage;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the focused session, across a relaunch', () => {
  it('records where focus landed, keyed by source and session', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    expect(focused()).toBe('a2');
    expect(stored().lastFocus).toEqual({ source: 'black-smith', session: 'a2' });
  });

  it('lands back on the remembered session after a remount', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    expect(focused()).toBe('a2');
    cleanup();

    render(<Canvas model={MODEL} />);
    expect(focused()).toBe('a2');
  });

  it('lands on the first session, not on nothing, when the remembered one has ended', () => {
    seed({ lastFocus: { source: 'black-smith', session: 'a2' } });
    render(<Canvas model={WITHOUT_A2} />);
    expect(focused()).toBe('a1');
  });

  it('lands on the first session when nothing was ever remembered', () => {
    render(<Canvas model={MODEL} />);
    expect(focused()).toBe('a1');
  });
});

/**
 * Recording focus means a launch writes preferences without the operator
 * touching anything, which is a real behaviour change and the one worth
 * bounding. These pin what it costs: ONE write, on the launch that has nothing
 * remembered yet, and none at all on every launch after -- because the pointer
 * the landing effect resolves FROM storage is the pointer it would write back,
 * and the guard compares by value, so a fresh object each render still matches.
 * A launch that wrote every time would be a store rewritten on every open, and
 * a rewrite drops any key this version does not model.
 */
describe('what a launch that touches nothing costs', () => {
  /** Every write to the prefs key, in order, while `body` runs. */
  function writes(body: () => void): string[] {
    const seen: string[] = [];
    const real = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key: string, value: string) => {
      if (key === PREFS_KEY) seen.push(value);
      real(key, value);
    };
    try {
      body();
    } finally {
      localStorage.setItem = real;
    }
    return seen;
  }

  it('writes twice on the first launch — once per field — and then settles', () => {
    const first = writes(() => render(<Canvas model={MODEL} />));
    // Two, not one, and the count is asserted rather than bounded: the tab
    // settles to its default and focus lands, each once, from two independent
    // effects. Anything more than two would be an effect re-triggering itself.
    expect(first).toHaveLength(2);
    expect(JSON.parse(first[0] ?? '{}').detailTab).toBe('Response');
    expect(JSON.parse(first[1] ?? '{}').lastFocus).toEqual({
      source: 'black-smith',
      session: 'a1',
    });
  });

  it('writes nothing at all on the next launch, having nothing new to say', () => {
    render(<Canvas model={MODEL} />);
    cleanup();
    expect(writes(() => render(<Canvas model={MODEL} />))).toEqual([]);
  });

  it('keeps every key it does not model, because it never rewrites unprompted', () => {
    seed({
      lastFocus: { source: 'black-smith', session: 'a1' },
      detailTab: 'Response',
      somethingNewer: 7,
    });
    render(<Canvas model={MODEL} />);
    expect(stored().somethingNewer).toBe(7);
  });
});

describe('the detail tab, across a relaunch', () => {
  it('comes back to the tab the operator left it on', () => {
    render(<Canvas model={MODEL} />);
    expect(currentTab()).toBe('response');
    act(() => {
      fireEvent.click(document.querySelector('[data-tab="agents"]') as HTMLElement);
    });
    expect(currentTab()).toBe('agents');
    expect(stored().detailTab).toBe('Agents');
    cleanup();

    render(<Canvas model={MODEL} />);
    expect(currentTab()).toBe('agents');
  });

  it('falls back to the default tab when the stored name is not one, resetting nothing else', () => {
    seed({
      detailTab: 'Sprockets',
      theme: 'light',
      lastFocus: { source: 'black-smith', session: 'a2' },
    });
    render(<Canvas model={MODEL} />);
    expect(currentTab()).toBe('response');
    // The bad tab cost only itself: its two neighbours still applied.
    expect(focused()).toBe('a2');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('falls back to the default tab when the stored value is not a string', () => {
    seed({ detailTab: 42 });
    render(<Canvas model={MODEL} />);
    expect(currentTab()).toBe('response');
  });
});
