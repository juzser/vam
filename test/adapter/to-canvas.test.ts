import { describe, expect, it } from 'vitest';
import type { ApiOverview, ApiRunningSession, ApiTimelineEntry } from '../../src/adapter/api.js';
import { NO_PROJECT_ID, toCanvasModel, toDecisions } from '../../src/adapter/to-canvas.js';

function apiSession(id: string, over: Partial<ApiRunningSession> = {}): ApiRunningSession {
  return {
    sessionId: id,
    startedAt: '2026-08-01T00:00:00Z',
    lastEventAt: '2026-08-01T01:00:00Z',
    eventCount: 4,
    liveAgentCount: 0,
    lastEventType: 'task-result-recorded',
    projects: ['black-smith'],
    ...over,
  };
}

function entry(
  eventId: string,
  eventType: string,
  over: Partial<ApiTimelineEntry> = {},
): ApiTimelineEntry {
  return {
    eventId,
    ts: `2026-08-01T00:00:0${eventId.length}Z`,
    eventType,
    taskId: null,
    planVersion: 1,
    causalParent: null,
    payload: {},
    project: 'black-smith',
    actor: null,
    ...over,
  };
}

function overview(
  sessions: readonly ApiRunningSession[],
  alerts: ApiOverview['alerts'] = { escalations: 0, pendingWaivers: 0 },
): ApiOverview {
  return { runningSessions: sessions, alerts };
}

