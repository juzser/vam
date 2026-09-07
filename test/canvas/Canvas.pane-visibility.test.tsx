// @vitest-environment happy-dom

/**
 * A hidden pane is a pane that is not there.
 *
 * vam's two panes are resizable, and every path that touches a width —
 * `clampPaneWidth`, `setPaneWidth`, `readPanes`, `dragCeiling`, `renderedWidth`
 * — floors at that pane's MIN on purpose: `panes.ts` says a width that rendered
 * at 0 "would be a pane that has vanished", and it is right. So visibility
 * cannot be a width of zero. It is a sibling flag, and hiding is unmounting.
 *
 * Which makes the flag the small half of the work. The large half is that
 * pieces of Canvas.tsx assume both panes are on screen: `I` moves the cursor
 * into the detail pane checking only that a session is focused, `>` picks its
 * target from the focused pane alone, and the width arithmetic hands each pane
 * its sibling's width whether or not the sibling is drawn. Each of those is a
 * defect the moment a pane can be absent — a cursor on something nothing
 * draws is exactly the defect this codebase removed one commit ago — so each is
 * asserted here.
 *
 * 0.2 migration, A12.1: the three canvas presets (`zc`/`zC`/`zf`) that used
 * to trigger a visibility change from the keyboard are gone with the canvas
 * they hid — there is no chord left in this file that mutates
 * `paneVisibility`. `z0` (`resetPanes`) survives on its own, as does the
 * settings overlay's toggle (`Canvas.settings.test.tsx`), so the setup for
 * "restore a hidden pane" now seeds the hidden state directly rather than
 * reaching it through a deleted chord.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { ALL_VISIBLE, DEFAULT_PANES, type PaneVisibility } from '../../src/renderer/prefs/panes.js';

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
  projects: [{ id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] }],
};

const PREFS_KEY = 'vam.prefs.v1';

/** Seed the store the way a previous session would have left it. */
function storeVisibility(visible: Partial<PaneVisibility>, panes = DEFAULT_PANES) {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      panes,
      paneVisibility: { ...ALL_VISIBLE, ...visible },
    }),
  );
}

function readStoredPanes(): { sidebar: number; detail: number } {
  return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').panes;
}

const sidebarPane = () => document.querySelector('[data-sidebar-pane]');
/** The detail COLUMN — the wrapper that carries the width and holds both the
 *  tab strip and `DetailPanel` (A12.1) — not `DetailPanel`'s own root, which
 *  `actionPane` below reads separately for its active/idle state. */
const detailPane = () => document.querySelector('[data-detail-pane]');
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const actionPane = () =>
  document.querySelector('[data-action-pane]')?.getAttribute('data-action-pane') ?? '';
const width = (el: Element | null) =>
  Number.parseFloat((el as HTMLElement | null)?.style.width ?? 'NaN');

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** `z0`, typed. */
function resetChord() {
  press('z');
  press('0');
}

/** Every action-bearing element on screen, the parity guard's own hook. */
const drawnActions = () => [...document.querySelectorAll('[data-action-id]')];
/** The action the cursor is on, if anything is drawing one. */
const ringed = () =>
  drawnActions()
    .filter((el) => el.classList.contains('border-waiting'))
    .map((el) => el.getAttribute('data-action-id'));

function storedPrefs(): {
  panes: { sidebar: number; detail: number };
  paneVisibility: PaneVisibility;
} {
  return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
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
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a hidden pane leaves the DOM', () => {
  it('draws both by default', () => {
    render(<Canvas model={MODEL} />);
    expect(sidebarPane()).not.toBeNull();
    expect(detailPane()).not.toBeNull();
  });

  it('unmounts the sidebar rather than narrowing it', () => {
    storeVisibility({ sidebar: false });
    render(<Canvas model={MODEL} />);
    expect(sidebarPane()).toBeNull();
    // Not merely narrow: nothing on screen carries the sidebar's own controls.
    expect(document.querySelector('[data-session-row]')).toBeNull();
    // And the survivor takes the whole window — nothing is reserved for a
    // pane that is not drawn.
    expect(detailPane()).not.toBeNull();
  });

  it('unmounts the detail pane too', () => {
    storeVisibility({ detail: false });
    render(<Canvas model={MODEL} />);
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

  it('refuses `>` when the sidebar is hidden, in either cursor mode', () => {
    storeVisibility({ sidebar: false });
    render(<Canvas model={MODEL} />);
    press('>');
    expect(statusBar()).toContain('hidden');
    expect(readStoredPanes().sidebar).toBe(DEFAULT_PANES.sidebar);
  });

  it('still resizes the sidebar when it is visible, in Select', () => {
    render(<Canvas model={MODEL} />);
    press('>');
    expect(readStoredPanes().sidebar).toBe(DEFAULT_PANES.sidebar + 24);
  });

  it('resizes the sidebar in the OPPOSITE direction from Insert — widening the pane you are in shrinks the sidebar', () => {
    // A12.1: the detail pane has no stored width of its own any more, so
    // "widen the pane the keyboard is in" while in Insert has to mean
    // "shrink the one real knob, the sidebar" — the seam approached from
    // its other side.
    render(<Canvas model={MODEL} />);
    press('I');
    press('>');
    expect(readStoredPanes().sidebar).toBe(DEFAULT_PANES.sidebar - 24);
  });

  it('does not reserve a hidden sibling’s width — the survivor takes the whole viewport', () => {
    window.innerWidth = 900;
    storeVisibility({ sidebar: false }, { sidebar: 264, detail: 640 });
    render(<Canvas model={MODEL} />);
    // With no canvas left to reserve room for, hiding the sidebar hands the
    // detail pane the entire 900px window — not 900 - 264.
    expect(width(detailPane())).toBe(900);
  });
});

describe('`z0` is the way back', () => {
  it('restores a hidden pane as well as the two widths', () => {
    // A width away from the default AND a pane hidden, seeded directly: the
    // chords that used to reach this from the keyboard (`zc`/`zC`) are gone
    // with the canvas they hid.
    storeVisibility({ sidebar: false }, { sidebar: 300, detail: 400 });
    render(<Canvas model={MODEL} />);
    expect(sidebarPane()).toBeNull();

    resetChord();

    // Widths only would answer the person who just hid the wrong pane with a
    // layout that still has a column missing — and set the width they
    // cannot see while it did.
    expect(sidebarPane()).not.toBeNull();
    expect(detailPane()).not.toBeNull();
    expect(storedPrefs().panes).toEqual({ ...DEFAULT_PANES });
    expect(storedPrefs().paneVisibility).toEqual(ALL_VISIBLE);
  });

  it('keeps the action-parity invariant across a reset', () => {
    storeVisibility({ sidebar: false });
    render(<Canvas model={MODEL} />);
    const ring = ringed();
    const drawnIds = drawnActions().map((el) => el.getAttribute('data-action-id'));
    for (const id of ring) {
      expect(drawnIds).toContain(id);
    }
    resetChord();
    expect(sidebarPane()).not.toBeNull();
    expect(detailPane()).not.toBeNull();
  });
});
