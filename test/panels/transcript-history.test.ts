/**
 * The join between the column and the pager: what the merged list is, and what
 * one step back actually asks for.
 *
 * NODE ENVIRONMENT, DELIBERATELY. Everything here is data at rest and a walk
 * over an injected reader -- no DOM, no layout, no scroll. The half of this
 * feature that a unit test genuinely cannot see (scroll anchoring, `scrollHeight`,
 * which element stayed under the reader's eye) lives in
 * `e2e/transcript-column-shots.mjs` and is measured in a real browser; putting a
 * happy-dom stand-in here would be the guard that stays green while the column
 * jumps.
 */

import { describe, expect, it, vi } from 'vitest';
import type { HistoryCursor, TranscriptPage } from '../../src/shared/history.js';
import type { Decision } from '../../src/renderer/domain/model.js';
import {
  appendOlder,
  applyWalk,
  cursorToAsk,
  MAX_BLANK_STEPS,
  mergeColumn,
  moreState,
  type PagerState,
  RESTING_PAGER,
  walkOlder,
} from '../../src/renderer/panels/transcript-history.js';

const turn = (id: string, output = `answer ${id}`): Decision => ({
  id,
  label: `step ${id}`,
  input: `ask ${id}`,
  output,
  commands: [],
});

const page = (over: Partial<Extract<TranscriptPage, { kind: 'page' }>> = {}): TranscriptPage => ({
  kind: 'page',
  turns: [],
  cursor: null,
  reachedStart: true,
  ...over,
});

describe('mergeColumn', () => {
  it('starts as the live tail, newest first', () => {
    const tail = [turn('t3'), turn('t2'), turn('t1')];
    expect(mergeColumn([], tail).map((d) => d.id)).toEqual(['t3', 't2', 't1']);
  });

  it('returns the SAME array when nothing changed, so a render-phase update cannot loop', () => {
    const tail = [turn('t3'), turn('t2')];
    const first = mergeColumn([], tail);
    expect(mergeColumn(first, tail)).toBe(first);
  });

  it('puts a newly polled turn at the front, where the newest turn belongs', () => {
    const column = mergeColumn([], [turn('t2'), turn('t1')]);
    expect(mergeColumn(column, [turn('t3'), turn('t2'), turn('t1')]).map((d) => d.id)).toEqual([
      't3',
      't2',
      't1',
    ]);
  });

  it('takes the FRESH copy of a turn the poll refreshed, in place', () => {
    const column = mergeColumn([], [turn('t2', null as unknown as string), turn('t1')]);
    const merged = mergeColumn(column, [turn('t2', 'the answer landed'), turn('t1')]);
    expect(merged.map((d) => d.id)).toEqual(['t2', 't1']);
    expect(merged[0]?.output).toBe('the answer landed');
  });

  it('KEEPS a turn the tail has dropped -- the window slides, the column must not tear', () => {
    // The measured case: on five of the six largest transcripts on the
    // operator's machine the tail holds ONE turn, so every new turn evicts the
    // previous one. A column that only ever drew `decisions` would lose a turn
    // it had already drawn, mid-read.
    const column = mergeColumn([], [turn('t2'), turn('t1')]);
    const merged = mergeColumn(column, [turn('t3')]);
    expect(merged.map((d) => d.id)).toEqual(['t3', 't2', 't1']);
  });

  it('never returns the same turn twice, whatever arrives', () => {
    const column = appendOlder(mergeColumn([], [turn('t2'), turn('t1')]), [turn('t1'), turn('t0')]);
    const merged = mergeColumn(column, [turn('t2'), turn('t1')]);
    expect(merged.map((d) => d.id)).toEqual(['t2', 't1', 't0']);
  });
});

