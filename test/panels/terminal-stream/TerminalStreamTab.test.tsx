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
import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_STREAM_LINE_HEIGHT,
} from '../../../src/renderer/prefs/terminal-font.js';
import {
  DEFAULT_TERMINAL_SCHEME_PREF,
  readTerminalSchemePref,
  setActiveTerminalScheme,
} from '../../../src/renderer/prefs/terminal-scheme.js';

const writeCalls: string[] = [];
const disposeCalls: number[] = [];
const loadedAddons: unknown[] = [];
let lastTerm: FakeTerminal | undefined;
let onDataHandler: ((text: string) => void) | undefined;
/** `false` (the default): `FakeTerminal#write`'s own callback fires
 * synchronously, standing in for xterm parsing a small write instantly --
 * every EXISTING test's own small strings. `true`: the callback is queued
 * onto `lastTerm.writeCallbacks` instead, for the backpressure tests below
 * to fire on their own schedule, simulating xterm still being mid-parse. */
let deferWriteCallbacks = false;
/** `false` (the default): the constructed `FakeTerminal` gets a real
 * `.unicode` object, matching a real xterm.js instance. `true`: `.unicode`
 * is left `undefined`, standing in for an incomplete `Terminal` (a test
 * double elsewhere in this repo, or a future xterm build shaped
 * differently) -- CI caught `TerminalStreamTab.tsx` crashing `connect()`
 * against exactly this shape (`DetailPanel.streaming-terminal.test.tsx`'s
 * own `FakeTerminal` never had `.unicode` at all). */
