// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { DEFAULT_KEEP_AWAKE, readKeepAwake } from '../../src/renderer/prefs/keep-awake.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setKeepAwake,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

function fake(initial: string | null): StorageLike {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

const stored = (payload: Record<string, unknown>) => readPrefs(fake(JSON.stringify(payload)));

describe('the default is off -- a brand-new capability must not act uninvited', () => {
  it('ships off, and an absent key reads as off', () => {
    expect(DEFAULT_KEEP_AWAKE).toBe('off');
    expect(EMPTY_PREFS.keepAwake).toBe('off');
    expect(stored({}).keepAwake).toBe('off');
  });

  it('reads back a stored choice, and only the three words are a choice', () => {
    expect(stored({ keepAwake: 'on' }).keepAwake).toBe('on');
    expect(stored({ keepAwake: 'while-running' }).keepAwake).toBe('while-running');
    for (const raw of ['On', 0, null, {}, [], 'always']) {
      expect(readKeepAwake(raw), JSON.stringify(raw)).toBe(DEFAULT_KEEP_AWAKE);
      expect(stored({ keepAwake: raw }).keepAwake, JSON.stringify(raw)).toBe(DEFAULT_KEEP_AWAKE);
    }
  });
});

describe('the setter', () => {
  it('normalises on the way in and touches nothing else', () => {
    const next = setKeepAwake({ ...EMPTY_PREFS, outFontSize: 15 }, 'on');
    expect(next.keepAwake).toBe('on');
    expect(next.outFontSize).toBe(15);
    expect(setKeepAwake(EMPTY_PREFS, 'nope').keepAwake).toBe(DEFAULT_KEEP_AWAKE);
  });

  it('survives a round trip through storage', () => {
    const storage = fake(null);
    writePrefs(storage, setKeepAwake(EMPTY_PREFS, 'while-running'));
    expect(readPrefs(storage).keepAwake).toBe('while-running');
  });
});
