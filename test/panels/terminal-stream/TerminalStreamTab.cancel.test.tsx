// @vitest-environment happy-dom

/**
 * Finding cbd56848: `connect()` used to await `openBridge.open()` and then
 * return on `if (cancelled) return;` without closing the stream that open
 * just created -- `streamIdRef.current` was still `null` while the open was
 * pending, so neither the effect cleanup's own `teardownStream()` call nor
 * the visibility handler's had anything to find and close. The fix gives
 * each `connect()` a generation, invalidated by the effect cleanup and by
 * the visibility teardown; a late successful open whose generation is stale
 * closes its own `streamId` through the same `openBridge.close` path
 * `teardownStream()` already uses, rather than adopting it or leaking it.
 *
 * Fixtures below are copied from `TerminalStreamTab.test.tsx`'s own
 * `FakeTerminal`/`FakeFitAddon`/`FakeResizeObserver`/`withBridge` -- that
 * file is untouched, per this task's own contract.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let lastTerm: FakeTerminal | undefined;

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  textarea: HTMLTextAreaElement = document.createElement('textarea');
  scrollPages = vi.fn();
  scrollToTop = vi.fn();
  scrollToBottom = vi.fn();
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | undefined;
  modes: { bracketedPasteMode: boolean } = { bracketedPasteMode: false };
  unicode: { activeVersion: string } | undefined = { activeVersion: '6' };
  constructor(options: Record<string, unknown>) {
    this.options = { ...options };
    lastTerm = this;
  }
  loadAddon() {}
  open(container: HTMLElement) {
    container.appendChild(this.textarea);
  }
  write(_text: string, callback?: () => void) {
    callback?.();
  }
  reset() {}
  onData() {}
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.customKeyEventHandler = handler;
  }
  dispose() {}
}

class FakeFitAddon {
  fit() {}
  proposeDimensions() {
    return undefined;
  }
}

class FakeUnicode11Addon {}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: FakeUnicode11Addon }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

const { TerminalStreamTab } = await import(
  '../../../src/renderer/panels/terminal-stream/TerminalStreamTab.js'
);

class FakeResizeObserver {
  observe() {}
  disconnect() {}
  constructor(readonly callback: () => void) {}
}

type OpenResult =
  | { ok: true; streamId: string; seed: string; name: string }
  | {
      ok: false;
      reason: 'bad-request' | 'unavailable' | 'unresolved-session' | 'unsupported-tmux';
    };

/**
 * `liveSubscriptions()` tracks `onData`/`onSeed`/`onDown` subscribe-minus-
 * unsubscribe calls -- additive to the three existing cases (none of them
 * reads it), needed by the new "superseded attempt leaves nothing live"
 * case below, which the original three fakes (returning a bare `() => {}`)
 * cannot observe on their own.
 */
function withBridge(over: {
  open?: (projectId: string, rowId?: string) => Promise<OpenResult>;
  close?: (streamId: string) => void;
}) {
  const close = vi.fn();
  const resize = vi.fn(async () => true);
  let subscriptions = 0;
  const subscribe = () => {
    subscriptions += 1;
    return () => {
      subscriptions -= 1;
    };
  };
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: { resize },
      terminalStream: {
        open: over.open ?? (async () => ({ ok: true, streamId: 's1', seed: '', name: 'vam-a1' })),
        close: over.close ?? close,
        write: vi.fn(),
        onData: subscribe,
        onSeed: subscribe,
        onDown: subscribe,
      },
    },
  });
  return { close, resize, liveSubscriptions: () => subscriptions };
}

beforeEach(() => {
  lastTerm = undefined;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
});

