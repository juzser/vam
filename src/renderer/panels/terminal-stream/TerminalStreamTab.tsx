/**
 * The Terminal tab's STREAMING half: xterm.js over `window.api.terminalStream`
 * instead of `TerminalTab.tsx`'s `capture-pane` poll.
 *
 * PARITY PASS (`docs/design/terminal-streaming.md`, task-breakdown items
 * 4-6): open, seed, live data, typed input, resize-driven refit, a
 * theme/font that tracks the shared prefs stores, insert/select-mode marks,
 * scrollback chords and visibility-driven connect/disconnect. Paste refusal
 * and IME composition are covered separately (see this file's own commits).
 * The `Terminal` instance's lifecycle is React's mount/unmount; the STREAM's
 * lifecycle is additionally gated on `document.visibilityState`, below.
 *
 * RESIZE IS NOT PART OF THE STREAM PROTOCOL. The EXISTING
 * `window.api.terminal.resize` channel (the one `TerminalTab.tsx` already
 * calls) is reused: the running program's redraw for the new size arrives as
 * ordinary data on the already-open stream, so no new IPC is needed here.
 */

import { FitAddon } from '@xterm/addon-fit';
import type { ITheme } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { INSERT_STOP, insertScopeMark } from '../../keyboard/focus-scope.js';
import { activeTerminalFontSize, subscribeTerminalFontSize } from '../../prefs/terminal-font.js';
import {
  activeTerminalScheme,
  type ResolvedTerminalScheme,
  subscribeTerminalScheme,
} from '../../prefs/terminal-scheme.js';

/**
 * The scheme's twenty-three colours plus `backgroundOpacity`, reduced to what
 * xterm.js's own `ITheme` accepts. `bold` is dropped -- `ITheme` has no such
 * field (`TerminalTab.tsx`'s own `spanClasses` is the only reader of it) --
 * and `backgroundOpacity` is a vam-only composite this tab does not paint
 * (the pane is opaque; there is no wrapper behind it to show through).
 */
function mapScheme(scheme: ResolvedTerminalScheme): ITheme {
  const { bold: _bold, backgroundOpacity: _backgroundOpacity, ...theme } = scheme;
  return theme;
}

/** What is shown when there is no bridge, or nothing focused to stream --
 *  the same wording `TerminalTab.tsx`'s own `NO_BRIDGE` case draws, since a
 *  browser build has no stream behind this tab either. */
const NOT_AVAILABLE_TEXT = 'the terminal is only available in the vam desktop app';

/** `TerminalTab.tsx`'s own `SCROLL_CHORDS` (`#459`) keys, Shift-held only:
 *  VAM'S scrollback, never the running program's, intercepted before xterm's
 *  own key handling sees them and mapped onto xterm's NATIVE scrollback
 *  (`term.scrollPages`/`scrollToTop`/`scrollToBottom`) instead of a DOM
 *  scroll. */
const SCROLL_CHORD_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End']);

/** The four ways `terminalStreamOpen` refuses (`main/terminal/stream-ipc.ts`'s
 *  own `StreamOpenRefusal`), named here rather than imported: that module
 *  reaches `node:crypto`, and this file is typechecked under
 *  `tsconfig.web.json` too -- the same reason `preload/api.ts` writes the
 *  union out by hand instead of importing it. */
type RefusalReason = 'bad-request' | 'unavailable' | 'unresolved-session' | 'unsupported-tmux';

/** One honest sentence per refusal, in `TerminalTab.tsx`'s own register: what
 *  vam could not do, never a guess at why. `unsupported-tmux` gets its own
 *  claim -- the operator's tmux, not vam's request, is what fell short --
 *  because folding it into `unavailable` would send them after the wrong
 *  cause. */
const REFUSAL_TEXT: Record<RefusalReason, string> = {
  'bad-request': 'vam could not open this session’s stream: the request it sent was malformed.',
  unavailable: 'vam could not ask tmux for its sessions, so it has nothing to stream.',
  'unresolved-session':
    'vam could not tell which tmux session this is: none of the ones it started answer for this row, or more than one does.',
  'unsupported-tmux':
    'this tmux is older than streaming needs (control-mode output notifications need tmux 3.2 or later) — the operator’s tmux, not this request, is what fell short.',
};

