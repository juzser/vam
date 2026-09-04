/**
 * The Terminal tab: the screen of the tmux session vam started for this one.
 *
 * WHAT IS DRAWN, exactly. `tmux capture-pane -p` returns the ALREADY-COMPOSED
 * screen as plain text -- what the pane looks like right now, with every
 * escape sequence already applied by tmux and none requested back. This is
 * therefore not a terminal emulator and not a stream: no cursor is placed, no
 * colour is interpreted, nothing is fed through a parser. vam has no terminal
 * renderer and cannot add one, and a snapshot drawn honestly beats a stream
 * drawn as garbage (`sources/tmux/argv.ts`).
 *
 * WHAT IT COSTS WHEN CLOSED: nothing. The operator asked for a tab that loads
 * only when opened, so the whole of this component is mounted by the tab
 * switch and unmounted by it. No timer, no IPC and no tmux process exists
 * while the tab is shut -- the effect below is the only thing that ever asks,
 * and it does not exist until this component does.
 *
 * The three empty answers are kept apart on purpose (`shared/terminal.ts`).
 * One blank pane meaning both "vam started nothing here" and "vam could not
 * reach tmux" is the exact conflation the provider was built to prevent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaneSize, PaneView } from '../../shared/terminal.js';
import { fitPane, sameSize } from './terminal-size.js';

/**
 * How often the open tab re-reads the pane.
 *
 * One second. Each refresh is a single short-lived `tmux capture-pane` that
 * prints a screenful and exits, so the cost is bounded by the screen, not by
 * how long the session has run; a second is fast enough that a working agent
 * reads as live to a person, and slow enough that vam is not spawning
 * processes at interaction rates. It runs ONLY while this component is
 * mounted and the window is visible, which is the constraint that actually
 * bounds the cost -- a closed tab refreshes at no rate at all.
 */
export const REFRESH_MS = 1_000;

/**
 * The reader the tab is given: `window.api.terminal.read`, or nothing.
 *
 * It is asked by PROJECT ID, not by title. The pairing between a session and
 * the tmux session vam started for it is recorded on the tmux session at
 * creation and read back (`main/terminal/pane.ts`); a title reached the name
 * once, was slugged and truncated on the way, and matched nothing.
 */
export type ReadPane = (projectId: string, rowId?: string) => Promise<PaneView>;

/**
 * Telling tmux how big to draw: `window.api.terminal.resize`, or nothing.
 *
 * THE PANE FITS BECAUSE OF THIS AND NOT BECAUSE OF ANY STYLE. `capture-pane`
 * returns the screen tmux has ALREADY composed, at the size the session was
 * created with, so a line tmux wrapped at 80 columns is 80 columns of text by
 * the time it reaches this component. Wrapping, truncation and the column
 * count are decided in tmux; the only thing on this side that can change them
 * is saying what the size should be.
 *
 * It lands only on a session vam recorded as its own for this project
 * (`main/terminal/pane.ts`), which is the guard that matters: this is the one
 * thing the tab does that CHANGES a terminal rather than reading one.
 */
export type ResizePane = (projectId: string, columns: number, rows: number) => Promise<boolean>;

/**
 * How long a wrapper has to stop moving before tmux is told about it.
 *
 * A resize per `ResizeObserver` callback would be a `tmux resize-window`
 * PROCESS PER ANIMATION FRAME while the pane resizer is dragged. The debounce
 * and the unchanged-size check are the two halves of not doing that: the
 * debounce collapses a drag into its last frame, and the check drops even that
 * one when the pixels moved without the cell count changing -- which is most
 * of them, since a cell is several pixels wide.
 */
export const RESIZE_DEBOUNCE_MS = 120;

/**
 * The measuring stick: real characters, in the pane's own font, rendered but
 * not shown.
 *
 * A MEASUREMENT AND NOT A RATIO. The advance width of a monospace face is a
 * property of the face, the size, the platform's hinting and the operator's
 * zoom -- Geist Mono at 10.5px measures 6.6015625px here, where the
 * plausible-looking 0.6 of the font size would have said 6.3 and lost a column
 * every seventeen. Ten characters rather than one because the browser rounds a
 * rectangle, and a tenth of that rounding is a tenth of the error.
 */
const RULER_TEXT = 'M'.repeat(10);

const px = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The pane's content box, in cells -- or `null` while there is no layout to
 * measure, which is every render before the first paint and every render while
 * the tab is hidden.
 *
 * The padding is subtracted because it is the TEXT that has to fit: a column
 * counted across the padding is a column that wraps against it.
 */
function measurePane(pane: HTMLElement, ruler: HTMLElement): PaneSize | null {
  const advance = ruler.getBoundingClientRect();
  const style = globalThis.getComputedStyle(pane);
  const inset = (start: string, end: string): number =>
    px(style.getPropertyValue(start)) + px(style.getPropertyValue(end));
  return fitPane(
    {
      width: pane.clientWidth - inset('padding-left', 'padding-right'),
      height: pane.clientHeight - inset('padding-top', 'padding-bottom'),
    },
    { width: advance.width / RULER_TEXT.length, height: advance.height },
  );
}