describe('toDecisions', () => {
  it('opens a turn on your prompt and keeps its words verbatim', () => {
    const decisions = toDecisions([
      entry('e1', 'user_prompt', {
        ts: '2026-08-01T00:00:01Z',
        payload: { prompt: 'run task-4' },
      }),
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.input).toBe('run task-4');
  });

  it('leaves output null while only dispatches have followed', () => {
    // A dispatch is the session going off to work. It is not an answer, and
    // calling it one would mark every in-flight turn as finished.
    const decisions = toDecisions([
      entry('e1', 'user_prompt', { ts: '2026-08-01T00:00:01Z', payload: { prompt: 'go run it' } }),
      entry('e2', 'dispatch_decision', { ts: '2026-08-01T00:00:02Z' }),
    ]);
    expect(decisions[0]?.output).toBeNull();
  });

  it('answers with the outcomes that followed, not with the working', () => {
    const decisions = toDecisions([
      entry('e1', 'user_prompt', { ts: '2026-08-01T00:00:01Z', payload: { prompt: 'go run it' } }),
      entry('e2', 'dispatch_decision', { ts: '2026-08-01T00:00:02Z' }),
      entry('e3', 'task-result-recorded', {
        ts: '2026-08-01T00:00:03Z',
        taskId: 'task-4',
        payload: { status: 'done' },
      }),
    ]);
    const out = decisions[0]?.output ?? '';
    expect(out).toContain('task-4');
    expect(out).toContain('done');
    expect(out).not.toContain('dispatch_decision');
  });

  it('closes a turn when the next prompt arrives', () => {
    const decisions = toDecisions([
      entry('e1', 'user_prompt', { ts: '2026-08-01T00:00:01Z', payload: { prompt: 'one' } }),
      entry('e2', 'task-result-recorded', { ts: '2026-08-01T00:00:02Z', payload: {} }),
      entry('e3', 'user_prompt', { ts: '2026-08-01T00:00:03Z', payload: { prompt: 'two' } }),
    ]);
    expect(decisions.map((d) => d.input)).toEqual(['two', 'one']);
    expect(decisions[1]?.output).not.toBeNull();
    expect(decisions[0]?.output).toBeNull();
  });

  it('returns newest first, the order the model stores', () => {
    const decisions = toDecisions([
      entry('e1', 'user_prompt', { ts: '2026-08-01T00:00:01Z', payload: { prompt: 'old' } }),
      entry('e2', 'user_prompt', { ts: '2026-08-01T00:00:02Z', payload: { prompt: 'new' } }),
    ]);
    expect(decisions.map((d) => d.input)).toEqual(['new', 'old']);
  });

  it('sorts by timestamp rather than trusting the order it was handed', () => {
    const decisions = toDecisions([
      entry('e2', 'user_prompt', { ts: '2026-08-01T00:00:02Z', payload: { prompt: 'new' } }),
      entry('e1', 'user_prompt', { ts: '2026-08-01T00:00:01Z', payload: { prompt: 'old' } }),
    ]);
    expect(decisions.map((d) => d.input)).toEqual(['new', 'old']);
  });

  it('ignores events before your first word — they answer no question of yours', () => {
    const decisions = toDecisions([
      entry('e1', 'session-start', { ts: '2026-08-01T00:00:01Z' }),
      entry('e2', 'user_prompt', { ts: '2026-08-01T00:00:02Z', payload: { prompt: 'hello' } }),
    ]);
    expect(decisions).toHaveLength(1);
  });

  it('has no turns at all for a session that ran itself', () => {
    // Honest, not a gap: a session you never spoke to made no decisions WITH
    // you. Its card still carries status, agent count and what it last did.
    expect(toDecisions([entry('e1', 'dispatch_decision')])).toEqual([]);
  });

  it('takes an operator note as a turn of its own', () => {
    const decisions = toDecisions([
      entry('e1', 'operator-note', {
        ts: '2026-08-01T00:00:01Z',
        actor: 'operator',
        payload: { note: "don't waive the S2" },
      }),
    ]);
    expect(decisions[0]?.input).toBe("don't waive the S2");
  });
});

describe('toCanvasModel', () => {
  it('groups sessions by their project', () => {
    const model = toCanvasModel(
      overview([
        apiSession('a', { projects: ['black-smith'] }),
        apiSession('b', { projects: ['vam'] }),
      ]),
      new Map(),
    );
    expect(model.projects.map((p) => p.id)).toEqual(['black-smith', 'vam']);
  });

  it('keeps a session with no project rather than dropping it', () => {
    // A session that has not created a task yet has no project. Dropping it
    // would hide exactly the session you just opened.
    const model = toCanvasModel(overview([apiSession('a', { projects: [] })]), new Map());
    expect(model.projects.map((p) => p.id)).toEqual([NO_PROJECT_ID]);
    expect(model.projects[0]?.sessions).toHaveLength(1);
  });

  it('files a session under its first project when it spans several', () => {
    const model = toCanvasModel(overview([apiSession('a', { projects: ['aa', 'bb'] })]), new Map());
    expect(model.projects.map((p) => p.id)).toEqual(['aa']);
  });

  it('carries the live agent count through as ●N', () => {
    const model = toCanvasModel(overview([apiSession('a', { liveAgentCount: 3 })]), new Map());
    expect(model.projects[0]?.sessions[0]?.runningAgents).toBe(3);
  });

  it('calls a session with live agents running', () => {
    const model = toCanvasModel(overview([apiSession('a', { liveAgentCount: 2 })]), new Map());
    expect(model.projects[0]?.sessions[0]?.status).toBe('running');
  });

  it('calls a session whose last event was an error failed', () => {
    const model = toCanvasModel(
      overview([apiSession('a', { liveAgentCount: 0, lastEventType: 'error-logged' })]),
      new Map(),
    );
    expect(model.projects[0]?.sessions[0]?.status).toBe('failed');
  });

  it('calls a session with an unanswered turn running, even with no live agent', () => {
    // A prompt is recorded the instant you send it, before anything has been
    // dispatched to answer it. Calling that `done` marks the one turn still
    // open as finished, which is exactly what the first live run showed.
    const model = toCanvasModel(
      overview([apiSession('a', { liveAgentCount: 0, lastEventType: 'user_prompt' })]),
      new Map([
        [
          'a',
          [
            entry('e1', 'user_prompt', { payload: { prompt: 'go run it' } }),
          ] as readonly ApiTimelineEntry[],
        ],
      ]),
    );
    expect(model.projects[0]?.sessions[0]?.status).toBe('running');
  });

  it('calls a session that answered and stopped waiting', () => {
    const model = toCanvasModel(
      overview([apiSession('a', { liveAgentCount: 0 })]),
      new Map([
        [
          'a',
          [
            entry('e1', 'user_prompt', { ts: '2026-08-01T00:00:01Z', payload: { prompt: 'ask' } }),
            entry('e2', 'task-result-recorded', { ts: '2026-08-01T00:00:02Z' }),
          ] as readonly ApiTimelineEntry[],
        ],
      ]),
    );
    expect(model.projects[0]?.sessions[0]?.status).toBe('waiting');
  });

  it('calls a session nobody ever spoke to done', () => {
    const model = toCanvasModel(overview([apiSession('a', { liveAgentCount: 0 })]), new Map());
    expect(model.projects[0]?.sessions[0]?.status).toBe('done');
  });

  it('splits what it last did from how long ago', () => {
    // In a column of a dozen rows the question is "is this fresh", never "at
    // what o'clock" — and an ISO stamp makes you subtract in your head.
    const now = new Date('2026-08-27T12:00:00Z');
    const model = toCanvasModel(
      overview([apiSession('a', { lastEventAt: '2026-08-27T11:45:00Z' })]),
      new Map(),
      now,
    );
    // The two are separate fields now: the activity line says WHAT it last
    // did, `age` says how long ago. The mockup puts them at opposite ends of
    // the same row, and one pre-joined string cannot be put in two places.
    expect(model.projects[0]?.sessions[0]?.activity).toBe('task-result-recorded');
    expect(model.projects[0]?.sessions[0]?.age).toBe('15m');
  });

  it('labels a session with the epic its newest turn is in', () => {
    // black-smith qualifies task ids as <epic>/<task>, so the epic is in the
    // data rather than guessed from the factory-wide epicsInFlight.
    const model = toCanvasModel(
      overview([apiSession('a')]),
      new Map([
        [
          'a',
          [
            entry('e1', 'user_prompt', {
              ts: '2026-08-01T00:00:01Z',
              taskId: 'ui-server-sse/task-4',
              payload: { prompt: 'run' },
            }),
          ] as readonly ApiTimelineEntry[],
        ],
      ]),
    );
    expect(model.projects[0]?.sessions[0]?.epic).toBe('ui-server-sse');
  });

  it('leaves the epic blank rather than guessing one', () => {
    const model = toCanvasModel(overview([apiSession('a')]), new Map());
    expect(model.projects[0]?.sessions[0]?.epic).toBeNull();
  });

  it('says what the session last did rather than inventing an activity line', () => {
    // §5 epic B has not landed, so nothing can say what an agent is DOING. What
    // the log can say is what last happened, and it is labelled as that.
    const model = toCanvasModel(
      overview([apiSession('a', { lastEventType: 'gate-outcome' })]),
      new Map(),
    );
    expect(model.projects[0]?.sessions[0]?.activity).toContain('gate-outcome');
  });

  it('leaves the activity line null when the log cannot say', () => {
    const model = toCanvasModel(overview([apiSession('a', { lastEventType: null })]), new Map());
    expect(model.projects[0]?.sessions[0]?.activity).toBeNull();
  });

  it('attaches the timeline it was given for that session', () => {
    const model = toCanvasModel(
      overview([apiSession('a')]),
      new Map([
        [
          'a',
          [
            entry('e1', 'user_prompt', { payload: { prompt: 'hi' } }),
          ] as readonly ApiTimelineEntry[],
        ],
      ]),
    );
    expect(model.projects[0]?.sessions[0]?.decisions[0]?.input).toBe('hi');
  });

  it('gives a session no icon, because nothing in the factory stores one', () => {
    const model = toCanvasModel(overview([apiSession('a')]), new Map());
    expect(model.projects[0]?.sessions[0]?.icon).toBeNull();
  });
});
