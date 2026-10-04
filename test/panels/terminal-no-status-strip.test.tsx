// @vitest-environment happy-dom

/**
 * EC-21: the status strip under the terminal is gone from BOTH renderers. The
 * session name stays only in the pane's accessible name; nothing visible
 * carries it, and no fixed-height sibling takes the strip's place.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  textarea: HTMLTextAreaElement = document.createElement('textarea');
  modes = { bracketedPasteMode: false };
  unicode = { activeVersion: '6' };
  constructor(options: Record<string, unknown>) {
    this.options = { ...options };
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
  attachCustomKeyEventHandler() {}
  dispose() {}
}
class FakeFitAddon {
  fit() {}
  proposeDimensions() {
    return undefined;
  }
}
class FakeUnicode11Addon {}
class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: FakeUnicode11Addon }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

const { TerminalStreamTab } = await import(
  '../../src/renderer/panels/terminal-stream/TerminalStreamTab.js'
);
const { TerminalTab } = await import('../../src/renderer/panels/TerminalTab.js');

import type { PaneView } from '../../src/shared/terminal.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
});

const NAME = 'vam-demo-7';
const STRIP = [
  '[data-terminal-status]',
  '[data-terminal-badge]',
  '[data-terminal-exit-hint]',
  '[data-terminal-stream-status]',
  '[data-terminal-stream-badge]',
];
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('TerminalTab draws no status strip', () => {
  it('has no strip element, no visible session name and no sibling under the pane', async () => {
    const read = vi.fn(
      async (): Promise<PaneView> => ({
        kind: 'ok',
        name: NAME,
        text: 'the screen',
        cursor: { kind: 'unreadable' },
      }),
    );
    render(
      <TerminalTab
        projectId="claude-code:demo-11111111"
        rowId="claude-code:demo-11111111"
        read={read}
        resize={undefined}
        send={vi.fn(async () => 'sent' as const)}
      />,
    );
    await settle();
    for (const selector of STRIP) expect(document.querySelector(selector)).toBeNull();
    const pane = document.querySelector<HTMLElement>('[data-terminal-pane]') as HTMLElement;
    expect(pane.getAttribute('aria-label')).toContain(NAME);
    expect(document.querySelector('[data-terminal]')?.textContent).not.toContain(NAME);
    // The pane scroller is the last child, and keeps the flex-fill contract.
    const tab = document.querySelector<HTMLElement>('[data-terminal]') as HTMLElement;
    expect(tab.lastElementChild?.contains(pane)).toBe(true);
    expect(pane.className).toContain('min-h-0');
  });
});

describe('TerminalStreamTab draws no status strip', () => {
  it('has no strip element, no visible session name, and the frame is the only child', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        terminal: { resize: vi.fn(async () => true) },
        terminalStream: {
          open: async () => ({ ok: true, streamId: 's1', seed: 'hi', name: NAME }),
          close: vi.fn(),
          write: vi.fn(),
          onData: () => () => {},
          onSeed: () => () => {},
          onDown: () => () => {},
        },
      },
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" />);
    await settle();
    for (const selector of STRIP) expect(document.querySelector(selector)).toBeNull();
    const frame = document.querySelector<HTMLElement>('[data-terminal-stream]') as HTMLElement;
    expect(frame.className).toContain('min-h-0');
    expect(frame.className).toContain('flex-1');
    expect(frame.parentElement?.children).toHaveLength(1);
    expect(frame.parentElement?.textContent).not.toContain(NAME);
  });
});
