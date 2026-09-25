import { describe, expect, it } from 'vitest';
import { mapWithConcurrencyLimit } from '../../src/main/sources/claude-code/concurrency-limit.js';

/**
 * S3 (review finding): `loadClaudeCodeProjects`'s concurrent transcript
 * reads (`Promise.all` over every live session) had no upper bound --
 * correct for a handful of sessions, but an operator with a very large
 * project set would spawn one read per session all at once. This is the
 * small in-house limiter that bounds it, pinned on its own, independent of
 * the caller wiring it in (`claude-code.test.ts`'s own "concurrent
 * transcript reads" suite covers that composition).
 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('mapWithConcurrencyLimit', () => {
  it('resolves to an empty array with no items, and never calls fn', async () => {
    const fn = async () => {
      throw new Error('must never be called with zero items');
    };
    expect(await mapWithConcurrencyLimit([], 8, fn)).toEqual([]);
  });

  it('runs every item at once when there are fewer than the limit', async () => {
    let peak = 0;
    let inFlight = 0;
    const items = [0, 1, 2];
    const result = await mapWithConcurrencyLimit(items, 8, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await flush();
      inFlight -= 1;
      return item * 10;
    });
    expect(peak).toBe(3);
    expect(result).toEqual([0, 10, 20]);
  });

  it('never runs more than `limit` at once, with more items than that', async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const pending: { item: number; resolve: () => void }[] = [];

    const resultPromise = mapWithConcurrencyLimit(items, 8, (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<number>((resolve) => {
        pending.push({
          item,
          resolve: () => {
            inFlight -= 1;
            resolve(item);
          },
        });
      });
    });

    await flush();
    expect(pending).toHaveLength(8);
    expect(peak).toBe(8);

    // Release the 12 reads one at a time, in the order they started. Each
    // release must let at most one more begin -- `peak` must never climb
    // past 8, no matter how many are released.
    for (let released = 0; released < items.length; released += 1) {
      pending[released]?.resolve();
      await flush();
    }
    expect(peak).toBe(8);

    const result = await resultPromise;
    // Order preserved by INPUT position, not by when each one resolved.
    expect(result).toEqual(items);
  });

  it('preserves result order even when a later item resolves before an earlier one', async () => {
    const resolvers = new Map<number, (v: string) => void>();
    const items = [0, 1, 2];
    const resultPromise = mapWithConcurrencyLimit(
      items,
      8,
      (item) => new Promise<string>((resolve) => resolvers.set(item, resolve)),
    );
    await flush();
    resolvers.get(2)?.('r2');
    resolvers.get(0)?.('r0');
    resolvers.get(1)?.('r1');
    expect(await resultPromise).toEqual(['r0', 'r1', 'r2']);
  });

  it('does not itself swallow a rejection -- the per-item try/catch is the caller’s job', async () => {
    // `source.ts` keeps its own try/catch around `readTranscriptOf` per
    // session (S3 must not change that NO_TRANSCRIPT semantics). This
    // limiter is a drop-in for `Promise.all`, so an `fn` that does not catch
    // its own failure must still fail the batch the same way `Promise.all`
    // would -- never silently drop or swallow it.
    const items = [0, 1, 2];
    await expect(
      mapWithConcurrencyLimit(items, 8, async (item) => {
        if (item === 1) throw new Error('boom');
        return item;
      }),
    ).rejects.toThrow('boom');
  });
});
