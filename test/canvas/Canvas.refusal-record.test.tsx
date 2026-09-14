// @vitest-environment happy-dom

/**
 * A REFUSAL VAM MEANT TO SAY IS STILL WORTH RECORDING.
 *
 * `errors/log.ts` has two kinds for exactly this reason: a `failure` is a bug
 * and can become an issue, a `refusal` is vam working correctly and must never
 * be counted as one. What a refusal is NOT is invisible -- an operator who
 * cannot see why a control did nothing is stuck either way, and the error log
 * is where they look.
 *
 * `newSessionRoute` has three askers, and two of them acted on its refusal:
 * "new project" recorded it (`recordRefusal('new project', ...)`), "new
 * session" wrote the same sentence to the status bar and nothing else. So the
 * identical "this source cannot start a session" left a trace from one control
 * and vanished from the one beside it -- and the status bar is overwritten by
 * the next act, which on this path is usually the operator trying again.
 *
 * Found by a tester walking the create-session flow, not by a gate.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { clearEvents, loggedEvents } from '../../src/renderer/errors/log.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

function session(id: string): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

/** A source that can write prompts but has no way to START a session. */
function cannotCreate(): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: false,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: { createSession: 'the CLI on this machine has no session command' },
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {} },
  };
  return { kind: 'session', source: inner as SessionSource, onWrote: () => {} };
}

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeEach(() => {
  clearEvents();
});
afterEach(cleanup);

describe('a refused new session leaves a trace', () => {
  it('records the refusal, so it outlives the status bar', () => {
    render(<Canvas model={MODEL} source={cannotCreate()} />);
    press('g');
    press('g');
    // `o` -- the chord that starts a session in the focused project.
    press('o');

    expect(statusBar()).toContain('cannot start a session');
    const recorded = loggedEvents();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.action).toBe('new session');
    expect(recorded[0]?.message).toContain('cannot start a session');
  });

  it('records it as a REFUSAL, never as a failure', () => {
    render(<Canvas model={MODEL} source={cannotCreate()} />);
    press('g');
    press('g');
    press('o');

    // The distinction the error log's whole shape rests on: a refusal is not
    // a bug, is not counted in the status bar's failure badge, and offers no
    // Report control.
    expect(loggedEvents()[0]?.kind).toBe('refusal');
  });

  it('carries the source’s own words for why, not the canvas’s', () => {
    render(<Canvas model={MODEL} source={cannotCreate()} />);
    press('g');
    press('g');
    press('o');
    expect(loggedEvents()[0]?.message).toContain('the CLI on this machine has no session command');
  });
});
