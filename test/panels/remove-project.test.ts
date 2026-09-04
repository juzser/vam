/**
 * Which sessions removing a project actually ends -- and which it only hides.
 *
 * THE WHOLE POINT OF THE SPLIT. vam can end a session it started: `#146`
 * proved the pairing per session and `stopSession` kills that tmux session.
 * It has no verb for a terminal somebody else opened, and `Session.
 * vamControlled` is a THREE-state fact whose third state is ABSENT -- vam
 * could not ask. Absent is not a licence to try: "vam did not start this" and
 * "vam has no idea" both mean the same thing to a `kill-session`, and killing
 * the wrong one is unrecoverable. So `end` is `=== true` and nothing else, and
 * the dialog's two numbers come from here rather than from a sentence someone
 * wrote once.
 */

import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/renderer/domain/model.js';
import { removalPlan } from '../../src/renderer/panels/remove-project.js';

function session(id: string, vamControlled?: boolean): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: 'work',
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '1m',
    decisions: [],
    ...(vamControlled === undefined ? {} : { vamControlled }),
  };
}

describe('removalPlan', () => {
  it('ends the sessions vam started and hides the rest', () => {
    const plan = removalPlan([session('a', true), session('b', false), session('c')]);
    expect(plan.end).toEqual(['a']);
    expect(plan.hide).toEqual(['b', 'c']);
  });

  it('never ends a session whose control vam could not establish', () => {
    // ABSENT, not false: the state a fixture, a missing tmux or a source with
    // no such surface produces. Widen the guard to `!== false` and this line
    // is the one that reddens.
    expect(removalPlan([session('c')]).end).toEqual([]);
  });

  it('ends nothing when vam started nothing', () => {
    const plan = removalPlan([session('b', false)]);
    expect(plan.end).toEqual([]);
    expect(plan.hide).toEqual(['b']);
  });

  it('is empty for a project whose sessions have all exited', () => {
    expect(removalPlan([])).toEqual({ end: [], hide: [] });
  });
});
