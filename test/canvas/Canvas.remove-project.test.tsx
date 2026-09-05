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

/**
 * alpha holds one of each of the three states removal has to tell apart, and
 * every one of them is load-bearing:
 *
 *   a1 -- vamControlled true: the only session that may be ended.
 *   a2 -- ABSENT: vam could not ask. Widening the plan's `=== true` to
 *         `!== false` sweeps this up, so it is what makes that mutation
 *         visible here rather than only in the unit test.
 *   a3 -- false, AND hidden by the default `hideAgentStarted` filter, so it
 *         has no row on screen. It must still be counted and still not
 *         ended: a plan computed over the filtered list would miss it.
 *
 * beta is untouched throughout.
 */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        session('a1', { vamControlled: true }),
        session('a2'),
        session('a3', {
          vamControlled: false,
          origin: { startedBy: 'agent', promptCount: null },
        }),
      ],
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

  /**
   * THE WHOLE PROMISE, on the real path.
   *
   * This is the test the hand-wired seam test only looked like: it drives the
   * menu, the confirm and the click the operator drives, through `Canvas`,
   * into the port's `write.closeSession` -- the seam main's `stop.ts` sits
   * behind. Nothing is composed by hand here, so forwarding the wrong set,
   * dropping the guard in `removalPlan` or bypassing the plan entirely all
   * redden it, and each of those is a change the earlier test could not see.
   */
  it('ends EXACTLY the sessions vam started, and no others, through the port', async () => {
    const closes: string[] = [];
    render(
      <Canvas
        model={MODEL}
        source={sourceWith(async (id) => {
          closes.push(id);
        })}
      />,
    );
    fireEvent.click(document.querySelector('[data-project-menu="p1"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-project-menu-item="remove"]') as HTMLElement);
    // The DISCLOSURE, on the real path and under the default filters: three
    // sessions in the project, one row on screen. A plan read off the filtered
    // list would say "0 will keep running" here.
    expect(document.querySelector('[data-confirm-end-count]')?.textContent).toBe('1');
    expect(document.querySelector('[data-confirm-hide-count]')?.textContent).toBe('2');
    await act(async () => {
      fireEvent.click(document.querySelector('[data-confirm-remove-go]') as HTMLElement);
    });
    // a2 is ABSENT and a3 is false -- neither is a session vam can prove it
    // started, and a3 does not even have a row. Both keep running and are
    // merely no longer drawn. Asserted by VALUE, because the failure this
    // guards is not recoverable.
    expect(closes).toEqual(['a1']);
    expect(heading('p1')).toBeNull();
  });

  it('CANCELLING reaches no spawn route at all', async () => {
    const closes: string[] = [];
    render(
      <Canvas
        model={MODEL}
        source={sourceWith(async (id) => {
          closes.push(id);
        })}
      />,
    );
    fireEvent.click(document.querySelector('[data-project-menu="p1"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-project-menu-item="remove"]') as HTMLElement);
    await act(async () => {
      fireEvent.click(document.querySelector('[data-confirm-cancel]') as HTMLElement);
    });
    expect(closes).toEqual([]);
    expect(heading('p1')).not.toBeNull();
    expect(stored()).not.toContain('p1');
  });

  /**
   * A project with no source: removed for this run, and back on the next one.
   *
   * `prefs.hiddenProjects` is keyed by SOURCE -- the two-level shape that
   * stops one source's removal from hiding another source's project of the
   * same id. A project with no source has no bucket to key under, and there
   * are only three things to do about it: invent a key (which reintroduces
   * exactly the collision the keying exists to prevent), refuse the removal
   * (a Remove item that does nothing), or remove it for this run and let it
   * return. The third is chosen, and this pins it -- a hidden-until-reload
   * project is defensible only as a decision somebody made on purpose.
   *
   * Every project from a real source has one; this is the fixture and
   * hand-built case.
   */
  it('removes a source-less project for the run, and does not pretend to store it', async () => {
    const noSource: CanvasModel = {
      projects: [
        { id: 'p9', name: 'unsourced', sessions: [session('n1')] },
        { id: 'p2', name: 'beta', source: 'claude-code', sessions: [session('b1')] },
      ],
    };
    const { unmount } = render(<Canvas model={noSource} source={sourceWith(async () => {})} />);
    await removeProject('p9');
    expect(heading('p9')).toBeNull();
    expect(restore('p9')).not.toBeNull();
    // Nothing was written under a key that does not exist.
    expect(JSON.parse(stored() || '{}').hiddenProjects ?? {}).toEqual({});

    unmount();
    render(<Canvas model={noSource} source={sourceWith(async () => {})} />);
    // Back, and that is the documented outcome rather than a leak.
    expect(heading('p9')).not.toBeNull();
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

/**
 * A removal reports what it DID, not what it meant to do — and a close that
 * failed keeps the project on screen.
 *
 * The failure this pins is the worst shape a report can take: two closes
 * refused, two sessions still running, the status line saying "ended 2
 * sessions" and the rows that would have shown otherwise hidden. Hiding is
 * what makes a still-running session unreachable, so a removal whose closes
 * did not all succeed does not hide at all: the operator keeps the rows, the
 * cards and the Remove item, and can try again once the source is reachable.
 *
 * `closeSession` swallows every failure into the status line by design (a
 * refusal is rendered verbatim, not thrown), so the count cannot be read off
 * an exception. It reports its outcome instead, and the removal counts those.
 */
describe('a removal that could not end a session says so, and hides nothing', () => {
  it('keeps the project drawn, and names the sessions still running', async () => {
    const source = sourceWith(async () => {
      throw new Error('interactive sessions are yours to stop');
    });
    render(<Canvas model={MODEL} source={source} />);
    await removeProject('p1');

    // THE LOAD-BEARING ASSERTION: the session vam failed to close is still on
    // screen. A hidden project is a running session with no row to reach it by.
    expect(heading('p1')).not.toBeNull();
    expect(canvasText()).toContain('alpha');
    expect(stored()).not.toContain('p1');

    // And the sentence is about what happened, not about the plan.
    expect(statusFull()).not.toContain('ended 1 session');
    expect(statusFull()).toContain('a1');
    expect(statusFull()).toContain('still');
  });

  it('reports the number it really ended when the closes succeed', async () => {
    render(<Canvas model={MODEL} source={sourceWith(async () => {})} />);
    await removeProject('p1');
    expect(heading('p1')).toBeNull();
    expect(statusFull()).toContain('ended 1 session');
  });
});
