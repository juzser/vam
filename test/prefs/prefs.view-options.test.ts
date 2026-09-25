/**
 * The sidebar's Group-by/Sort-by choice, persisted -- same treatment as
 * `filters` beside it: stored, never pruned by the icon TTL, per-field
 * defensive so one garbage value cannot drag the other setting back to its
 * default with it.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_OPTIONS } from '../../src/renderer/domain/selectors.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setViewOptions,
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

describe('viewOptions, persisted', () => {
  it('ships Project grouping and needs-you-first sorting', () => {
    expect(EMPTY_PREFS.viewOptions).toEqual(DEFAULT_VIEW_OPTIONS);
  });

  it('survives a write/read round trip', () => {
    const s = store();
    writePrefs(s, setViewOptions(EMPTY_PREFS, { groupBy: 'status', sortBy: 'name' }));
    expect(readPrefs(s).viewOptions).toEqual({ groupBy: 'status', sortBy: 'name' });
  });

  it('falls back to the default for a payload written before the field existed', () => {
    expect(readPrefs(store('{"theme":"light"}')).viewOptions).toEqual(DEFAULT_VIEW_OPTIONS);
  });

  it('takes only a known groupBy — garbage falls back per field, not wholesale', () => {
    const raw = '{"viewOptions":{"groupBy":"pr","sortBy":"name"}}';
    expect(readPrefs(store(raw)).viewOptions).toEqual({
      groupBy: DEFAULT_VIEW_OPTIONS.groupBy,
      sortBy: 'name',
    });
  });

  it('takes only a known sortBy — garbage falls back per field, not wholesale', () => {
    const raw = '{"viewOptions":{"groupBy":"status","sortBy":"activity"}}';
    expect(readPrefs(store(raw)).viewOptions).toEqual({
      groupBy: 'status',
      sortBy: DEFAULT_VIEW_OPTIONS.sortBy,
    });
  });

  it('keeps a stored choice of "none" grouping', () => {
    const raw = '{"viewOptions":{"groupBy":"none"}}';
    expect(readPrefs(store(raw)).viewOptions).toEqual({
      groupBy: 'none',
      sortBy: DEFAULT_VIEW_OPTIONS.sortBy,
    });
  });
});
