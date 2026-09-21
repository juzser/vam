/**
 * THE THIRD FILTER ROW: ended sessions, hidden by default.
 *
 * ── WHAT THE OPERATOR ASKED FOR, AND IN WHICH ORDER ───────────────────────
 *
 * First: "Don't show recent threads -- it makes managing active sessions
 * harder. Better to have a history section to view and resume old sessions."
 * Then, softening it: "The session display needs re-checking -- or the filter
 * should get a toggle to show/hide those recent sessions."
 *
 * So: gone by default, one click away, and their own count where the operator
 * can see it. A toggle that silently swallowed rows would be how somebody
 * loses a session, which is the thing the sidebar exists to prevent.
 *
 * ── WHY THIS IS A FILTER AND NOT A SEPARATE SURFACE ───────────────────────
 *
 * `docs/design/reopening-a-session.md` (#409) proposed the command palette
 * instead, and called it "the cheaper answer and probably the right one". It
 * was right for the source it was written against and it is not right here;
 * `session-filter.ts`'s own header records the reasoning, and the deciding
 * fact is mechanical: `Canvas.tsx` feeds the palette the array this module has
 * ALREADY narrowed, so a palette group for ended sessions would be empty in
 * exactly the state it exists to serve.
 *
 * ── THE ONE INTERACTION THAT HAD TO BE DECIDED ────────────────────────────
 *
 * The popover also has a status pill row, and one of the pills is "Done".
 * A standing default that hides done rows would make that pill select nothing
 * -- two controls in one popover, fighting. The rule below is that an explicit
 * status choice wins, because naming a status is a narrower and more
 * deliberate act than never having touched a default.
 */

import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/renderer/domain/model.js';
import {
  DEFAULT_SESSION_FILTERS,
  isEnded,
  isHiddenByEndedFilter,
  type SessionFilters,
} from '../../src/renderer/domain/session-filter.js';

const session = (over: Partial<Session> = {}): Session => ({
  id: 'an-invented-id',
  title: 'an invented session',
  icon: null,
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
  /**
   * The operator's stated concern is what they get without doing anything.
   * The other two toggles' defaults are unchanged, and this asserts that too:
   * a default flipped by accident is how a filter loses somebody's work.
   */
  it('hides ended sessions, and leaves the other two rules where they were', () => {
    expect(DEFAULT_SESSION_FILTERS.hideEnded).toBe(true);
    expect(DEFAULT_SESSION_FILTERS.hideAgentStarted).toBe(true);
    expect(DEFAULT_SESSION_FILTERS.onlyPrompted).toBe(false);
  });
});

describe('isEnded', () => {
  it('is what the source measured, and reads a session that said so', () => {
    expect(isEnded(session({ ended: true }))).toBe(true);
  });

  /**
   * THE MEASUREMENT THAT SHAPED THIS RULE. Keying on `status === 'done'` was
   * tried first and broke 461 assertions across 62 files, because Claude Code
   * reports `done` for a background agent that finished INSIDE a session the
   * operator is still working in. Those rows belong on the canvas. The rule
   * has to be the source's own verdict on the conversation, not the colour.
   */
  it('does not fire on a `done` row whose source never claimed it ended', () => {
    expect(isEnded(session({ status: 'done' }))).toBe(false);
  });

  it('treats a source that never looked as not ended, never the reverse', () => {
    expect(isEnded(session({}))).toBe(false);
    expect(isEnded(session({ ended: false }))).toBe(false);
  });

  it('never fires on a session that is alive, whatever else it carries', () => {
    for (const status of ['running', 'waiting', 'idle', 'failed'] as const) {
      expect(isEnded(session({ status }))).toBe(false);
    }
  });
});

describe('isHiddenByEndedFilter', () => {
  it('hides an ended session while the rule is in force', () => {
    expect(isHiddenByEndedFilter(session({ status: 'done', ended: true }), filters(), 'all')).toBe(
      true,
    );
  });

  it('never hides a session that has not ended', () => {
    for (const status of ['running', 'waiting', 'idle', 'failed'] as const) {
      expect(isHiddenByEndedFilter(session({ status }), filters(), 'all')).toBe(false);
    }
  });

  it('shows them the moment the operator turns the rule off', () => {
    expect(
      isHiddenByEndedFilter(
        session({ status: 'done', ended: true }),
        filters({ hideEnded: false }),
        'all',
      ),
    ).toBe(false);
  });

  /**
   * The popover's own "Done" pill. Asking for done sessions by name must
   * produce done sessions, not an empty list explained by a different control
   * three rows down.
   */
  it('stands aside when the operator has asked for a status by name', () => {
    expect(isHiddenByEndedFilter(session({ status: 'done', ended: true }), filters(), 'done')).toBe(
      false,
    );
  });

  /**
   * Uniform across sources, deliberately. `SessionFilters`' own header says
   * these rules are "a fact about how YOU want the list read" and are not
   * keyed by source; a filter that meant one thing for Codex and another for
   * Claude Code would be one boolean standing for two claims, which is the
   * mistake `vamControlled` already made in this tree.
   */
  it('does not care which source the row came from', () => {
    for (const source of ['codex', 'claude-code', 'something-new']) {
      expect(
        isHiddenByEndedFilter(session({ status: 'done', ended: true, source }), filters(), 'all'),
      ).toBe(true);
    }
  });
});
