// @vitest-environment happy-dom

/**
 * The status bar's usage cell: the formatted line for a known snapshot, the
 * em-dash for unknown, and -- the browser-build requirement -- no request at
 * all when `window.api` is absent.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import { POLL_INTERVAL_MS, type UsageSnapshot } from '../../src/shared/usage.js';

const EMPTY: CanvasModel = { projects: [] };

const usageCell = () => document.querySelector('[data-usage]');

beforeAll(() => {
  // ReactFlow measures with APIs happy-dom does not implement.
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
  Reflect.deleteProperty(window, 'api');
  vi.restoreAllMocks();
});

describe('the status bar usage cell', () => {
  it('renders the formatted line for a known snapshot', async () => {
    const snapshot: UsageSnapshot = {
      kind: 'ok',
      windows: {
        fiveHour: {
          kind: 'known',
          percent: 40,
          resetsAt: new Date(Date.now() + 75 * 60_000).toISOString(),
        },
        sevenDay: {
          kind: 'known',
          percent: 30,
          resetsAt: new Date(Date.now() + (4 * 24 + 20) * 60 * 60_000).toISOString(),
        },
      },
      observedAt: new Date().toISOString(),
    };
    (window as unknown as { api: unknown }).api = {
      usage: { get: vi.fn(async () => snapshot) },
    };

    render(<Canvas model={EMPTY} />);
    await act(async () => {});

    expect(usageCell()?.textContent).toContain('40% used');
    expect(usageCell()?.textContent).toContain('30% used');
  });

  it('renders the em-dash for an unknown snapshot, never 0%', async () => {
    (window as unknown as { api: unknown }).api = {
      usage: { get: vi.fn(async () => ({ kind: 'unknown', reason: 'no-token' }) as UsageSnapshot) },
    };

    render(<Canvas model={EMPTY} />);
    await act(async () => {});

    expect(usageCell()?.textContent).toBe('—');
    expect(usageCell()?.textContent).not.toContain('0%');
  });

  it('lets the newest poll win when an older one answers late', async () => {
    // Whichever `.then` resolved last used to call `setSnapshot`
    // unconditionally, so a slow poll could overwrite a newer, already
    // displayed reading and regress the cell to older numbers until the next
    // tick corrected it. Background-tab timer throttling releasing a burst of
    // queued intervals is the ordinary way to reach that.
    const known = (percent: number): UsageSnapshot => ({
      kind: 'ok',
      windows: {
        fiveHour: {
          kind: 'known',
          percent,
          resetsAt: new Date(Date.now() + 75 * 60_000).toISOString(),
        },
        sevenDay: { kind: 'unknown' },
      },
      observedAt: new Date().toISOString(),
    });

    const resolvers: ((snapshot: UsageSnapshot) => void)[] = [];
    (window as unknown as { api: unknown }).api = {
      usage: {
        get: vi.fn(
          () =>
            new Promise<UsageSnapshot>((resolve) => {
              resolvers.push(resolve);
            }),
        ),
      },
    };

    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      render(<Canvas model={EMPTY} />);
      // First poll issued, still in flight.
      expect(resolvers).toHaveLength(1);

      // The interval fires a second poll before the first has answered.
      await act(async () => {
        vi.advanceTimersByTime(POLL_INTERVAL_MS);
      });
      expect(resolvers).toHaveLength(2);

      // The NEWER one answers first and is displayed...
      await act(async () => {
        resolvers[1]?.(known(30));
      });
      expect(usageCell()?.textContent).toContain('30% used');

      // ...then the OLDER one answers late. It must not win.
      await act(async () => {
        resolvers[0]?.(known(99));
      });
      expect(usageCell()?.textContent).toContain('30% used');
      expect(usageCell()?.textContent).not.toContain('99% used');
    } finally {
      vi.useRealTimers();
    }
  });

  it('attempts nothing in the browser build: no window.api, no fetch call, em-dash shown', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch must not be called in the browser build');
    });

    render(<Canvas model={EMPTY} />);
    await act(async () => {});

    expect(usageCell()?.textContent).toBe('—');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
