/**
 * The ledger in `./waiting.ts`, driven by the model as it arrives, talking to
 * the bridge.
 *
 * Two things live here and nowhere else, because they need a document:
 *
 *  1. IS THE OPERATOR LOOKING. `focused` is which session the cursor is on;
 *     that is not the same as attention. `document.hasFocus()` is false when
 *     another application is in front, and `visibilityState` is `hidden` when
 *     the window is minimised or on another Space -- in either case a banner
 *     is the right thing even about the focused session, because the operator
 *     has demonstrably looked away. Only all three together mean "attended".
 *
 *  2. THE CROSSING TO MAIN. `api` is `window.api.notify`, absent in the
 *     browser build, and every call is fire-and-forget for the reason
 *     `activatePrefs` gives: a rejection carries nothing the operator can act
 *     on here, and what the OS did is reported through the error log by main
 *     itself (`main/notify/notify.ts`). Nothing crosses when the switch is
 *     off: `decideNotifications` returns empty lists, so there is no call to
 *     make, not a call that is made and ignored.
 *
 * A ref, not state, for the ledger: nothing renders from it, and a state write
 * per poll would re-render the whole canvas for a bookkeeping change.
 */

import { useEffect, useRef } from 'react';
import type { NotifyApi, NotifyTarget } from '../../preload/api.js';
import {
  decideNotifications,
  EMPTY_NOTIFY_LEDGER,
  type NotifiableSession,
  type NotifyLedger,
} from './waiting.js';

/** Focused AND visible: the document, not the cursor. */
function attended(): boolean {
  const doc = globalThis.document;
  if (doc === undefined) return false;
  return doc.hasFocus() && doc.visibilityState === 'visible';
}

export function useWaitingNotifications({
  sessions,
  enabled,
  focused,
  api,
  onActivate,
}: {
  readonly sessions: readonly NotifiableSession[];
  readonly enabled: boolean;
  /** The session the cursor is on, or `null`. */
  readonly focused: NotifyTarget | null;
  readonly api: NotifyApi | undefined;
  /** A banner was clicked; main has already brought the window forward. */
  readonly onActivate: (target: NotifyTarget) => void;
}): void {
  const ledger = useRef<NotifyLedger>(EMPTY_NOTIFY_LEDGER);

  useEffect(() => {
    const decision = decideNotifications(ledger.current, sessions, {
      enabled,
      attending: attended() ? focused : null,
      now: Date.now(),
    });
    ledger.current = decision.ledger;
    if (api === undefined) return;
    for (const target of decision.close) {
      api.close(target).catch(() => {});
    }
    for (const request of decision.show) {
      api.show(request).catch(() => {});
    }
  }, [sessions, enabled, focused, api]);

  // Latest callback through a ref, so the subscription below depends on the
  // bridge alone and is not torn down and rebuilt on every render.
  const activate = useRef(onActivate);
  useEffect(() => {
    activate.current = onActivate;
  });
  useEffect(() => {
    if (api === undefined) return;
    return api.onActivated((target) => activate.current(target));
  }, [api]);
}
