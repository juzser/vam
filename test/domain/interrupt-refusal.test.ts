/**
 * `interruptRefusal` — the one place "can vam press a key into this session's
 * pane right now" is decided, read by two callers that used to each carry
 * their own copy of the same three-way ternary: `DetailPanel`'s own
 * `interruptRun` (the bubble menu's "Cancel prompt", the phone strip's
 * `Escape` tap) and `Canvas.tsx`'s `case 'interrupt'` (`Mod-.`, reachable
 * whether or not a composer is even mounted for the focused session).
 *
 * Two different facts that look the same is this pane's oldest defect
 * (`main/sources/pull-requests.ts`: "'No PRs' and 'vam could not ask' must
 * never look the same"), so the three refusals stay three distinct sentences
 * here too, in the one function both callers now read.
 */

import { describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { interruptRefusal } from '../../src/renderer/domain/selectors.js';

function sessionWith(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Provider survey',
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 1,
    activity: null,
    age: '3m',
    decisions: [],
    slashCommands: [],
    vamControlled: true,
    ...over,
  };
}

function entryWith(over: Partial<Session> = {}): SessionEntry {
  const session = sessionWith(over);
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  return { project, session };
}

describe('interruptRefusal', () => {
  it('allows a running, vam-started session on a source with a terminal', () => {
    expect(interruptRefusal(entryWith(), true)).toBeNull();
  });

  it('refuses on a source with no terminal capability at all', () => {
    expect(interruptRefusal(entryWith(), false)).toContain('terminal');
  });

  it('does not refuse for "no terminal" when the caller only said nothing', () => {
    // `undefined` means "nobody said" (`DetailPanel`'s own `terminal?: boolean`
    // doc), never "no" — the same reading every other capability flag in this
    // codebase gives its own absence.
    expect(interruptRefusal(entryWith(), undefined)).toBeNull();
  });

  it('refuses on nothing focused at all', () => {
    expect(interruptRefusal(null, true)).not.toBeNull();
    expect(interruptRefusal(null, true)?.toLowerCase()).toContain('session');
  });

  it('refuses on a session vam did not start, distinctly from "nothing running"', () => {
    const text = interruptRefusal(entryWith({ vamControlled: false }), true);
    expect(text?.toLowerCase()).toContain('did not start');
    expect(text?.toLowerCase()).not.toContain('nothing running');
  });

  it('refuses on a session that is not currently working, distinctly from "vam cannot reach it"', () => {
    for (const status of ['idle', 'done', 'failed', 'waiting'] as const) {
      const text = interruptRefusal(entryWith({ status }), true);
      expect(text?.toLowerCase(), status).toContain('nothing running');
      expect(text?.toLowerCase(), status).not.toContain('did not start');
    }
  });

  it('checks reach before checking activity — a session vam cannot touch is that fact, whatever its status', () => {
    const text = interruptRefusal(entryWith({ vamControlled: false, status: 'idle' }), true);
    expect(text?.toLowerCase()).toContain('did not start');
  });
});
