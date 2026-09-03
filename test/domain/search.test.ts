import { describe, expect, it } from 'vitest';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { cycleMatch, searchMatches } from '../../src/renderer/domain/search.js';
import { allSessions } from '../../src/renderer/domain/selectors.js';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'black-smith',
      source: 'black-smith',
      sessions: [session('D-257', { epic: 'ui-server-sse' }), session('D-263', { epic: 'quorum' })],
    },
    { id: 'p2', name: 'vam', source: 'orca', sessions: [session('epic-1')] },
  ],
};

const ENTRIES = allSessions(MODEL);

describe('searchMatches', () => {
  it('matches on the session title', () => {
    expect(searchMatches(ENTRIES, '257')).toEqual(['D-257']);
  });

  it('matches on the project name, so /vam finds what is in vam', () => {
    expect(searchMatches(ENTRIES, 'vam')).toEqual(['epic-1']);
  });

  it('matches on the epic', () => {
    expect(searchMatches(ENTRIES, 'quorum')).toEqual(['D-263']);
  });

  it('ignores case', () => {
    expect(searchMatches(ENTRIES, 'd-2')).toEqual(['D-257', 'D-263']);
    expect(searchMatches(ENTRIES, 'BLACK')).toEqual(['D-257', 'D-263']);
  });

  it('keeps canvas order, so n walks the screen rather than a ranking', () => {
    expect(searchMatches(ENTRIES, '-')).toEqual(['D-257', 'D-263', 'epic-1']);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchMatches(ENTRIES, 'zzz')).toEqual([]);
  });

  it('returns nothing for an empty query rather than everything', () => {
    // `/` with nothing typed has selected nothing yet. Matching all of them
    // would make the first `n` jump somewhere for no reason.
    expect(searchMatches(ENTRIES, '')).toEqual([]);
    expect(searchMatches(ENTRIES, '   ')).toEqual([]);
  });
});

describe('cycleMatch', () => {
  const matches = ['a', 'b', 'c'];

  it('steps forward and wraps at the end', () => {
    expect(cycleMatch(matches, 'a', 1)).toBe('b');
    expect(cycleMatch(matches, 'c', 1)).toBe('a');
  });

  it('steps backward and wraps at the start', () => {
    expect(cycleMatch(matches, 'b', -1)).toBe('a');
    expect(cycleMatch(matches, 'a', -1)).toBe('c');
  });

  it('starts at the first match when the cursor is not among them', () => {
    expect(cycleMatch(matches, 'elsewhere', 1)).toBe('a');
  });

  it('starts at the first match when there is no cursor at all', () => {
    expect(cycleMatch(matches, null, 1)).toBe('a');
  });

  it('is null when nothing matched', () => {
    expect(cycleMatch([], 'a', 1)).toBeNull();
  });

  it('stays put when it is the only match', () => {
    expect(cycleMatch(['only'], 'only', 1)).toBe('only');
    expect(cycleMatch(['only'], 'only', -1)).toBe('only');
  });
});
