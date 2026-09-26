/**
 * THE FIFTH FILTER ROW: sleeping (idle) sessions, off by default.
 *
 * Orca's own panel calls this "Hide sleeping" and ships it ON. vam's own rule
 * for a NEW toggle is the opposite -- `docs/design/workspace-options.md`
 * states it -- because a preference that changes a shipped default is a
 * preference an existing operator never chose. So this one starts OFF: an
 * upgrade shows exactly the rows it showed the day before, and the toggle is
 * one click away for whoever wants it.
 *
 * `idle` is a session that is alive, attached and simply between turns
 * (`model.ts`'s own `SessionStatus` header) -- the "sleeping" word orca uses
 * for the same state. It is not `unstarted` (a pane nothing has been started
 * in) or `terminal` (an agent that exited but whose conversation survives):
 * both share `idle`'s neutral colour and its quiet, but neither is a session
 * an agent is sitting between turns of, which is the one thing "sleeping"
 * names.
 */

import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/renderer/domain/model.js';
import {
  DEFAULT_SESSION_FILTERS,
  isHiddenByIdleFilter,
  isIdle,
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
  source: 'an-invented-source',
  ...over,
});

const filters = (over: Partial<SessionFilters> = {}): SessionFilters => ({
  ...DEFAULT_SESSION_FILTERS,
  ...over,
});

describe('the shipped default', () => {
  it('leaves sleeping sessions on screen -- an upgrade changes nothing', () => {
    expect(DEFAULT_SESSION_FILTERS.hideIdle).toBe(false);
  });
});

describe('isIdle', () => {
  it('is true of exactly the idle status, not its two quiet neighbours', () => {
    expect(isIdle(session({ status: 'idle' }))).toBe(true);
    expect(isIdle(session({ status: 'unstarted' }))).toBe(false);
    expect(isIdle(session({ status: 'terminal' }))).toBe(false);
  });

  it('never fires on a session that is asking for something or working', () => {
    for (const status of ['running', 'waiting', 'done', 'failed'] as const) {
      expect(isIdle(session({ status }))).toBe(false);
    }
  });
});

describe('isHiddenByIdleFilter', () => {
  it('hides an idle session once the operator turns the rule on', () => {
    expect(
      isHiddenByIdleFilter(session({ status: 'idle' }), filters({ hideIdle: true }), 'all'),
    ).toBe(true);
  });

  it('leaves it be at the shipped default', () => {
    expect(isHiddenByIdleFilter(session({ status: 'idle' }), filters(), 'all')).toBe(false);
  });

  it('never hides a session that is not idle', () => {
    for (const status of [
      'running',
      'waiting',
      'done',
      'failed',
      'unstarted',
      'terminal',
    ] as const) {
      expect(isHiddenByIdleFilter(session({ status }), filters({ hideIdle: true }), 'all')).toBe(
        false,
      );
    }
  });

  /** The status pill row has no "Sleeping" pill of its own today, but the
   *  rule stands aside for any explicit status choice anyway, the same shape
   *  `isHiddenByEndedFilter` already takes -- a narrower ask always wins over
   *  a standing default. */
  it('stands aside once a status has been named explicitly', () => {
    expect(
      isHiddenByIdleFilter(session({ status: 'idle' }), filters({ hideIdle: true }), 'running'),
    ).toBe(false);
  });
});
