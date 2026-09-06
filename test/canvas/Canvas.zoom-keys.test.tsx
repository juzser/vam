// @vitest-environment happy-dom

/**
 * Zoom in / zoom out / fit view get a key.
 *
 * All three shipped mouse-only: `Canvas.tsx` drew the zoom strip and the fit
 * button with no `KeyAction` behind them at all — not merely unbound, there
 * was no slot for one in the grammar's own union. An operator navigating a
 * busy canvas with the keyboard had no way to change the zoom level without
 * reaching for the mouse.
 *
 * This asserts the actions are reachable BY KEYSTROKE, dispatched at
 * `window` exactly the way an operator's key press arrives — not that a
 * binding string merely exists in `BINDING_TABLES`, which would prove the
 * entry was typed and nothing about whether a keystroke reaches the
 * ReactFlow handler.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const zoomIn = vi.fn();
const zoomOut = vi.fn();
const fitView = vi.fn();

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), zoomIn, zoomOut, fitView }),
  };
});

const { Canvas } = await import('../../src/renderer/canvas/Canvas.js');
const { buildKeySheet } = await import('../../src/renderer/keyboard/keysheet.js');
type CanvasModel = import('../../src/renderer/domain/model.js').CanvasModel;

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [
        {
          id: 'a1',
          title: 'a1',
          icon: null,
          epic: null,
          branch: null,
          status: 'done',
          runningAgents: 0,
          activity: null,
          age: null,
          decisions: [],
        },
      ],
    },
  ],
};

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** Every row the generated sheet lists, whatever group it landed in. */
function sheetRows() {
  return buildKeySheet().flatMap(({ rows }) => rows);
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(() => {
  cleanup();
  zoomIn.mockClear();
  zoomOut.mockClear();
  fitView.mockClear();
});

describe('zoom and fit are reachable from the keyboard', () => {
  it('reaches zoomIn/zoomOut/fitView on `+`/`-`/`Z`, each key uniquely', () => {
    render(<Canvas model={MODEL} />);
    press('+');
    press('-');
    press('Z');
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).toHaveBeenCalledTimes(1);
    expect(fitView).toHaveBeenCalledTimes(1);

    const keys = sheetRows().map((r) => r.keys);
    for (const key of ['+', '-', 'Z']) {
      expect(keys.filter((k) => k === key)).toHaveLength(1);
    }
  });

  it('the generated sheet lists all three, by label, with the right key', () => {
    const rows = sheetRows();
    expect(rows.some((r) => /zoom in/i.test(r.label) && r.keys === '+')).toBe(true);
    expect(rows.some((r) => /zoom out/i.test(r.label) && r.keys === '-')).toBe(true);
    expect(rows.some((r) => /fit the whole canvas/i.test(r.label) && r.keys === 'Z')).toBe(true);
  });

  it('an open overlay still owns the keyboard: no zoom behind the shortcut sheet', () => {
    render(<Canvas model={MODEL} />);
    press('?');
    expect(document.querySelector('[data-key-sheet]')).not.toBeNull();
    press('+');
    expect(zoomIn).not.toHaveBeenCalled();
  });
});
