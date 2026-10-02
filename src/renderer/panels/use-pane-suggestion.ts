/**
 * The provider TUI's own greyed prompt suggestion, polled off the pane for the
 * Response view's prompt box (operator event #30).
 *
 * READ-ONLY: every call is `terminal.read` in `PaneReadMode` `'echo'`, which
 * asks for the screen only and never refreshes the keystroke aim. Nothing here
 * sends a key.
 *
 * ONLY WHILE IT COULD BE OFFERED: desktop, Response showing, session idle, an
 * empty draft, and no question card offering one (the card has priority).
 * When any stops holding the value is dropped AT ONCE, before any new read.
 */

import { useEffect, useRef, useState } from 'react';
import type { SessionStatus } from '../../shared/model.js';
import { readPromptSuggestion } from '../../shared/prompt-suggestion.js';
import type { ReadPane } from './TerminalTab.js';

/** At most one read per this long. */
export const PANE_SUGGESTION_MS = 2_000;

export type UsePaneSuggestionInput = {
  readonly read: ReadPane | undefined;
  readonly projectId: string | null;
  readonly rowId: string | undefined;
  readonly phone: boolean;
  readonly tab: string;
  readonly status: SessionStatus | null;
  readonly draft: string;
  /** What a question card offers, if one does -- the pane offer stands down. */
  readonly cardSuggestion: string | null;
};

export function usePaneSuggestion({
  read,
  projectId,
  rowId,
  phone,
  tab,
  status,
  draft,
  cardSuggestion,
}: UsePaneSuggestionInput): string | null {
  const enabled =
    read !== undefined &&
    projectId !== null &&
    rowId !== undefined &&
    !phone &&
    tab === 'Response' &&
    status === 'idle' &&
    draft === '' &&
    cardSuggestion === null;
  // Keyed by row, so a render between a switch and its effect cannot leak a ghost across sessions.
  const [found, setFound] = useState<{ readonly row: string; readonly text: string } | null>(null);
  const lastRead = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (!enabled || read === undefined || projectId === null || rowId === undefined) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      lastRead.current = Date.now();
      void read(projectId, rowId, 'echo')
        .then((view) => {
          if (!live) return;
          const text = view.kind === 'ok' ? readPromptSuggestion(view.text) : null;
          setFound(text === null ? null : { row: rowId, text });
        })
        .catch(() => {
          if (live) setFound(null);
        })
        .finally(() => {
          if (live) timer = setTimeout(tick, PANE_SUGGESTION_MS);
        });
    };
    timer = setTimeout(tick, Math.max(0, lastRead.current + PANE_SUGGESTION_MS - Date.now()));
    return () => {
      live = false;
      clearTimeout(timer);
      setFound(null);
    };
  }, [enabled, read, projectId, rowId]);

  return enabled && found !== null && found.row === rowId ? found.text : null;
}
