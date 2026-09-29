import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import {
  isOutsideVamScope,
  type OwnershipScope,
} from '../../src/renderer/domain/session-ownership.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';

const entry = (over: Partial<Session> = {}, projectId = 'p1'): SessionEntry => ({
  project: { id: projectId, name: 'a', source: 'claude-code', sessions: [] },
  session: {
    id: 's1',
    title: 's1',
    epic: null,
    branch: null,
    status: 'waiting',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    source: 'claude-code',
    ...over,
  },
});
const scope = (over: Partial<OwnershipScope> = {}): OwnershipScope => ({
  prefs: EMPTY_PREFS,
  hiddenProjectIds: [],
  vamListingGap: null,
  demo: false,
  ...over,
});
const dismissed = (activity: string | null): Prefs => ({
  ...EMPTY_PREFS,
  dismissedSessions: { 'claude-code': { s1: { at: 'now', activity } } },
});
const foreign = entry({ vamControlled: false });
describe('isOutsideVamScope', () => {
  it('drops a session in a hidden or removed project', () => {
    expect(isOutsideVamScope(entry({}, 'p1'), scope({ hiddenProjectIds: ['p1'] }))).toBe(true);
  });
  it('drops a dismissed session, even in a listing gap or the demo', () => {
    const prefs = dismissed(null);
    expect(isOutsideVamScope(entry(), scope({ prefs }))).toBe(true);
    expect(isOutsideVamScope(entry(), scope({ prefs, vamListingGap: 'x' }))).toBe(true);
  });
  it('drops a foreign session only while hideForeign is on and nothing stands it down', () => {
    expect(isOutsideVamScope(foreign, scope())).toBe(true);
    const off = { ...EMPTY_PREFS, filters: { ...EMPTY_PREFS.filters, hideForeign: false } };
    expect(isOutsideVamScope(foreign, scope({ prefs: off }))).toBe(false);
    expect(isOutsideVamScope(foreign, scope({ vamListingGap: 'x' }))).toBe(false);
    expect(isOutsideVamScope(foreign, scope({ demo: true }))).toBe(false);
  });
  it('reads no status and no view narrowing', () => {
    const filters = { ...EMPTY_PREFS.filters, hideIdle: true, hideAgentWorktrees: true };
    const prefs = { ...EMPTY_PREFS, filters };
    for (const status of ['running', 'idle', 'done'] as const) {
      const e = entry({ status, ended: true, isAgentWorktree: true });
      expect(isOutsideVamScope(e, scope({ prefs }))).toBe(false);
    }
  });
});
