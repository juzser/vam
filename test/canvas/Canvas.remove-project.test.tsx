// @vitest-environment happy-dom

/**
 * Removing a project, end to end through `Canvas` -- the three things the
 * sidebar cannot do alone.
 *
 * `SessionList` owns the menu item, the confirm and its counts, and those are
 * tested there. Everything a removal must ALSO be true of lives here, because
 * `Canvas` is what holds prefs, the other two views and the in-flight guard:
 *
 *   - it is PERSISTED, or the project returns on the next reload;
 *   - it applies to the CANVAS AND THE CURSOR, not the sidebar alone, or the
 *     cards stay drawn and `j` steps onto a session with no row; and
 *   - it does not half-happen while another close is in flight.
 *
 * Nothing spawns: the close path is asserted through the port's
 * `write.closeSession`, the seam main's `stop.ts` sits behind.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';

function session(id: string, over: Partial<Session> = {}): Session {
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
    ...over,
  };
}

/** alpha holds one session vam started and one it did not; beta is untouched. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', { vamControlled: true }), session('a2', { vamControlled: false })],
    },
    { id: 'p2', name: 'beta', source: 'claude-code', sessions: [session('b1')] },
  ],
};

const canvasText = () => document.querySelector('[data-canvas-pane]')?.textContent ?? '';
/** The project's HEADING. Not the sidebar's text: a removed project is still
 *  named there, by the strip that brings it back. */
const heading = (id: string) => document.querySelector(`[data-project-id="${id}"]`);
const restore = (id: string) => document.querySelector(`[data-restore-project="${id}"]`);
/** What is actually in the store, read by the key `prefs.ts` writes. */
const stored = () => localStorage.getItem('vam.prefs.v1') ?? '';
const statusFull = () =>
  document.querySelector('[data-status-bar] [data-status]')?.getAttribute('data-note') ?? '';
const focusedTitle = () => document.querySelector('[data-prompt-target]')?.textContent ?? '';

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

function sourceWith(closeSession: (sessionId: string) => Promise<void>): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: true,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {}, closeSession },
  };
  return {
    kind: 'session',
    source: inner as unknown as SessionSource,
    onWrote: () => {},
  };
}

/** Menu, item, confirm -- the operator's three clicks, awaited. */
async function removeProject(projectId: string) {
  fireEvent.click(document.querySelector(`[data-project-menu="${projectId}"]`) as HTMLElement);
  fireEvent.click(document.querySelector('[data-project-menu-item="remove"]') as HTMLElement);
  await act(async () => {
    fireEvent.click(document.querySelector('[data-confirm-remove-go]') as HTMLElement);
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe('removing a project, through Canvas', () => {
  it('persists it, so a reload does not bring the project back', async () => {
    const { unmount } = render(<Canvas model={MODEL} source={sourceWith(async () => {})} />);
    await removeProject('p1');
    expect(heading('p1')).toBeNull();

    // The store, not the component: a removal that lives only in React state
    // is a removal that ends at the next reload. Keyed by SOURCE, the shape
    // `prefs.ts` documents.
    expect(JSON.parse(stored()).hiddenProjects).toEqual({ 'claude-code': ['p1'] });

    unmount();
    render(<Canvas model={MODEL} source={sourceWith(async () => {})} />);
    expect(heading('p1')).toBeNull();
    // beta is untouched: the removal is one project's, not the list's.
    expect(heading('p2')).not.toBeNull();
  });

  it('takes the project off the canvas and out of the cursor, not just the list', async () => {
    render(<Canvas model={MODEL} source={sourceWith(async () => {})} />);
    expect(canvasText()).toContain('alpha');
    await removeProject('p1');

    // The three views agree on the SET -- the rule the entries memo states.
    expect(canvasText()).not.toContain('alpha');
    press('g');
    press('g');
    expect(focusedTitle()).toBe('b1');
    press('j');
    press('j');
    expect(focusedTitle()).toBe('b1');
  });

  it('restores it, on the canvas as well as in the list', async () => {
    render(<Canvas model={MODEL} source={sourceWith(async () => {})} />);
    await removeProject('p1');
    await act(async () => {
      fireEvent.click(restore('p1') as HTMLElement);
    });
    expect(heading('p1')).not.toBeNull();
    expect(canvasText()).toContain('alpha');
    // And the store is back to a fresh install's shape, not an empty bucket.
    expect(JSON.parse(stored()).hiddenProjects).toEqual({});
  });

  it('REFUSES while another close is in flight, and removes nothing', async () => {
    // A `claude stop` can burn its whole 15s timeout. While it does,
    // `closeSession` returns at its own guard -- so a removal that went ahead
    // would hide the project having ended nothing, and say nothing about it.
    let release: () => void = () => {};
    const closes: string[] = [];
    const source = sourceWith((id) => {
      closes.push(id);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    render(<Canvas model={MODEL} source={source} />);
    press('g');
    press('g');
    press('x');
    expect(closes).toEqual(['a1']);

    await removeProject('p1');
    expect(heading('p1')).not.toBeNull();
    expect(restore('p1')).toBeNull();
    expect(statusFull()).toContain('alpha');
    expect(closes).toEqual(['a1']);
    await act(async () => {
      release();
    });
  });
});
