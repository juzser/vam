/**
 * THE FOURTH FILTER ROW: sessions vam did not start, hidden by default.
 *
 * `docs/design/vam-owns-the-session.md`, the operator's own ask distilled:
 * "it should only show the sessions that vam creates." Once `vamControlled`
 * is a REAL fact on every source (Stage 1's own line -- Claude Code already
 * had it, Codex now does too), a session vam did not start is not a row that
 * failed a test; it is not what the default list is for. It is not DELETED
 * from vam's knowledge, the same rule `isHiddenByEndedFilter` already lives
 * by -- it moves behind this toggle, one click away, same as an ended one.
 *
 * ── WHY THIS IS A SEPARATE RULE FROM `isHiddenByEndedFilter`, NOT A FOLD
 * INTO IT ──────────────────────────────────────────────────────────────────
 *
 * `isHiddenByEndedFilter`'s own test file already names the trap: "a filter
 * that meant one thing for Codex and another for Claude Code would be one
 * boolean standing for two claims, which is the mistake `vamControlled`
 * already made in this tree." Folding "not vam's" into "has ended" would be
 * the SAME mistake wearing the ended toggle's clothes -- a live Codex thread
 * the operator started by hand in their own terminal has not ended (no source
 * measured that), but it is not vam's either, and only THIS rule can say so.
 *
 * ── WHY `false` AND NOT ABSENCE ───────────────────────────────────────────
 *
 * `vamControlled`'s own header: `false` is vam having ASKED and found no
 * pairing; absent is vam not being able to ask AT ALL -- no tmux, no server,
 * a source with no such surface, a fixture. A filter that read absence as
 * "not vam's" would hide every row on a machine with no tmux server, which is
 * the exact trap the design doc's own "Traps" section names first.
 */

import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/renderer/domain/model.js';
import {
  DEFAULT_SESSION_FILTERS,
  isForeign,
  isHiddenByForeignFilter,
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
  it('hides foreign sessions, and leaves the other three rules where they were', () => {
    expect(DEFAULT_SESSION_FILTERS.hideForeign).toBe(true);
    expect(DEFAULT_SESSION_FILTERS.hideEnded).toBe(true);
    expect(DEFAULT_SESSION_FILTERS.hideAgentStarted).toBe(true);
    expect(DEFAULT_SESSION_FILTERS.onlyPrompted).toBe(false);
  });
});

describe('isForeign', () => {
  it('is what the source measured, and reads a session that said so', () => {
    expect(isForeign(session({ vamControlled: false }))).toBe(true);
  });

  it('is not foreign when vam proved the pairing', () => {
    expect(isForeign(session({ vamControlled: true }))).toBe(false);
  });

  /** ABSENT IS NOT FALSE -- the trap this whole rule exists to avoid. */
  it('treats a source that never asked as not foreign, never the reverse', () => {
    expect(isForeign(session({}))).toBe(false);
  });
});

describe('isHiddenByForeignFilter', () => {
  it('hides a foreign session while the rule is in force', () => {
    expect(isHiddenByForeignFilter(session({ vamControlled: false }), filters())).toBe(true);
  });

  it('never hides a session vam proved it owns', () => {
    expect(isHiddenByForeignFilter(session({ vamControlled: true }), filters())).toBe(false);
  });

  it('never hides a session whose ownership vam could not ask about at all', () => {
    expect(isHiddenByForeignFilter(session({}), filters())).toBe(false);
  });

  it('shows a foreign session the moment the operator turns the rule off', () => {
    expect(
      isHiddenByForeignFilter(session({ vamControlled: false }), filters({ hideForeign: false })),
    ).toBe(false);
  });

  /**
   * Uniform across sources, deliberately -- the same discipline
   * `isHiddenByEndedFilter` already holds itself to, and for the same reason:
   * a rule that meant one thing for Codex and another for Claude Code would
   * be a single boolean standing for two claims.
   */
  it('does not care which source the row came from', () => {
    for (const source of ['codex', 'claude-code', 'something-new']) {
      expect(isHiddenByForeignFilter(session({ vamControlled: false, source }), filters())).toBe(
        true,
      );
    }
  });

  /**
   * A LIVE, FOREIGN SESSION IS THE CASE `isHiddenByEndedFilter` CANNOT CATCH.
   * The operator's own Codex, running in their own terminal, has not ended --
   * no source measured that -- but it is not vam's, and only this rule hides
   * it.
   */
  it('hides a foreign session whatever its status, unlike the ended rule', () => {
    for (const status of ['running', 'waiting', 'idle', 'done', 'failed'] as const) {
      expect(isHiddenByForeignFilter(session({ status, vamControlled: false }), filters())).toBe(
        true,
      );
    }
  });
});
