// @vitest-environment happy-dom

/**
 * The status bar's usage cell: the formatted line for a known snapshot, the
 * em-dash for unknown, and -- the browser-build requirement -- no request at
 * all when `window.api` is absent.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import {
  describeUsage,
  POLL_INTERVAL_MS,
  STALE_AFTER_MS,
  type UsageSnapshot,
} from '../../src/shared/usage.js';

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

/**
 * A snapshot whose five-hour window reads `percent` and whose seven-day window
 * reads half of it, observed now. `utilization` is ALREADY a percentage, so
 * 40 means 40% and the bar's width is that number verbatim.
 */
function okSnapshot(percent: number): UsageSnapshot {
  return {
    kind: 'ok',
    windows: {
      fiveHour: {
        kind: 'known',
        percent,
        resetsAt: new Date(Date.now() + 75 * 60_000).toISOString(),
      },
      sevenDay: {
        kind: 'known',
        percent: percent / 2,
        resetsAt: new Date(Date.now() + (4 * 24 + 20) * 60 * 60_000).toISOString(),
      },
    },
    observedAt: new Date().toISOString(),
  };
}

function serve(snapshot: UsageSnapshot): void {
  (window as unknown as { api: unknown }).api = {
    usage: { get: vi.fn(async () => snapshot) },
  };
}

const bar = (window_: '5h' | '7d') =>
  document.querySelector<HTMLElement>(`[data-usage-bar="${window_}"]`);

describe('the status bar usage bars', () => {
  it('draws each window at the width its utilization already states', async () => {
    serve(okSnapshot(40));

    render(<Canvas model={EMPTY} />);
    await act(async () => {});

    // 40.0 means 40% -- not 4000%, not 0.4%.
    expect(bar('5h')?.style.width).toBe('40%');
    expect(bar('7d')?.style.width).toBe('20%');
  });

  it('draws NO bar for an unknown snapshot, keeping the em-dash and its reason', async () => {
    serve({ kind: 'unknown', reason: 'no-token' });

    render(<Canvas model={EMPTY} />);
    await act(async () => {});

    // A zero-width bar would read as "0% used" -- a lie in the safe-looking
    // direction. There is no honest width for an unknown, so there is no bar.
    expect(document.querySelectorAll('[data-usage-bar]')).toHaveLength(0);
    expect(usageCell()?.textContent).toBe('—');
    expect(
      document.querySelector('[data-status-bar] [data-note]')?.getAttribute('data-note'),
    ).toContain('keychain');
  });

  it('draws NO bar for a stale reading either', async () => {
    serve({
      ...okSnapshot(40),
      observedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000).toISOString(),
    } as UsageSnapshot);

    render(<Canvas model={EMPTY} />);
    await act(async () => {});

    expect(document.querySelectorAll('[data-usage-bar]')).toHaveLength(0);
    expect(usageCell()?.textContent).toBe('—');
    expect(
      document.querySelector('[data-status-bar] [data-note]')?.getAttribute('data-note'),
    ).toContain('stale');
  });

  it('takes the high-usage colour from describeUsage, so bar and text agree', async () => {
    serve(okSnapshot(95));

    render(<Canvas model={EMPTY} />);
    await act(async () => {});

    const high = describeUsage(okSnapshot(95), new Date());
    expect(high.highUsage).toBe(true);
    expect(bar('5h')?.className).toContain('bg-failed');
    expect(usageCell()?.className).toContain('text-failed');
  });

  it('keeps the ordinary colour below the threshold', async () => {
    serve(okSnapshot(40));

    render(<Canvas model={EMPTY} />);
    await act(async () => {});

    expect(bar('5h')?.className).not.toContain('bg-failed');
  });
});

function fixtureSession(id: string, source?: string): Session {
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
    ...(source === undefined ? {} : { source }),
  };
}

// `data-source` is already taken by the header's source line, so the footer's
// glyph gets its own name.
const sourceGlyph = () => document.querySelector('[data-status-source]');

describe("the status bar's source glyph", () => {
  it("names the focused session's own source when the session carries one", async () => {
    const model: CanvasModel = {
      projects: [{ id: 'p1', name: 'alpha', sessions: [fixtureSession('a1', 'claude-code')] }],
    };

    render(<Canvas model={model} />);
    await act(async () => {});

    expect(sourceGlyph()?.getAttribute('data-status-source')).toBe('claude-code');
    expect(sourceGlyph()?.getAttribute('aria-label')).toContain('claude-code');
  });

  it("falls back to the project's source, which is what the factory adapter sets", async () => {
    const model: CanvasModel = {
      projects: [
        { id: 'p1', name: 'alpha', source: 'black-smith', sessions: [fixtureSession('a1')] },
      ],
    };

    render(<Canvas model={model} />);
    await act(async () => {});

    expect(sourceGlyph()?.getAttribute('data-status-source')).toBe('black-smith');
  });

  it('draws nothing at all when no source is named, rather than a decorative constant', async () => {
    const model: CanvasModel = {
      projects: [{ id: 'p1', name: 'alpha', sessions: [fixtureSession('a1')] }],
    };

    render(<Canvas model={model} />);
    await act(async () => {});

    expect(sourceGlyph()).toBeNull();
  });
});

describe('the status bar no longer states which session is focused', () => {
  it('has dropped the project/session cell the operator read as a branch', async () => {
    const model: CanvasModel = {
      projects: [{ id: 'p1', name: 'alpha', sessions: [fixtureSession('a1', 'claude-code')] }],
    };

    render(<Canvas model={model} />);
    await act(async () => {});

    // `alpha/a1` is the string that read like a git ref. The canvas card still
    // says which session is focused; the footer no longer repeats it.
    expect(document.querySelector('[data-status-bar] [data-focus]')).toBeNull();
    expect(document.querySelector('[data-status-bar]')?.textContent).not.toContain('alpha/a1');
    expect(document.querySelectorAll('[data-focus-indicator]')).toHaveLength(1);
  });
});
