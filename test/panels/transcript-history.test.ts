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
import { readLiveTail } from '../../src/main/sources/claude-code/tail.js';
import { readWindowOf, type TranscriptSource } from '../../src/main/sources/claude-code/window.js';
import type { Decision } from '../../src/renderer/domain/model.js';
import {
  appendOlder,
  applyWalk,
  columnOf,
  cursorToAsk,
  MAX_BLANK_STEPS,
  MAX_RETAINED_TURNS,
  moreState,
  type PagerState,
  pagerAfterRetain,
  RESTING_PAGER,
  retainLeft,
  walkOlder,
} from '../../src/renderer/panels/transcript-history.js';
import type { HistoryCursor, TranscriptPage } from '../../src/shared/history.js';

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

describe('columnOf', () => {
  it('is the live tail alone when nothing has been walked back', () => {
    const tail = [turn('t3'), turn('t2'), turn('t1')];
    expect(columnOf(tail, [])).toBe(tail);
  });

  it('puts the pages BEHIND the tail: older turns at the older end', () => {
    expect(columnOf([turn('t3'), turn('t2')], [turn('t1'), turn('t0')]).map((d) => d.id)).toEqual([
      't3',
      't2',
      't1',
      't0',
    ]);
  });

  it('lets the POLL own the live region, whatever the pager remembers', () => {
    // The rule that keeps `Canvas.tsx`'s optimistic paint working: a turn it
    // retracts (a refused write, or its replacement by the source's own turn)
    // must leave the column with it, so the pane keeps no second opinion about
    // a turn the poll is carrying -- or has stopped carrying.
    const merged = columnOf([turn('real-1')], []);
    expect(merged.map((d) => d.id)).toEqual(['real-1']);
  });

  it('draws the POLL copy of a turn both halves hold, not the pager stale one', () => {
    const merged = columnOf([turn('t2', 'the answer landed')], [turn('t2', 'still working')]);
    expect(merged.map((d) => d.id)).toEqual(['t2']);
    expect(merged[0]?.output).toBe('the answer landed');
  });

  it('never returns the same turn twice, whatever arrives', () => {
    const merged = columnOf([turn('t2'), turn('t1')], [turn('t1'), turn('t0')]);
    expect(merged.map((d) => d.id)).toEqual(['t2', 't1', 't0']);
    expect(new Set(merged.map((d) => d.id)).size).toBe(merged.length);
  });
});

describe('appendOlder', () => {
  it('puts a page BEHIND what is held: older turns go to the older end', () => {
    expect(
      appendOlder([turn('t3'), turn('t2')], [turn('t1'), turn('t0')]).map((d) => d.id),
    ).toEqual(['t3', 't2', 't1', 't0']);
  });

  it('drops a turn the pager already holds rather than drawing it twice', () => {
    // PR 283 made the cursor say whether it names a turn the caller already
    // holds, so this should not happen -- which is exactly why it is asserted
    // here: a cheap check that protects that fix rather than trusting it.
    expect(
      appendOlder([turn('t2'), turn('t1')], [turn('t1'), turn('t0')]).map((d) => d.id),
    ).toEqual(['t2', 't1', 't0']);
  });

  it('returns the same array when a page adds nothing', () => {
    const held = [turn('t2'), turn('t1')];
    expect(appendOlder(held, [turn('t1')])).toBe(held);
  });
});

describe('cursorToAsk', () => {
  it('is the id of the OLDEST turn on screen when no page has answered yet', () => {
    const column = columnOf([turn('t3'), turn('t2'), turn('t1')], []);
    expect(cursorToAsk(null, column)).toBe('t1');
  });

  it('is the id of the oldest turn WALKED BACK TO, once pages have landed', () => {
    const column = columnOf([turn('t3')], [turn('t2'), turn('t1')]);
    expect(cursorToAsk(null, column)).toBe('t1');
  });

  it('is the cursor the last page handed back, once there is one', () => {
    const column = columnOf([turn('t3')], []);
    expect(cursorToAsk('@4096', column)).toBe('@4096');
  });

  it('is null when there is no turn to page before and no cursor', () => {
    expect(cursorToAsk(null, [])).toBeNull();
  });
});

