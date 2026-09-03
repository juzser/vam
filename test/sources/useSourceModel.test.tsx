// @vitest-environment happy-dom

/**
 * The desktop's model lifecycle.
 *
 * Before this hook existed, `DesktopCanvas` loaded ONCE on mount and reloaded
 * only after a write. Nothing polled and `liveUpdates` is false, so the
 * session list froze at launch: a session going busy -> idle kept reading as
 * running, a new session never appeared, a failing one never showed as failed,
 * and every `age` stopped moving. For an app whose stated purpose is making
 * the `waiting` state impossible to miss, that is the whole purpose lost.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasModel, Project } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import {
  SOURCE_POLL_INTERVAL_MS,
  useSourceModel,
} from '../../src/renderer/sources/useSourceModel.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const projects = (name: string): readonly Project[] => [
  { id: 'p1', name, source: 'claude-code', sessions: [] },
];

/** A source whose `load` resolves when the test says so, in the order it says. */
function gatedSource() {
  const pending: { resolve: (p: readonly Project[]) => void; reject: (e: unknown) => void }[] = [];
  const source = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {},
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: () =>
      new Promise<readonly Project[]>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  } as unknown as SessionSource;
  return { source, pending };
}

/** Renders the hook and exposes its latest return value. */
function mount(source: SessionSource | null) {
  const seen: { model: CanvasModel; error: string | null; reload: () => void }[] = [];
  function Probe() {
    seen.push(useSourceModel(source));
    return null;
  }
  render(<Probe />);
  return { seen, latest: () => seen[seen.length - 1] };
}

describe('useSourceModel', () => {
  it('loads once on mount', async () => {
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    expect(pending).toHaveLength(1);
    await act(async () => pending[0]?.resolve(projects('alpha')));
    expect(latest()?.model.projects[0]?.name).toBe('alpha');
  });

  it('polls on the interval, so a status change reaches the screen unasked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.resolve(projects('first')));

    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    expect(pending).toHaveLength(2);
    await act(async () => pending[1]?.resolve(projects('second')));
    expect(latest()?.model.projects[0]?.name).toBe('second');
  });

  it('does not stack polls while one is still in flight', async () => {
    // A slow `claude agents` call must not queue a subprocess per tick.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    mount(source);
    expect(pending).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 4);
    });
    expect(pending).toHaveLength(1);
  });

  it('lets the newest load win when an older one answers late', async () => {
    // The same defect the usage poll had: whichever resolved last used to win.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.resolve(projects('first')));
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    // Second issued; resolve it, THEN let the first-issued one answer late.
    await act(async () => pending[1]?.resolve(projects('newest')));
    expect(latest()?.model.projects[0]?.name).toBe('newest');
    await act(async () => pending[0]?.resolve(projects('stale')));
    expect(latest()?.model.projects[0]?.name).toBe('newest');
  });

  it('keeps the last good model when a poll fails, and says why', async () => {
    // A transient CLI failure must not blank a list the operator is reading.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.resolve(projects('alpha')));
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    await act(async () => pending[1]?.reject(new Error('claude went away')));
    expect(latest()?.model.projects[0]?.name).toBe('alpha');
    expect(latest()?.error).toMatch(/claude went away/);
  });

  it('clears the error once a later poll succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.reject(new Error('gone')));
    expect(latest()?.error).toMatch(/gone/);
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    await act(async () => pending[1]?.resolve(projects('back')));
    expect(latest()?.error).toBeNull();
  });

  it('reloads when the window regains focus', async () => {
    // Coming back to vam is exactly when its numbers matter and are stalest.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    mount(source);
    await act(async () => pending[0]?.resolve(projects('alpha')));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(pending).toHaveLength(2);
  });

  it('does not touch state after unmount', async () => {
    const { source, pending } = gatedSource();
    const { seen } = mount(source);
    cleanup();
    const before = seen.length;
    await act(async () => pending[0]?.resolve(projects('late')));
    expect(seen.length).toBe(before);
  });

  it('does nothing at all without a source', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { latest } = mount(null);
    act(() => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 3);
    });
    expect(latest()?.model.projects).toEqual([]);
    expect(latest()?.error).toBeNull();
  });
});
