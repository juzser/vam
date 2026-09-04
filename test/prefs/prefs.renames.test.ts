/**
 * The local rename override.
 *
 * `claude agents` has no rename subcommand, so there is no upstream call to
 * make: the override is vam's own, stored beside the icons and keyed the same
 * way. These are the store's guarantees -- it wins over the source title, it
 * round-trips, an old payload without the key still loads, and clearing it
 * gives the source's name back.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import {
  applyRenames,
  EMPTY_PREFS,
  readPrefs,
  type Prefs,
  writePrefs,
  setRename,
} from '../../src/renderer/prefs/prefs.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');

function storage(seed?: string) {
  const map = new Map<string, string>();
  if (seed !== undefined) {
    map.set('vam.prefs.v1', seed);
  }
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    read: () => map.get('vam.prefs.v1') ?? null,
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        {
          id: 'a1',
          title: 'sess-077b',
          icon: null,
          epic: null,
          branch: null,
          status: 'done',
          runningAgents: 0,
          activity: null,
          age: null,
          decisions: [],
        },
      ],
    },
  ],
};

describe('setRename', () => {
  it('stores the title under source then session, like an icon', () => {
    const prefs = setRename(EMPTY_PREFS, 'claude-code', 'a1', 'the good one', NOW);
    expect(prefs.renames['claude-code']?.['a1']?.title).toBe('the good one');
  });

  it('clears the override when the title is empty, rather than storing ""', () => {
    const named = setRename(EMPTY_PREFS, 'claude-code', 'a1', 'the good one', NOW);
    const cleared = setRename(named, 'claude-code', 'a1', '', NOW);
    expect(cleared.renames['claude-code']).toBeUndefined();
  });

  it('keeps two sources apart, since a session id is unique only within one', () => {
    const both = setRename(
      setRename(EMPTY_PREFS, 'claude-code', 'a1', 'mine', NOW),
      'black-smith',
      'a1',
      'theirs',
      NOW,
    );
    expect(both.renames['claude-code']?.['a1']?.title).toBe('mine');
    expect(both.renames['black-smith']?.['a1']?.title).toBe('theirs');
  });
});

describe('applyRenames', () => {
  it("wins over the source's own title", () => {
    const prefs = setRename(EMPTY_PREFS, 'claude-code', 'a1', 'the good one', NOW);
    const model = applyRenames(MODEL, prefs.renames);
    expect(model.projects[0]?.sessions[0]?.title).toBe('the good one');
  });

  it('leaves the source title alone when there is no override', () => {
    expect(applyRenames(MODEL, {}).projects[0]?.sessions[0]?.title).toBe('sess-077b');
  });

  it('does not apply another source’s override to this project', () => {
    const prefs = setRename(EMPTY_PREFS, 'black-smith', 'a1', 'wrong', NOW);
    expect(applyRenames(MODEL, prefs.renames).projects[0]?.sessions[0]?.title).toBe('sess-077b');
  });
});

describe('the prefs round trip', () => {
  it('carries a rename through save and load', () => {
    const store = storage();
    const prefs = setRename(EMPTY_PREFS, 'claude-code', 'a1', 'the good one', NOW);
    writePrefs(store, prefs);
    expect(readPrefs(store, NOW).renames['claude-code']?.['a1']?.title).toBe('the good one');
  });

  it('loads an OLD payload that has no rename field at all', () => {
    const store = storage(JSON.stringify({ icons: {}, theme: 'dark' }));
    const loaded: Prefs = readPrefs(store, NOW);
    expect(loaded.renames).toEqual({});
    expect(loaded.theme).toBe('dark');
  });

  it('drops a rename entry that is not a `{title, at}` object', () => {
    const store = storage(JSON.stringify({ renames: { 'claude-code': { a1: 'bare string' } } }));
    expect(readPrefs(store, NOW).renames['claude-code']).toBeUndefined();
  });

  it('prunes a rename older than the TTL, exactly as it prunes an icon', () => {
    const store = storage();
    writePrefs(store, setRename(EMPTY_PREFS, 'claude-code', 'a1', 'ancient', NOW));
    const muchLater = new Date(NOW.getTime() + 400 * 24 * 60 * 60 * 1000);
    expect(readPrefs(store, muchLater).renames['claude-code']).toBeUndefined();
  });
});
