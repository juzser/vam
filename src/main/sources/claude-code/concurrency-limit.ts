/**
 * A bounded, order-preserving stand-in for `Promise.all(items.map(fn))`.
 *
 * `source.ts`'s transcript reads used to run genuinely unbounded: every live
 * session's `readTranscriptOf` started in the same tick (S3, a review
 * finding on the fix that made them concurrent at all). Correct for the
 * handful of sessions this machine has ever shown, but an operator with a
 * very large project set would spawn one `claude` read per session all at
 * once. This caps how many run at a time -- no new dependency, the whole
 * point of a review finding this size.
 *
 * A WORK-STEALING POOL OVER A SHARED ITERATOR, not a chunked batch: `limit`
 * workers each pull the next `[index, item]` off `items.entries()` and run
 * `fn` on it, so a fast item's slot is reused by the next item immediately
 * rather than waiting for the rest of its batch to finish. `items.entries()`
 * is a single iterator shared by every worker; each `for...of` iteration's
 * `.next()` call is synchronous, so two workers can never be handed the same
 * item even though the workers themselves run concurrently.
 *
 * ORDER IS BY INPUT POSITION, NEVER BY RESOLUTION ORDER: `results[index]` is
 * assigned by the index `entries()` handed out, not by push order, so a
 * later item resolving before an earlier one still lands in its own slot.
 *
 * REJECTION IS NOT CAUGHT HERE. Exactly like `Promise.all`, one `fn` call
 * that throws fails the whole batch. `source.ts` keeps its own per-session
 * try/catch around `readTranscriptOf`, landing that session's
 * `NO_TRANSCRIPT` sentinel instead of ever letting a rejection reach here --
 * this limiter does not change or duplicate that contract.
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const entries = items.entries();

  async function worker(): Promise<void> {
    for (const [index, item] of entries) {
      results[index] = await fn(item, index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
