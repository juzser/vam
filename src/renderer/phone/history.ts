/**
 * The phone's own back gesture, made to mean "back to the list".
 *
 * Without this, iOS Safari's edge swipe leaves the page -- which over a
 * Cloudflare Access tunnel is a re-auth round trip to undo a gesture the
 * operator makes by reflex. The History API is native; nothing is installed
 * for it.
 *
 * The functions take the history object rather than reading `window` so the
 * rule is testable without a DOM: it is arithmetic on pushes and backs.
 */

/** The mark on the entry this module pushes, so a foreign entry is not ours. */
export const PHONE_HISTORY_MARK = 'vamPhoneSession';

/** The half of `History` this module uses, and no more of it. */
export type HistoryLike = {
  pushState(data: unknown, unused: string, url?: string): void;
  back(): void;
};

/** One entry per opened session — the thing the back gesture will consume. */
export function openSession(history: HistoryLike): void {
  history.pushState({ [PHONE_HISTORY_MARK]: true }, '');
}

/** Is this `popstate` state the entry we pushed? */
export function isSessionEntry(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)[PHONE_HISTORY_MARK] === true
  );
}

/**
 * Close the session screen by unwinding our own entry.
 *
 * `pushed` is false once `popstate` has already consumed it — the system
 * gesture's path — and going back again there would walk out of the app,
 * which is the exact failure the push was added to prevent.
 */
export function closeSession(history: HistoryLike, pushed: boolean): void {
  if (pushed) history.back();
}
