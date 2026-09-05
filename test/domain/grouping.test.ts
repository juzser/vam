import { describe, expect, it } from 'vitest';
import { orderedSessions } from '../../src/renderer/canvas/layout.js';
import { composeGroups, groupSource } from '../../src/renderer/domain/grouping.js';
import type { CanvasModel, Project, Session } from '../../src/renderer/domain/model.js';
import { allSessions } from '../../src/renderer/domain/selectors.js';
import type { StoredGroup } from '../../src/renderer/prefs/prefs.js';

function session(id: string, status: Session['status'] = 'running'): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

function project(id: string, sessions: readonly Session[], source = 'claude-code'): Project {
  return { id, name: id, source, sessions };
}

const MODEL: CanvasModel = {
  projects: [
    project('p-alpha', [session('a1', 'done')]),
    project('p-beta', [session('b1', 'waiting')]),
    project('p-gamma', [session('g1', 'running')]),
  ],
};

function stored(...groups: StoredGroup[]): Record<string, readonly StoredGroup[]> {
  return { 'claude-code': groups };
}

describe('composeGroups', () => {
  /**
   * THE PROPERTY THAT MAKES THE GROUP LAYER SAFE TO SHIP. Every store in
   * existence has no groups, so this is the path every operator is on until
   * they make one, and it has to be the same object -- not merely an equal
   * one, so the memo below it does not recompute and the canvas does not
   * relayout for a feature nobody used.
   */
  it('returns the very same model when nothing is stored', () => {
    expect(composeGroups(MODEL, {})).toBe(MODEL);
    expect(composeGroups(MODEL, { 'claude-code': [] })).toBe(MODEL);
  });

  it('leaves the ordered session list unchanged when nothing is stored', () => {
    const before = orderedSessions(MODEL).map((entry) => entry.session.id);
    const after = orderedSessions(composeGroups(MODEL, {})).map((entry) => entry.session.id);
    expect(after).toEqual(before);
    expect(after).toEqual(['b1', 'g1', 'a1']);
  });

  it('resolves members in the stored order and leaves the rest at the top level', () => {
    const composed = composeGroups(
      MODEL,
      stored({ id: 'group:1', name: 'work', projects: ['p-gamma', 'p-alpha'] }),
    );
    expect(composed.groups?.map((group) => group.id)).toEqual(['group:1']);
    expect(composed.groups?.[0]?.projects.map((p) => p.id)).toEqual(['p-gamma', 'p-alpha']);
    expect(composed.projects.map((p) => p.id)).toEqual(['p-beta']);
  });

  it('keeps a member id that matches no live project, and skips it', () => {
    const record: StoredGroup = { id: 'group:1', name: 'work', projects: ['p-gone', 'p-alpha'] };
    const composed = composeGroups(MODEL, stored(record));
    expect(composed.groups?.[0]?.projects.map((p) => p.id)).toEqual(['p-alpha']);
    // The store is the operator's decision; composing may not edit it.
    expect(record.projects).toEqual(['p-gone', 'p-alpha']);
  });

  it('matches a member only inside its own source', () => {
    const model: CanvasModel = { projects: [project('shared', [session('s1')], 'tmux')] };
    const composed = composeGroups(
      model,
      stored({ id: 'group:1', name: 'work', projects: ['shared'] }),
    );
    expect(composed.groups?.[0]?.projects).toEqual([]);
    expect(composed.projects.map((p) => p.id)).toEqual(['shared']);
  });

  it('carries the icon through and defaults a missing one to null', () => {
    const composed = composeGroups(
      MODEL,
      stored(
        { id: 'group:1', name: 'iconed', icon: '🌿', projects: [] },
        { id: 'group:2', name: 'plain', projects: [] },
      ),
    );
    expect(composed.groups?.[0]?.icon).toBe('🌿');
    expect(composed.groups?.[1]?.icon).toBe(null);
  });

  it('names the source a group is stored under, and null for an unknown id', () => {
    const groups = stored({ id: 'group:1', name: 'work', projects: [] });
    expect(groupSource(groups, 'group:1')).toBe('claude-code');
    expect(groupSource(groups, 'group:2')).toBe(null);
  });
});

describe('grouped ordering', () => {
  const composed = composeGroups(
    MODEL,
    stored({ id: 'group:1', name: 'work', projects: ['p-alpha', 'p-gamma'] }),
  );

  it('flattens grouped sessions into allSessions carrying their group', () => {
    const entries = allSessions(composed);
    expect(entries.map((e) => e.session.id).sort()).toEqual(['a1', 'b1', 'g1']);
    expect(entries.find((e) => e.session.id === 'b1')?.group).toBe(null);
    expect(entries.find((e) => e.session.id === 'a1')?.group?.id).toBe('group:1');
  });

  it('ranks a group by its most urgent member and keeps its members together', () => {
    // p-beta is `waiting` and ungrouped, so it leads; the group ranks on
    // p-gamma's `running`, which puts both its members after p-beta even
    // though p-alpha alone is `done`.
    expect(orderedSessions(composed).map((e) => e.session.id)).toEqual(['b1', 'g1', 'a1']);
  });

  it('puts a group holding the most urgent session first', () => {
    const urgent = composeGroups(
      MODEL,
      stored({ id: 'group:1', name: 'work', projects: ['p-beta'] }),
    );
    expect(orderedSessions(urgent).map((e) => e.session.id)).toEqual(['b1', 'g1', 'a1']);
    expect(orderedSessions(urgent)[0]?.group?.id).toBe('group:1');
  });
});