describe('appendOlder', () => {
  it('puts a page BEHIND what is held: older turns go to the older end', () => {
    const column = mergeColumn([], [turn('t3'), turn('t2')]);
    expect(appendOlder(column, [turn('t1'), turn('t0')]).map((d) => d.id)).toEqual([
      't3',
      't2',
      't1',
      't0',
    ]);
  });

  it('drops a turn the column already holds rather than drawing it twice', () => {
    // #283 made the cursor say whether it names a turn the caller already
    // holds, so this should not happen -- which is exactly why it is asserted
    // here: a cheap check that protects that fix rather than trusting it.
    const column = mergeColumn([], [turn('t2'), turn('t1')]);
    expect(appendOlder(column, [turn('t1'), turn('t0')]).map((d) => d.id)).toEqual([
      't2',
      't1',
      't0',
    ]);
  });

  it('returns the same array when a page adds nothing', () => {
    const column = mergeColumn([], [turn('t2'), turn('t1')]);
    expect(appendOlder(column, [turn('t1')])).toBe(column);
  });
});

describe('cursorToAsk', () => {
  it('is the id of the OLDEST turn on screen when no page has answered yet', () => {
    const column = mergeColumn([], [turn('t3'), turn('t2'), turn('t1')]);
    expect(cursorToAsk(null, column)).toBe('t1');
  });

  it('is the cursor the last page handed back, once there is one', () => {
    const column = mergeColumn([], [turn('t3')]);
    expect(cursorToAsk('@4096', column)).toBe('@4096');
  });

  it('is null when there is no turn to page before and no cursor', () => {
    expect(cursorToAsk(null, [])).toBeNull();
  });
});

describe('walkOlder', () => {
  it('answers a page that carries turns, in one read', async () => {
    const read = vi.fn(async () => page({ turns: [turn('t0')], cursor: '@8', reachedStart: false }));
    const walk = await walkOlder(read, 's1', 't1');
    expect(read).toHaveBeenCalledExactlyOnceWith('s1', 't1');
    expect(walk).toEqual({
      kind: 'page',
      turns: [turn('t0')],
      cursor: '@8',
      reachedStart: false,
      steps: 1,
    });
  });

  it('answers the START as the start, and asks no further', async () => {
    const read = vi.fn(async () => page({ turns: [turn('t0')], cursor: null, reachedStart: true }));
    const walk = await walkOlder(read, 's1', 't1');
    expect(walk).toEqual({
      kind: 'page',
      turns: [turn('t0')],
      cursor: null,
      reachedStart: true,
      steps: 1,
    });
  });

  it('KEEPS GOING through an empty window that is not the start', async () => {
    // The normal case on a large session: ~2.5 MB of transcript per turn, so a
    // window holding no complete turn is what a step back usually finds. It is
    // not the end and must never be reported as one.
    const cursors: (HistoryCursor | null)[] = [];
    const read = vi.fn(async (_id: string, cursor: HistoryCursor | null) => {
      cursors.push(cursor);
      if (cursor === 't1') return page({ turns: [], cursor: '@600', reachedStart: false });
      if (cursor === '@600') return page({ turns: [], cursor: '@300', reachedStart: false });
      return page({ turns: [turn('t0')], cursor: '@100', reachedStart: false });
    });
    const walk = await walkOlder(read, 's1', 't1');
    expect(cursors).toEqual(['t1', '@600', '@300']);
    expect(walk).toEqual({
      kind: 'page',
      turns: [turn('t0')],
      cursor: '@100',
      reachedStart: false,
      steps: 3,
    });
  });

  it('stops after the cap, and still says there is MORE rather than an end', async () => {
    let at = 0;
    const read = vi.fn(async () => {
      at += 1;
      return page({ turns: [], cursor: `@${at}`, reachedStart: false });
    });
    const walk = await walkOlder(read, 's1', 't1');
    expect(read).toHaveBeenCalledTimes(MAX_BLANK_STEPS);
    expect(walk).toEqual({
      kind: 'page',
      turns: [],
      cursor: `@${MAX_BLANK_STEPS}`,
      reachedStart: false,
      steps: MAX_BLANK_STEPS,
    });
  });

  it('reports a refusal as a refusal, and asks no further', async () => {
    const error = { kind: 'unreachable', code: 'transcript-unreadable', message: 'no such file' };
    const read = vi.fn(async () => ({ kind: 'unavailable', error }) as TranscriptPage);
    const walk = await walkOlder(read, 's1', 't1');
    expect(read).toHaveBeenCalledTimes(1);
    expect(walk).toEqual({ kind: 'unavailable', error, steps: 1 });
  });

  it('never asks with a cursor of its own devising', async () => {
    // `HistoryCursor` is opaque: exactly two shapes are legal, and both come
    // from somewhere else. Every ask after the first must be a cursor the
    // previous page handed back, verbatim.
    const handed = ['@600', '@300'];
    const read = vi.fn(async () => {
      const cursor = handed.shift() ?? null;
      return page({ turns: [], cursor, reachedStart: cursor === null });
    });
    await walkOlder(read, 's1', 't1');
    expect(read.mock.calls.map((c) => c[1])).toEqual(['t1', '@600', '@300']);
  });

  it('turns a REJECTION into the same refusal rather than losing the gesture', async () => {
    // The port says `history` never rejects, and every source vam ships keeps
    // that promise. A source built by hand is exactly what the member is
    // optional for, and an unhandled rejection here would leave the column
    // reading forever with nothing on screen to say so.
    const read = vi.fn(async () => {
      throw new Error('the bridge went away');
    });
    const walk = await walkOlder(read, 's1', 't1');
    expect(walk.kind).toBe('unavailable');
    expect(walk.kind === 'unavailable' && walk.error.message).toContain('the bridge went away');
  });
});

