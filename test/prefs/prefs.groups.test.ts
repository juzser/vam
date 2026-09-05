/**
 * The one thing the group layer stores: which projects the operator put
 * together, and which of those groups they folded shut.
 *
 * TWO PROPERTIES DECIDE THE SHAPE HERE, and both are about not losing the
 * operator's work.
 *
 * A group holds member IDS, never paths. A project id is a digest of a cwd,
 * so there is no directory recorded here to go stale, and a member whose
 * project has no live session is simply not in the model that poll builds.
 * That is why a stored member id is KEPT and never pruned: pruning would throw
 * the grouping away the moment the operator closed the last session in that
 * directory, and the group would come back one project short. Kept, it rejoins
 * the moment a session starts there again.
 *
 * And a project belongs to AT MOST ONE group, enforced on the way in: adding
 * one that is already grouped MOVES it. Membership is expressed by array
 * position, so a project in two groups would have its sessions drawn twice,
 * minting duplicate node ids that break both the canvas and the keys `j`/`k`
 * navigate by.
 */

import { describe, expect, it } from 'vitest';
import {
  addProjectToGroup,
  createGroup,
  deleteGroup,
  EMPTY_PREFS,
  isGroupCollapsed,
  readPrefs,
  removeProjectFromGroup,
  renameGroup,
  type StorageLike,
  setGroupCollapsed,
  setGroupIcon,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const KEY = 'vam.prefs.v1';
const NOW = new Date('2026-08-27T12:00:00.000Z');
const SOURCE = 'claude-code';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) {
        this.value = value;
      }
    },
  };
}

describe('reading the group buckets', () => {
  it('starts empty, so a store with no groups is a canvas with no groups', () => {
    expect(EMPTY_PREFS.groups).toEqual({});
    expect(EMPTY_PREFS.collapsedGroups).toEqual({});
  });

  it('reads a payload written before groups existed as empty, keeping its neighbours', () => {
    // Every store on disk today is this one: the keys are simply absent, and
    // there is no version number and no migration.
    const store = fake(JSON.stringify({ theme: 'light', hiddenProjects: { [SOURCE]: ['p1'] } }));
    const prefs = readPrefs(store, NOW);
    expect(prefs.groups).toEqual({});
    expect(prefs.collapsedGroups).toEqual({});
    expect(prefs.theme).toBe('light');
    expect(prefs.hiddenProjects[SOURCE]).toEqual(['p1']);
  });

  it('drops garbage per field, never dragging a neighbour to its default with it', () => {
    const store = fake(JSON.stringify({ theme: 'light', groups: 'nonsense', collapsedGroups: 7 }));
    const prefs = readPrefs(store, NOW);
    expect(prefs.groups).toEqual({});
    expect(prefs.collapsedGroups).toEqual({});
    expect(prefs.theme).toBe('light');
  });

  it('drops one bad group, and one bad member id, without dropping the good ones', () => {
    const store = fake(
      JSON.stringify({
        groups: {
          [SOURCE]: [
            { id: 'group:a', name: 'infra', projects: ['p1', 42, 'p2'] },
            { id: 'group:b' },
            'not a group',
            { name: 'no id', projects: [] },
          ],
          bad: 'not an array',
        },
      }),
    );
    const prefs = readPrefs(store, NOW);
    expect(prefs.groups[SOURCE]).toEqual([
      { id: 'group:a', name: 'infra', projects: ['p1', 'p2'] },
    ]);
    expect(prefs.groups.bad).toBeUndefined();
  });

  it('is exempt from the icon TTL: a grouping is a decision, not a session that stopped', () => {
    const store = fake();
    writePrefs(store, createGroup(EMPTY_PREFS, SOURCE, 'group:a', 'infra'));
    const muchLater = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(readPrefs(store, muchLater).groups[SOURCE]).toHaveLength(1);
  });

  it('round-trips under the literal keys `groups` and `collapsedGroups`', () => {
    const store = fake();
    const saved = setGroupCollapsed(
      addProjectToGroup(
        createGroup(EMPTY_PREFS, SOURCE, 'group:a', 'infra'),
        SOURCE,
        'group:a',
        'p1',
      ),
      SOURCE,
      'group:a',
      true,
    );
    writePrefs(store, saved);
    const stored = JSON.parse(store.value ?? '{}') as Record<string, unknown>;
    expect(stored.groups).toEqual({
      [SOURCE]: [{ id: 'group:a', name: 'infra', projects: ['p1'] }],
    });
    expect(stored.collapsedGroups).toEqual({ [SOURCE]: ['group:a'] });
    expect(readPrefs(store, NOW).groups).toEqual(saved.groups);
    expect(isGroupCollapsed(readPrefs(store, NOW), SOURCE, 'group:a')).toBe(true);
  });
});

