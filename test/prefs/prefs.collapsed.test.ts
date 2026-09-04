/**
 * A collapsed project stays collapsed across a reload.
 *
 * Keyed by SOURCE then project id, the same two-level shape `projectIcons`
 * already uses and for the same reason: a project id is unique only within
 * its source, so a flat list of ids would let two sources' projects collapse
 * each other. Never pruned by the icon TTL — a fold is a fact about the
 * person, like `theme`, `panes` and `filters`.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  isProjectCollapsed,
  readPrefs,
  setProjectCollapsed,
  type StorageLike,
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

describe('collapsed projects, persisted', () => {
  it('defaults to nothing collapsed', () => {
    expect(EMPTY_PREFS.collapsedProjects).toEqual({});
    expect(isProjectCollapsed(EMPTY_PREFS, 'black-smith', 'p1')).toBe(false);
  });

  it('survives a write/read round trip', () => {
    const storage = store();
    const next = setProjectCollapsed(EMPTY_PREFS, 'black-smith', 'p1', true);
    writePrefs(storage, next);
    expect(isProjectCollapsed(readPrefs(storage), 'black-smith', 'p1')).toBe(true);
  });

  it('does not collapse another source that reuses the project id', () => {
    const next = setProjectCollapsed(EMPTY_PREFS, 'black-smith', 'p1', true);
    expect(isProjectCollapsed(next, 'claude-code', 'p1')).toBe(false);
  });

  it('expanding removes the entry rather than storing a false', () => {
    const on = setProjectCollapsed(EMPTY_PREFS, 'black-smith', 'p1', true);
    const off = setProjectCollapsed(on, 'black-smith', 'p1', false);
    expect(isProjectCollapsed(off, 'black-smith', 'p1')).toBe(false);
    expect(JSON.parse(JSON.stringify(off)).collapsedProjects).toEqual({});
  });

  it('reads an old payload that has no collapsed field at all', () => {
    // Every shipped payload today is one of these.
    const legacy = store(JSON.stringify({ icons: {}, theme: 'light' }));
    const prefs = readPrefs(legacy);
    expect(prefs.collapsedProjects).toEqual({});
    expect(prefs.theme).toBe('light');
  });

  it('ignores garbage under the key instead of throwing', () => {
    const junk = store(JSON.stringify({ collapsedProjects: { 'black-smith': [1, 'p1', null] } }));
    expect(readPrefs(junk).collapsedProjects).toEqual({ 'black-smith': ['p1'] });
    const worse = store(JSON.stringify({ collapsedProjects: 7 }));
    expect(readPrefs(worse).collapsedProjects).toEqual({});
  });

  it('does not let a __proto__ project id vanish through the prototype setter', () => {
    const storage = store();
    writePrefs(storage, setProjectCollapsed(EMPTY_PREFS, 'black-smith', '__proto__', true));
    expect(isProjectCollapsed(readPrefs(storage), 'black-smith', '__proto__')).toBe(true);
  });
});
