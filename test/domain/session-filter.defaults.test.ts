/**
 * What the default narrowing actually removes from the list, over sessions
 * built the way the app builds them.
 *
 * The sessions here come out of `toCanvasModel` off a real timeline shape
 * rather than out of a literal: the fact under test is that a `session-start`
 * written by a factory role is what "an agent or test session" MEANS here, and
 * a hand-made `origin` would assert that fact into existence instead of
 * reading it. `SessionAgent` (a session's subagent roster) is a different
 * thing entirely and never becomes a row -- see `model.ts`.
 */

import { describe, expect, it } from 'vitest';
import type {
  ApiOverview,
  ApiRunningSession,
  ApiTimelineEntry,
} from '../../src/renderer/adapter/api.js';
import { toCanvasModel } from '../../src/renderer/adapter/to-canvas.js';
import type { Session } from '../../src/renderer/domain/model.js';
import {
  DEFAULT_SESSION_FILTERS,
  isHiddenByOriginFilters,
} from '../../src/renderer/domain/session-filter.js';

function api(sessionId: string): ApiRunningSession {
  return {
    sessionId,
    startedAt: '2026-09-03T00:00:00.000Z',
    lastEventAt: '2026-09-03T01:00:00.000Z',
    eventCount: 1,
    liveAgentCount: 0,
    lastEventType: 'session-start',
    projects: ['p'],
  };
}

function start(actor: string | null): ApiTimelineEntry {
  return {
    eventId: 'e0',
    ts: '2026-09-03T00:00:00.000Z',
    eventType: 'session-start',
    taskId: null,
    planVersion: 1,
    causalParent: null,
    payload: {},
    project: null,
    actor,
  };
}

/** Sessions as the black-smith adapter builds them, one per `session-start`. */
function sessions(actors: readonly (string | null)[]): readonly Session[] {
  const overview = {
    runningSessions: actors.map((_, i) => api(`s${i}`)),
  } as unknown as ApiOverview;
  const timelines = new Map<string, readonly ApiTimelineEntry[]>(
    actors.map((actor, i) => [`s${i}`, [start(actor)]]),
  );
  return toCanvasModel(overview, timelines, 'black-smith').projects.flatMap((p) => p.sessions);
}

describe('the hide-agent default, over real sessions', () => {
  it('hides an agent-opened and a test session, and nothing else', () => {
    // `coder` and `tester` are factory roles; `operator`, `operator-skill` and
    // an actor vam has never seen are not, and all three stay on screen.
    const list = sessions(['coder', 'tester', 'operator', 'operator-skill', 'somebody-new', null]);
    const hidden = list.filter((s) => isHiddenByOriginFilters(s, DEFAULT_SESSION_FILTERS));
    expect(hidden.map((s) => s.id)).toEqual(['s0', 's1']);
  });

  it('reveals them the moment the default is turned off', () => {
    const list = sessions(['coder', 'tester', 'operator']);
    const off = { ...DEFAULT_SESSION_FILTERS, hideAgentStarted: false };
    expect(list.filter((s) => isHiddenByOriginFilters(s, off))).toEqual([]);
  });

  it('keeps the other rule off by default, so no prompt-less session is lost', () => {
    // A session with no `user_prompt` is real work driven through a skill.
    // Only the operator's own choice may remove it.
    const list = sessions(['operator']);
    expect(list[0]?.origin?.promptCount).toBe(0);
    expect(isHiddenByOriginFilters(list[0] as Session, DEFAULT_SESSION_FILTERS)).toBe(false);
    expect(
      isHiddenByOriginFilters(list[0] as Session, {
        ...DEFAULT_SESSION_FILTERS,
        onlyPrompted: true,
      }),
    ).toBe(true);
  });
});
