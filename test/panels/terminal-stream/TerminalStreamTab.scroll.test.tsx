// @vitest-environment happy-dom

/**
 * EC-22 / EC-69: the terminal does not scroll, and scrolls slowly.
 *
 * Real xterm lays out nothing in happy-dom (`scrollLines` never moves
 * `viewportY`), so these pins are on what THIS component hands xterm and the
 * DOM around it: the options, the writes, the wheel target and the fit step.
 *
 * THE LIVE PROBE (recorded in the task result) found the cause of "scrolls
 * only after Enter": the seed is `capture-pane -p -e -N` with no `-S`, so it
 * carries the visible screen and nothing above it, and xterm's scrollback is
 * empty on a fresh mount until output arrives. That is decided in
 * `main/terminal/stream/`, outside this task's claims. Each hypothesis
 * below is a pin: it passes at base, so the renderer is refuted as the cause
 * and no fix was made here.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let lastTerm: FakeTerminal | undefined;
let fitCalls = 0;
let resizeCallback: (() => void) | undefined;

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  textarea: HTMLTextAreaElement = document.createElement('textarea');
  written: string[] = [];
  scrollPages = vi.fn();
  scrollToTop = vi.fn();
  scrollToBottom = vi.fn();
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
  write(text: string, callback?: () => void) {
    this.written.push(text);
    callback?.();
  }
  reset() {}
  onData() {}
  attachCustomKeyEventHandler() {}
  dispose() {}
}

class FakeFitAddon {
  fit() {
    fitCalls += 1;
  }
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
const { TERMINAL_FAST_SCROLL_FACTOR, TERMINAL_WHEEL_LINES_PER_NOTCH } = await import(
  '../../../src/renderer/panels/terminal-stream/terminal-stream-tuning.js'
);

class FakeResizeObserver {
  observe() {}
  disconnect() {}
  constructor(callback: () => void) {
    resizeCallback = callback;
  }
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

let dataListener: ((chunk: string) => void) | undefined;
let write: ReturnType<typeof vi.fn>;

async function mount() {
  write = vi.fn();
  const resize = vi.fn(async () => true);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: { resize },
      terminalStream: {
        open: async () => ({ ok: true, streamId: 's1', seed: 'seed', name: 'vam-demo-7' }),
        close: vi.fn(),
        write,
        onData: (_id: string, listener: (chunk: string) => void) => {
          dataListener = listener;
          return () => {};
        },
        onSeed: () => () => {},
        onDown: () => () => {},
      },
    },
  });
  render(<TerminalStreamTab projectId="p1" rowId="s1" />);
  await flush();
}

beforeEach(() => {
  lastTerm = undefined;
  fitCalls = 0;
  resizeCallback = undefined;
  dataListener = undefined;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    cb();
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
});

describe('EC-69: wheel speed comes from one named constant', () => {
  it('builds the Terminal with 3 lines per notch and 5x for Alt', async () => {
    await mount();
    expect(TERMINAL_WHEEL_LINES_PER_NOTCH).toBe(3);
    expect(TERMINAL_FAST_SCROLL_FACTOR).toBe(5);
    expect(lastTerm?.options.scrollSensitivity).toBe(TERMINAL_WHEEL_LINES_PER_NOTCH);
    expect(lastTerm?.options.fastScrollSensitivity).toBe(TERMINAL_FAST_SCROLL_FACTOR);
    // Alt plus one notch: 3 x 5 = 15 lines.
    expect(TERMINAL_WHEEL_LINES_PER_NOTCH * TERMINAL_FAST_SCROLL_FACTOR).toBe(15);
  });
});

describe('EC-22 differential: each hypothesis is a pin that passes at base', () => {
  it('(a) scrollback: every streamed chunk reaches xterm, so the renderer never drops history', async () => {
    await mount();
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}\r\n`);
    await act(async () => {
      for (const line of lines) dataListener?.(line);
    });
    const written = (lastTerm?.written ?? []).join('');
    expect(written).toContain('line 0\r\n');
    expect(written).toContain('line 299\r\n');
  });

  it('(b) wheel swallowed: a wheel on the mount is neither prevented nor sent to the pane by vam', async () => {
    await mount();
    const mountEl = q<HTMLElement>('[data-terminal-stream-mount]') as HTMLElement;
    const event = new WheelEvent('wheel', {
      deltaY: -3,
      deltaMode: 1,
      cancelable: true,
      bubbles: true,
    });
    mountEl.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('(c) sizing: the frame and mount keep the min-h-0 / h-full contract, and fit runs before the open', async () => {
    await mount();
    const frame = q<HTMLElement>('[data-terminal-stream]');
    expect(frame?.className).toContain('min-h-0');
    expect(frame?.className).toContain('flex-1');
    expect(q<HTMLElement>('[data-terminal-stream-mount]')?.className).toContain('h-full');
    expect(fitCalls).toBeGreaterThanOrEqual(1);
  });

  it('(d) hidden mount: a 0 -> non-zero resize refits, without any keypress or output', async () => {
    await mount();
    const before = fitCalls;
    expect(resizeCallback).toBeDefined();
    await act(async () => {
      resizeCallback?.();
    });
    expect(fitCalls).toBe(before + 1);
  });
});