describe('applyWalk', () => {
  const walkTurns = {
    kind: 'page' as const,
    turns: [turn('t0')],
    cursor: '@8',
    reachedStart: false,
    steps: 1,
  };

  it('carries the next cursor forward when a page landed', () => {
    expect(applyWalk(RESTING_PAGER, walkTurns)).toEqual({
      cursor: '@8',
      phase: 'rest',
      error: null,
    });
  });

  it('records the start as the start', () => {
    expect(applyWalk(RESTING_PAGER, { ...walkTurns, cursor: null, reachedStart: true })).toEqual({
      cursor: null,
      phase: 'start',
      error: null,
    });
  });

  it('a blank page past the cap is still MORE, never a start', () => {
    const after = applyWalk(RESTING_PAGER, { ...walkTurns, turns: [], cursor: '@4' });
    expect(after).toEqual({ cursor: '@4', phase: 'rest', error: null });
    expect(moreState(after, async () => page({}))).toBe('available');
  });

  it('a refusal leaves the cursor exactly where it was, so a retry asks the same thing', () => {
    const error = { kind: 'refused' as const, code: 'nope', message: 'not today' };
    const asked: PagerState = { cursor: '@600', phase: 'rest', error: null };
    expect(applyWalk(asked, { kind: 'unavailable', error, steps: 1 })).toEqual({
      cursor: '@600',
      phase: 'failed',
      error,
    });
  });
});

describe('moreState', () => {
  const read = async () => page({});

  it('is UNSUPPORTED when the source has no pager at all', () => {
    // Absent is a stated refusal, never "there is nothing older".
    expect(moreState(RESTING_PAGER, null)).toBe('unsupported');
  });

  it('is nothing at all once the start is proven -- there is nothing left to ask', () => {
    expect(moreState({ cursor: null, phase: 'start', error: null }, read)).toBeNull();
  });

  it('a source with no pager can still have proven the start', () => {
    // It cannot today, and the ordering is asserted so it stays that way if one
    // ever can: a source that HAS reached the start has nothing to refuse.
    expect(moreState({ cursor: null, phase: 'start', error: null }, null)).toBeNull();
  });

  it('says READING while a walk is in flight, and UNAVAILABLE after one failed', () => {
    expect(moreState({ cursor: null, phase: 'reading', error: null }, read)).toBe('reading');
    expect(
      moreState(
        { cursor: null, phase: 'failed', error: { kind: 'refused', code: 'x', message: 'y' } },
        read,
      ),
    ).toBe('unavailable');
  });
});
