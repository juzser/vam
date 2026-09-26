/**
 * ONE FLAG: does the sidebar draw a countdown to when a Claude Code session's
 * prompt cache expires.
 *
 * Operator, translated from Orca's own Agents settings: "Claude caches your
 * conversation to reduce costs. When idle too long the cache expires and the
 * next message resends full context at higher cost. This shows a countdown
 * so you know when to resume." `domain/cache-timer.ts` is the whole reading
 * rule this flag gates; `panels/CacheCountdown.tsx` is the row it gates.
 *
 * ON BY DEFAULT, the operator's own instruction -- unlike `concise-output.ts`
 * (which types into somebody else's agent) this changes nothing about a
 * running session, so there is no cost to shipping it live for everyone who
 * never opens Settings.
 *
 * A file of its own for the reason `notify.ts` and `concise-output.ts` are:
 * the default is a decision worth finding by name.
 */

export const DEFAULT_CACHE_TIMER = true;

/** A boolean is a choice; anything else is the default -- the same symmetric
 *  read `readNotifyWaiting` takes, for the same reason: neither direction
 *  here types into an agent, so an unreadable value costs nothing worse than
 *  the default. */
export function readCacheTimer(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_CACHE_TIMER;
}
