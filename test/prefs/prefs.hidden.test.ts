/**
 * A project removed from vam stays removed across a reload -- and can come
 * back.
 *
 * REMOVAL IS NOT DELETION. A project here is derived from the cwd of live
 * sessions, so nothing about it is stored to delete: end every session vam
 * can end and the project still reappears on the next refresh, because some
 * other terminal is still running in that directory. This list is what makes
 * "remove" stick, and it is therefore the only half of removal that is
 * REVERSIBLE -- which is why `setProjectHidden(..., false)` exists and is
 * tested here beside the write.
 *
 * Keyed by SOURCE then project id, the two-level shape `collapsedProjects`
 * established, for its reason: a project id is unique only within its source.
 * Never pruned by the icon TTL -- a removal is a decision the operator made.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  isProjectHidden,
  readPrefs,
  type StorageLike,
  setProjectHidden,
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

describe('hidden projects, persisted', () => {
  it('defaults to nothing hidden', () => {
    expect(EMPTY_PREFS.hiddenProjects).toEqual({});
    expect(isProjectHidden(EMPTY_PREFS, 'black-smith', 'p1')).toBe(false);
  });

  it('survives a write/read round trip', () => {
    const storage = store();
    writePrefs(storage, setProjectHidden(EMPTY_PREFS, 'black-smith', 'p1', true));
    expect(isProjectHidden(readPrefs(storage), 'black-smith', 'p1')).toBe(true);
  });

  it('hides only the source it was told about', () => {
    const next = setProjectHidden(EMPTY_PREFS, 'black-smith', 'p1', true);
    expect(isProjectHidden(next, 'claude-code', 'p1')).toBe(false);
  });

  it('restores a hidden project, leaving no residue behind', () => {
    const hidden = setProjectHidden(EMPTY_PREFS, 'black-smith', 'p1', true);
    const back = setProjectHidden(hidden, 'black-smith', 'p1', false);
    expect(isProjectHidden(back, 'black-smith', 'p1')).toBe(false);
    // The stored shape matches a fresh install exactly, so a restore reads
    // back as "never removed" rather than as an empty bucket.
    expect(back.hiddenProjects).toEqual({});
  });

  it('reads a payload written before this field existed, resetting nothing', () => {
    const old = JSON.stringify({
      version: 1,
      theme: 'light',
      outFontSize: 15,
      collapsedProjects: { 'black-smith': ['p9'] },
    });
    const prefs = readPrefs(store(old));
    expect(prefs.hiddenProjects).toEqual({});
    expect(prefs.theme).toBe('light');
    expect(prefs.outFontSize).toBe(15);
    expect(prefs.collapsedProjects).toEqual({ 'black-smith': ['p9'] });
  });

  it('drops a garbage bucket without unhiding a good one', () => {
    const payload = JSON.stringify({
      version: 1,
      hiddenProjects: { 'black-smith': ['p1', 7], 'claude-code': 'nope' },
    });
    const prefs = readPrefs(store(payload));
    expect(prefs.hiddenProjects).toEqual({ 'black-smith': ['p1'] });
  });
});