let omitUnicode = false;

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  // A REAL element, not a stub: `focusInsertStop`'s `.focus()` and
  // `document.activeElement` check need a node actually attached to the
  // document, which is exactly what xterm.js hands back as `term.textarea`
  // once `open()` runs against a real container.
  textarea: HTMLTextAreaElement = document.createElement('textarea');
  scrollPages = vi.fn();
  scrollToTop = vi.fn();
  scrollToBottom = vi.fn();
  /** Callbacks `write()` deferred rather than firing synchronously -- only
   * populated while `deferWriteCallbacks` is `true` (see its own comment).
   * FIFO, matching real xterm's own in-order parse. */
  writeCallbacks: Array<() => void> = [];
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | undefined;
  // The one field of the real `Terminal.modes` getter the paste handler
  // reads -- a plain, test-settable property standing in for xterm's own
  // computed one. Defaults to `false`: most panes are not running a program
  // that asked for bracketed paste.
  modes: { bracketedPasteMode: boolean } = { bracketedPasteMode: false };
  // The real `Terminal.unicode` API surface this component touches:
  // `activeVersion` starts at xterm's own built-in default ('6') until a
  // provider addon (`Unicode11Addon`) is loaded and this is reassigned.
  // `undefined` while `omitUnicode` is set -- see that flag's own comment.
  unicode: { activeVersion: string } | undefined = { activeVersion: '6' };
  constructor(options: Record<string, unknown>) {
    this.options = { ...options };
    if (omitUnicode) this.unicode = undefined;
    lastTerm = this;
  }
  loadAddon(addon: unknown) {
    loadedAddons.push(addon);
  }
  open(container: HTMLElement) {
    container.appendChild(this.textarea);
  }
  write(text: string, callback?: () => void) {
    writeCalls.push(text);
    if (callback === undefined) return;
    if (deferWriteCallbacks) this.writeCallbacks.push(callback);
    else callback();
  }
  reset() {}
  onData(handler: (text: string) => void) {
    onDataHandler = handler;
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.customKeyEventHandler = handler;
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

// A stand-in for the real addon this component loads to correct xterm's
// default (Unicode 6) width table against tmux's own -- `instanceof` in the
// wiring test below is what proves THIS addon, not merely *an* addon, was
// loaded.
class FakeUnicode11Addon {}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: FakeUnicode11Addon }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Imported AFTER the mocks above are registered (vitest hoists `vi.mock`
// calls, so this ordering in source is fine either way, but kept explicit).
const { TerminalStreamTab, TERMINAL_STREAM_HIGH_WATER_MARK, TERMINAL_STREAM_LOW_WATER_MARK } =
  await import('../../../src/renderer/panels/terminal-stream/TerminalStreamTab.js');

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
    | { ok: true; streamId: string; seed: string; name: string }
    | {
        ok: false;
        reason: 'bad-request' | 'unavailable' | 'unresolved-session' | 'unsupported-tmux';
      }
  >;
  close?: (streamId: string) => void;
  write?: (streamId: string, bytes: Uint8Array) => void;
  onData?: (streamId: string, listener: (chunk: string) => void) => () => void;
  onSeed?: (streamId: string, listener: (seed: string) => void) => () => void;
  onDown?: (streamId: string, listener: (event: StreamDownEvent) => void) => () => void;
}) {
  const close = vi.fn();
  const resize = vi.fn(async () => true);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: { resize },
      terminalStream: {
        open:
          over.open ??
          (async () => ({
            ok: true,
            streamId: 'stream-1',
            seed: 'hello',
            name: 'vam-stub-a1b2c3',
          })),
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

type StreamDownEvent =
  | { readonly kind: 'reconnecting'; readonly attempt: number }
  | { readonly kind: 'gave-up'; readonly reason: 'max-attempts' | 'session-gone' };

/** Captures the bridge's own `onDown` listener so a test can fire it
 * directly, exactly the way `withBridge`'s `open`/`onSeed` overrides let a
 * test drive the rest of the bridge -- a review finding: `onDown` had no
 * such seam at all before this, which is exactly how the component's own
 * missing subscription (a second finding on the same review pass) went
 * unnoticed: nothing in this file could have exercised it either way. */
function withDownCapture() {
  let handler: ((event: StreamDownEvent) => void) | undefined;
  const onDown = vi.fn((_streamId: string, listener: (event: StreamDownEvent) => void) => {
    handler = listener;
    return () => {
      handler = undefined;
    };
  });
  return {
    onDown,
    fire: (event: StreamDownEvent) => handler?.(event),
    isSubscribed: () => handler !== undefined,
  };
}

beforeEach(() => {
  writeCalls.length = 0;
  disposeCalls.length = 0;
  loadedAddons.length = 0;
  lastTerm = undefined;
  onDataHandler = undefined;
  deferWriteCallbacks = false;
  omitUnicode = false;
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
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

  it('asks to fall back only for unsupported-tmux, never for the other three refusals', async () => {
    for (const reason of ['bad-request', 'unavailable', 'unresolved-session'] as const) {
      const onFallback = vi.fn();
      withBridge({ open: async () => ({ ok: false, reason }) });
      const { unmount } = render(
        <TerminalStreamTab projectId="p1" rowId="s1" branch={null} onFallback={onFallback} />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onFallback).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('asks its caller to fall back on unsupported-tmux, still drawing its own refusal text too', async () => {
    const onFallback = vi.fn();
    withBridge({ open: async () => ({ ok: false, reason: 'unsupported-tmux' }) });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} onFallback={onFallback} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onFallback).toHaveBeenCalledExactlyOnceWith('unsupported-tmux');
    expect(q('[data-terminal-stream-refused]')?.getAttribute('data-terminal-stream-reason')).toBe(
      'unsupported-tmux',
    );
  });

  it('never leaves a blank pane -- no container is drawn once refused', async () => {
    withBridge({ open: async () => ({ ok: false, reason: 'unavailable' }) });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // ASSERT THE PROPERTY, NOT ITS PROXY. A FRESH connect() now constructs a
    // Terminal BEFORE `open()` resolves (so it can resize tmux ahead of the
    // seed capture -- a review finding chasing the cursor-position fix, see
    // `connect()`'s own header comment), so `lastTerm` being SET is no
    // longer proof that a blank pane was left drawn: the DOM, and whether
    // that Terminal was actually disposed rather than leaked detached from
    // it, are the real facts this test's own title is about.
    expect(q('[data-terminal-stream-mount]')).toBeNull();
    expect(q('[data-terminal-stream-refused]')).not.toBeNull();
    expect(lastTerm).toBeDefined();
    expect(disposeCalls).toHaveLength(1);
  });
});

describe('mounted with a bridge', () => {
  it('opens the stream by projectId/rowId and writes the real seed to the real terminal', async () => {
    withBridge({
      open: async (projectId, rowId) => {
        expect(projectId).toBe('p1');
        expect(rowId).toBe('s1');
        return {
          ok: true,
          streamId: 'stream-1',
          seed: 'the actual seed text',
          name: 'vam-stub-a1b2c3',
        };
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

  it("normalizes a bare-\\n seed to \\r\\n before writing it (capture-pane's own line separator, against convertEol: false)", async () => {
    // REPRODUCED against a real tmux + a real Terminal
    // (`e2e/terminal-stream-glitch-shots.mjs`): `tmux capture-pane -p` joins
    // its own rows with a bare `\n`, and `convertEol: false` (this
    // component's own option, matching a real pty's `\r\n`) means xterm.js
    // never returns the cursor to column 0 on a bare `\n` -- every row after
    // the first landed further right than the last, a staircase that read
    // as "ALL the output is misaligned" for a box-drawn Claude Code prompt.
    withBridge({
      open: async () => ({
        ok: true,
        streamId: 'stream-1',
        seed: 'row one\nrow two\r\nrow three',
        name: 'vam-stub-a1b2c3',
      }),
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeCalls).toContain('row one\r\nrow two\r\nrow three');
  });

  it('loads Unicode11Addon and switches to the "11" width table -- xterm’s default (Unicode 6) disagrees with tmux on wide emoji (measured: real tmux reports width 2 for U+1F389, xterm’s default table reports 1)', async () => {
    withBridge({});
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadedAddons.some((addon) => addon instanceof FakeUnicode11Addon)).toBe(true);
    expect(lastTerm?.unicode?.activeVersion).toBe('11');
  });

  // ── CI finding: DetailPanel.streaming-terminal.test.tsx's own FakeTerminal
  // never had `.unicode` at all, and `connect()` crashed reaching for it
  // (`TypeError: Cannot set properties of undefined (setting
  // 'activeVersion')`), swallowed by that call site's own `.catch()` --
  // that test was passing for the wrong reason, not proving this path ever
  // actually completed. This is the direct regression test: a `Terminal`
  // with no `.unicode` at all must not crash the open, and must not log an
  // error either. ──────────────────────────────────────────────────────
  it('does not crash (or log an error) opening a stream against a Terminal with no .unicode', async () => {
    omitUnicode = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    withBridge({});
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(q('[data-terminal-stream]')).not.toBeNull();
    expect(q('[data-terminal-stream-mount]')?.childElementCount).toBeGreaterThan(0);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('gives xterm a transparent ground at the composited opacity, matching the frame’s own translucent background -- xterm’s canvas used to paint an opaque one over it regardless of the pref', async () => {
    setActiveTerminalScheme(readTerminalSchemePref({ backgroundOpacity: 0.6 }), 'dark');
    withBridge({});
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // `allowTransparency` is required for xterm to honour a non-opaque
    // `theme.background` at all -- without it, xterm forces the background
    // fully opaque regardless of the alpha channel it was handed.
    expect(lastTerm?.options.allowTransparency).toBe(true);
    // Hans's own #1e1f29 (the default dark scheme), composited at 0.6 --
    // the SAME `withAlpha` arithmetic `terminalSchemeStyle` already applies
    // to the frame div, so both layers land on identical pixels rather than
    // two independent roundings of the same colour.
    const theme = lastTerm?.options.theme as
      | { background?: string; cursor?: string; selectionBackground?: string }
      | undefined;
    expect(theme?.background).toBe('rgba(30, 31, 41, 0.6)');
    // The cursor and selection colours stay the scheme's own OPAQUE hex --
    // only the GROUND is meant to let the frame show through; a translucent
    // cursor/selection would read as broken, not as parity.
    expect(theme?.cursor).toBe('#ae7af7');
    expect(theme?.selectionBackground).toBe('#0f0e19');
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

  describe('scrollback chords (#459), Shift-held only', () => {
    async function openAndGetHandler() {
      withBridge({});
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const handler = lastTerm?.customKeyEventHandler;
      if (handler === undefined) throw new Error('no handler attached');
      return handler;
    }

    // `false` from `attachCustomKeyEventHandler` is what stops the key
    // reaching xterm's own processing -- and so its `onData`, the channel
    // that becomes `terminalStream.write` -- BEFORE it can leak through as
    // typed input; a real xterm never calls `onData` for a key this handler
    // declines, which is trusted here rather than re-implemented (this
    // component mocks `Terminal` entirely, matching every other test in this
    // file).
    it.each([
      ['PageUp', 'scrollPages', [-1]],
      ['PageDown', 'scrollPages', [1]],
      ['Home', 'scrollToTop', []],
      ['End', 'scrollToBottom', []],
    ] as const)('Shift+%s scrolls via term.%s and consumes the key', async (key, method, args) => {
      const handler = await openAndGetHandler();
      const consumed = handler({ type: 'keydown', shiftKey: true, key } as KeyboardEvent);
      expect(consumed).toBe(false);
      expect(lastTerm?.[method]).toHaveBeenCalledWith(...args);
    });

    it('does not consume the same key without Shift held', async () => {
      const handler = await openAndGetHandler();
      const consumed = handler({
        type: 'keydown',
        shiftKey: false,
        key: 'PageUp',
      } as KeyboardEvent);
      expect(consumed).toBe(true);
      expect(lastTerm?.scrollPages).not.toHaveBeenCalled();
    });

    it('does not act on keyup, only keydown', async () => {
      const handler = await openAndGetHandler();
      const consumed = handler({ type: 'keyup', shiftKey: true, key: 'Home' } as KeyboardEvent);
      expect(consumed).toBe(true);
      expect(lastTerm?.scrollToTop).not.toHaveBeenCalled();
    });
  });

  describe('a real paste', () => {
    // A minimal fake `clipboardData` -- a real `ClipboardEvent`/`DataTransfer`
    // is awkward to instantiate in happy-dom (no precedent for it in this
    // file's own paste-adjacent tests, which drive the hidden-input path via
    // a plain `input` event with `inputType` instead).
    function pasteEvent(text: string): Event {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
      return event;
    }

    it('cancels the browser default and xterm’s own paste handling', async () => {
      withBridge({});
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const textarea = lastTerm?.textarea;
      if (textarea === undefined) throw new Error('no textarea');
      const event = pasteEvent('a whole pasted paragraph');
      const preventDefault = vi.spyOn(event, 'preventDefault');
      const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');
      act(() => {
        textarea.dispatchEvent(event);
      });
      expect(preventDefault).toHaveBeenCalled();
      expect(stopImmediatePropagation).toHaveBeenCalled();
    });

    it('writes the sanitised clipboard text, unwrapped, when the pane has not asked for bracketed paste', async () => {
      const write = vi.fn();
      withBridge({ write });
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const textarea = lastTerm?.textarea;
      if (textarea === undefined || lastTerm === undefined) throw new Error('no textarea');
      lastTerm.modes.bracketedPasteMode = false;
      act(() => {
        textarea.dispatchEvent(pasteEvent('line one\r\nline two'));
      });
      // CRLF -> one CR, exactly `terminal-paste.ts`'s own `preparePastedText`.
      expect(write).toHaveBeenCalledWith(
        'stream-1',
        new TextEncoder().encode('line one\rline two'),
      );
    });

    it('wraps the write in bracketed-paste codes when the pane HAS asked for it', async () => {
      const write = vi.fn();
      withBridge({ write });
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const textarea = lastTerm?.textarea;
      if (textarea === undefined || lastTerm === undefined) throw new Error('no textarea');
      lastTerm.modes.bracketedPasteMode = true;
      act(() => {
        textarea.dispatchEvent(pasteEvent('hello'));
      });
      expect(write).toHaveBeenCalledWith(
        'stream-1',
        new TextEncoder().encode('\x1b[200~hello\x1b[201~'),
      );
    });

    it('does nothing for an empty clipboard', async () => {
      const write = vi.fn();
      withBridge({ write });
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const textarea = lastTerm?.textarea;
      if (textarea === undefined) throw new Error('no textarea');
      act(() => {
        textarea.dispatchEvent(pasteEvent(''));
      });
      expect(write).not.toHaveBeenCalled();
    });

    it('draws no refusal text -- a real paste is not a refusal', async () => {
      withBridge({});
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const textarea = lastTerm?.textarea;
      if (textarea === undefined) throw new Error('no textarea');
      act(() => {
        textarea.dispatchEvent(pasteEvent('hello'));
      });
      expect(q('[data-terminal-stream-refused]')).toBeNull();
    });

    it('does nothing for a paste outside Select mode -- the listener lives only on term.textarea', async () => {
      // The operator's ask was Insert mode only; Select mode's own posture
      // (no focus on `term.textarea`, `focusInsertStop`'s own note) is
      // unchanged. The paste listener is wired to `liveTerm.textarea`
      // exclusively (see the connect effect above), so a paste dispatched on
      // the CONTAINER -- what a real paste would target while the textarea
      // does not hold DOM focus -- never reaches it: a `paste` event does not
      // propagate to a descendant, only to ancestors.
      const write = vi.fn();
      withBridge({ write });
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const container = q('[data-terminal-stream]');
      if (container === null) throw new Error('no container');
      act(() => {
        container.dispatchEvent(pasteEvent('nope'));
      });
      expect(write).not.toHaveBeenCalled();
    });
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

describe('frame parity with TerminalTab.tsx (docs/design/terminal-streaming.md)', () => {
  it('draws the same bordered, rounded, clipped pane frame TerminalTab.tsx draws -- border-line, rounded-[9px], overflow-hidden, the focus-visible ring', async () => {
    withBridge({});
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const pane = q('[data-terminal-stream]');
    const className = pane?.className ?? '';
    for (const token of [
      'rounded-[9px]',
      'border',
      'border-line',
      'overflow-hidden',
      'has-[:focus-visible]:outline',
      'has-[:focus-visible]:outline-line-strong',
    ]) {
      expect(className, className).toContain(token);
    }
  });

  it('configures the real Terminal with the shared font family, TerminalTab.tsx’s own line-height ratio and a steady (non-blinking) block cursor', async () => {
    withBridge({});
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastTerm?.options.fontFamily).toBe(TERMINAL_FONT_FAMILY);
    expect(lastTerm?.options.lineHeight).toBe(TERMINAL_STREAM_LINE_HEIGHT);
    // TerminalTab.tsx's own header: "IT DOES NOT BLINK" -- a steady block
    // reads as the same surface either way the setting is flipped.
    expect(lastTerm?.options.cursorBlink).toBe(false);
  });

  it('draws a status rule under the pane with the branch and the resolved tmux session name, the same facts TerminalTab.tsx draws and in the same order', async () => {
    withBridge({
      open: async () => ({ ok: true, streamId: 'stream-1', seed: 'hi', name: 'vam-atlas-a1b2c3' }),
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch="work/atlas-fit" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(q('[data-terminal-stream-branch]')?.textContent).toBe('work/atlas-fit');
    expect(q('[data-terminal-stream-badge]')?.textContent).toBe('vam-atlas-a1b2c3');
  });

  it('draws no branch and no name until the stream has actually opened -- no invented identity', async () => {
    let resolveOpen:
      | ((value: { ok: true; streamId: string; seed: string; name: string }) => void)
      | undefined;
    withBridge({
      open: () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch="work/atlas-fit" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('[data-terminal-stream-badge]')).toBeNull();
    await act(async () => {
      resolveOpen?.({ ok: true, streamId: 'stream-1', seed: 'hi', name: 'vam-atlas-a1b2c3' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(q('[data-terminal-stream-badge]')?.textContent).toBe('vam-atlas-a1b2c3');
  });
});

describe('renderer-side backpressure (coordinator follow-up: bytes handed to xterm vs. parsed)', () => {
  it('never trips the high-water mark for an ordinary small chunk', async () => {
    let capturedListener: ((chunk: string) => void) | undefined;
    withBridge({
      onData: (_streamId, listener) => {
        capturedListener = listener;
        return () => {};
      },
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    writeCalls.length = 0;
    act(() => {
      capturedListener?.('an ordinary line of output\r\n');
    });
    expect(writeCalls).toEqual(['an ordinary line of output\r\n']);
  });

  it('stops handing further chunks to xterm once pending (unparsed) bytes cross the high-water mark', async () => {
    deferWriteCallbacks = true;
    let capturedListener: ((chunk: string) => void) | undefined;
    withBridge({
      onData: (_streamId, listener) => {
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

    // xterm never gets to PARSE this (its callback is deferred, per
    // `deferWriteCallbacks`) -- crosses the high-water mark on its own.
    const big = 'x'.repeat(TERMINAL_STREAM_HIGH_WATER_MARK + 1);
    act(() => {
      capturedListener?.(big);
    });
    expect(writeCalls).toContain(big);

    writeCalls.length = 0;
    act(() => {
      capturedListener?.('dropped chunk');
    });
    expect(writeCalls).toEqual([]);
  });

  it('keeps dropping while pending bytes are still above the low-water mark, even after some drain', async () => {
    deferWriteCallbacks = true;
    let capturedListener: ((chunk: string) => void) | undefined;
    let openCount = 0;
    const { close } = withBridge({
      open: async () => {
        openCount += 1;
        return {
          ok: true,
          streamId: `stream-${openCount}`,
          seed: `seed-${openCount}`,
          name: `vam-stub-${openCount}`,
        };
      },
      onData: (_streamId, listener) => {
        capturedListener = listener;
        return () => {};
      },
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(openCount).toBe(1);

    // Two chunks, summing to just over the high-water mark -- so draining
    // only the FIRST one's callback leaves pending bytes still above the
    // low-water mark (a quarter of the high one), proving the hysteresis
    // gap is real rather than one shared threshold.
    const chunk1 = 'a'.repeat(TERMINAL_STREAM_HIGH_WATER_MARK / 2);
    const chunk2 = 'b'.repeat(TERMINAL_STREAM_HIGH_WATER_MARK / 2 + 1);
    // The premise this whole test rests on: chunk2 ALONE must still be
    // above the low-water mark, or draining only chunk1 would already
    // trigger the reconnect and the "still dropping" assertion below would
    // hold by accident rather than by the hysteresis gap actually working.
    expect(chunk2.length).toBeGreaterThan(TERMINAL_STREAM_LOW_WATER_MARK);
    act(() => {
      capturedListener?.(chunk1);
      capturedListener?.(chunk2);
    });

    await act(async () => {
      const first = lastTerm?.writeCallbacks.shift();
      first?.();
      await Promise.resolve();
    });
    // Still above TERMINAL_STREAM_LOW_WATER_MARK -- no reconnect yet.
    expect(openCount).toBe(1);
    expect(close).not.toHaveBeenCalled();

    await act(async () => {
      for (const cb of lastTerm?.writeCallbacks.splice(0) ?? []) cb();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Now drained under the low-water mark -- the reconnect (drop and
    // reseed) fires.
    expect(close).toHaveBeenCalledWith('stream-1');
    expect(openCount).toBe(2);
  });
});

describe('visibility-driven connect/disconnect', () => {
  it('closes the stream when the window is hidden and opens a fresh one, reseeded, when it returns', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    let openCount = 0;
    const { close } = withBridge({
      open: async () => {
        openCount += 1;
        return {
          ok: true,
          streamId: `stream-${openCount}`,
          seed: `seed-${openCount}`,
          name: `vam-stub-${openCount}`,
        };
      },
    });
    try {
      visibility.mockReturnValue('visible');
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(openCount).toBe(1);
      expect(writeCalls).toContain('seed-1');
      // THE SAME `Terminal` INSTANCE, not a recreated one -- this component's
      // own choice to keep it alive across hide/show, documented at the
      // effect.
      const termBeforeHide = lastTerm;

      visibility.mockReturnValue('hidden');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(close).toHaveBeenCalledWith('stream-1');
      // No dispose: the instance survives, only the stream closed.
      expect(disposeCalls).toHaveLength(0);

      visibility.mockReturnValue('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(openCount).toBe(2);
      // NEVER a resume of the old streamId -- a brand new one.
      expect(writeCalls).toContain('seed-2');
      expect(lastTerm).toBe(termBeforeHide);
    } finally {
      visibility.mockRestore();
    }
  });

  it('does not connect at mount while the window starts hidden', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    const openSpy = vi.fn(async () => ({
      ok: true as const,
      streamId: 's1',
      seed: 'x',
      name: 'vam-stub-a1b2c3',
    }));
    withBridge({ open: openSpy });
    try {
      visibility.mockReturnValue('hidden');
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      visibility.mockRestore();
    }
  });
});

// Review finding: this pane never subscribed to `onDown` at all, so a
// dropped connection sat frozen -- the LAST screen drawn, no sign anything
// was wrong -- for as long as `StreamClient` kept retrying, and stayed
// frozen forever once it gave up. `withDownCapture` is what makes that
// actually exercisable: the bridge stub's own `onDown` used to be a no-op
// (`() => () => {}`), which is exactly why this went unnoticed by every
// OTHER test in this file.
describe('the onDown banner (review finding)', () => {
  it('subscribes to onDown at all -- the bridge stub used to be a no-op', async () => {
    const down = withDownCapture();
    withBridge({ onDown: down.onDown });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(down.onDown).toHaveBeenCalledWith('stream-1', expect.any(Function));
    expect(down.isSubscribed()).toBe(true);
  });

  it('shows "reconnecting…" on a reconnecting event, without tearing down the pane', async () => {
    const down = withDownCapture();
    withBridge({ onDown: down.onDown });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      down.fire({ kind: 'reconnecting', attempt: 1 });
    });

    const banner = q('[data-terminal-stream-down]');
    expect(banner?.textContent).toBe('reconnecting…');
    expect(banner?.getAttribute('data-terminal-stream-down-kind')).toBe('reconnecting');
    // The terminal itself is still there -- the operator's last screen
    // stays visible underneath the banner, never replaced by it.
    expect(q('[data-terminal-stream]')).not.toBeNull();
    expect(disposeCalls).toHaveLength(0);
  });

  it.each([
    ['max-attempts', 'disconnected — vam could not reconnect'],
    ['session-gone', 'disconnected — the session ended'],
  ] as const)(
    'shows a distinguishable "disconnected" text for gave-up/%s',
    async (reason, text) => {
      const down = withDownCapture();
      withBridge({ onDown: down.onDown });
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      act(() => {
        down.fire({ kind: 'gave-up', reason });
      });

      const banner = q('[data-terminal-stream-down]');
      expect(banner?.textContent).toBe(text);
      expect(banner?.getAttribute('data-terminal-stream-down-kind')).toBe('gave-up');
    },
  );

  it.each([['max-attempts'], ['session-gone']] as const)(
    'asks its caller to fall back once gave-up fires for %s',
    async (reason) => {
      const down = withDownCapture();
      const onFallback = vi.fn();
      withBridge({ onDown: down.onDown });
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} onFallback={onFallback} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      act(() => {
        down.fire({ kind: 'gave-up', reason });
      });

      expect(onFallback).toHaveBeenCalledExactlyOnceWith(reason);
    },
  );

  it('never asks to fall back on a mere reconnecting event', async () => {
    const down = withDownCapture();
    const onFallback = vi.fn();
    withBridge({ onDown: down.onDown });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} onFallback={onFallback} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      down.fire({ kind: 'reconnecting', attempt: 1 });
    });

    expect(onFallback).not.toHaveBeenCalled();
  });

  it('clears the banner once a fresh seed arrives', async () => {
    const down = withDownCapture();
    let seedListener: ((seed: string) => void) | undefined;
    withBridge({
      onDown: down.onDown,
      onSeed: (_streamId, listener) => {
        seedListener = listener;
        return () => {
          seedListener = undefined;
        };
      },
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      down.fire({ kind: 'reconnecting', attempt: 1 });
    });
    expect(q('[data-terminal-stream-down]')).not.toBeNull();

    act(() => {
      seedListener?.('a fresh screen');
    });
    expect(q('[data-terminal-stream-down]')).toBeNull();
  });

  it('normalizes a bare-\\n RECONNECT seed the same way the initial one is (onSeed, not just connect())', async () => {
    let seedListener: ((seed: string) => void) | undefined;
    withBridge({
      onSeed: (_streamId, listener) => {
        seedListener = listener;
        return () => {
          seedListener = undefined;
        };
      },
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    writeCalls.length = 0;

    act(() => {
      seedListener?.('reseeded row one\nreseeded row two');
    });
    expect(writeCalls).toContain('reseeded row one\r\nreseeded row two');
  });

  it('clears a stale banner on a fresh connect() (visibility reconnect)', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    const down = withDownCapture();
    try {
      visibility.mockReturnValue('visible');
      withBridge({ onDown: down.onDown });
      render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      act(() => {
        down.fire({ kind: 'gave-up', reason: 'max-attempts' });
      });
      expect(q('[data-terminal-stream-down]')).not.toBeNull();

      visibility.mockReturnValue('hidden');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      visibility.mockReturnValue('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(q('[data-terminal-stream-down]')).toBeNull();
    } finally {
      visibility.mockRestore();
    }
  });
});

describe('tmux stays sized to xterm across a reconnect (task brief: cols×rows must equal tmux’s window size after a reconnect, not only after the first connect)', () => {
  it('refits and re-sends resize-window when a RECONNECT pushes a fresh seed through onSeed, not only on the initial connect()', async () => {
    let seedListener: ((seed: string) => void) | undefined;
    const { resize } = withBridge({
      onSeed: (_streamId, listener) => {
        seedListener = listener;
        return () => {
          seedListener = undefined;
        };
      },
    });
    render(<TerminalStreamTab projectId="p1" rowId="s1" branch={null} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // THE INITIAL connect() already asserted the size once -- cleared so this
    // test only speaks to what the RECONNECT path does on its own.
    resize.mockClear();

    // `StreamClient`'s own `#reconnect()` (main/terminal/stream/client.ts)
    // never re-opens the stream from the renderer's side -- it pushes a
    // fresh seed through the SAME `onSeed` subscription a `%pause`/
    // `%continue` reseed also uses. Between the drop and this reseed, tmux's
    // window may have drifted from whatever `fit()` last told it (a `-C`
    // client with no real tty reports no size of its own, and a window this
    // pane is not currently drawing to has nothing forcing it to stay put)
    // -- so this is the one seam that MUST re-assert cols×rows, not merely
    // rewrite the screen.
    act(() => {
      seedListener?.('reseeded row one');
    });

    expect(resize).toHaveBeenCalledWith('p1', lastTerm?.cols, lastTerm?.rows, 's1');
  });
});
