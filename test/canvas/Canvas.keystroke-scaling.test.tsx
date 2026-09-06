// @vitest-environment happy-dom

/**
 * THE QUESTION A PRIOR AUDIT LEFT OPEN. `draft` (the composer's text) lives
 * in `Canvas.tsx`, not in `DetailPanel`, so every keystroke re-renders the
 * component that also owns the graph. The audit read the code, believed
 * `nodes`/`edges` were memoised independently of `draft`, and stopped there
 * -- it never measured. `@xyflow/react` wraps its per-node renderer
 * (`NodeWrapper`, and the outer `NodeRenderer`) in `React.memo`, so that
 * belief was almost right: it holds for `nodes` and `edges` themselves, but
 * `NodeWrapper` also takes `onClick` -- the click handler `<ReactFlow>`
 * itself receives as `onNodeClick` -- and Canvas built that as a FRESH
 * closure on every render. A fresh closure is a prop that changed, which is
 * exactly what defeats a memo: EVERY drawn node's wrapper re-rendered, and
 * called its registered component (`SessionInfoNode`, `StepNode`, ...)
 * again, on every keystroke, regardless of whether the graph had anything
 * new to draw.
 *
 * THIS FILE USED TO ASSERT ON A TIMING RATIO (`keystroke` cost divided by
 * `mount` cost), on the theory that dividing by a same-run baseline cancels
 * machine noise. It does not: under the contention of a full suite run, the
 * two numbers are measured at different moments under different load and
 * move independently, and this test went red twice in a row inside the full
 * suite with two different numbers, while passing every time run alone. On a
 * machine measured stretching an 11ms operation past 5 seconds under
 * parallel load, no wall-clock-derived quantity is safe to assert on, ratio
 * or not.
 *
 * THE FIX BELOW MEASURES RENDERS, NOT TIME. The defect is "the graph
 * re-renders on every keystroke because a fresh closure defeats
 * `React.memo`" -- a render-COUNT fact, which is exact and load-independent.
 * Each of the four node-type components Canvas registers with `<ReactFlow>`
 * is wrapped here (via `vi.mock`, never touching `Canvas.tsx`) with a
 * counter that increments once per actual invocation. A keystroke that
 * leaves `nodes`/`edges` alone should cause ZERO of those invocations,
 * whatever the node count -- not "fewer than some millisecond bound".
 *
 * FALSIFIED BY MUTATION: reverting the `useCallback` in `Canvas.tsx` back to
 * an inline arrow reproduces a non-zero count proportional to the node count
 * and reddens the assertion below.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

// Counts real invocations of each node-type component Canvas registers with
// `<ReactFlow>` (`NODE_TYPES` in `Canvas.tsx`) -- never a second read path,
// never a change to `Canvas.tsx` itself: `vi.mock` swaps in a thin counting
// wrapper around the SAME component each module already exports, so the
// wrapped component still renders exactly what the real one would.
const renderCounts = vi.hoisted(() => ({ info: 0, step: 0, fan: 0, slot: 0 }));

vi.mock('../../src/renderer/canvas/SessionInfoNode.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/canvas/SessionInfoNode.js')>();
  const Wrapped = (props: Parameters<typeof actual.SessionInfoNode>[0]) => {
    renderCounts.info += 1;
    return actual.SessionInfoNode(props);
  };
  return { ...actual, SessionInfoNode: Wrapped };
});

vi.mock('../../src/renderer/canvas/StepNode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/canvas/StepNode.js')>();
  const Wrapped = (props: Parameters<typeof actual.StepNode>[0]) => {
    renderCounts.step += 1;
    return actual.StepNode(props);
  };
  return { ...actual, StepNode: Wrapped };
});

vi.mock('../../src/renderer/canvas/SessionFanNode.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/canvas/SessionFanNode.js')>();
  const Wrapped = (props: Parameters<typeof actual.SessionFanNode>[0]) => {
    renderCounts.fan += 1;
    return actual.SessionFanNode(props);
  };
  return { ...actual, SessionFanNode: Wrapped };
});

vi.mock('../../src/renderer/canvas/StepSlotNode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/canvas/StepSlotNode.js')>();
  const Wrapped = (props: Parameters<typeof actual.StepSlotNode>[0]) => {
    renderCounts.slot += 1;
    return actual.StepSlotNode(props);
  };
  return { ...actual, StepSlotNode: Wrapped };
});

function decision(id: string): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

function session(id: string): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: 'main',
    status: 'running',
    runningAgents: 1,
    activity: 'thinking',
    age: '2m',
    decisions: [decision(`d-${id}-1`), decision(`d-${id}-2`), decision(`d-${id}-3`)],
  };
}

/** `sessionCount` sessions' worth of nodes in one project -- realistic (4) or
 *  stress (200), per the brief this measures against. */
function buildModel(sessionCount: number): CanvasModel {
  const sessions: Session[] = [];
  for (let i = 0; i < sessionCount; i++) sessions.push(session(`s${i}`));
  return { projects: [{ id: 'p1', name: 'alpha', source: 'black-smith', sessions }] };
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

function totalNodeRenders(): number {
  return renderCounts.info + renderCounts.step + renderCounts.fan + renderCounts.slot;
}

function resetNodeRenders(): void {
  renderCounts.info = 0;
  renderCounts.step = 0;
  renderCounts.fan = 0;
  renderCounts.slot = 0;
}

/** Mount, let the composer's textarea settle, then reset the counters so
 *  only the KEYSTROKE's own renders are counted -- never the mount's, which
 *  legitimately renders every node once. */
function typeOneCharacterAndCountNodeRenders(sessionCount: number): number {
  const model = buildModel(sessionCount);
  const { unmount } = render(<Canvas model={model} />);
  const textarea = document.querySelector('[data-prompt-box] textarea') as HTMLTextAreaElement;
  if (!textarea) throw new Error('composer textarea not found');
  resetNodeRenders();
  act(() => {
    fireEvent.change(textarea, { target: { value: 'a' } });
  });
  const count = totalNodeRenders();
  unmount();
  return count;
}

describe('a composer keystroke against the graph it should never touch', () => {
  it('causes zero node-component renders, at a realistic and a stress node count', () => {
    // Exact counts, not a millisecond bound: this is deterministic and
    // cannot flake under load, unlike a timing measurement on a machine
    // that has been seen stretching an 11ms operation past 5 seconds.
    expect(typeOneCharacterAndCountNodeRenders(4)).toBe(0);
    expect(typeOneCharacterAndCountNodeRenders(200)).toBe(0);
  });
});
