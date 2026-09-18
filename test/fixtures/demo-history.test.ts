/**
 * The demo's own backward pager, and what it is for.
 *
 * `?demo=1` is the only session vam may put in a screenshot or drive from a
 * guard: the repo is public, and every real transcript on this machine is
 * somebody's work. So the demo has to exercise the SAME four answers a real
 * source gives, or the guard that drives it is measuring a happy path nobody
 * ships. This file pins that it does -- including the two answers a fixture is
 * always tempted to leave out, the blank window that is not the end and the
 * read that failed.
 */

import { describe, expect, it } from 'vitest';
import { createDemoHistory, DEMO_HISTORY_TURNS } from '../../src/renderer/fixtures/demo-history.js';
import type { TranscriptPage } from '../../src/shared/history.js';

/** Walk the pager to exhaustion, collecting each answer in order. */
async function walk(read: ReturnType<typeof createDemoHistory>, from: string) {
  const answers: TranscriptPage[] = [];
  let cursor: string | null = from;
  for (let step = 0; step < 20; step += 1) {
    const answer: TranscriptPage = await read('factory-sse-1', cursor);
    answers.push(answer);
    if (answer.kind === 'unavailable') {
      // A refusal is where a walk stops; the caller retries the same cursor.
      continue;
    }
    if (answer.reachedStart) break;
    cursor = answer.cursor;
  }
  return answers;
}

describe('the demo pager', () => {
  it('answers only for the session it has a transcript for', async () => {
    const read = createDemoHistory(0);
    const answer = await read('some-other-session', null);
    expect(answer.kind).toBe('unavailable');
    expect(answer.kind === 'unavailable' && answer.error.code).toBe('no-demo-transcript');
  });

  it('gives all four answers over one walk, in a fixed order', async () => {
    const read = createDemoHistory(0);
    const answers = await walk(read, 'd-hello');
    const shapes = answers.map((a) =>
      a.kind === 'unavailable'
        ? 'unavailable'
        : a.reachedStart
          ? 'start'
          : a.turns.length > 0
            ? 'turns'
            : 'blank',
    );
    // 1. turns, 2. a blank window that is NOT the end, 3. a read that failed,
    // 4. the retry that succeeds, 5-7. three more blank windows -- which is
    // `MAX_BLANK_STEPS`, so one gesture ends on one of them and the column has
    // to say "there is more" with nothing new to show -- 8. the proven start.
    expect(shapes).toEqual([
      'turns',
      'blank',
      'unavailable',
      'turns',
      'blank',
      'blank',
      'blank',
      'start',
    ]);
  });

  it('the blank window carries a cursor, so it can never read as an ending', async () => {
    const read = createDemoHistory(0);
    const answers = await walk(read, 'd-hello');
    const blank = answers[1];
    expect(blank?.kind).toBe('page');
    if (blank?.kind !== 'page') return;
    expect(blank.turns).toHaveLength(0);
    expect(blank.reachedStart).toBe(false);
    expect(blank.cursor).not.toBeNull();
  });

  it('the refusal carries words a person can act on, and is TRANSIENT', async () => {
    const read = createDemoHistory(0);
    const answers = await walk(read, 'd-hello');
    const refused = answers[2];
    expect(refused?.kind).toBe('unavailable');
    if (refused?.kind !== 'unavailable') return;
    expect(refused.error.message.length).toBeGreaterThan(20);
    // The retry -- the same cursor again -- is what answers next, which is the
    // whole point of the cursor not moving on a failure.
    expect(answers[3]?.kind).toBe('page');
  });

  it('hands over every one of its turns exactly once, oldest last', async () => {
    const read = createDemoHistory(0);
    const answers = await walk(read, 'd-hello');
    const ids = answers.flatMap((a) => (a.kind === 'page' ? a.turns.map((t) => t.id) : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(DEMO_HISTORY_TURNS);
    // Newest first within the walk, so the last one handed over is the oldest.
    expect(ids.at(-1)).toBe('demo-old-1');
  });

  it('says the start ONLY at the start, never merely because a page was short', async () => {
    const read = createDemoHistory(0);
    const answers = await walk(read, 'd-hello');
    const starts = answers.filter((a) => a.kind === 'page' && a.reachedStart);
    expect(starts).toHaveLength(1);
    expect(starts[0]).toBe(answers.at(-1));
    expect(starts[0]?.kind === 'page' && starts[0].cursor).toBeNull();
  });

  it('keeps answering the start once it has reached it', async () => {
    const read = createDemoHistory(0);
    const answers = await walk(read, 'd-hello');
    const last = answers.at(-1);
    const again = await read('factory-sse-1', null);
    expect(again.kind).toBe('page');
    expect(again.kind === 'page' && again.reachedStart).toBe(true);
    expect(last?.kind === 'page' && last.reachedStart).toBe(true);
  });

  it('is one walk per instance, so a reload starts the sequence over', async () => {
    // The refusal is a state in a closure, not a global: two demo canvases in
    // one browser must not steal each other's step.
    const first = await walk(createDemoHistory(0), 'd-hello');
    const second = await walk(createDemoHistory(0), 'd-hello');
    expect(second.map((a) => a.kind)).toEqual(first.map((a) => a.kind));
  });
});
