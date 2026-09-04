// @vitest-environment happy-dom

/**
 * A hidden pane is a pane that is not there.
 *
 * vam's two side panes are resizable, and every path that touches a width —
 * `clampPaneWidth`, `setPaneWidth`, `readPanes`, `dragCeiling`, `renderedWidth`
 * — floors at that pane's MIN on purpose: `panes.ts` says a width that rendered
 * at 0 "would be a pane that has vanished", and it is right. So visibility
 * cannot be a width of zero. It is a sibling flag, and hiding is unmounting.
 *
 * Which makes the flag the small half of the work. The large half is that three
 * pieces of Canvas.tsx assume both panes are on screen: `I` moves the cursor
 * into the detail pane checking only that a session is focused, `>` picks its
 * target from the focused pane alone, and the width arithmetic hands each pane
 * its sibling's width whether or not the sibling is drawn. Each of those is a
 * defect the moment a pane can be absent — a cursor on something nothing
 * draws is exactly the defect this codebase removed one commit ago — so each is
 * asserted here.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { DEFAULT_PANES, type PaneVisibility } from '../../src/renderer/prefs/panes.js';

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
  projects: [{ id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1')] }],
};

const PREFS_KEY = 'vam.prefs.v1';

/** Seed the store the way a previous session would have left it. */
function storeVisibility(visible: Partial<PaneVisibility>, panes = DEFAULT_PANES) {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      panes,
      paneVisibility: { sidebar: true, canvas: true, detail: true, ...visible },
    }),
  );
}

function readStoredPanes(): { sidebar: number; detail: number } {
  return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').panes;
}

const sidebarPane = () => document.querySelector('[data-sidebar-pane]');
const canvasPane = () => document.querySelector('[data-canvas-pane]');
const detailPane = () => document.querySelector('[data-action-pane]');
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const actionPane = () => detailPane()?.getAttribute('data-action-pane') ?? '';
const width = (el: Element | null) =>
  Number.parseFloat((el as HTMLElement | null)?.style.width ?? 'NaN');

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

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

describe('a hidden pane leaves the DOM', () => {
  it('draws all three by default', () => {
    render(<Canvas model={MODEL} />);
    expect(sidebarPane()).not.toBeNull();
    expect(canvasPane()).not.toBeNull();
    expect(detailPane()).not.toBeNull();
  });

  it('unmounts the sidebar rather than narrowing it', () => {
    storeVisibility({ sidebar: false });
    render(<Canvas model={MODEL} />);
    expect(sidebarPane()).toBeNull();
    // Not merely narrow: nothing on screen carries the sidebar's own controls.
    expect(document.querySelector('[data-session-row]')).toBeNull();
  });

  it('unmounts the canvas and the detail pane too', () => {
    storeVisibility({ canvas: false, detail: false });
    render(<Canvas model={MODEL} />);
    expect(canvasPane()).toBeNull();
    expect(detailPane()).toBeNull();
    expect(sidebarPane()).not.toBeNull();
  });
});

describe('the handlers that assumed both panes were on screen', () => {
  it('refuses `I` when the detail pane is hidden', () => {
    storeVisibility({ detail: false });
    render(<Canvas model={MODEL} />);
    press('I');
    // The cursor did not move into a pane nothing draws — the parity defect.
    expect(statusBar()).toContain('detail pane is hidden');
    expect(detailPane()).toBeNull();
    // And the keyboard is still on the list, so `j`/`k` still walk sessions.
    expect(document.querySelector('[data-mode]')?.textContent).not.toContain('action');
  });

  it('still hands `I` the detail pane when it is visible', () => {
    render(<Canvas model={MODEL} />);
    press('I');
    expect(actionPane()).toBe('active');
  });

  it('refuses `>` when the pane it would widen is hidden', () => {
    storeVisibility({ sidebar: false });
    render(<Canvas model={MODEL} />);
    press('>');
    expect(statusBar()).toContain('hidden');
    expect(readStoredPanes().sidebar).toBe(DEFAULT_PANES.sidebar);
  });

  it('still resizes the pane the keyboard is on when it is visible', () => {
    render(<Canvas model={MODEL} />);
    press('>');
    expect(readStoredPanes().sidebar).toBe(DEFAULT_PANES.sidebar + 24);
  });

  it('does not reserve a hidden sibling’s width', () => {
    // 900px is wide enough for sidebar + detail + canvas, so the sibling's
    // width only shows up as arithmetic. With the sidebar hidden the detail
    // pane must not still be paying 264px for it.
    window.innerWidth = 900;
    storeVisibility({ sidebar: false }, { sidebar: 264, detail: 640 });
    render(<Canvas model={MODEL} />);
    // 900 - 0 - CANVAS_MIN(360) = 540, not 900 - 264 - 360 = 276.
    expect(width(detailPane())).toBe(540);
  });
});
