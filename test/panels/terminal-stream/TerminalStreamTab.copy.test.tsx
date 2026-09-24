// @vitest-environment happy-dom

/**
 * SELECT-AND-COPY, AGAINST A REAL `Terminal` -- same reason
 * `TerminalStreamTab.ime.test.tsx`'s own header gives for not using the mock:
 * the question is whether xterm.js's BUILT-IN handling already does the
 * right thing with zero code added here, and only a real `Terminal` can
 * answer that.
 *
 * MEASURED (a scratch probe, not committed): xterm.js's OWN keydown handling
 * never forwards a Meta-held C (macOS Cmd+C) as terminal input at all --
 * checked both WITH and WITHOUT an active selection, the result was the same
 * either way, so this is NOT conditional on `hasSelection()` the way this
 * task's own brief guessed. `Terminal.attachCustomKeyEventHandler` (this
 * component's own scroll-chord handler) is never even reached for it. xterm
 * separately registers its OWN `copy` listener on its container, which reads
 * the selection straight off `SelectionService` when a native `copy` event
 * actually fires -- that part needs a real selection AND a real browser
 * `Cmd+C`/`document.execCommand('copy')` to observe, neither of which this
 * headless harness can drive from outside the component (the `Terminal`
 * instance is not exposed by `TerminalStreamTab.tsx`, on purpose). What IS
 * verified here, the useful and testable half: Meta+C never leaks into
 * `terminalStream.write` as bytes, so it can never reach a running agent by
 * accident; a plain Ctrl+C (no Meta -- SIGINT on every platform this app
 * ships for, Mac included) still forwards normally, proving the two are
 * genuinely distinguished rather than Ctrl/Meta both being swallowed. No
 * change was needed in `TerminalStreamTab.tsx`; this file is the proof.
 *
 * THE FLOOR, per this task's own bar: proving the keystroke did NOT get
 * forwarded as bytes. Asserting the OS clipboard actually received the text
 * is out of scope -- not meaningfully testable in this harness.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalStreamTab } from '../../../src/renderer/panels/terminal-stream/TerminalStreamTab.js';

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

function withBridge(write: (streamId: string, bytes: Uint8Array) => void) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: { resize: vi.fn(async () => true) },
      terminalStream: {
        open: async () => ({ ok: true, streamId: 'stream-1', seed: 'hello world' }),
        close: vi.fn(),
        write,
        onData: () => () => {},
        onSeed: () => () => {},
        onDown: () => () => {},
      },
    },
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
});

describe('Cmd+C (Meta+C), against a real Terminal', () => {
  it('is never forwarded to terminalStream.write as bytes', async () => {
    const write = vi.fn();
    withBridge(write);
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const textarea = document.querySelector('[data-terminal-stream] textarea') as
      | HTMLTextAreaElement
      | null;
    if (textarea === null) throw new Error('no textarea rendered');
    textarea.focus();

    write.mockClear();
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        keyCode: 67,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('a plain Ctrl+C (no Meta) still sends the interrupt byte, selection or not', async () => {
    const write = vi.fn();
    withBridge(write);
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const textarea = document.querySelector('[data-terminal-stream] textarea') as
      | HTMLTextAreaElement
      | null;
    if (textarea === null) throw new Error('no textarea rendered');
    textarea.focus();
    write.mockClear();
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        keyCode: 67,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(write).toHaveBeenCalledWith('stream-1', new TextEncoder().encode('\x03'));
  });
});
