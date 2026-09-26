// @vitest-environment happy-dom

/**
 * IME COMPOSITION, DRIVEN AGAINST A REAL `@xterm/xterm` `Terminal` -- not the
 * mock every other test in this directory uses (`TerminalStreamTab.test.tsx`'s
 * own header explains why the mock exists: canvas). This file is the one
 * exception, on purpose: the design doc's own open question is whether
 * xterm.js's composition handling works with ZERO custom code in
 * `TerminalStreamTab.tsx`, and a mocked `Terminal` cannot answer that -- only
 * a real one, composing for real, can.
 *
 * THE TECHNIQUE. `TerminalTab.openkey.test.tsx` drives its own hidden
 * `<textarea>` with a single synthetic `input` event carrying `inputType`,
 * because that component reads `event.nativeEvent.inputType` itself. xterm.js
 * reads none of that: it listens for the browser's own
 * `compositionstart`/`compositionupdate`/`compositionend` sequence on
 * `term.textarea`, so THIS file drives that sequence directly instead,
 * confirmed against a scratch probe (not committed) that isolated two
 * happy-dom gaps neither `TerminalTab`'s own tests needed to work around:
 *   1. `KeyboardEvent`'s `keyCode` is not derived from `key` in happy-dom --
 *      a bare `{ key: 'a' }` reaches xterm's `keydown` handler as an
 *      unrecognised key and is silently dropped. Named explicitly (`keyCode:
 *      229`, `key: 'Process'`) for the composition-start keydown, matching a
 *      real IME's own "processing" keycode.
 *   2. xterm.js's `CompositionHelper.compositionend()`
 *      (`_finalizeComposition`) reads `textarea.value` inside its own
 *      `setTimeout(fn, 0)`, not synchronously -- a test that asserts
 *      immediately after `fireEvent(textarea, compositionEndEvent)` observes
 *      nothing, not a failure of composition itself. This file waits out that
 *      macrotask before asserting, same as the scratch probe that found it.
 *
 * RESULT: IT WORKS CLEANLY, WITH ZERO CUSTOM COMPOSITION CODE IN
 * `TerminalStreamTab.tsx` -- confirming the design doc's own hope. This is
 * the one thing this file verified rather than assumed; see the assertions
 * below for exactly what was checked.
 *
 * WHAT THIS FILE CANNOT PROVE. Same caveat `TerminalTab.openkey.test.tsx`
 * names for its own OpenKey coverage: a synthetic `CompositionEvent`/
 * `KeyboardEvent` sequence, reasoned from xterm.js's own source and measured
 * against happy-dom, is not a real OS input method. A real Vietnamese IME
 * (or OpenKey specifically) was not driven against a real Chromium for this
 * task -- that would need the same CDP `Input.imeSetComposition` access
 * `TerminalTab.openkey.test.tsx`'s own header says was unavailable in this
 * environment. What IS verified: the composed text reaches
 * `terminalStream.write` exactly once, uncorrupted, through xterm's own
 * mechanism, with no bespoke handling in this component to get wrong.
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
        open: async () => ({ ok: true, streamId: 'stream-1', seed: '' }),
        close: vi.fn(),
        write,
        onData: () => () => {},
        onSeed: () => () => {},
        onDown: () => () => {},
      },
    },
  });
}

function tick(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
});

describe('IME composition, against a real Terminal', () => {
  it('sends the whole composed syllable to terminalStream.write once, uncorrupted', async () => {
    const write = vi.fn();
    withBridge(write);
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const textarea = document.querySelector(
      '[data-terminal-stream] textarea',
    ) as HTMLTextAreaElement | null;
    if (textarea === null) throw new Error('no textarea rendered');
    textarea.focus();

    await act(async () => {
      // The composition-start keydown a real IME sends: keyCode 229
      // ("Process"), which is what lets xterm.js's own keydown handler tell
      // this key apart from an ordinary character -- see this file's header.
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true }),
      );
      textarea.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      textarea.value = 'ố';
      textarea.selectionStart = 1;
      textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event('compositionupdate', { bubbles: true }));
      await tick();
      const end = new Event('compositionend', { bubbles: true }) as Event & { data?: string };
      Object.defineProperty(end, 'data', { value: 'ố' });
      textarea.dispatchEvent(end);
      await tick();
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('stream-1', new TextEncoder().encode('ố'));
  });
});
