// @vitest-environment happy-dom

/**
 * Escape in the streaming terminal hands the keyboard back to Select mode, the
 * way the snapshot TerminalTab does, instead of being written into the pane
 * (where it cancels the Claude prompt). `Mod-.` stays the way to send a
 * literal Escape. `Terminal` is mocked, as in `TerminalStreamTab.test.tsx`:
 * the subject is the custom key handler's verdict, and `false` is what stops
 * xterm from ever calling `onData`.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusInsertStop } from '../../../src/renderer/keyboard/focus-scope.js';

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
  modes = { bracketedPasteMode: false };
  unicode = { activeVersion: '6' };
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
}

beforeEach(() => {
  lastTerm = undefined;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: { resize: vi.fn(async () => true) },
      terminalStream: {
        open: async () => ({ ok: true, streamId: 'stream-1', seed: '', name: 'vam-stub' }),
        close: vi.fn(),
        write: vi.fn(),
        paste: vi.fn(),
        onData: () => () => {},
        onSeed: () => () => {},
        onDown: () => () => {},
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
});

async function openInInsert() {
  render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const handler = lastTerm?.customKeyEventHandler;
  if (handler === undefined || lastTerm === undefined) throw new Error('no handler attached');
  focusInsertStop(document.querySelector('[data-terminal-stream]'));
  expect(document.activeElement).toBe(lastTerm.textarea);
  return { handler, textarea: lastTerm.textarea };
}

describe('Escape in the streaming terminal', () => {
  it('releases Insert and is not forwarded to the pane', async () => {
    const { handler, textarea } = await openInInsert();
    const forwarded = handler({ type: 'keydown', key: 'Escape' } as KeyboardEvent);
    expect(forwarded).toBe(false);
    expect(document.activeElement).not.toBe(textarea);
  });

  it('does not intercept Escape while an IME is composing', async () => {
    const { handler, textarea } = await openInInsert();
    const forwarded = handler({
      type: 'keydown',
      key: 'Escape',
      isComposing: true,
    } as KeyboardEvent);
    expect(forwarded).toBe(true);
    expect(document.activeElement).toBe(textarea);
  });

  it('leaves Mod-. and Shift+PageUp alone / scrolling as before', async () => {
    const { handler, textarea } = await openInInsert();
    expect(handler({ type: 'keydown', key: '.', ctrlKey: true } as KeyboardEvent)).toBe(true);
    expect(handler({ type: 'keydown', key: '.', metaKey: true } as KeyboardEvent)).toBe(true);
    expect(handler({ type: 'keydown', key: 'Escape', ctrlKey: true } as KeyboardEvent)).toBe(true);
    expect(document.activeElement).toBe(textarea);
    expect(handler({ type: 'keydown', key: 'PageUp', shiftKey: true } as KeyboardEvent)).toBe(
      false,
    );
    expect(lastTerm?.scrollPages).toHaveBeenCalledWith(-1);
  });
  it('does not intercept Escape keyup or Shift/Alt/Meta-modified Escape', async () => {
    const { handler, textarea } = await openInInsert();
    expect(handler({ type: 'keyup', key: 'Escape' } as KeyboardEvent)).toBe(true);
    expect(handler({ type: 'keydown', key: 'Escape', shiftKey: true } as KeyboardEvent)).toBe(true);
    expect(handler({ type: 'keydown', key: 'Escape', altKey: true } as KeyboardEvent)).toBe(true);
    expect(handler({ type: 'keydown', key: 'Escape', metaKey: true } as KeyboardEvent)).toBe(true);
    expect(document.activeElement).toBe(textarea);
  });

  it('keeps every Shift scrollback chord unchanged and unshifted ones pass through', async () => {
    const { handler } = await openInInsert();
    const shifted = (key: string) =>
      handler({ type: 'keydown', key, shiftKey: true } as KeyboardEvent);
    expect(shifted('PageUp')).toBe(false);
    expect(shifted('PageDown')).toBe(false);
    expect(shifted('Home')).toBe(false);
    expect(shifted('End')).toBe(false);
    expect(lastTerm?.scrollPages).toHaveBeenNthCalledWith(1, -1);
    expect(lastTerm?.scrollPages).toHaveBeenNthCalledWith(2, 1);
    expect(lastTerm?.scrollToTop).toHaveBeenCalledTimes(1);
    expect(lastTerm?.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(handler({ type: 'keydown', key: 'PageUp' } as KeyboardEvent)).toBe(true);
    expect(lastTerm?.scrollPages).toHaveBeenCalledTimes(2);
  });
});
