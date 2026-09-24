/**
 * The Terminal tab's STREAMING half: xterm.js over `window.api.terminalStream`
 * instead of `TerminalTab.tsx`'s `capture-pane` poll.
 *
 * MINIMAL CORE ONLY, for this pass (`docs/design/terminal-streaming.md`):
 * open, seed, live data, typed input, resize-driven refit and a theme/font
 * that tracks the shared prefs stores. Insert/select-mode marks, scrollback
 * chords, visibility-driven reconnect, paste refusal and IME composition are
 * a later task's scope, not this one's — this component's lifecycle is
 * exactly React's own mount/unmount, driven by `DetailPanel`'s tab switch,
 * with nothing else deciding when the stream opens or closes.
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
    let cancelled = false;
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeSeed: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let frame: number | undefined;

    setRefusal(null);
    bridge
      .open(projectId, rowId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setRefusal(result.reason);
          return;
        }
        const { streamId } = result;
        streamIdRef.current = streamId;

        const term = new Terminal({
          theme: mapScheme(activeTerminalScheme()),
          fontSize: activeTerminalFontSize(),
          scrollback: 5000,
          cursorBlink: true,
          convertEol: false,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(container);
        term.write(result.seed);
        fit.fit();
        termRef.current = term;
        fitRef.current = fit;
        window.api?.terminal?.resize(projectId, term.cols, term.rows, rowId);

        term.onData((text) => bridge.write(streamId, new TextEncoder().encode(text)));
        unsubscribeData = bridge.onData(streamId, (chunk) => term.write(chunk));
        unsubscribeSeed = bridge.onSeed(streamId, (seed) => {
          term.reset();
          term.write(seed);
        });

        resizeObserver = new ResizeObserver(() => {
          if (frame !== undefined) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            fit.fit();
            window.api?.terminal?.resize(projectId, term.cols, term.rows, rowId);
          });
        });
        resizeObserver.observe(container);
      })
      .catch((error: unknown) => {
        console.error('vam: terminal stream open failed:', error);
      });

    return () => {
      cancelled = true;
      unsubscribeData?.();
      unsubscribeSeed?.();
      resizeObserver?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      const streamId = streamIdRef.current;
      if (streamId !== null) bridge.close(streamId);
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      streamIdRef.current = null;
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
    <div data-terminal-stream ref={containerRef} className="relative min-h-0 flex-1 font-mono" />
  );
}
