import { describe, expect, it } from 'vitest';
import type { ApiFinding, ApiLesson } from '../../src/adapter/api.js';
import { lessonQueue, waiverQueue } from '../../src/adapter/review-queue.js';

function finding(id: string, over: Partial<ApiFinding> = {}): ApiFinding {
  return {
    findingId: id,
    taskId: 'task-1',
    fingerprint: `fp-${id}`,
    severity: 'S3-minor',
    findingStatus: 'raised',
    summary: `summary ${id}`,
    foundBy: 'reviewer',
    waiverId: null,
    ...over,
  };
}

function lesson(id: string, over: Partial<ApiLesson> = {}): ApiLesson {
  return {
    lessonId: id,
    sessionId: 's1',
    lessonType: 'rule',
    lessonScope: 'stack-wide',
    lessonStatus: 'candidate',
    statement: `statement ${id}`,
    ...over,
  };
}

describe('waiverQueue', () => {
  it('asks about an unanswered S3', () => {
    expect(waiverQueue([finding('1')]).map((f) => f.findingId)).toEqual(['1']);
  });

  it('never offers to waive an S1 or an S2', () => {
    // waivers.ts refuses the WHOLE batch if a granted covers one. Offering the
    // button would be a UI that lets you answer and then throws the answer
    // away — and worse, a UI that suggests stop-the-line is negotiable.
    const queue = waiverQueue([
      finding('1', { severity: 'S1-stop-the-line' }),
      finding('2', { severity: 'S2-major' }),
    ]);
    expect(queue).toEqual([]);
  });

  it('drops one that already carries a waiver', () => {
    expect(waiverQueue([finding('1', { waiverId: 'w-1' })])).toEqual([]);
  });

  it('leaves a finding already being fixed alone', () => {
    // Asking you to waive work in flight is asking you to undo it.
    const queue = waiverQueue([
      finding('1', { findingStatus: 'fix-pending' }),
      finding('2', { findingStatus: 'fix-landed' }),
    ]);
    expect(queue).toEqual([]);
  });

  it('asks once per fingerprint, not once per occurrence', () => {
    // One decision covers every occurrence of the same defect. Listing five
    // rows that resolve together would let you grant one and believe the other
    // four were still open.
    const queue = waiverQueue([
      finding('1', { fingerprint: 'fp-same' }),
      finding('2', { fingerprint: 'fp-same' }),
      finding('3', { fingerprint: 'fp-other' }),
    ]);
    expect(queue.map((f) => f.fingerprint)).toEqual(['fp-same', 'fp-other']);
  });

  it('puts the more serious answer first', () => {
    const queue = waiverQueue([
      finding('nit', { severity: 'S4-nit' }),
      finding('minor', { severity: 'S3-minor' }),
    ]);
    expect(queue.map((f) => f.findingId)).toEqual(['minor', 'nit']);
  });
});

describe('lessonQueue', () => {
  it('keeps only the candidates this session raised', () => {
    const queue = lessonQueue([lesson('a'), lesson('b', { sessionId: 'other' })], 's1');
    expect(queue.map((l) => l.lessonId)).toEqual(['a']);
  });

  it('is empty when nothing is pending', () => {
    expect(lessonQueue([], 's1')).toEqual([]);
  });
});