describe('walkOlder', () => {
  it('answers a page that carries turns, in one read', async () => {
    const read = vi.fn(async () =>
      page({ turns: [turn('t0')], cursor: '@8', reachedStart: false }),
    );
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
    const read = vi.fn(async (_id: string, _asked: HistoryCursor | null) => {
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

describe('retainLeft', () => {
  it('keeps a turn that left the window, in front of what was already walked to', () => {
    const kept = retainLeft([turn('c'), turn('b')], [turn('d'), turn('c')], [turn('a')]);
    expect(kept.map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('holds a turn once however often the window slides, and returns `older` when nothing left', () => {
    const older = [turn('b')];
    expect(retainLeft([turn('c')], [turn('c')], older)).toBe(older);
    expect(retainLeft([turn('b')], [turn('c')], older)).toBe(older);
  });

  it('never keeps a turn vam painted itself', () => {
    const paint: Decision = { ...turn('vam-pending-1'), unconfirmed: true };
    expect(retainLeft([paint, turn('a')], [turn('b')], [])).toEqual([turn('a')]);
  });
});

describe('EC-99 the retention cap never skips the pager', () => {
  it('asks the next walk from the oldest turn still held, so the dropped turns come back', async () => {
    // Newest first. `n1` is the poll's new turn; `h0` is the live turn that
    // leaves; `h1..` are turns the pager walked, MAX_RETAINED_TURNS of them.
    const history = Array.from({ length: MAX_RETAINED_TURNS + 6 }, (_, i) => turn(`h${i}`));
    const walked = history.slice(1, MAX_RETAINED_TURNS + 1);
    const handedBack = `@after-${walked.at(-1)?.id}`;
    const pager: PagerState = { cursor: handedBack, phase: 'rest', error: null };
    const live = [turn('n1')];
    const older = retainLeft([history[0] as Decision], live, walked);
    // The join was one longer than the cap, so the cap dropped the OLDEST end.
    expect(older).toHaveLength(MAX_RETAINED_TURNS);
    expect(older.at(-1)?.id).not.toBe(walked.at(-1)?.id);

    const resumed = pagerAfterRetain(pager, walked, older);
    const column = columnOf(live, older);
    const read = vi.fn(async (_id: string, cursor: string | null) => {
      const at = history.findIndex((d) => d.id === cursor);
      // A handed-back cursor names the turn walked last; a turn id names itself.
      const from = cursor === handedBack ? MAX_RETAINED_TURNS + 1 : at + 1;
      return page({ turns: history.slice(from, from + 3), cursor: 'x', reachedStart: false });
    });
    const walk = await walkOlder(read, 's1', cursorToAsk(resumed.cursor, column) as string);
    if (walk.kind !== 'page') throw new Error('expected a page');
    const joined = columnOf(live, appendOlder(older, walk.turns));
    const ids = joined.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['n1', ...history.slice(0, ids.length - 1).map((d) => d.id)]);
    expect(ids).toContain(walked.at(-1)?.id);
  });
});

describe('EC-100 a window that opens mid-turn does not double the turn', () => {
  const at = (text: string) => ({
    type: 'user',
    promptSource: 'typed',
    timestamp: '2026-09-16T09:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
  const marker = (text: string) => ({ type: 'last-prompt', lastPrompt: text });
  const said = {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  };
  const tool = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'r' }] },
  };
  const lines = [
    at('ask S'),
    marker('ask S'),
    said, // S: 0..2
    at('ask T'),
    marker('ask T'),
    said, // T: 3, marker 4, 5
    marker('ask T'),
    tool,
    said, // R1 = 6
    marker('ask T'),
    tool,
    said, // R2 = 9
    marker('ask T'),
    tool,
    said, // R3 = 12
  ].map((l) => JSON.stringify(l));
  const text = `${lines.join('\n')}\n`;
  const bytes = Buffer.from(text);
  const offsetOf = (i: number) =>
    Buffer.byteLength(`${lines.slice(0, i).join('\n')}${i ? '\n' : ''}`);

  // One poll: the file as it was when it ended at `endLine`, read through the
  // REAL `readLiveTail` with a step that opens the window at `startLine`.
  const poll = async (endLine: number, startLine: number): Promise<Decision[]> => {
    const end = offsetOf(endLine);
    const source: TranscriptSource = {
      size: async () => end,
      read: async (from, to) => readWindowOf(bytes, from, Math.min(to, end)),
    };
    const tail = await readLiveTail(source, 'sess', end - offsetOf(startLine));
    return [...tail.facts.decisions];
  };

  it('prints T once and S once over three growing reads', async () => {
    const reads = [await poll(8, 0), await poll(11, 5), await poll(14, 7)];
    // Read 1 holds T's marker; read 2 opens after it (T opens at R1); read 3
    // opens after R1 (T opens at R2).
    const idsOf = reads.map((r) => r.map((d) => d.id));
    let held: readonly Decision[] = [];
    let drawn: readonly Decision[] = reads[0] as Decision[];
    for (const next of reads.slice(1)) {
      held = retainLeft(drawn, next, held);
      drawn = next;
    }
    const column = columnOf(drawn, held);
    expect(
      column.map((d) => d.input),
      `T's id per read ${JSON.stringify(idsOf)}`,
    ).toEqual(['ask T', 'ask S']);
  });
});