describe('writing the group buckets', () => {
  const withOne = createGroup(EMPTY_PREFS, SOURCE, 'group:a', 'infra');

  it('creates an empty group, which is a state a group is allowed to be in', () => {
    expect(withOne.groups[SOURCE]).toEqual([{ id: 'group:a', name: 'infra', projects: [] }]);
  });

  it('keeps one source out of another: a second source is its own bucket', () => {
    const both = createGroup(withOne, 'black-smith', 'group:b', 'factory');
    expect(both.groups[SOURCE]).toHaveLength(1);
    expect(both.groups['black-smith']).toEqual([{ id: 'group:b', name: 'factory', projects: [] }]);
  });

  it('renames and re-icons in place, leaving membership alone', () => {
    const named = setGroupIcon(
      renameGroup(
        addProjectToGroup(withOne, SOURCE, 'group:a', 'p1'),
        SOURCE,
        'group:a',
        'platform',
      ),
      SOURCE,
      'group:a',
      '🏗',
    );
    expect(named.groups[SOURCE]?.[0]).toEqual({
      id: 'group:a',
      name: 'platform',
      icon: '🏗',
      projects: ['p1'],
    });
  });

  it('adds a member once, however many times you add it', () => {
    const twice = addProjectToGroup(
      addProjectToGroup(withOne, SOURCE, 'group:a', 'p1'),
      SOURCE,
      'group:a',
      'p1',
    );
    expect(twice.groups[SOURCE]?.[0]?.projects).toEqual(['p1']);
  });

  it('MOVES a project that is already in another group, rather than duplicating it', () => {
    const two = createGroup(
      addProjectToGroup(withOne, SOURCE, 'group:a', 'p1'),
      SOURCE,
      'group:b',
      'apps',
    );
    const moved = addProjectToGroup(two, SOURCE, 'group:b', 'p1');
    expect(moved.groups[SOURCE]?.[0]?.projects).toEqual([]);
    expect(moved.groups[SOURCE]?.[1]?.projects).toEqual(['p1']);
  });

  it('removes a member without touching the group or its siblings', () => {
    const filled = addProjectToGroup(
      addProjectToGroup(withOne, SOURCE, 'group:a', 'p1'),
      SOURCE,
      'group:a',
      'p2',
    );
    expect(removeProjectFromGroup(filled, SOURCE, 'group:a', 'p1').groups[SOURCE]?.[0]).toEqual({
      id: 'group:a',
      name: 'infra',
      projects: ['p2'],
    });
  });

  it('deletes a group, its fold with it, and leaves no residue when it was the last', () => {
    const folded = setGroupCollapsed(withOne, SOURCE, 'group:a', true);
    const gone = deleteGroup(folded, SOURCE, 'group:a');
    // The bucket goes, not just the entry: the stored shape then matches a
    // fresh install exactly, which is what makes "ungroup everything" leave
    // nothing behind to read back.
    expect(gone.groups[SOURCE]).toBeUndefined();
    expect(gone.collapsedGroups[SOURCE]).toBeUndefined();
  });

  it('ignores a write aimed at a group that is not there', () => {
    expect(renameGroup(withOne, SOURCE, 'group:nope', 'x').groups).toEqual(withOne.groups);
    expect(addProjectToGroup(withOne, 'other-source', 'group:a', 'p1').groups).toEqual(
      withOne.groups,
    );
  });

  it('never touches the three project buckets it sits beside', () => {
    const before = setTheme(EMPTY_PREFS, 'light');
    const after = deleteGroup(
      addProjectToGroup(createGroup(before, SOURCE, 'group:a', 'infra'), SOURCE, 'group:a', 'p1'),
      SOURCE,
      'group:a',
    );
    expect(after.projectIcons).toEqual(before.projectIcons);
    expect(after.collapsedProjects).toEqual(before.collapsedProjects);
    expect(after.hiddenProjects).toEqual(before.hiddenProjects);
    expect(after.theme).toBe('light');
  });
});