/**
 * What is shown when there is no bridge -- the browser build has no main
 * process behind it. Not an empty pane: vam has not looked, so it may not say
 * there is nothing there.
 */
const NO_BRIDGE: PaneView = {
  kind: 'unavailable',
  error: {
    kind: 'unreachable',
    code: 'no-bridge',
    message: 'the terminal is only available in the vam desktop app',
  },
};

export function TerminalTab({
  projectId,
  rowId,
  read,
  resize,
}: {
  readonly projectId: string | null;
  /**
   * The ROW being shown, when there is one. It is what lets main answer with
   * the pane this SESSION published rather than the project's -- a project vam
   * started two sessions in has two panes, and the project alone can only say
   * `ambiguous` (`main/terminal/pane.ts`).
   */
  readonly rowId?: string | undefined;
  readonly read: ReadPane | undefined;
  readonly resize: ResizePane | undefined;
}) {
  /**
   * `null` is "has not answered yet", and it is a state rather than an
   * optimistic guess for one reason: every other value here is a CLAIM about
   * the operator's tmux, and showing one of them before a read has returned
   * would flash "vam started no session for this" at a session that has one.
   */
  const [view, setView] = useState<PaneView | null>(read === undefined ? NO_BRIDGE : null);

  /**
   * WHICH PROJECT THE VALUE ABOVE IS ABOUT, and the reason it is a ref checked
   * during render rather than an effect. A `view` held across a change of
   * `projectId` is the PREVIOUS session's screen, drawn under this session's
   * tab and named as this session's -- and it survived until the next read
   * returned, which is bounded by tmux's 10s timeout, not by the 1s refresh.
   * Clearing it in an effect would still paint the stale frame once. This is
   * the exact case the `null` initial state exists for; it just was not being
   * applied when the prop changed.
   */
  const shownFor = useRef(projectId);
  /** The size tmux was last told, for the session it was told about. */
  const sent = useRef<PaneSize | null>(null);
  if (shownFor.current !== projectId) {
    shownFor.current = projectId;
    // The remembered size belongs to the session it was sent for. Keeping it
    // across a change of project would leave the next session unresized
    // whenever the two panes happen to be the same shape.
    sent.current = null;
    if (view !== null && read !== undefined) setView(null);
  }

  const poll = useCallback(
    (mine: () => boolean) => {
      if (read === undefined || projectId === null) return;
      read(projectId, rowId)
        .then((next) => {
          if (mine()) setView(next);
        })
        .catch((cause: unknown) => {
          // A rejected bridge call is vam not having asked. Reporting it as an
          // empty pane would be the one lie this tab exists to avoid.
          if (!mine()) return;
          setView({
            kind: 'unavailable',
            error: {
              kind: 'unreachable',
              code: 'bridge-failed',
              message: `vam could not read the session's screen: ${String(cause)}`,
            },
          });
        });
    },
    [read, projectId, rowId],
  );

  useEffect(() => {
    if (read === undefined || projectId === null) return;
    let cancelled = false;
    /**
     * Which request's answer is still wanted. `cancelled` alone covers only
     * unmount: two polls in flight both apply their result, so a slow one
     * answering after a newer one would repaint an older screen over a fresher
     * one -- reachable whenever background throttling releases a burst of
     * queued intervals. Only the most recently ISSUED read may write.
     */
    let issued = 0;
    let timer: number | undefined;

    const tick = () => {
      issued += 1;
      const seq = issued;
      poll(() => !cancelled && seq === issued);
    };
    const start = () => {
      if (timer !== undefined) return;
      tick();
      timer = window.setInterval(tick, REFRESH_MS);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    // A hidden window is not being read by anyone, and the browser would
    // throttle the interval into bursts anyway. Stopping outright is both
    // cheaper and more honest than polling into a window nobody can see.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll, read, projectId]);

  const paneRef = useRef<HTMLElement | null>(null);
  const rulerRef = useRef<HTMLElement | null>(null);
  /**
   * Only a pane that is actually being drawn is measured -- and a pane is
   * drawn only for a session vam RECORDED as its own for this project. Every
   * other answer (`not-vam`, `gone`, `ambiguous`, `unavailable`) draws a
   * sentence and no pane, so there is nothing to fit and nothing is observed.
   * That is not a nicety: a resize aimed at a session vam cannot prove would
   * reflow a terminal belonging to work vam has nothing to do with.
   */
  const showing = view !== null && view.kind === 'ok';

  useEffect(() => {
    const pane = paneRef.current;
    const ruler = rulerRef.current;
    if (!showing || resize === undefined || projectId === null || pane === null || ruler === null) {
      return;
    }
    let timer: number | undefined;
    const apply = () => {
      const size = measurePane(pane, ruler);
      // `null` is "no layout yet", not "very small". Sending a size derived
      // from a zero box would resize the session to the clamp floor.
      if (size === null || sameSize(sent.current, size)) return;
      sent.current = size;
      // Fire and forget: the answer is whether tmux did it, and the next
      // capture shows that better than any message could. A rejected bridge
      // call must not become an unhandled rejection over a cosmetic ask.
      void resize(projectId, size.columns, size.rows).catch(() => undefined);
    };
    // The observer, and not a window `resize` listener: the pane changes width
    // when the pane RESIZER is dragged and when a layout preset moves the
    // canvas strip, neither of which resizes the window. `observe` delivers the
    // element's initial size, so this is also the first measurement.
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(apply, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(pane);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [showing, resize, projectId]);

  // Nothing is focused, so there is no project to ask about and the effect
  // above never asks. Saying "reading the session's screen" here -- which is
  // what the pending state below says -- would be vam claiming to be looking
  // at something it had not asked a single question about, forever.
  if (projectId === null) {
    return (
      <p data-terminal data-terminal-empty className="text-[11px] text-ink-faint">
        No session selected — pick one in the sidebar.
      </p>
    );
  }
  if (view === null) {
    return (
      <p data-terminal data-terminal-pending className="text-[11px] text-ink-faint">
        Reading the session’s screen…
      </p>
    );
  }
  if (view.kind === 'unavailable') {
    return (
      <p
        data-terminal
        data-terminal-unavailable
        data-terminal-code={view.error.code}
        className="text-[11px] text-ink-faint"
      >
        {/* vam could not ask. Not "there is no session". */}
        {view.error.message}
      </p>
    );
  }
  if (view.kind !== 'ok') {
    return (
      <p data-terminal data-terminal-empty className="text-[11px] text-ink-faint">
        {view.kind === 'gone'
          ? 'The tmux session vam started for this one has ended.'
          : view.kind === 'ambiguous'
            ? // Neither screen, and both names. Drawing one of them would be a
              // coin toss the operator has no way of seeing was tossed.
              `vam started more than one tmux session for this project, so it will not guess which screen you meant: ${view.names.join(', ')}.`
            : // No offer to connect to anything: vam can show the sessions it
              // started and no others, because no process can take over
              // another's controlling TTY.
              'vam did not start a tmux session for this one, so there is no screen to show.'}
      </p>
    );
  }
  return (
    <div data-terminal className="flex min-h-0 flex-1 flex-col gap-1.5">
      <p data-terminal-name className="flex-none font-mono text-[10px] text-ink-faint">
        {/* Whose screen this is. The text below came from that session and
            goes nowhere near vam's own output. */}
        {view.name}
      </p>
      {/* A FOCUS STOP, because this is a scroll region and vam is driven from
          the keyboard. `vam-no-scrollbar` hides the bar, so without a focus
          stop there was no way at all -- mouse or key -- to read past the
          first screenful. Tab reaches it and the arrow keys, Page keys and
          Home/End scroll it, all of which the browser does for a focused
          scrollable element; nothing is bound here, so nothing captions it as
          bound and `buildKeySheet` has nothing to list. It is a named region
          rather than a button: it activates nothing, and a focus stop that
          activates nothing while looking activatable is its own trap. */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a SCROLLABLE region
          is the one case where WCAG 2.1.1 requires exactly this. The rule
          reads a focus stop on a non-interactive element as a keyboard trap
          with nothing to activate, which is right almost everywhere and wrong
          here: without the focus stop the content below the fold is reachable
          by no key at all. It is a named <section> rather than a role, so the
          region is the element's own semantics, and nothing is bound to it. */}
      <section
        ref={paneRef}
        data-terminal-pane
        // biome-ignore lint/a11y/noNoninteractiveTabindex: see above -- a scrollable region is the one case WCAG 2.1.1 requires this
        tabIndex={0}
        aria-label={`terminal output of ${view.name}`}
        className="vam-no-scrollbar relative min-h-0 flex-1 overflow-auto rounded-[9px] border border-line bg-panel px-3 py-2 font-mono text-[10.5px] text-ink leading-[1.45] focus-visible:outline focus-visible:outline-2 focus-visible:outline-line-strong"
      >
        {/* The ruler. It is INSIDE the pane so that it inherits the exact font
            family, size and line height the text is drawn in -- measuring a
            character anywhere else would measure a different character. It is
            transparent and out of the flow rather than `display: none`,
            because a box that is not laid out has no size to read; it is
            hidden from assistive tech and from the pointer, so nothing but the
            measurement notices it. */}
        <span
          ref={rulerRef}
          data-terminal-ruler
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 whitespace-pre opacity-0"
        >
          {RULER_TEXT}
        </span>
        <pre className="whitespace-pre">{view.text}</pre>
      </section>
    </div>
  );
}
