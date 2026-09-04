// @vitest-environment happy-dom

/**
 * The focus layout: the response in the middle, the canvas demoted to a strip.
 *
 * The two shipped layouts are subtractive — they hide a column and change
 * nothing else — and `panes.ts` said in as many words that a layout which
 * REORDERED the columns could not be expressed by a visibility record, because
 * the order lived in `Canvas.tsx`'s JSX. This file is the other half of that
 * sentence: a descriptor that carries an ORDER, and the assertions that make
 * the order observable rather than merely declared.
 *
 * Every order assertion here reads DOCUMENT ORDER. A test that only asked
 * whether all three columns exist would pass against the layout this file was
 * written to replace, which is another way of saying it would assert nothing.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { DEFAULT_ORDER, LAYOUTS } from '../../src/renderer/prefs/panes.js';

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

const PREFS_KEY = 'vam.prefs.v1';

function seed(payload: Record<string, unknown>) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
}

function stored(): Record<string, never> & {
  panes: { sidebar: number; detail: number };
  paneVisibility: { order?: string[]; sidebar: boolean; canvas: boolean; detail: boolean };
  theme?: string;
  focusViewportShare?: number;
} {
  return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
}

/**
 * The three columns in the order the DOM has them. One `querySelectorAll` over
 * all three selectors, because that returns document order — three separate
 * queries would only prove presence.
 */
const columnOrder = () =>
  [...document.querySelectorAll('[data-sidebar-pane],[data-canvas-pane],[data-action-pane]')].map(
    (el) =>
      el.hasAttribute('data-sidebar-pane')
        ? 'sidebar'
        : el.hasAttribute('data-canvas-pane')
          ? 'canvas'
          : 'detail',
  );

/** The session ids the canvas currently draws, deduplicated. */
const drawnSessions = () => [
  ...new Set(
    [...document.querySelectorAll('.react-flow__node')]
      .map((el) => (el.getAttribute('data-id') ?? '').split(':')[1] ?? '')
      .filter((id) => id !== ''),
  ),
];

const canvasPane = () => document.querySelector('[data-canvas-pane]') as HTMLElement | null;

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeAll(() => {
  // ReactFlow measures; happy-dom has no layout engine.
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the focus layout reorders the columns', () => {
  it('draws sidebar, then response, then canvas — in document order', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
  });

  it('leaves the shipped layout in its shipped order', () => {
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'canvas', 'detail']);
  });

  it('gives the demoted canvas a strip, narrower than the response beside it', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    const strip = Number.parseFloat(canvasPane()?.style.width ?? 'NaN');
    const detail = Number.parseFloat(
      (document.querySelector('[data-action-pane]') as HTMLElement | null)?.style.width ?? 'NaN',
    );
    expect(strip).toBeGreaterThan(0);
    expect(strip).toBeLessThan(detail);
  });
});

describe('the demoted canvas draws the focused session and nothing else', () => {
  it('drops the other sessions from the strip', () => {
    render(<Canvas model={MODEL} />);
    expect(drawnSessions().sort()).toEqual(['a1', 'a2']);
    cleanup();

    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(drawnSessions()).toEqual(['a1']);
  });

  it('follows the focus when it moves', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    press('j');
    expect(drawnSessions()).toEqual(['a2']);
  });
});

describe('z0 undoes it', () => {
  it('restores the shipped order and the stored widths', () => {
    seed({
      panes: { sidebar: 300, detail: 420 },
      paneVisibility: LAYOUTS.focusResponse,
    });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);

    press('z');
    press('0');

    expect(columnOrder()).toEqual(['sidebar', 'canvas', 'detail']);
    expect(stored().paneVisibility.order ?? DEFAULT_ORDER).toEqual([...DEFAULT_ORDER]);
    const sidebar = document.querySelector('[data-sidebar-pane]') as HTMLElement | null;
    const detail = document.querySelector('[data-action-pane]') as HTMLElement | null;
    expect(Number.parseFloat(sidebar?.style.width ?? 'NaN')).toBe(300);
    expect(Number.parseFloat(detail?.style.width ?? 'NaN')).toBe(420);
  });

  it('is reachable by its own chord', () => {
    render(<Canvas model={MODEL} />);
    press('z');
    press('f');
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
  });
});

describe('the layouts that shipped are unchanged', () => {
  it('keeps both subtractive layouts in the shipped order', () => {
    for (const name of ['noCanvas', 'responseOnly'] as const) {
      expect(LAYOUTS[name].order ?? DEFAULT_ORDER).toEqual([...DEFAULT_ORDER]);
    }
  });

  it('still hides the canvas for noCanvas and the sidebar for responseOnly', () => {
    seed({ paneVisibility: LAYOUTS.noCanvas });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail']);
    cleanup();

    seed({ paneVisibility: LAYOUTS.responseOnly });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['detail']);
  });
});

describe('a payload written before the descriptor existed', () => {
  it('loads in the shipped order and leaves unrelated settings alone', () => {
    seed({
      theme: 'light',
      focusViewportShare: 0.9,
      panes: { sidebar: 300, detail: 420 },
      paneVisibility: { sidebar: true, canvas: true, detail: true },
    });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'canvas', 'detail']);
    press('z');
    press('f');
    expect(stored().theme).toBe('light');
    expect(stored().focusViewportShare).toBe(0.9);
    expect(stored().panes).toEqual({ sidebar: 300, detail: 420 });
  });
});

describe('the settings picker offers it', () => {
  it('lists the focus layout and applies it when picked', () => {
    render(<Canvas model={MODEL} />);
    press(',');
    const option = document.querySelector(
      '[data-layout-option="focusResponse"]',
    ) as HTMLElement | null;
    expect(option).not.toBeNull();
    fireEvent.click(option as HTMLElement);
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
    expect(
      document
        .querySelector('[data-layout-option="focusResponse"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
