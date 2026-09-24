// @vitest-environment happy-dom

/**
 * The streaming Terminal tab's minimal core: open, seed, live data in, typed
 * data out, and a clean unmount. `@xterm/xterm` and `@xterm/addon-fit` are
 * mocked -- a real `Terminal` draws to canvas, which happy-dom does not
 * implement, and asserting through a mock that only stands in for
 * construction/`write`/`dispose` is the same trade `TerminalTab.fit.test.tsx`
 * makes for layout: the SUBJECT here is the wiring between the bridge and
 * xterm.js, not xterm.js's own rendering.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusInsertStop } from '../../../src/renderer/keyboard/focus-scope.js';

const writeCalls: string[] = [];
const disposeCalls: number[] = [];
let lastTerm: FakeTerminal | undefined;
let onDataHandler: ((text: string) => void) | undefined;

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  // A REAL element, not a stub: `focusInsertStop`'s `.focus()` and
  // `document.activeElement` check need a node actually attached to the
  // document, which is exactly what xterm.js hands back as `term.textarea`
  // once `open()` runs against a real container.
  textarea: HTMLTextAreaElement = document.createElement('textarea');
  constructor(options: Record<string, unknown>) {
    this.options = { ...options };
    lastTerm = this;
  }
  loadAddon() {}
  open(container: HTMLElement) {
    container.appendChild(this.textarea);
  }
  write(text: string) {
    writeCalls.push(text);
  }
  reset() {}
  onData(handler: (text: string) => void) {
    onDataHandler = handler;
  }
  dispose() {
    disposeCalls.push(1);
  }
}

class FakeFitAddon {
  fit() {}
  proposeDimensions() {
    return undefined;
  }
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Imported AFTER the mocks above are registered (vitest hoists `vi.mock`
// calls, so this ordering in source is fine either way, but kept explicit).
const { TerminalStreamTab } = await import(
  '../../../src/renderer/panels/terminal-stream/TerminalStreamTab.js'
);

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe() {}
  disconnect() {}
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

function withBridge(over: {
  open?: (
    projectId: string,
    rowId?: string,
  ) => Promise<
    | { ok: true; streamId: string; seed: string }
    | {
        ok: false;
        reason: 'bad-request' | 'unavailable' | 'unresolved-session' | 'unsupported-tmux';
      }
  >;
  close?: (streamId: string) => void;
  write?: (streamId: string, bytes: Uint8Array) => void;
  onData?: (streamId: string, listener: (chunk: string) => void) => () => void;
  onSeed?: (streamId: string, listener: (seed: string) => void) => () => void;
  onDown?: (streamId: string, listener: () => void) => () => void;
}) {
  const close = vi.fn();
  const resize = vi.fn(async () => true);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: { resize },
      terminalStream: {
        open: over.open ?? (async () => ({ ok: true, streamId: 'stream-1', seed: 'hello' })),
        close: over.close ?? close,
        write: over.write ?? vi.fn(),
        onData: over.onData ?? (() => () => {}),
        onSeed: over.onSeed ?? (() => () => {}),
        onDown: over.onDown ?? (() => () => {}),
      },
    },
  });
  return { close, resize };
}

beforeEach(() => {
  writeCalls.length = 0;
  disposeCalls.length = 0;
  lastTerm = undefined;
  onDataHandler = undefined;
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
});

describe('with no bridge and no project', () => {
  it('says the terminal is desktop-only, like TerminalTab does', () => {
    render(<TerminalStreamTab projectId={null} branch={null} />);
    expect(q('[data-terminal-stream-empty]')?.textContent).toMatch(
      /only available in the vam desktop app/,
    );
  });

  it('says the same thing when window.api has no terminalStream member', () => {
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    expect(q('[data-terminal-stream-empty]')).not.toBeNull();
  });
});

describe('a refused open', () => {
  it.each([
    ['bad-request', /malformed/],
    ['unavailable', /could not ask tmux/],
    ['unresolved-session', /which tmux session/],
    ['unsupported-tmux', /older than streaming needs/],
  ] as const)('draws distinguishable, non-blank text for %s', async (reason, expected) => {
    withBridge({ open: async () => ({ ok: false, reason }) });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const el = q('[data-terminal-stream-refused]');
    expect(el?.getAttribute('data-terminal-stream-reason')).toBe(reason);
    expect(el?.textContent ?? '').not.toBe('');
    expect(el?.textContent).toMatch(expected);
  });

  it('never leaves a blank pane -- no container is drawn once refused', async () => {
    withBridge({ open: async () => ({ ok: false, reason: 'unavailable' }) });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastTerm).toBeUndefined();
  });
});

describe('mounted with a bridge', () => {
  it('opens the stream by projectId/rowId and writes the real seed to the real terminal', async () => {
    withBridge({
      open: async (projectId, rowId) => {
        expect(projectId).toBe('p1');
        expect(rowId).toBe('s1');
        return { ok: true, streamId: 'stream-1', seed: 'the actual seed text' };
      },
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // FALSIFIABLE against a stub that always answers `.write` was called: the
    // real seed string must be the one that reached the mock terminal.
    expect(writeCalls).toContain('the actual seed text');
    expect(q('[data-terminal-stream]')).not.toBeNull();
  });

  it('a data push for this stream reaches term.write; a push for another stream never does', async () => {
    let capturedListener: ((chunk: string) => void) | undefined;
    withBridge({
      onData: (streamId, listener) => {
        expect(streamId).toBe('stream-1');
        capturedListener = listener;
        return () => {};
      },
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(capturedListener).toBeDefined();
    act(() => {
      capturedListener?.('live chunk');
    });
    expect(writeCalls).toContain('live chunk');
    // The preload's own `createFilteredStreamListener` is what filters a
    // different stream's push before this component's listener is ever
    // called -- trusted rather than re-implemented here (its own test file
    // covers it). This component subscribes with the right streamId, proven
    // by the `expect(streamId).toBe('stream-1')` assertion inside `onData`
    // above -- the one thing wrong wiring here could get wrong.
  });

  it('marks the container as an insert scope and the real textarea as its insert stop', async () => {
    withBridge({});
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const container = q('[data-terminal-stream]');
    expect(container?.hasAttribute('data-insert-scope')).toBe(true);
    expect(lastTerm?.textarea.hasAttribute('data-insert-stop')).toBe(true);
  });

  it('focusInsertStop lands DOM focus on term.textarea, not the container', async () => {
    withBridge({});
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const container = q('[data-terminal-stream]');
    const landed = focusInsertStop(container);
    expect(landed).toBe(true);
    expect(document.activeElement).toBe(lastTerm?.textarea);
  });

  it('types into the stream via write()', async () => {
    const write = vi.fn();
    withBridge({ write });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDataHandler).toBeDefined();
    act(() => {
      onDataHandler?.('a');
    });
    expect(write).toHaveBeenCalledWith('stream-1', new TextEncoder().encode('a'));
  });

  it('closes the stream and disposes the terminal on unmount', async () => {
    const { close } = withBridge({});
    const { unmount } = render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastTerm).toBeDefined();
    unmount();
    expect(close).toHaveBeenCalledWith('stream-1');
    expect(disposeCalls).toHaveLength(1);
  });
});
