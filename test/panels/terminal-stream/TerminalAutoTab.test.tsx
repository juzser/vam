// @vitest-environment happy-dom

/**
 * `TerminalAutoTab.tsx` is the ONE call site `DetailPanel.tsx` now makes for
 * the Terminal tab -- it owns the `streamingTerminal` pref read AND the
 * runtime fallback (`docs/design/terminal-streaming.md`'s "Flipping the
 * default", task 3): streaming refused for an old tmux, or a live stream
 * giving up after its own bounded reconnect retries, both drop to
 * `TerminalTab.tsx` with a one-line notice rather than a frozen or refused
 * pane. `DetailPanel.streaming-terminal.test.tsx` still covers the ONE
 * prop this component itself needs from `DetailPanel` (`streamingTerminal`
 * picking a tab at all); this file covers the fallback this component adds
 * on top.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalAutoTab } from '../../../src/renderer/panels/terminal-stream/TerminalAutoTab.js';
import { setActiveStreamingTerminal } from '../../../src/renderer/prefs/streaming-terminal.js';

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  textarea: HTMLTextAreaElement = document.createElement('textarea');
  modes: { bracketedPasteMode: boolean } = { bracketedPasteMode: false };
  unicode: { activeVersion: string } = { activeVersion: '6' };
  loadAddon() {}
  open(container: HTMLElement) {
    container.appendChild(this.textarea);
  }
  write() {}
  reset() {}
  onData() {}
  attachCustomKeyEventHandler() {}
  scrollPages() {}
  scrollToTop() {}
  scrollToBottom() {}
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

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

type OpenResult =
  | { ok: true; streamId: string; seed: string; name: string }
  | {
      ok: false;
      reason: 'bad-request' | 'unavailable' | 'unresolved-session' | 'unsupported-tmux';
    };

type DownEvent =
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'gave-up'; reason: 'max-attempts' | 'session-gone' };

function stubBridge(over: {
  open?: (projectId: string, rowId?: string) => Promise<OpenResult>;
  onDown?: (streamId: string, listener: (event: DownEvent) => void) => () => void;
}) {
  const read = vi.fn(async () => ({
    kind: 'unavailable',
    error: { code: 'x', message: 'no read' },
  }));
  const resize = vi.fn(async () => true);
  const send = vi.fn(async () => ({ ok: true }) as const);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: { read, resize, send },
      terminalStream: {
        open:
          over.open ??
          (async () => ({ ok: true, streamId: 'stream-1', seed: '', name: 'vam-stub-a1b2c3' })),
        close: vi.fn(),
        write: vi.fn(),
        onData: () => () => {},
        onSeed: () => () => {},
        onDown: over.onDown ?? (() => () => {}),
      },
    },
  });
  return { read, resize, send };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
  setActiveStreamingTerminal(true);
});

describe('picking a tab from the live streamingTerminal pref', () => {
  it('streaming on (the default): draws the streaming tab, opens no classic read', async () => {
    const { read } = stubBridge({});
    setActiveStreamingTerminal(true);
    render(
      <TerminalAutoTab
        projectId="p1"
        rowId="s1"
        branch={null}
        read={undefined}
        resize={undefined}
        send={undefined}
      />,
    );
    await waitFor(() => {
      if (!q('[data-terminal-stream]')) throw new Error('still pending');
    });
    expect(q('[data-terminal]')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('streaming off: draws the classic tab, never opens a stream', async () => {
    const openStream = vi.fn(async () => ({
      ok: true as const,
      streamId: 'x',
      seed: '',
      name: 'n',
    }));
    stubBridge({ open: openStream });
    setActiveStreamingTerminal(false);
    render(
      <TerminalAutoTab
        projectId="p1"
        rowId="s1"
        branch={null}
        read={window.api?.terminal?.read}
        resize={undefined}
        send={undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('[data-terminal]')).not.toBeNull();
    expect(q('[data-terminal-stream]')).toBeNull();
    expect(openStream).not.toHaveBeenCalled();
  });
});

describe('the runtime fallback', () => {
  it('an unsupported-tmux refusal drops to the classic tab with a one-line notice', async () => {
    stubBridge({ open: async () => ({ ok: false, reason: 'unsupported-tmux' }) });
    setActiveStreamingTerminal(true);
    render(
      <TerminalAutoTab
        projectId="p1"
        rowId="s1"
        branch={null}
        read={window.api?.terminal?.read}
        resize={undefined}
        send={undefined}
      />,
    );
    await waitFor(() => {
      if (!q('[data-terminal]')) throw new Error('still pending');
    });
    expect(q('[data-terminal-stream]')).toBeNull();
    expect(q('[data-terminal-fallback-notice]')?.textContent).toMatch(/older than streaming needs/);
  });

  it('gave-up (max-attempts) drops to the classic tab with a distinguishable notice', async () => {
    let downListener: ((event: DownEvent) => void) | undefined;
    stubBridge({
      onDown: (_streamId, listener) => {
        downListener = listener;
        return () => {
          downListener = undefined;
        };
      },
    });
    setActiveStreamingTerminal(true);
    render(
      <TerminalAutoTab
        projectId="p1"
        rowId="s1"
        branch={null}
        read={window.api?.terminal?.read}
        resize={undefined}
        send={undefined}
      />,
    );
    await waitFor(() => {
      if (!q('[data-terminal-stream]')) throw new Error('still pending');
    });

    act(() => {
      downListener?.({ kind: 'gave-up', reason: 'max-attempts' });
    });

    await waitFor(() => {
      if (!q('[data-terminal]')) throw new Error('still pending');
    });
    expect(q('[data-terminal-stream]')).toBeNull();
    expect(q('[data-terminal-fallback-notice]')?.textContent).toMatch(
      /could not be re-established/,
    );
  });

  it('a session switch after a fallback gives the new session a fresh try at streaming', async () => {
    stubBridge({ open: async () => ({ ok: false, reason: 'unsupported-tmux' }) });
    setActiveStreamingTerminal(true);
    const { rerender } = render(
      <TerminalAutoTab
        projectId="p1"
        rowId="s1"
        branch={null}
        read={window.api?.terminal?.read}
        resize={undefined}
        send={undefined}
      />,
    );
    await waitFor(() => {
      if (!q('[data-terminal-fallback-notice]')) throw new Error('still pending');
    });

    // A DIFFERENT session's tmux may well support streaming even though the
    // last one did not -- the fallback must not follow the operator across
    // a switch as though it were a global, permanent downgrade.
    stubBridge({ open: async () => ({ ok: true, streamId: 'x2', seed: '', name: 'n2' }) });
    rerender(
      <TerminalAutoTab
        projectId="p2"
        rowId="s2"
        branch={null}
        read={window.api?.terminal?.read}
        resize={undefined}
        send={undefined}
      />,
    );

    await waitFor(() => {
      if (!q('[data-terminal-stream]')) throw new Error('still pending');
    });
    expect(q('[data-terminal-fallback-notice]')).toBeNull();
  });
});
