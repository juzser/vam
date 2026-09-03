/**
 * Who started a session, and whether you ever spoke in it.
 *
 * Both rules are written to fail SAFE in one direction only: a session vam
 * has not actually classified is never hidden. The tests below say that out
 * loud, because it is the property the whole feature rests on — a filter that
 * hides work nobody checked is a filter that loses work.
 */

import { describe, expect, it } from 'vitest';
import type { Session, SessionOrigin } from '../../src/renderer/domain/model.js';
import { isAgentStarted, isUnprompted } from '../../src/renderer/domain/session-filter.js';

function session(origin?: SessionOrigin): Session {
  return {
    id: 's',
    title: 's',
    icon: null,
    epic: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...(origin === undefined ? {} : { origin }),
  };
}

describe('isAgentStarted', () => {
  it('is true only for a session an agent role opened', () => {
    expect(isAgentStarted(session({ startedBy: 'agent', promptCount: 0 }))).toBe(true);
  });

  it('is false for a human, and false for an origin vam never derived', () => {
    expect(isAgentStarted(session({ startedBy: 'human', promptCount: 0 }))).toBe(false);
    expect(isAgentStarted(session({ startedBy: 'unknown', promptCount: null }))).toBe(false);
    // No origin at all — a fixture, or a model built before this field existed.
    expect(isAgentStarted(session())).toBe(false);
  });
});

describe('isUnprompted', () => {
  it('is true only when vam counted the prompts and found none', () => {
    expect(isUnprompted(session({ startedBy: 'human', promptCount: 0 }))).toBe(true);
  });

  it('is false when there is a prompt, and false when the count is unknown', () => {
    expect(isUnprompted(session({ startedBy: 'human', promptCount: 1 }))).toBe(false);
    // `null` is "not counted", which is not the same as "counted zero". A
    // timeline that has not arrived must not empty the sidebar.
    expect(isUnprompted(session({ startedBy: 'unknown', promptCount: null }))).toBe(false);
    expect(isUnprompted(session())).toBe(false);
  });
});
