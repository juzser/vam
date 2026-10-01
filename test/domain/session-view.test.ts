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
const entry = (id: string, over: Partial<Session> = {}): SessionEntry => ({
  project,
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

const ctx = (over: Partial<SessionViewContext> = {}): SessionViewContext => ({
  ownershipScope: { prefs: EMPTY_PREFS, hiddenProjectIds: [], vamListingGap: null, demo: false },
  query: '',
  matches: [],
  statusFilter: 'all',
  prefs: EMPTY_PREFS,
  vamListingGap: null,
  foreignFilterApplies: true,
  ...over,
});

const ids = (es: SessionEntry[]) => es.map((e) => e.session.id);

const entries = [
  entry('run', { status: 'running' }),
  entry('wait', { status: 'waiting' }),
  entry('done'),
  entry('ended', { ended: true }),
  entry('foreign', { vamControlled: false, status: 'running' }),
];

describe('EC-46b -- visibleSessions', () => {
  it('lists everything the default filters leave, and drops ended and foreign', () => {
    expect(ids(visibleSessions(entries, ctx()))).toEqual(['run', 'wait', 'done']);
  });

  it('narrows by status', () => {
    expect(ids(visibleSessions(entries, ctx({ statusFilter: 'running' })))).toEqual(['run']);
  });

  it('narrows by text only when the query is not blank', () => {
    expect(ids(visibleSessions(entries, ctx({ query: 'x', matches: ['wait'] })))).toEqual(['wait']);
    expect(ids(visibleSessions(entries, ctx({ query: '  ', matches: ['wait'] })))).toHaveLength(3);
  });

  it('stands the ended and foreign rules down under a listing gap', () => {
    expect(
      visibleSessions(
        entries,
        ctx({
          vamListingGap: 'tmux unreadable',
          ownershipScope: {
            prefs: EMPTY_PREFS,
            hiddenProjectIds: [],
            vamListingGap: 'x',
            demo: false,
          },
        }),
      ),
    ).toHaveLength(5);
  });

  it('keeps foreign sessions when the foreign rule does not apply (demo)', () => {
    expect(
      ids(
        visibleSessions(
          entries,
          ctx({
            foreignFilterApplies: false,
            ownershipScope: {
              prefs: EMPTY_PREFS,
              hiddenProjectIds: [],
              vamListingGap: null,
              demo: true,
            },
          }),
        ),
      ),
    ).toContain('foreign');
  });
});

describe('EC-46b -- statusTally', () => {
  it('each key equals the length of visibleSessions with that status selected', () => {
    const c = ctx({
      prefs: { ...EMPTY_PREFS, filters: { ...DEFAULT_SESSION_FILTERS, hideIdle: true } },
    });
    const t = statusTally(entries, c);
    for (const key of Object.keys(t) as (keyof typeof t)[]) {
      expect(t[key]).toBe(visibleSessions(entries, { ...c, statusFilter: key }).length);
    }
    // The done pill stands hideEnded down, so it also lists the ended one.
    expect(t).toMatchObject({ all: 3, running: 1, waiting: 1, done: 2, failed: 0 });
  });

  it('ignores the statusFilter it is handed', () => {
    expect(statusTally(entries, ctx({ statusFilter: 'failed' }))).toEqual(
      statusTally(entries, ctx()),
    );
  });
});
