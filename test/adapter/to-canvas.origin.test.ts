/**
 * Deriving "who started this" and "did you ever speak here" from the timeline
 * black-smith already hands over.
 *
 * No new request and no cache: `useCanvas` fetches every session's timeline on
 * every load already, so both facts are read off data that is in hand.
 */

import { describe, expect, it } from 'vitest';
import type {
  ApiOverview,
  ApiRunningSession,
  ApiTimelineEntry,
} from '../../src/renderer/adapter/api.js';
import { toCanvasModel } from '../../src/renderer/adapter/to-canvas.js';

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

function event(eventType: string, actor: string | null, i = 0): ApiTimelineEntry {
  return {
    eventId: `e${i}`,
    ts: `2026-09-03T00:0${i}:00.000Z`,
    eventType,
    taskId: null,
    agentId: null,
    planVersion: 1,
    causalParent: null,
    payload: {},
    project: null,
    actor,
  };
}

function originOf(sessionId: string, timeline?: readonly ApiTimelineEntry[]) {
  const overview = { runningSessions: [api(sessionId)] } as unknown as ApiOverview;
  const map = new Map<string, readonly ApiTimelineEntry[]>();
  if (timeline !== undefined) {
    map.set(sessionId, timeline);
  }
  const model = toCanvasModel(overview, map, 'black-smith');
  return model.projects[0]?.sessions[0]?.origin;
}

describe('Session.origin, derived from the timeline', () => {
  it('reads a person off `session-start` — the live factory’s `operator`', () => {
    expect(originOf('s', [event('session-start', 'operator')])).toEqual({
      startedBy: 'human',
      promptCount: 0,
    });
  });

  it('reads `operator-skill` as a person too — a human driving through a skill', () => {
    // Measured against the live factory on 2026-09-03: `dogfood-mcp-1` (379
    // events) and `dogfood-mcp-followup-1` (157) both start this way. Calling
    // them agent-made would hide two of the busiest sessions by default.
    expect(originOf('s', [event('session-start', 'operator-skill')])?.startedBy).toBe('human');
  });

  it('reads a factory role as an agent — the live factory’s `tester`', () => {
    expect(originOf('s', [event('session-start', 'tester')])?.startedBy).toBe('agent');
  });

  it('leaves an actor it does not recognise UNKNOWN rather than guessing', () => {
    // The safe direction: an actor string black-smith adds tomorrow stays
    // visible instead of silently vanishing behind a default-on toggle.
    expect(originOf('s', [event('session-start', 'somebody-new')])?.startedBy).toBe('unknown');
    expect(originOf('s', [event('session-start', null)])?.startedBy).toBe('unknown');
  });

  it('counts `user_prompt` events, and only those', () => {
    const origin = originOf('s', [
      event('session-start', 'operator', 0),
      event('user_prompt', 'user', 1),
      event('operator-note', 'operator', 2),
      event('user_prompt', 'user', 3),
      event('dispatch_decision', 'orchestrator', 4),
    ]);
    expect(origin?.promptCount).toBe(2);
  });

  it('says UNKNOWN, not zero, when no timeline has arrived for the session', () => {
    expect(originOf('s')).toEqual({ startedBy: 'unknown', promptCount: null });
    expect(originOf('s', [])).toEqual({ startedBy: 'unknown', promptCount: null });
  });

  it('says unknown when the timeline has no `session-start` at all', () => {
    const origin = originOf('s', [event('user_prompt', 'user', 1)]);
    expect(origin?.startedBy).toBe('unknown');
    // The prompts were still counted — the two facts are independent.
    expect(origin?.promptCount).toBe(1);
  });
});
