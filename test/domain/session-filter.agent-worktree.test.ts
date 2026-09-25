/**
 * THE SIXTH FILTER ROW: Claude Code agent worktree sessions, hidden by
 * default -- the operator's report: "I see a worktree-agent showing when I
 * press New session. There should be a filter for it, hidden by default."
 *
 * `Session.isAgentWorktree`'s own header (`model.ts`) and `agent-worktree.ts`
 * carry the detection rule; this file is the filter that acts on it, same
 * shape `isHiddenByForeignFilter` already established.
 *
 * ── WHY A WAITING AGENT-WORKTREE SESSION IS NEVER HIDDEN, UNLIKE `hideForeign`
 * ──────────────────────────────────────────────────────────────────────────
 *
 * `hideForeign` hides a foreign session at ANY status, on purpose -- it is
 * not vam's to act on regardless of what it is asking. An agent worktree
 * session is the opposite: it IS vam's own Claude Code session, from a
 * throwaway path -- and one that is `waiting` is asking the operator a real
 * question they might otherwise never see answered, because the whole point
 * of this toggle is to stop looking at the project it lives in. Hiding it
 * would lose work, not merely declutter a list, so this rule stands down for
 * `waiting` the way `isHiddenByEndedFilter` stands down for an explicit
 * status pill -- a narrower, more deliberate exception than the default.
 */

import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/renderer/domain/model.js';
import {
  countHiddenByAgentWorktreeFilter,
  DEFAULT_SESSION_FILTERS,
  isAgentWorktreeSession,
  isHiddenByAgentWorktreeFilter,
  type SessionFilters,
} from '../../src/renderer/domain/session-filter.js';

const session = (over: Partial<Session> = {}): Session => ({
  id: 'an-invented-id',
  title: 'an invented session',
  epic: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: null,
  branch: null,
  decisions: [],
  source: 'claude-code',
  ...over,
});

const filters = (over: Partial<SessionFilters> = {}): SessionFilters => ({
  ...DEFAULT_SESSION_FILTERS,
  ...over,
});

describe('the shipped default', () => {
  it('hides agent worktrees, without disturbing the other rules', () => {
    expect(DEFAULT_SESSION_FILTERS.hideAgentWorktrees).toBe(true);
    expect(DEFAULT_SESSION_FILTERS.hideForeign).toBe(true);
    expect(DEFAULT_SESSION_FILTERS.hideEnded).toBe(true);
  });
});

describe('isAgentWorktreeSession', () => {
  it('is what the source measured', () => {
    expect(isAgentWorktreeSession(session({ isAgentWorktree: true }))).toBe(true);
  });

  it('is false for an ordinary session', () => {
    expect(isAgentWorktreeSession(session({}))).toBe(false);
    expect(isAgentWorktreeSession(session({ isAgentWorktree: false }))).toBe(false);
  });
});

describe('isHiddenByAgentWorktreeFilter', () => {
  it('hides an agent worktree session while the rule is in force', () => {
    expect(
      isHiddenByAgentWorktreeFilter(session({ isAgentWorktree: true }), filters()),
    ).toBe(true);
  });

  it('never hides an ordinary session', () => {
    expect(isHiddenByAgentWorktreeFilter(session({}), filters())).toBe(false);
  });

  it('shows an agent worktree session the moment the operator turns the rule off', () => {
    expect(
      isHiddenByAgentWorktreeFilter(
        session({ isAgentWorktree: true }),
        filters({ hideAgentWorktrees: false }),
      ),
    ).toBe(false);
  });

  it('never hides one that is waiting on the operator -- it must stay reachable', () => {
    expect(
      isHiddenByAgentWorktreeFilter(
        session({ isAgentWorktree: true, status: 'waiting' }),
        filters(),
      ),
    ).toBe(false);
  });

  it('hides it at every OTHER status', () => {
    for (const status of ['running', 'idle', 'done', 'failed', 'unstarted', 'terminal'] as const) {
      expect(
        isHiddenByAgentWorktreeFilter(session({ isAgentWorktree: true, status }), filters()),
      ).toBe(true);
    }
  });
});

describe('countHiddenByAgentWorktreeFilter', () => {
  it('counts zero when nothing is an agent worktree', () => {
    expect(countHiddenByAgentWorktreeFilter([session({}), session({})], filters())).toBe(0);
  });

  it('counts every hidden one, but never a waiting one -- it was never actually hidden', () => {
    expect(
      countHiddenByAgentWorktreeFilter(
        [
          session({ isAgentWorktree: true }),
          session({ isAgentWorktree: true, status: 'waiting' }),
          session({ isAgentWorktree: false }),
        ],
        filters(),
      ),
    ).toBe(1);
  });

  it('counts zero once the rule itself is off', () => {
    expect(
      countHiddenByAgentWorktreeFilter(
        [session({ isAgentWorktree: true })],
        filters({ hideAgentWorktrees: false }),
      ),
    ).toBe(0);
  });
});
