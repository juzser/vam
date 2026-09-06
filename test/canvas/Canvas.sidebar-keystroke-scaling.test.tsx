// @vitest-environment happy-dom

/**
 * THE RESIDUAL LEFT BY pull request 218: it fixed `onNodeClick`, but
 * `SessionList` was still a plain function receiving 40+ inline props from
 * `Canvas.tsx`, most of them callbacks -- so a composer keystroke (`draft`
 * lives on `Canvas`) re-rendered it in full every time. THE FIX wraps it in
 * `React.memo` and stabilises every prop; a single one left unstable defeats
 * the whole memo, so THIS GUARD asserts a render COUNT, not a millisecond
 * bound, exactly as `Canvas.keystroke-scaling.test.tsx` does and for the
 * same reason: two wall-clock samples drift independently under contention.
 *
 * HOW THE COUNT IS TAKEN: `SessionList` is `memo(SessionListImpl)`, so
 * `actual.SessionList.type` is the raw, unmemoized function `memo()` wraps
 * (a documented shape of what `React.memo` returns). Calling it inside a
 * fresh `memo()` here recreates production's exact bail-or-render decision,
 * with a counter on the "render" branch -- the same technique
 * `Canvas.keystroke-scaling.test.tsx` uses on the four node-type components,
 * generalised to a component wrapped in `memo` by this file, not a library.
 *
 * FALSIFIED BY MUTATION: making one `Canvas.tsx` prop an inline arrow again
 * reproduces a non-zero count and reddens the assertion -- see the coder's
 * report for the mutation and its red output.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { memo, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import type { SessionListProps } from '../../src/renderer/panels/SessionList.js';

const renderCounts = vi.hoisted(() => ({ sessionList: 0 }));

vi.mock('../../src/renderer/panels/SessionList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/panels/SessionList.js')>();
  const rawSessionList = (
    actual.SessionList as unknown as { type: (props: SessionListProps) => ReactNode }
  ).type;
  const Wrapped = memo((props: SessionListProps) => {
    renderCounts.sessionList += 1;
    return rawSessionList(props);
  });
  return { ...actual, SessionList: Wrapped };
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

/** `sessionCount` sessions' worth of rows in one project -- realistic (4) or
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

/** Mount, let the composer's textarea settle, then reset the counter so only
 *  the KEYSTROKE's own renders are counted -- never the mount's, which
 *  legitimately renders the sidebar once. */
function typeOneCharacterAndCountSessionListRenders(sessionCount: number): number {
  const model = buildModel(sessionCount);
  const { unmount } = render(<Canvas model={model} />);
  const textarea = document.querySelector('[data-prompt-box] textarea') as HTMLTextAreaElement;
  if (!textarea) throw new Error('composer textarea not found');
  renderCounts.sessionList = 0;
  act(() => {
    fireEvent.change(textarea, { target: { value: 'a' } });
  });
  const count = renderCounts.sessionList;
  unmount();
  return count;
}

describe('a composer keystroke against the sidebar it should never touch', () => {
  // Exact count, not a millisecond bound -- deterministic under load. The
  // 20s timeout is the same accommodation `Canvas.keystroke-scaling.test.tsx`
  // needs: mounting a 200-session Canvas under full-suite contention can
  // itself take longer than the 5s default.
  it('causes zero SessionList renders, at a realistic and a stress session count', () => {
    expect(typeOneCharacterAndCountSessionListRenders(4)).toBe(0);
    expect(typeOneCharacterAndCountSessionListRenders(200)).toBe(0);
  }, 20000);
});