describe('finding cbd56848: a cancelled/superseded open closes what it opened', () => {
  it('closes a late successful open that resolves after unmount', async () => {
    let resolveOpen: ((value: OpenResult) => void) | undefined;
    const { close } = withBridge({
      open: () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    });
    const { unmount } = render(<TerminalStreamTab projectId="p1" rowId="s1" />);
    await act(async () => {
      await Promise.resolve();
    });

    unmount();
    expect(close).not.toHaveBeenCalled();

    await act(async () => {
      resolveOpen?.({ ok: true, streamId: 's-late', seed: 'x', name: 'vam-a1' });
      await Promise.resolve();
      await Promise.resolve();
    });

    // THE DIFFERENTIAL: under HEAD (the bug) close has 0 calls here; under
    // the fix it has exactly 1, with the late stream's own id.
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith('s-late');
  });

  it('closes only the superseded open across a hidden/visible cycle, and attaches to the surviving one', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    let resolveFirst: ((value: OpenResult) => void) | undefined;
    let resolveSecond: ((value: OpenResult) => void) | undefined;
    let openCount = 0;
    const { close } = withBridge({
      open: () => {
        openCount += 1;
        if (openCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      },
    });
    try {
      visibility.mockReturnValue('visible');
      render(<TerminalStreamTab projectId="p1" rowId="s1" />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(openCount).toBe(1);

      // Hidden -> visible while the first open is STILL pending: teardown
      // then a fresh connect(), which starts a second, independent open.
      visibility.mockReturnValue('hidden');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      visibility.mockReturnValue('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(openCount).toBe(2);

      // The SECOND (current) open resolves first, ok, with 's-new'.
      await act(async () => {
        resolveSecond?.({ ok: true, streamId: 's-new', seed: 'seed-new', name: 'vam-new' });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(close).not.toHaveBeenCalled();

      // The FIRST (superseded) open resolves late, ok, with 's-old'.
      await act(async () => {
        resolveFirst?.({ ok: true, streamId: 's-old', seed: 'seed-old', name: 'vam-old' });
        await Promise.resolve();
        await Promise.resolve();
      });

      // Under the fix: 's-old' closed exactly once, 's-new' never closed.
      expect(close).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith('s-old');
      expect(close).not.toHaveBeenCalledWith('s-new');

      // Attached to the surviving stream -- the status rule shows its name.
      expect(document.querySelector('[data-terminal-stream-badge]')?.textContent).toBe('vam-new');
    } finally {
      visibility.mockRestore();
    }
  });

  it('a duplicate visible while an open is pending adopts one stream and closes the other', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    let resolveFirst: ((value: OpenResult) => void) | undefined;
    let resolveSecond: ((value: OpenResult) => void) | undefined;
    let openCount = 0;
    const { close, liveSubscriptions } = withBridge({
      open: () => {
        openCount += 1;
        if (openCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      },
    });
    try {
      visibility.mockReturnValue('visible');
      const { unmount } = render(<TerminalStreamTab projectId="p1" rowId="s1" />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(openCount).toBe(1);

      // A SECOND 'visible' event, WITH NO 'hidden' BEFORE IT, while the
      // mount's own open is still pending.
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(openCount).toBe(2);

      // The FIRST (superseded) open resolves ok first.
      await act(async () => {
        resolveFirst?.({ ok: true, streamId: 's-a', seed: 'seed-a', name: 'vam-a' });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(close).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith('s-a');
      expect(close).not.toHaveBeenCalledWith('s-b');

      // The SECOND (current) open resolves ok after.
      await act(async () => {
        resolveSecond?.({ ok: true, streamId: 's-b', seed: 'seed-b', name: 'vam-b' });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(document.querySelector('[data-terminal-stream-badge]')?.textContent).toBe('vam-b');
      expect(close).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalledWith('s-b');

      // Exactly one subscription set (onData+onSeed+onDown) is live: the
      // superseded attempt never subscribed at all.
      expect(liveSubscriptions()).toBe(3);

      unmount();
      expect(close).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledWith('s-b');
      expect(liveSubscriptions()).toBe(0);
    } finally {
      visibility.mockRestore();
    }
  });

  it('a duplicate visible while pending: the second open resolves first, the first closes when it resolves late', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    let resolveFirst: ((value: OpenResult) => void) | undefined;
    let resolveSecond: ((value: OpenResult) => void) | undefined;
    let openCount = 0;
    const { close } = withBridge({
      open: () => {
        openCount += 1;
        if (openCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      },
    });
    try {
      visibility.mockReturnValue('visible');
      const { unmount } = render(<TerminalStreamTab projectId="p1" rowId="s1" />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(openCount).toBe(1);

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(openCount).toBe(2);

      // The SECOND (current) open resolves ok first.
      await act(async () => {
        resolveSecond?.({ ok: true, streamId: 's-b', seed: 'seed-b', name: 'vam-b' });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(close).not.toHaveBeenCalled();
      expect(document.querySelector('[data-terminal-stream-badge]')?.textContent).toBe('vam-b');

      // The FIRST (superseded) open resolves ok late.
      await act(async () => {
        resolveFirst?.({ ok: true, streamId: 's-a', seed: 'seed-a', name: 'vam-a' });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(close).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith('s-a');
      expect(close).not.toHaveBeenCalledWith('s-b');

      unmount();
      expect(close).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledWith('s-b');
    } finally {
      visibility.mockRestore();
    }
  });

  it('a duplicate visible after the stream is already live closes it and reconnects', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    let openCount = 0;
    const { close } = withBridge({
      open: async () => {
        openCount += 1;
        return openCount === 1
          ? { ok: true, streamId: 's-a', seed: 'seed-a', name: 'vam-a' }
          : { ok: true, streamId: 's-b', seed: 'seed-b', name: 'vam-b' };
      },
    });
    try {
      visibility.mockReturnValue('visible');
      const { unmount } = render(<TerminalStreamTab projectId="p1" rowId="s1" />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(document.querySelector('[data-terminal-stream-badge]')?.textContent).toBe('vam-a');
      expect(close).not.toHaveBeenCalled();

      // A duplicate 'visible', with no 'hidden' before it, arrives once the
      // stream is already live.
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(close).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith('s-a');
      expect(document.querySelector('[data-terminal-stream-badge]')?.textContent).toBe('vam-b');

      unmount();
      expect(close).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledWith('s-b');
    } finally {
      visibility.mockRestore();
    }
  });

  it('a refusal resolving after unmount closes nothing and sets no state', async () => {
    let resolveOpen: ((value: OpenResult) => void) | undefined;
    const { close } = withBridge({
      open: () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    });
    const { unmount } = render(<TerminalStreamTab projectId="p1" rowId="s1" />);
    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    await act(async () => {
      resolveOpen?.({ ok: false, reason: 'unavailable' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(close).not.toHaveBeenCalled();
    expect(lastTerm).toBeDefined();
  });
});
