/**
 * `sendEscapeRefusal` / `cancelPromptRefusal` — the two places "can vam press
 * a key into this session's pane right now" is decided.
 *
 * ONE FUNCTION USED TO ANSWER BOTH QUESTIONS (`interruptRefusal`), gating on
 * `session.status !== 'running'` for every caller. That was right for
 * `DetailPanel`'s own "Cancel this turn" (cancelling a turn that is not
 * running is a contradiction) and WRONG for `Canvas.tsx`'s `case 'interrupt'`
 * (`Mod-.`), whose whole job — since the operator's reversal moved Escape off
 * `Mod-.` and onto leaving Insert — is to be the ONLY way left to press a
 * literal Escape into a session's pane. An idle or waiting session still has
 * a pane: Claude Code's own Esc-Esc rewind, its `/model`/`/resume` menus, a
 * shell prompt, vim, all read a literal Escape whether or not the agent is
 * mid-turn, and the status gate made that unreachable the moment a session
 * stopped running.
 *
 * So the one function is now two. `sendEscapeRefusal` carries the three facts
 * that make a pane unreachable at all — no terminal, no session picked, a
 * session vam did not start — and never asks what the session is doing.
 * `cancelPromptRefusal` is those same three PLUS the fourth, status-scoped
 * fact that only "Cancel this turn" needs: a turn cannot be cancelled if
 * nothing is running.
 */

import { describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { cancelPromptRefusal, sendEscapeRefusal } from '../../src/renderer/domain/selectors.js';

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

describe('sendEscapeRefusal', () => {
  it('allows a running, vam-started session on a source with a terminal', () => {
    expect(sendEscapeRefusal(entryWith(), true)).toBeNull();
  });

  it('refuses on a source with no terminal capability at all', () => {
    expect(sendEscapeRefusal(entryWith(), false)).toContain('terminal');
  });

  it('does not refuse for "no terminal" when the caller only said nothing', () => {
    // `undefined` means "nobody said" (`DetailPanel`'s own `terminal?: boolean`
    // doc), never "no" — the same reading every other capability flag in this
    // codebase gives its own absence.
    expect(sendEscapeRefusal(entryWith(), undefined)).toBeNull();
  });

  it('refuses on nothing focused at all', () => {
    expect(sendEscapeRefusal(null, true)).not.toBeNull();
    expect(sendEscapeRefusal(null, true)?.toLowerCase()).toContain('session');
  });

  it('refuses on a session vam did not start', () => {
    const text = sendEscapeRefusal(entryWith({ vamControlled: false }), true);
    expect(text?.toLowerCase()).toContain('did not start');
  });

  it('checks reach before checking anything else — a session vam cannot touch is that fact, whatever its status', () => {
    const text = sendEscapeRefusal(entryWith({ vamControlled: false, status: 'idle' }), true);
    expect(text?.toLowerCase()).toContain('did not start');
  });

  /**
   * THE REGRESSION THIS FILE EXISTS TO CATCH. `interruptRefusal`'s old status
   * gate made every one of these `null` — an idle, a waiting, a done, a
   * failed, an unstarted session — read as "nothing running to interrupt",
   * which left NO way to send a literal Escape into a pane the instant its
   * agent stopped running. Sending Escape is not "stop the agent"; it is
   * "press this key into the pane", and the pane exists in every one of
   * these states exactly as it does while running.
   */
  it('does NOT refuse for any non-running status — Escape still has somewhere to go', () => {
    for (const status of ['idle', 'waiting', 'done', 'failed', 'unstarted'] as const) {
      expect(sendEscapeRefusal(entryWith({ status }), true), status).toBeNull();
    }
  });
});

describe('cancelPromptRefusal', () => {
  it('allows a running, vam-started session on a source with a terminal', () => {
    expect(cancelPromptRefusal(entryWith(), true)).toBeNull();
  });

  it('refuses on a source with no terminal capability at all', () => {
    expect(cancelPromptRefusal(entryWith(), false)).toContain('terminal');
  });

  it('does not refuse for "no terminal" when the caller only said nothing', () => {
    expect(cancelPromptRefusal(entryWith(), undefined)).toBeNull();
  });

  it('refuses on nothing focused at all', () => {
    expect(cancelPromptRefusal(null, true)).not.toBeNull();
    expect(cancelPromptRefusal(null, true)?.toLowerCase()).toContain('session');
  });

  it('refuses on a session vam did not start, distinctly from "nothing running"', () => {
    const text = cancelPromptRefusal(entryWith({ vamControlled: false }), true);
    expect(text?.toLowerCase()).toContain('did not start');
    expect(text?.toLowerCase()).not.toContain('nothing running');
  });

  it('refuses on a session that is not currently working, distinctly from "vam cannot reach it"', () => {
    for (const status of ['idle', 'done', 'failed', 'waiting'] as const) {
      const text = cancelPromptRefusal(entryWith({ status }), true);
      expect(text?.toLowerCase(), status).toContain('nothing running');
      expect(text?.toLowerCase(), status).not.toContain('did not start');
    }
  });

  it('checks reach before checking activity — a session vam cannot touch is that fact, whatever its status', () => {
    const text = cancelPromptRefusal(entryWith({ vamControlled: false, status: 'idle' }), true);
    expect(text?.toLowerCase()).toContain('did not start');
  });
});
