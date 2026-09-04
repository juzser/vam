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

import { useCallback, useEffect, useState } from 'react';
import type { PaneView } from '../../shared/terminal.js';

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

/** The reader the tab is given: `window.api.terminal.read`, or nothing. */
export type ReadPane = (title: string) => Promise<PaneView>;

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
  title,
  read,
}: {
  readonly title: string | null;
  readonly read: ReadPane | undefined;
}) {
  /**
   * `null` is "has not answered yet", and it is a state rather than an
   * optimistic guess for one reason: every other value here is a CLAIM about
   * the operator's tmux, and showing one of them before a read has returned
   * would flash "vam started no session for this" at a session that has one.
   */
  const [view, setView] = useState<PaneView | null>(read === undefined ? NO_BRIDGE : null);

  const poll = useCallback(
    (mine: () => boolean) => {
      if (read === undefined || title === null) return;
      read(title)
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
    [read, title],
  );

  useEffect(() => {
    if (read === undefined || title === null) return;
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
  }, [poll, read, title]);

  if (view === null) {
    return (
      <p data-terminal data-terminal-pending className="text-[11px] text-ink-faint">
        Reading the session's screen&#8230;
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
      <pre
        data-terminal-pane
        className="vam-no-scrollbar min-h-0 flex-1 overflow-auto whitespace-pre rounded-[9px] border border-line bg-panel px-3 py-2 font-mono text-[10.5px] text-ink leading-[1.45]"
      >
        {view.text}
      </pre>
    </div>
  );
}
