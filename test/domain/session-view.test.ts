/**
 * `visibleSessions` / `statusTally`: the one pipeline behind the sidebar list
 * and its status pill counts (EC-46b). Pure, so no DOM.
 */

import { describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DEFAULT_SESSION_FILTERS } from '../../src/renderer/domain/session-filter.js';
import {
  type SessionViewContext,
  statusTally,
  visibleSessions,
} from '../../src/renderer/domain/session-view.js';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';

const project: Project = { id: 'p', name: 'p', source: 'claude-code', sessions: [] };
const hiddenProject: Project = { id: 'hid', name: 'hid', source: 'claude-code', sessions: [] };
const entry = (id: string, over: Partial<Session> = {}, proj: Project = project): SessionEntry => ({
  project: proj,
  session: {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  },
});

// The operator's own prefs: a dismissal and hide-idle. The ownership scope is
// handed prefs WITHOUT the dismissal, so the dismissed-step in `visibleSessions`
// is the only thing that can drop that session.
const prefs = {
  ...EMPTY_PREFS,
  filters: { ...DEFAULT_SESSION_FILTERS, hideIdle: true },
  dismissedSessions: { 'claude-code': { dism: { at: '2026-01-01T00:00:00Z', activity: null } } },
};

const scope = (over: Partial<SessionViewContext['ownershipScope']> = {}) => ({
  prefs: EMPTY_PREFS,
  hiddenProjectIds: ['hid'],
  vamListingGap: null,
  demo: false,
  ...over,
});

const ctx = (over: Partial<SessionViewContext> = {}): SessionViewContext => ({
  ownershipScope: scope(),
  query: '',
  matches: [],
  statusFilter: 'all',
  prefs,
  vamListingGap: null,
  foreignFilterApplies: true,
  ...over,
});

const ids = (es: SessionEntry[]) => es.map((e) => e.session.id);

// One session of each kind. The last five are running, so a status filter of
// 'running' shows which step (not the status) is what hides each of them.
const entries = [
  entry('run', { status: 'running' }),
  entry('wait', { status: 'waiting' }),
  entry('done'),
  entry('unstarted', { status: 'unstarted' }),
  entry('terminal', { status: 'terminal' }),
  entry('failed', { status: 'failed' }),
  entry('ended', { ended: true }),
  entry('idle', { status: 'idle' }),
  entry('agentwt', { status: 'running', isAgentWorktree: true }),
  entry('foreign', { status: 'running', vamControlled: false }),
  entry('oos', { status: 'running' }, hiddenProject),
  entry('dism', { status: 'running' }),
  entry('origin', { status: 'running', origin: { startedBy: 'agent', promptCount: 1 } }),
];

const ORDINARY = ['run', 'wait', 'done', 'unstarted', 'terminal', 'failed'];

describe('EC-46b -- visibleSessions', () => {
  it.each([
    ['all', ORDINARY],
    ['running', ['run']],
    ['waiting', ['wait']],
    ['idle', ['idle']],
    ['unstarted', ['unstarted']],
    ['terminal', ['terminal']],
    // A status filter stands hide-ended down, so the ended one is listed too.
    ['done', ['done', 'ended']],
    ['failed', ['failed']],
  ] as const)('status %s lists exactly these ids', (statusFilter, expected) => {
    expect(ids(visibleSessions(entries, ctx({ statusFilter })))).toEqual(expected);
  });

  it('narrows by a text query', () => {
    const matches = ['wait', 'ended', 'idle', 'agentwt', 'foreign', 'oos', 'dism', 'origin'];
    expect(ids(visibleSessions(entries, ctx({ query: 'x', matches })))).toEqual(['wait']);
  });

  it('treats a whitespace-only query as no query', () => {
    expect(ids(visibleSessions(entries, ctx({ query: '  ', matches: ['wait'] })))).toEqual(
      ORDINARY,
    );
  });

  it('stands the ended, idle, agent-worktree and foreign rules down under a listing gap', () => {
    const gap = 'tmux unreadable';
    const c = ctx({ vamListingGap: gap, ownershipScope: scope({ vamListingGap: gap }) });
    expect(ids(visibleSessions(entries, c))).toEqual([
      ...ORDINARY,
      'ended',
      'idle',
      'agentwt',
      'foreign',
    ]);
  });

  it('keeps the foreign session when the foreign rule does not apply (demo)', () => {
    const c = ctx({ foreignFilterApplies: false, ownershipScope: scope({ demo: true }) });
    expect(ids(visibleSessions(entries, c))).toEqual([...ORDINARY, 'foreign']);
  });
});

describe('EC-46b -- statusTally', () => {
  it('yields all eight keys, each the length of visibleSessions with that key selected', () => {
    const t = statusTally(entries, ctx());
    expect(Object.keys(t).sort()).toEqual(
      ['all', 'done', 'failed', 'idle', 'running', 'terminal', 'unstarted', 'waiting'].sort(),
    );
    for (const key of Object.keys(t) as (keyof typeof t)[]) {
      expect(t[key]).toBe(visibleSessions(entries, ctx({ statusFilter: key })).length);
    }
    expect(t).toEqual({
      all: 6,
      running: 1,
      waiting: 1,
      idle: 1,
      unstarted: 1,
      terminal: 1,
      done: 2,
      failed: 1,
    });
  });

  it('is the same object whatever statusFilter it is given', () => {
    const base = statusTally(entries, ctx());
    for (const statusFilter of Object.keys(base) as (keyof typeof base)[]) {
      expect(statusTally(entries, ctx({ statusFilter }))).toEqual(base);
    }
  });
});
