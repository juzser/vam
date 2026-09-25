/**
 * WHICH TERMINAL TAB DRAWS, decided live -- the ONE call `DetailPanel.tsx`
 * makes for the Terminal view now (`docs/design/terminal-streaming.md`'s
 * "Flipping the default" section).
 *
 * TWO DECISIONS, NOT ONE. `prefs/streaming-terminal.ts`'s `streamingTerminal`
 * picks the STARTING renderer, the same module-state read `DetailPanel.tsx`
 * used to make directly (default ON now, see that pref's own header). What
 * is NEW here is the runtime half: an operator's tmux can fail the version
 * gate (`unsupported-tmux`) or a live stream can exhaust its own bounded
 * reconnect retries (`StreamClient`'s `gave-up`, `main/terminal/stream/
 * client.ts`) -- both are facts about THIS operator's tmux, not about
 * whether streaming should be tried at all, and this component drops to
 * `TerminalTab.tsx` for the rest of this session with a one-line notice
 * rather than leaving `TerminalStreamTab.tsx` to sit refused or frozen.
 *
 * MOVED HERE FROM `DetailPanel.tsx` ON PURPOSE. That file is 9,000+ lines
 * several other epics are editing concurrently; the ternary this replaced
 * there is now this file's problem; `DetailPanel.tsx`'s own diff for this
 * change is one import and one call site.
 *
 * THE FALLBACK RESETS PER SESSION. A tmux that could not stream, or a
 * connection that gave up, says nothing about the NEXT session an operator
 * opens -- carrying it across a project/row switch would strand every later
 * tab on the classic renderer for a reason that no longer applies to it.
 */

import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import {
  activeStreamingTerminal,
  subscribeStreamingTerminal,
} from '../../prefs/streaming-terminal.js';
import type { ReadPane, ResizePane, SendKey } from '../TerminalTab.js';
import { TerminalTab } from '../TerminalTab.js';
import type { StreamFallbackReason } from './TerminalStreamTab.js';

// `TerminalStreamTab`, in its own lazy chunk -- the same split
// `DetailPanel.tsx` used to make directly (`bundle-budget.test.ts`'s own
// boundary convention): it carries xterm.js, which is not small, and a
// session that falls back or has streaming turned off never needs it.
const LazyTerminalStreamTab = lazy(() =>
  import('./TerminalStreamTab.js').then((m) => ({ default: m.TerminalStreamTab })),
);

/** One honest sentence per fallback reason, in `TerminalStreamTab.tsx`'s own
 *  `REFUSAL_TEXT`/`downText` register: what changed, never a guess at why
 *  beyond what those two already know. */
const FALLBACK_NOTICE: Record<StreamFallbackReason, string> = {
  'unsupported-tmux':
    'vam switched to the classic terminal: this tmux is older than streaming needs.',
  'max-attempts':
    'vam switched to the classic terminal: the live connection could not be re-established.',
  'session-gone': 'vam switched to the classic terminal: the session ended.',
};

export function TerminalAutoTab(props: {
  readonly projectId: string | null;
  readonly rowId?: string | undefined;
  readonly read: ReadPane | undefined;
  readonly resize: ResizePane | undefined;
  readonly send: SendKey | undefined;
  readonly branch?: string | null;
}) {
  const { projectId, rowId, read, resize, send, branch } = props;
  const streamingTerminal = useSyncExternalStore(
    subscribeStreamingTerminal,
    activeStreamingTerminal,
    activeStreamingTerminal,
  );
  const [fallback, setFallback] = useState<StreamFallbackReason | null>(null);

  // A FRESH SESSION GETS A FRESH TRY -- see the module header. `setFallback`
  // is a state setter (stable by React's own contract), so this never
  // fights `TerminalStreamTab`'s own effect deps over identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a session switch is the re-try signal, not a value read here -- neither projectId nor rowId is used in the body
  useEffect(() => {
    setFallback(null);
  }, [projectId, rowId]);

  if (!streamingTerminal || fallback !== null) {
    return (
      <TerminalTab
        projectId={projectId}
        rowId={rowId}
        read={read}
        resize={resize}
        send={send}
        branch={branch}
        notice={fallback !== null ? FALLBACK_NOTICE[fallback] : null}
      />
    );
  }

  return (
    <Suspense fallback={null}>
      <LazyTerminalStreamTab
        projectId={projectId}
        rowId={rowId}
        branch={branch ?? null}
        onFallback={setFallback}
      />
    </Suspense>
  );
}
