/**
 * Dismissing a session row from the sidebar, without ending anything.
 *
 * THE OPERATOR'S ACTUAL COMPLAINT, once `stop.ts`'s `already-finished`
 * refusal exists: a background row the source already reports as `done` or
 * `failed` has no running job left, so `closeSession` refuses it -- correctly
 * -- on every attempt, and the row still sits on screen for up to
 * `BACKGROUND_WINDOW_MS` (`agents.ts`: 14 days) offering a Close that can
 * never succeed. Dismissing is the local, reversible answer: it removes the
 * ROW, never the session or its transcript, and it is exactly
 * `hiddenProjects`'s idiom one level down -- same two-level shape (source,
 * then id), same list-not-map storage, same "absent means shown" default, and
 * the same reason for being exempt from the icon TTL: it records a decision
 * the operator made, not a session that stopped existing.
 *
 * Keyed by SESSION ROW ID (`session.id`, i.e. `<sessionId>#<pid>` -- see
 * `agents.ts`), matching how `icons` and `renames` are already keyed one
 * level down from source: two DIFFERENT rows can resume the same session id
 * (measured, `agents.ts`), and dismissing one must never dismiss the other.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import {
  applySessionDismissals,
  EMPTY_PREFS,
  isSessionDismissed,
  readPrefs,
  type StorageLike,
  setSessionDismissed,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

function store(initial?: string): StorageLike {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        {
          id: 'a1#100',
          title: 'nightly sweep',
          icon: null,
          epic: null,
          branch: null,
          status: 'done',
          runningAgents: 0,
          activity: null,
          age: null,
          decisions: [],
        },
        {
          id: 'a2#200',
          title: 'still running',
          icon: null,
          epic: null,
          branch: null,
          status: 'running',
          runningAgents: 0,
          activity: null,
          age: null,
          decisions: [],
        },
      ],
    },
  ],
};

describe('dismissed sessions, persisted', () => {
  it('defaults to nothing dismissed', () => {
    expect(EMPTY_PREFS.dismissedSessions).toEqual({});
    expect(isSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#100')).toBe(false);
  });

  it('survives a write/read round trip', () => {
    const storage = store();
    writePrefs(storage, setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#100', true));
    expect(isSessionDismissed(readPrefs(storage), 'claude-code', 'a1#100')).toBe(true);
  });

  it('dismisses only the source it was told about', () => {
    const next = setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#100', true);
    expect(isSessionDismissed(next, 'factory', 'a1#100')).toBe(false);
  });

  it('restores a dismissed session, leaving no residue behind', () => {
    const dismissed = setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#100', true);
    const back = setSessionDismissed(dismissed, 'claude-code', 'a1#100', false);
    expect(isSessionDismissed(back, 'claude-code', 'a1#100')).toBe(false);
    // The stored shape matches a fresh install exactly, so a restore reads
    // back as "never dismissed" rather than as an empty bucket.
    expect(back.dismissedSessions).toEqual({});
  });

  it('reads a payload written before this field existed, resetting nothing', () => {
    const old = JSON.stringify({
      version: 1,
      theme: 'light',
      hiddenProjects: { factory: ['p9'] },
    });
    const prefs = readPrefs(store(old));
    expect(prefs.dismissedSessions).toEqual({});
    expect(prefs.theme).toBe('light');
    expect(prefs.hiddenProjects).toEqual({ factory: ['p9'] });
  });

  it('drops a garbage bucket without undismissing a good one', () => {
    const payload = JSON.stringify({
      version: 1,
      dismissedSessions: { 'claude-code': ['a1#100', 7], factory: 'nope' },
    });
    const prefs = readPrefs(store(payload));
    expect(prefs.dismissedSessions).toEqual({ 'claude-code': ['a1#100'] });
  });
});

describe('applySessionDismissals', () => {
  it('drops exactly the dismissed row, leaving its neighbour alone', () => {
    const prefs = setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#100', true);
    const model = applySessionDismissals(MODEL, prefs.dismissedSessions);
    expect(model.projects[0]?.sessions.map((s) => s.id)).toEqual(['a2#200']);
  });

  it('touches nothing when nothing is dismissed -- same object back, like applyIcons/applyRenames', () => {
    expect(applySessionDismissals(MODEL, {})).toBe(MODEL);
  });

  it('never dismisses a row in a project from another source', () => {
    const prefs = setSessionDismissed(EMPTY_PREFS, 'factory', 'a1#100', true);
    const model = applySessionDismissals(MODEL, prefs.dismissedSessions);
    expect(model.projects[0]?.sessions.map((s) => s.id)).toEqual(['a1#100', 'a2#200']);
  });

  it('drops nothing for a project with no source to look up', () => {
    const noSource: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          sessions: MODEL.projects[0]?.sessions ?? [],
        },
      ],
    };
    const prefs = setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#100', true);
    const model = applySessionDismissals(noSource, prefs.dismissedSessions);
    expect(model.projects[0]?.sessions.map((s) => s.id)).toEqual(['a1#100', 'a2#200']);
  });
});
