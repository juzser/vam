/**
 * The Terminal tab's STREAMING half: xterm.js over `window.api.terminalStream`
 * instead of `TerminalTab.tsx`'s `capture-pane` poll.
 *
 * PARITY PASS (`docs/design/terminal-streaming.md`, task-breakdown items
 * 4-6): open, seed, live data, typed input, resize-driven refit, a
 * theme/font that tracks the shared prefs stores, insert/select-mode marks,
 * scrollback chords and visibility-driven connect/disconnect. Paste WAS
 * refused outright; the operator asked for it back, and it now goes through
 * `terminal-paste.ts`'s shared sanitiser and xterm's own bracketed-paste mode
 * (see the paste listener below). IME composition is covered separately (see
 * this file's own commits). The `Terminal` instance's lifecycle is React's
 * mount/unmount; the STREAM's lifecycle is additionally gated on
 * `document.visibilityState`, below.
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
import { GitBranch } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { INSERT_STOP, insertScopeMark } from '../../keyboard/focus-scope.js';
import {
  activeTerminalFontSize,
  subscribeTerminalFontSize,
  TERMINAL_FONT_FAMILY,
  TERMINAL_STREAM_LINE_HEIGHT,
} from '../../prefs/terminal-font.js';
import {
  activeTerminalScheme,
  type ResolvedTerminalScheme,
  subscribeTerminalScheme,
  terminalSchemeStyle,
} from '../../prefs/terminal-scheme.js';
import { preparePastedText } from '../terminal-paste.js';

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

/** `TerminalTab.tsx`'s own `SCROLL_CHORDS` (issue 459) keys, Shift-held only:
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

/**
 * `StreamClient`'s own `StreamDownEvent` (`main/terminal/stream/client.ts`),
 * carried across the bridge by `terminalStreamDown` -- written out here
 * rather than imported for the same `tsconfig.web.json` reason `RefusalReason`
 * above is. A review finding: this pane never subscribed to it at all, so a
 * dropped connection sat frozen -- the LAST screen drawn, no sign anything
 * was wrong -- for as long as `StreamClient` kept retrying, and then stayed
 * frozen forever once it gave up.
 */
type StreamDownEvent =
  | { readonly kind: 'reconnecting'; readonly attempt: number }
  | { readonly kind: 'gave-up'; readonly reason: 'max-attempts' | 'session-gone' };

/** One honest sentence for the banner drawn over the pane while `down` is
 *  set -- `reconnecting…` for a retry still in flight, `disconnected —
 *  <reason>` once `StreamClient` has given up for good (matched to this
 *  file's own `RefusalReason` register: what happened, never a guess at
 *  why beyond what `StreamClient` itself already knows). */
function downText(event: StreamDownEvent): string {
  if (event.kind === 'reconnecting') return 'reconnecting…';
  return event.reason === 'session-gone'
    ? 'disconnected — the session ended'
    : 'disconnected — vam could not reconnect';
}

/**
 * A "seed" (`StreamClient#connect`'s return value and every later
 * `onSeed` push) is `tmux capture-pane -p -e -J`'s own TEXT DUMP of the
 * pane -- one already-composed row per line, joined with a bare `\n`
 * exactly as any other line-oriented CLI output is (tmux's own documented
 * behaviour, unrelated to how a running program's PTY writes a real
 * newline). The live half of this stream (`onData`, fed by `%output`) is
 * the OPPOSITE: raw bytes the pane's own process actually wrote to its
 * pty, decoded verbatim (`decodeOutputPayload`) -- a real terminal program
 * pairs a line break with an explicit `\r` there, which is why
 * `convertEol` is `false` on this `Terminal` (converting a bare `\n` to
 * `\r\n` on the LIVE path would be redundant at best).
 *
 * A SEED IS NOT THAT: xterm.js only moves the cursor to column 0 on a
 * `\r`, never merely on a `\n` (`convertEol: false`'s whole point), so
 * writing a bare-`\n`-joined seed drew every row indented by wherever the
 * PREVIOUS row's text happened to end -- a staircase that grew by one
 * row's width each line and was this task's own reproduction of "ALL the
 * output is misaligned" (an operator's box-drawn Claude Code prompt, once
 * so indented, reads as noise). MEASURED: `e2e/terminal-stream-glitch-shots.mjs`'s
 * own real-tmux fixture (a Claude Code-style box, CJK, an emoji, Vietnamese
 * combining marks) rendered seven garbled, staircased rows without this
 * and all seven byte-for-byte correct with it.
 */
