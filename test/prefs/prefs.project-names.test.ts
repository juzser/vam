/**
 * The local project rename override.
 *
 * A project's display name today comes only from its source -- there is no
 * field to override it, unlike a session (`renames`) or a project's icon
 * (`projectIcons`). This mirrors `projectIcons` exactly, one level over:
 * source id -> project id -> `RenameChoice`, same TTL, same migration/read/
 * prune path (`readBuckets`/`pruneBuckets`/`migrateSourceKey`). These are the
 * store's guarantees -- it wins over the source's own name, it round-trips,
 * an old payload without the key still loads, and clearing it gives the
 * source's name back.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import {
  applyRenames,
  EMPTY_PREFS,
  type Prefs,
  readPrefs,
  setProjectRename,
  writePrefs,
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
      name: 'vam',
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

describe('setProjectRename', () => {
  it('stores the title under source then project, like a project icon', () => {
    const prefs = setProjectRename(EMPTY_PREFS, 'claude-code', 'p1', 'the good repo', NOW);
    expect(prefs.projectNames).toEqual({
      'claude-code': { p1: { title: 'the good repo', at: NOW.toISOString() } },
    });
  });

  it('clears the override when the title is empty, rather than storing ""', () => {
    const named = setProjectRename(EMPTY_PREFS, 'claude-code', 'p1', 'the good repo', NOW);
    const cleared = setProjectRename(named, 'claude-code', 'p1', '', NOW);
    expect(cleared.projectNames).toEqual({});
  });

  it('keeps two sources apart, since a project id is unique only within one', () => {
    const both = setProjectRename(
      setProjectRename(EMPTY_PREFS, 'claude-code', 'p1', 'mine', NOW),
      'factory',
      'p1',
      'theirs',
      NOW,
    );
    expect(both.projectNames['claude-code']?.p1?.title).toBe('mine');
    expect(both.projectNames.factory?.p1?.title).toBe('theirs');
  });
});

describe('applyRenames with projectNames', () => {
  it("wins over the source's own project name", () => {
    const prefs = setProjectRename(EMPTY_PREFS, 'claude-code', 'p1', 'the good repo', NOW);
    const model = applyRenames(MODEL, {}, prefs.projectNames);
    expect(model.projects[0]?.name).toBe('the good repo');
  });

  it('does not change the project id', () => {
    const prefs = setProjectRename(EMPTY_PREFS, 'claude-code', 'p1', 'the good repo', NOW);
    const model = applyRenames(MODEL, {}, prefs.projectNames);
    expect(model.projects[0]?.id).toBe('p1');
  });

  it('leaves the source name alone when there is no override', () => {
    expect(applyRenames(MODEL, {}, {}).projects[0]?.name).toBe('vam');
  });

  it('does not apply another source’s override to this project', () => {
    const prefs = setProjectRename(EMPTY_PREFS, 'factory', 'p1', 'wrong', NOW);
    expect(applyRenames(MODEL, {}, prefs.projectNames).projects[0]?.name).toBe('vam');
  });

  it('leaves a project with no source alone -- never guesses which bucket to read', () => {
    const sourceless: CanvasModel = { projects: [{ id: 'p1', name: 'vam', sessions: [] }] };
    const prefs = setProjectRename(EMPTY_PREFS, 'claude-code', 'p1', 'the good repo', NOW);
    expect(applyRenames(sourceless, {}, prefs.projectNames).projects[0]?.name).toBe('vam');
  });

  it('returns the same object when there is nothing to apply', () => {
    const before = MODEL;
    expect(applyRenames(before, {}, {})).toBe(before);
  });
});

describe('the prefs round trip', () => {
  it('carries a project rename through save and load', () => {
    const store = storage();
    const prefs = setProjectRename(EMPTY_PREFS, 'claude-code', 'p1', 'the good repo', NOW);
    writePrefs(store, prefs);
    expect(readPrefs(store, NOW).projectNames['claude-code']?.p1?.title).toBe('the good repo');
  });

  it('loads an OLD payload that has no projectNames field at all', () => {
    const store = storage(JSON.stringify({ icons: {}, theme: 'dark' }));
    const loaded: Prefs = readPrefs(store, NOW);
    expect(loaded.projectNames).toEqual({});
    expect(loaded.theme).toBe('dark');
  });

  it('drops a projectNames entry that is not a `{title, at}` object', () => {
    const store = storage(
      JSON.stringify({ projectNames: { 'claude-code': { p1: 'bare string' } } }),
    );
    expect(readPrefs(store, NOW).projectNames['claude-code']).toBeUndefined();
  });

  it('prunes a project rename older than the TTL, exactly as it prunes a project icon', () => {
    const store = storage();
    writePrefs(store, setProjectRename(EMPTY_PREFS, 'claude-code', 'p1', 'ancient', NOW));
    const muchLater = new Date(NOW.getTime() + 400 * 24 * 60 * 60 * 1000);
    expect(readPrefs(store, muchLater).projectNames['claude-code']).toBeUndefined();
  });

  it('reads a project rename stored under the old source id back under the new one', () => {
    const store = storage(
      JSON.stringify({
        projectNames: { 'black-smith': { p1: { title: 'renamed', at: NOW.toISOString() } } },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(out.projectNames.factory?.p1?.title).toBe('renamed');
    expect(out.projectNames['black-smith']).toBeUndefined();
  });
});
