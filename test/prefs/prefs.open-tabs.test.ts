/**
 * Which session tabs are open, and in what order — across a quit and a
 * relaunch.
 *
 * A hand-arranged tab order the app forgets on restart is worse than no
 * arrangement at all (epic.md Amendment A1.5), so the order is OWNED STATE,
 * persisted here exactly like `lastFocus` — same `{ source, session }` shape,
 * for the same reason: a session id is unique only within its source. Unlike
 * `lastFocus`, which is a single pointer dropped whole on a bad shape, this is
 * a LIST: one malformed entry must not cost its well-formed neighbours, the
 * same defence `icons`/`renames` already give their own buckets.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setOpenTabs,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

function store(initial?: string): StorageLike {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
  };
}

describe('the open session tabs, persisted', () => {
  it('defaults to nothing open', () => {
    expect(EMPTY_PREFS.openTabs).toEqual([]);
  });

  it('survives a write/read round trip, by value and in order', () => {
    const storage = store();
    writePrefs(
      storage,
      setOpenTabs(EMPTY_PREFS, [
        { source: 'factory', session: 'alpha' },
        { source: 'factory', session: 'beta' },
      ]),
    );
    expect(readPrefs(storage).openTabs).toEqual([
      { source: 'factory', session: 'alpha' },
      { source: 'factory', session: 'beta' },
    ]);
  });

  it('keeps two sources apart, the same as lastFocus', () => {
    const storage = store();
    writePrefs(
      storage,
      setOpenTabs(EMPTY_PREFS, [
        { source: 'factory', session: 'beta' },
        { source: 'other-source', session: 'beta' },
      ]),
    );
    expect(readPrefs(storage).openTabs).toEqual([
      { source: 'factory', session: 'beta' },
      { source: 'other-source', session: 'beta' },
    ]);
  });

  it('a later write replaces the whole list, not merges it', () => {
    const storage = store();
    writePrefs(storage, setOpenTabs(EMPTY_PREFS, [{ source: 'factory', session: 'alpha' }]));
    writePrefs(storage, setOpenTabs(readPrefs(storage), [{ source: 'factory', session: 'beta' }]));
    expect(readPrefs(storage).openTabs).toEqual([{ source: 'factory', session: 'beta' }]);
  });

  it('closing every tab is a real state, not a reset to the default', () => {
    const storage = store();
    writePrefs(storage, setOpenTabs(EMPTY_PREFS, [{ source: 'factory', session: 'alpha' }]));
    writePrefs(storage, setOpenTabs(readPrefs(storage), []));
    expect(readPrefs(storage).openTabs).toEqual([]);
  });
});

describe('the open session tabs, defended per field', () => {
  it('loads a payload written before the field existed, resetting nothing else', () => {
    const storage = store(
      JSON.stringify({
        theme: 'light',
        outFontSize: 17,
        hiddenProjects: { factory: ['p1'] },
      }),
    );
    const prefs = readPrefs(storage);
    expect(prefs.openTabs).toEqual([]);
    expect(prefs.theme).toBe('light');
    expect(prefs.outFontSize).toBe(17);
    expect(prefs.hiddenProjects).toEqual({ factory: ['p1'] });
  });

  it('is dropped whole for a payload that is not an array, without taking a good sibling with it', () => {
    for (const garbage of [42, 'beta', null, {}]) {
      const storage = store(JSON.stringify({ openTabs: garbage, theme: 'light', outFontSize: 17 }));
      const prefs = readPrefs(storage);
      expect(prefs.openTabs).toEqual([]);
      expect(prefs.theme).toBe('light');
      expect(prefs.outFontSize).toBe(17);
    }
  });

  it('drops only the malformed entries, keeping the well-formed ones and their order', () => {
    const storage = store(
      JSON.stringify({
        openTabs: [
          { source: 'factory', session: 'alpha' },
          { source: 'factory' },
          42,
          null,
          { source: 7, session: 'beta' },
          { source: 'factory', session: 'gamma' },
        ],
      }),
    );
    expect(readPrefs(storage).openTabs).toEqual([
      { source: 'factory', session: 'alpha' },
      { source: 'factory', session: 'gamma' },
    ]);
  });
});
