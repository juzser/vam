import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '../../src/shared/update.js';
import { reduce, type UpdateEvent } from '../../src/shared/update-state.js';

const IDLE: UpdateStatus = { kind: 'idle' };
const AVAILABLE: UpdateStatus = {
  kind: 'available',
  version: '0.2.0',
  notesUrl: 'https://github.com/x',
};
const DOWNLOADING = (percent: number): UpdateStatus => ({
  kind: 'downloading',
  version: '0.2.0',
  percent,
});
const INSTALLING: UpdateStatus = { kind: 'installing', version: '0.2.0' };
const CHECKING = (manual: boolean): UpdateStatus => ({ kind: 'checking', manual });

describe('reduce: checking', () => {
  it('idle -> checking, remembering whether it was manual', () => {
    expect(reduce(IDLE, { type: 'check-start', manual: true })).toEqual(CHECKING(true));
    expect(reduce(IDLE, { type: 'check-start', manual: false })).toEqual(CHECKING(false));
  });

  it('is ignored while downloading or installing', () => {
    const d = DOWNLOADING(10);
    expect(reduce(d, { type: 'check-start', manual: true })).toBe(d);
    expect(reduce(INSTALLING, { type: 'check-start', manual: true })).toBe(INSTALLING);
  });

  it('a check result lands only on a checking state', () => {
    const result: UpdateEvent = { type: 'check-result', status: AVAILABLE };
    expect(reduce(CHECKING(false), result)).toEqual(AVAILABLE);
    const d = DOWNLOADING(5);
    expect(reduce(d, result)).toBe(d);
    expect(reduce(IDLE, result)).toBe(IDLE);
  });

  it('a check result may be not-available or error but never a progress status', () => {
    const checking = CHECKING(true);
    const na: UpdateStatus = { kind: 'not-available', manual: true, reason: 'up-to-date' };
    expect(reduce(checking, { type: 'check-result', status: na })).toEqual(na);
    const err: UpdateStatus = { kind: 'error', message: 'x', code: 'network' };
    expect(reduce(checking, { type: 'check-result', status: err })).toEqual(err);
    expect(reduce(checking, { type: 'check-result', status: DOWNLOADING(1) })).toBe(checking);
  });
});

describe('reduce: download', () => {
  it('starts only from available', () => {
    expect(reduce(AVAILABLE, { type: 'download-start' })).toEqual(DOWNLOADING(0));
    for (const s of [IDLE, INSTALLING, DOWNLOADING(3), CHECKING(false)]) {
      expect(reduce(s, { type: 'download-start' })).toBe(s);
    }
  });

  it('progress applies only while downloading, clamped and monotonic', () => {
    expect(reduce(DOWNLOADING(10), { type: 'progress', percent: 40 })).toEqual(DOWNLOADING(40));
    expect(reduce(DOWNLOADING(40), { type: 'progress', percent: 20 })).toEqual(DOWNLOADING(40));
    expect(reduce(DOWNLOADING(40), { type: 'progress', percent: 250 })).toEqual(DOWNLOADING(100));
    expect(reduce(DOWNLOADING(40), { type: 'progress', percent: -5 })).toEqual(DOWNLOADING(40));
    const d = DOWNLOADING(40);
    expect(reduce(d, { type: 'progress', percent: Number.NaN })).toBe(d);
    expect(reduce(AVAILABLE, { type: 'progress', percent: 50 })).toBe(AVAILABLE);
    expect(reduce(IDLE, { type: 'progress', percent: 50 })).toBe(IDLE);
  });

  it('installing follows downloading only', () => {
    expect(reduce(DOWNLOADING(100), { type: 'install-start' })).toEqual(INSTALLING);
    expect(reduce(AVAILABLE, { type: 'install-start' })).toBe(AVAILABLE);
    expect(reduce(IDLE, { type: 'install-start' })).toBe(IDLE);
  });
});

describe('reduce: failure, dismiss, reset', () => {
  it('fail turns a busy state into an error', () => {
    const fail: UpdateEvent = { type: 'fail', message: 'boom', code: 'checksum' };
    const err = { kind: 'error', message: 'boom', code: 'checksum' };
    expect(reduce(DOWNLOADING(9), fail)).toEqual(err);
    expect(reduce(INSTALLING, fail)).toEqual(err);
    expect(reduce(CHECKING(true), fail)).toEqual(err);
    expect(reduce(IDLE, fail)).toBe(IDLE);
    expect(reduce(AVAILABLE, fail)).toBe(AVAILABLE);
  });

  it('dismiss from available -> idle; illegal elsewhere', () => {
    expect(reduce(AVAILABLE, { type: 'dismiss' })).toEqual(IDLE);
    const d = DOWNLOADING(1);
    expect(reduce(d, { type: 'dismiss' })).toBe(d);
    expect(reduce(INSTALLING, { type: 'dismiss' })).toBe(INSTALLING);
    expect(reduce(IDLE, { type: 'dismiss' })).toBe(IDLE);
  });

  it('reset clears an error or a not-available notice, nothing else', () => {
    const err: UpdateStatus = { kind: 'error', message: 'x', code: 'network' };
    const na: UpdateStatus = { kind: 'not-available', manual: true };
    expect(reduce(err, { type: 'reset' })).toEqual(IDLE);
    expect(reduce(na, { type: 'reset' })).toEqual(IDLE);
    expect(reduce(AVAILABLE, { type: 'reset' })).toBe(AVAILABLE);
    const d = DOWNLOADING(1);
    expect(reduce(d, { type: 'reset' })).toBe(d);
  });

  it('a fresh check may replace an error or an available offer', () => {
    const err: UpdateStatus = { kind: 'error', message: 'x', code: 'network' };
    expect(reduce(err, { type: 'check-start', manual: true })).toEqual(CHECKING(true));
    expect(reduce(AVAILABLE, { type: 'check-start', manual: true })).toEqual(CHECKING(true));
  });
});