function asXtermSeed(seed: string): string {
  return seed.replace(/\r?\n/g, '\r\n');
}

export function TerminalStreamTab(props: {
  readonly projectId: string | null;
  readonly rowId?: string | undefined;
  readonly branch: string | null;
}) {
  const { projectId, rowId, branch } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const [refusal, setRefusal] = useState<RefusalReason | null>(null);
  const [down, setDown] = useState<StreamDownEvent | null>(null);
  /**
   * THE RESOLVED TMUX SESSION NAME, once the stream has actually opened --
   * `null` until then, on purpose: `TerminalTab.tsx`'s own status rule never
   * draws a name it has not confirmed either (its `view` starts `null` for
   * the identical reason, see that file's header). `StreamOpenResult.name`
   * (`main/terminal/stream-ipc.ts`) is the SAME `targetSession` pairing that
   * file's `view.name` comes from -- the one fact this tab could not
   * otherwise say, since the stream itself carries bytes, not a name.
   */
  const [name, setName] = useState<string | null>(null);

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
    let unsubscribeDown: (() => void) | undefined;
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
      unsubscribeDown?.();
      unsubscribeData = undefined;
      unsubscribeSeed = undefined;
      unsubscribeDown = undefined;
      const streamId = streamIdRef.current;
      streamIdRef.current = null;
      if (streamId !== null) openBridge.close(streamId);
    }

    async function connect() {
      setRefusal(null);
      setDown(null);
      setName(null);
      const result = await openBridge.open(openProjectId, rowId);
      if (cancelled) return;
      if (!result.ok) {
        setRefusal(result.reason);
        return;
      }
      const { streamId } = result;
      streamIdRef.current = streamId;
      setName(result.name);

      let term = termRef.current;
      if (term === null) {
        term = new Terminal({
          theme: mapScheme(activeTerminalScheme()),
          fontSize: activeTerminalFontSize(),
          // THE SAME ROW HEIGHT `TerminalTab.tsx`'s CSS produces, and the
          // SAME face (`TERMINAL_FONT_FAMILY`, copied from `styles.css`'s
          // `--font-mono` -- see that constant's own header for why a copy
          // is unavoidable for a DOM renderer that takes a literal string).
          // `TERMINAL_STREAM_LINE_HEIGHT`, NOT `TERMINAL_LINE_HEIGHT`: xterm's
          // own option means something different to the same number -- see
          // that constant's own header for the measured mismatch it corrects.
          // Left at xterm's defaults (1.0 lineHeight, a generic `courier-new`
          // stack) the two screens read as visibly different type, not merely
          // a different engine underneath the same face.
          lineHeight: TERMINAL_STREAM_LINE_HEIGHT,
          fontFamily: TERMINAL_FONT_FAMILY,
          scrollback: 5000,
          // A STEADY BLOCK, NOT A BLINK -- matching `TerminalTab.tsx`'s own
          // cursor exactly (that file's header: "IT DOES NOT BLINK"). That
          // file's reason (a poll cannot honestly animate liveness) does not
          // apply here -- this pane really is live -- but the operator's own
          // ask is that the two screens look the same with the setting
          // flipped, and a blink is the single most visible difference a
          // cursor can carry.
          cursorBlink: false,
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
        // `liveTerm`, NOT `term`, IS WHAT THE CLOSURES BELOW CAPTURE --
        // `attachCustomKeyEventHandler`'s callback, `onData`'s callback and
        // this paste listener are all invoked LATER, after this whole `if`
        // block has finished running, and TypeScript does not narrow a `let`
        // captured by a function defined here across that gap. Declared once
        // and reused by every one of them, rather than each closing over
        // `term` and fighting the same narrowing individually.
        const liveTerm = term;
        // A REAL PASTE, HANDLED HERE RATHER THAN LEFT TO XTERM'S OWN DEFAULT.
        // xterm.js listens for `paste` on this same textarea and, left alone,
        // sends the clipboard text through as `onData` itself -- wrapped in
        // bracketed-paste codes if the pane asked for them, but with NO
        // escaping of an embedded END marker inside the clipboard text
        // (`terminal-paste.ts`'s own header explains why that matters). The
        // CAPTURE phase is what lets this handler run and cancel xterm's own
        // BEFORE it acts; `stopImmediatePropagation` on top of
        // `preventDefault` is belt and braces against xterm's own listener
        // (added earlier, inside `open()`) ever running for the same event.
        //
        // NO PERMISSION IS NEEDED TO READ `event.clipboardData` -- it is
        // handed over because the operator pressed the keys (or used the
        // Edit menu's Paste), not read via `navigator.clipboard`, whose
        // permission this app's policy denies (`composer-paste.ts` carries
        // the same argument for the prompt box's own image paste).
        //
        // BRACKETING IS THIS COMPONENT'S OWN DECISION, unlike the
        // capture-pane renderer's `sendPasteArgv`, which leaves it to tmux's
        // `paste-buffer -p`: there is no tmux verb on this path at all, only
        // a write of raw bytes to the control-mode connection, so xterm's own
        // `modes.bracketedPasteMode` -- the SAME fact tmux tracks per pane,
        // read here instead of there -- is what this component consults
        // before deciding whether to wrap.
        liveTerm.textarea?.addEventListener(
          'paste',
          (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            const raw = event.clipboardData?.getData('text/plain') ?? '';
            if (raw === '') return;
            const text = preparePastedText(raw);
            if (text === '') return;
            const payload = liveTerm.modes.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text;
            const currentStreamId = streamIdRef.current;
            if (currentStreamId !== null) {
              openBridge.write(currentStreamId, new TextEncoder().encode(payload));
            }
          },
          { capture: true },
        );
        // `false` STOPS THE KEY REACHING XTERM'S OWN HANDLING (and so its
        // `onData`) -- checked BEFORE that handling, exactly where
        // `TerminalTab.tsx`'s own `onKeyDown` checks `SCROLL_CHORDS`. `true`
        // for everything else, including keyup, so ordinary typing is
        // unaffected.
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
      // FIT/RESIZE BEFORE THE SEED IS WRITTEN, not after: this terminal's
      // `cols`/`rows` start at xterm's own default (80x24) until the first
      // `fit()` runs, and a seed containing a box-drawn Claude Code prompt
      // (98 columns wide) written at 80 columns would soft-wrap once here
      // and never straighten back out (`asXtermSeed`'s own header covers the
      // OTHER half of this same symptom).
      //
      // NO `document.fonts.ready` AWAIT HERE, deliberately, despite this
      // task's own brief asking to check for one: `fontFamily`
      // (`TERMINAL_FONT_FAMILY`, copied from `styles.css`'s `--font-mono`)
      // NAMES `Geist Mono` but this renderer bundles no such font -- no
      // `@font-face`, no package (`SessionList.tsx`'s own header, the same
      // gap `terminal-size.ts` already lives with for `TerminalTab.tsx`'s own
      // measurement). `document.fonts.ready` resolves once every
      // ALREADY-REGISTERED `@font-face` has loaded; with none registered for
      // this stack, Chromium resolves straight to a system fallback (`ui-
      // monospace`/`SF Mono`/Menlo/Consolas) SYNCHRONOUSLY, before this line
      // ever runs -- there is no later font swap for a deferred `fit()` to
      // correct. Awaiting it here would cost a microtask for a race that
      // cannot occur today; add it back the day this stack ships a real
      // `@font-face` (searching for that comment is the reminder).
      fitRef.current?.fit();
      window.api?.terminal?.resize(openProjectId, term.cols, term.rows, rowId);
      term.write(asXtermSeed(result.seed));

      unsubscribeData = openBridge.onData(streamId, (chunk) => term?.write(chunk));
      unsubscribeSeed = openBridge.onSeed(streamId, (seed) => {
        // A FRESH SEED IS THE ALL-CLEAR (review finding, paired with
        // `onDown` below): `StreamClient` only ever pushes one after a
        // successful reconnect or a post-pause catch-up, so whatever
        // banner `onDown` raised is stale the moment this arrives.
        setDown(null);
        term?.reset();
        // REFIT AND RE-ASSERT THE SIZE HERE TOO, not only on the initial
        // `connect()` above: this branch is `StreamClient`'s OWN reconnect
        // (`main/terminal/stream/client.ts#reconnect`) and its `%pause`/
        // `%continue` catch-up, neither of which re-opens the stream from
        // this side -- they push straight through this same subscription.
        // tmux has nothing holding the window at the size this pane last
        // fit it to while THIS client was down (a control-mode client with
        // no real tty reports no size of its own to keep it there), so the
        // guard this task asks for -- cols×rows still equal to tmux's own
        // window size AFTER a reconnect -- has to be re-asserted on every
        // seed, exactly like the first one, rather than assumed to still
        // hold from before the drop.
        fitRef.current?.fit();
        // READ BACK THROUGH `termRef`, not the `term` this closure captured:
        // the same reason the `ResizeObserver` callback above does (a `let`
        // closed over by an async callback keeps its DECLARED, nullable type
        // under TypeScript's control-flow analysis, not the narrowing this
        // function body earned above this closure).
        const current = termRef.current;
        if (current !== null) {
          window.api?.terminal?.resize(openProjectId, current.cols, current.rows, rowId);
        }
        term?.write(asXtermSeed(seed));
      });
      unsubscribeDown = openBridge.onDown(streamId, (event) => {
        setDown(event);
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
    /* THE SAME OUTER SHAPE `TerminalTab.tsx`'s own return draws -- a
       flex-column with the pane above and a one-row status rule below,
       `font-mono` ambient and the operator's chosen size on the root so
       anything drawn in `em`/`ch` inside it (there is nothing today, but
       `TerminalTab.tsx`'s own comment names this as the reason it carries
       the size too) inherits it. */
    <div
      data-terminal-stream-root
      className="relative mx-auto flex w-full min-h-0 flex-1 flex-col gap-1.5 font-mono"
      style={{ fontSize: `${fontSize}px` }}
    >
      {/* THE PANE FRAME, byte-for-byte the classes `TerminalTab.tsx`'s own
         `OverlayScroll` scroller carries (`rounded-[9px] border border-line
         ... has-[:focus-visible]:outline ...`), plus `overflow-hidden`
         (unlike that file's `overflow-auto`): xterm.js owns its own
         scrollback and paints its own square-cornered canvas, so the frame
         has to CLIP it to the radius rather than let it scroll past one --
         `TerminalTab.tsx` never has this problem because its screen is a
         `<pre>` inside the SAME rounded/padded box, never a layer under it.

         THE PADDING LIVES HERE, ON THE FRAME -- DELIBERATELY NOT ON THE
         ELEMENT `term.open()` MOUNTS INTO (a review finding, reversing this
         file's own earlier claim). `FitAddon.proposeDimensions()` reads
         `getComputedStyle` on `term.element.parentElement` for its WIDTH/
         HEIGHT and, separately, on `term.element` ITSELF for the padding to
         subtract -- two DIFFERENT elements. Putting the padding on the
         element `term.open()` mounts into makes it `term.element`'s own
         PARENT, so its width is read (807px, MEASURED, this task's own
         report) but its padding never is (`term.element`'s -- the `.xterm`
         div's own -- padding is zero): every column this frame's `px-3
         py-2` was supposed to reserve was instead handed to xterm as
         drawable columns, and Chromium's `getComputedStyle().width` on a
         `box-sizing: border-box` element (this renderer's own Tailwind
         preflight) returns the BORDER-BOX size, padding and border
         included -- NOT the content box this file used to claim it always
         is. MEASURED consequence: `.xterm-screen` rendered 790px wide
         inside a 781px viewport, the missing 9px landing exactly in this
         padding's own space, which is why a full-width line's closing `│`
         crowded the right edge with none of the left edge's clearance.
         The fix is the INNER, UNPADDED `[data-terminal-stream-mount]` div
         below: `term.open()` mounts into THAT, so `term.element.parentElement`
         is an element with no padding of its own, sized (`h-full w-full`)
         to exactly this frame's content box -- the number FitAddon needs,
         with nothing left for it to fail to subtract.

         THE SCHEME'S OWN COLOURS, the same `terminalSchemeStyle` call
         `TerminalTab.tsx` makes -- the composited background and the
         `--vam-term-*`/`--vam-ansi-*` custom properties. xterm's OWN canvas
         paints itself from `mapScheme`'s ITheme (below) rather than reading
         these, so what this buys here is the FRAME matching at opacity 1
         (the shipped default): `docs/design/terminal-streaming.md`'s own
         comparison table names the one case they can disagree -- a
         `backgroundOpacity` under 1, which xterm's opaque canvas cannot
         honour without its own translucency work this task did not need at
         the default the operator will actually see. */}
      <div
        data-terminal-stream
        {...insertScopeMark}
        className="relative min-h-0 flex-1 overflow-hidden rounded-[9px] border border-line px-3 py-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-line-strong"
        style={terminalSchemeStyle(scheme) as CSSProperties}
      >
        {/* THE UNPADDED MOUNT, per the comment above: `term.open()` mounts
           HERE, not into the padded frame, so `term.element.parentElement`
           (this div) reports the frame's own content box with nothing left
           for `FitAddon` to fail to subtract. */}
        <div data-terminal-stream-mount ref={containerRef} className="h-full w-full" />
        {down !== null && (
          // A review finding: this pane never subscribed to onDown at all, so
          // a dropped connection sat frozen -- the last screen drawn, no sign
          // anything was wrong. `absolute` over the pane rather than replacing
          // it: the operator's last-known screen (and its scrollback) stays
          // visible underneath while this says why nothing is moving.
          <p
            data-terminal-stream-down
            data-terminal-stream-down-kind={down.kind}
            className="absolute top-1 right-1 z-10 rounded border border-line bg-panel px-2 py-0.5 text-control text-ink-faint"
          >
            {downText(down)}
          </p>
        )}
      </div>
      {/* THE STATUS RULE, the same one row `TerminalTab.tsx` draws under its
         own screen -- branch at the left where reading starts, the tmux
         session's name pushed to the right (`aria-hidden`: the pane's own
         accessible name already carries it, via `term.textarea`'s
         `aria-label`... which this tab does not set yet, see the design
         doc). `name` is `null` until the stream actually opens
         (`StreamOpenResult.name`), which is what keeps this from ever
         inventing an identity before one is confirmed -- `TerminalTab.tsx`'s
         own `view` starts `null` for the identical reason. */}
      <div
        data-terminal-stream-status
        className="flex flex-none items-center gap-2 border-line border-t pt-1 font-mono text-meta text-ink-faint"
      >
        {typeof branch === 'string' && branch !== '' && (
          <span className="flex min-w-0 items-center gap-1">
            <GitBranch size={10} strokeWidth={1.6} aria-hidden="true" />
            <span data-terminal-stream-branch title={branch} className="truncate">
              {branch}
            </span>
          </span>
        )}
        <span className="flex-1" />
        {name !== null && (
          <span
            data-terminal-stream-badge
            aria-hidden="true"
            className="max-w-[60%] flex-none truncate text-ink-quiet"
          >
            {name}
          </span>
        )}
      </div>
    </div>
  );
}
