// @vitest-environment happy-dom

/**
 * ONE KEYSTROKE, ONE SCAN.
 *
 * Before this fix, a sidebar filter keystroke scanned `allEntries` twice:
 * once in the `useMemo` at `Canvas.tsx`'s module scope (feeding `n`/`N`
 * cycling, the `i/total` status readout and the visible-row filter) and a
 * second time inside `onSidebarFilterChange` itself, only to read `[0]` and
 * focus it. The fix moves the focus-the-first-match step into an effect that
 * reads the memoised value instead of scanning again, gated on a flag the
 * handler sets so the jump still happens on the keystroke that asked for it
 * and never on a `matches` change caused by something else.
 *
 * `searchMatches` is wrapped, not spied on, the same idiom as
 * `Canvas.sidebar-keystroke-scaling.test.tsx` uses for `SessionList`'s
 * render count: `vi.hoisted` state plus `vi.mock` on the module the counted
 * function actually lives in.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

const counts = vi.hoisted(() => ({ scans: 0 }));

vi.mock('../../src/renderer/domain/search.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/domain/search.js')>();
  return {
    ...actual,
    searchMatches: (...args: Parameters<typeof actual.searchMatches>) => {
      counts.scans += 1;
      return actual.searchMatches(...args);
    },
  };
});

// Imported after the mock so `Canvas.tsx` picks up the wrapped `searchMatches`.
const { Canvas } = await import('../../src/renderer/canvas/Canvas.js');

function decision(id: string): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

function session(id: string, title: string): Session {
  return {
    id,
    title,
    epic: null,
    branch: 'main',
    status: 'running',
    runningAgents: 1,
    activity: 'thinking',
    age: '2m',
    decisions: [decision(`d-${id}-1`)],
  };
}

function buildModel(): CanvasModel {
  return {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'factory',
        sessions: [session('s1', 'cat'), session('s2', 'beta'), session('s3', 'beta-two')],
      },
    ],
  };
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

function openFilter(): HTMLInputElement {
  // The filter input does not exist until filtering opens (`Canvas.tsx`'s
  // `filtering` state, set by the `/` action). `input[aria-label="filter
  // sessions"]` is load-bearing: the filter-menu BUTTON in `SessionList.tsx`
  // carries the same aria-label, so a bare `getByLabelText` is ambiguous.
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  });
  const input = document.querySelector<HTMLInputElement>('input[aria-label="filter sessions"]');
  if (input === null) throw new Error('filter input not found after opening the filter');
  return input;
}

describe('a sidebar filter keystroke', () => {
  it('scans the entries exactly once, and still moves focus to the first match', () => {
    const model = buildModel();
    render(<Canvas model={model} />);

    // Move focus to `s3` FIRST, by clicking its row, before filtering. This
    // matters for isolating the assertion below from `Canvas.tsx`'s other,
    // pre-existing effect that reassigns focus when the filter strips the
    // focused session away entirely (`sessionIds` no longer includes it):
    // filtering for `beta` below leaves `s3` in the visible set (it still
    // matches), so that other effect does nothing, and a cursor move to
    // `s2` can only be the incremental-search behaviour this test guards.
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-session-row="s3"]')?.click();
    });

    const input = openFilter();

    counts.scans = 0;
    act(() => {
      fireEvent.change(input, { target: { value: 'beta' } });
    });

    expect(counts.scans).toBe(1);

    const cursorRow = document.querySelector('[data-row-cursor]')?.closest('[data-session-row]');
    expect(cursorRow?.getAttribute('data-session-row')).toBe('s2');
  });
});