export function TerminalStreamTab(props: {
  readonly projectId: string | null;
  readonly rowId?: string | undefined;
  readonly branch: string | null;
}) {
  const { projectId, rowId } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const [refusal, setRefusal] = useState<RefusalReason | null>(null);

  const bridge = globalThis.window?.api?.terminalStream;
  const fontSize = useSyncExternalStore(subscribeTerminalFontSize, activeTerminalFontSize);
  const scheme = useSyncExternalStore(subscribeTerminalScheme, activeTerminalScheme);

  useEffect(() => {
    if (bridge === undefined || projectId === null || containerRef.current === null) {
      return;
    }
    const container = containerRef.current;
    // NARROWED ONCE, HELD BY THE FUNCTIONS BELOW. `teardownStream`/`connect`
    // are function DECLARATIONS, and TypeScript does not carry a narrowing
    // of an outer `const`/parameter across a function boundary -- these two
    // locals are what let `openBridge.open`/`.close` type-check without
    // reaching for a non-null assertion.
    const openBridge = bridge;
    const openProjectId = projectId;
    let cancelled = false;
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeSeed: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let frame: number | undefined;

    // THE RESOURCE LIVES WHILE MOUNTED **AND** VISIBLE. A hidden-but-mounted
    // pane closes its stream outright (design doc, "Control-client lifetime
    // per view") rather than leaving a `tmux -C` child running for a window
    // nobody can see; becoming visible again always opens a FRESH stream --
    // never a resume of the old `streamId`, which `StreamClient` cannot
    // resume anyway -- and reseeds, since a hidden pane's screen may be
    // stale and there is no cheap way to know it is not (mirrors
    // `StreamClient`'s own reconnect posture).
    //
    // THE `Terminal` INSTANCE ITSELF IS KEPT ACROSS A HIDE/SHOW CYCLE,
    // deliberately, rather than disposed and recreated: only the stream
    // (the open connection, its data/seed subscriptions) is torn down and
    // rebuilt. Disposing xterm too would also drop its scrollback and
    // force a full re-measure for no benefit -- reseeding already replaces
    // everything the operator can see, and the keyboard/resize wiring below
    // is set up once and stays valid for the instance's whole life.
    function teardownStream() {
      unsubscribeData?.();
      unsubscribeSeed?.();
      unsubscribeData = undefined;
      unsubscribeSeed = undefined;
      const streamId = streamIdRef.current;
      streamIdRef.current = null;
      if (streamId !== null) openBridge.close(streamId);
    }

    async function connect() {
      setRefusal(null);
      const result = await openBridge.open(openProjectId, rowId);
      if (cancelled) return;
      if (!result.ok) {
        setRefusal(result.reason);
        return;
      }
      const { streamId } = result;
      streamIdRef.current = streamId;

      let term = termRef.current;
      if (term === null) {
        term = new Terminal({
          theme: mapScheme(activeTerminalScheme()),
          fontSize: activeTerminalFontSize(),
          scrollback: 5000,
          cursorBlink: true,
          convertEol: false,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(container);
        // WHERE `I`/A CLICK LANDS. `focus-scope.ts`'s `focusInsertStop` finds
        // the first `data-insert-stop` inside the nearest `data-insert-scope`
        // (the container, marked below) and calls `.focus()` on it -- for
        // every other pane that is an element rendered in JSX; xterm.js
        // creates its own `<textarea>` inside `container` on `open()`, so
        // the mark has to be set imperatively on the element it actually
        // gives back rather than rendered.
        term.textarea?.setAttribute(INSERT_STOP, '');
        // SILENT, MATCHING `TerminalTab.tsx` EXACTLY -- its own `onInput`
        // drops `insertFromPaste`/`insertFromDrop` with no visible message,
        // "this channel is bounded precisely so that it cannot become one".
        // xterm.js listens for `paste` on this same textarea and, by
        // default, sends the clipboard text through as input; the CAPTURE
        // phase is what lets this handler run and refuse BEFORE that.
        term.textarea?.addEventListener(
          'paste',
          (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
          },
          { capture: true },
        );
        // `false` STOPS THE KEY REACHING XTERM'S OWN HANDLING (and so its
        // `onData`) -- checked BEFORE that handling, exactly where
        // `TerminalTab.tsx`'s own `onKeyDown` checks `SCROLL_CHORDS`. `true`
        // for everything else, including keyup, so ordinary typing is
        // unaffected.
        const liveTerm = term;
        liveTerm.attachCustomKeyEventHandler((event) => {
          if (event.type !== 'keydown' || !event.shiftKey || !SCROLL_CHORD_KEYS.has(event.key)) {
            return true;
          }
          if (event.key === 'PageUp') liveTerm.scrollPages(-1);
          else if (event.key === 'PageDown') liveTerm.scrollPages(1);
          else if (event.key === 'Home') liveTerm.scrollToTop();
          else liveTerm.scrollToBottom();
          return false;
        });
        // WRITES ALWAYS TARGET THE CURRENT STREAM, read from the ref at
        // call time rather than closed over here -- this handler is wired
        // ONCE for the instance's whole life, but `streamIdRef` changes on
        // every reconnect. `null` (hidden, disconnected) drops the
        // keystroke rather than sending it nowhere.
        liveTerm.onData((text) => {
          const currentStreamId = streamIdRef.current;
          if (currentStreamId !== null) {
            openBridge.write(currentStreamId, new TextEncoder().encode(text));
          }
        });
        termRef.current = term;
        fitRef.current = fit;
        resizeObserver = new ResizeObserver(() => {
          if (frame !== undefined) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            fit.fit();
            const current = termRef.current;
            if (current !== null) {
              window.api?.terminal?.resize(openProjectId, current.cols, current.rows, rowId);
            }
          });
        });
        resizeObserver.observe(container);
      } else {
        // A RECONNECT, NOT A FIRST CONNECT: always reseed, on the same
        // "assume nothing was missed" posture the design doc names for
        // `StreamClient`'s own reconnect.
        term.reset();
      }
      term.write(result.seed);
      fitRef.current?.fit();
      window.api?.terminal?.resize(openProjectId, term.cols, term.rows, rowId);

      unsubscribeData = openBridge.onData(streamId, (chunk) => term?.write(chunk));
      unsubscribeSeed = openBridge.onSeed(streamId, (seed) => {
        term?.reset();
        term?.write(seed);
      });
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        teardownStream();
      } else {
        void connect().catch((error: unknown) => {
          console.error('vam: terminal stream reconnect failed:', error);
        });
      }
    };

    if (document.visibilityState !== 'hidden') {
      connect().catch((error: unknown) => {
        console.error('vam: terminal stream open failed:', error);
      });
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      teardownStream();
      resizeObserver?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [bridge, projectId, rowId]);

  // The font size, pushed live -- cell metrics change with it, so the fit
  // addon has to re-measure and tell the running program the new size.
  useEffect(() => {
    const term = termRef.current;
    if (term === null) return;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
    if (projectId !== null) {
      window.api?.terminal?.resize(projectId, term.cols, term.rows, rowId);
    }
  }, [fontSize, projectId, rowId]);

  // The scheme, pushed live -- no refit needed, only a repaint.
  useEffect(() => {
    const term = termRef.current;
    if (term === null) return;
    term.options.theme = mapScheme(scheme);
  }, [scheme]);

  if (bridge === undefined || projectId === null) {
    return (
      <p data-terminal-stream data-terminal-stream-empty className="text-control text-ink-faint">
        {NOT_AVAILABLE_TEXT}
      </p>
    );
  }

  if (refusal !== null) {
    return (
      <p
        data-terminal-stream
        data-terminal-stream-refused
        data-terminal-stream-reason={refusal}
        className="text-control text-ink-faint"
      >
        {REFUSAL_TEXT[refusal]}
      </p>
    );
  }

  return (
    <div
      data-terminal-stream
      ref={containerRef}
      {...insertScopeMark}
      className="relative min-h-0 flex-1 font-mono"
    />
  );
}
