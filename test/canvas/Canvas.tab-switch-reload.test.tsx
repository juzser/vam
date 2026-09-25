// @vitest-environment happy-dom

/**
 * THE OPERATOR'S REPORT: "After I pick the option in the Terminal, the
 * Response view doesn't update; it still shows the options card."
 *
 * `useSourceModel`'s own poll is what would eventually notice the answer --
 * up to `SOURCE_POLL_INTERVAL_MS` later, longer still under its
 * unchanged-streak backoff or while the window is hidden. But switching a
 * pane's OWN tab back to Response asked for nothing: `onTabChange`
 * (`Canvas.tsx`) only persisted the pick (`setViewFor`); it never told the
 * source a fresh read might be worth having, the same way every write in this
 * file already does (`source.onWrote()`, six times over, after a prompt sent
 * or a session closed). Leaving the Terminal tab is exactly the moment the
 * operator may have just typed an answer directly into the pane themselves --
 * out of band from anything vam wrote -- so it deserves the same nudge.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

function session(id: string): Session {
  return {
    id,
    title: id,
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

/** A source that offers a terminal, which is what puts the view on the bar. */
function withTerminal(onWrote: () => void): CanvasSource {
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
      terminal: true,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {} },
  };
  return { kind: 'session', source: inner as SessionSource, onWrote };
}

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** `Alt+<n>` — the VIEW in the focused pane (`Canvas.view-per-session.test.tsx`). */
const viewChord = (n: number) =>
  press(String(n), { ctrlKey: true, altKey: true, code: `Digit${n}` });

function mountFocused(onWrote: () => void) {
  const view = render(<Canvas model={MODEL} source={withTerminal(onWrote)} />);
  press('g');
  press('g');
  return view;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const selectedView = () =>
  document.querySelector('[data-view][aria-pressed="true"]')?.getAttribute('data-view') ?? null;

describe('leaving the Terminal tab', () => {
  it('asks the source for a fresh read, the same way a write does', () => {
    const onWrote = vi.fn();
    mountFocused(onWrote);
    onWrote.mockClear();

    viewChord(3); // Response -> Terminal
    expect(selectedView()).toBe('terminal');
    expect(onWrote).not.toHaveBeenCalled();

    viewChord(1); // Terminal -> Response: the operator may have just answered by hand
    expect(selectedView()).toBe('response');
    expect(onWrote).toHaveBeenCalledTimes(1);
  });

  it('does not reload on every ordinary tab switch, only on leaving Terminal', () => {
    const onWrote = vi.fn();
    mountFocused(onWrote);
    onWrote.mockClear();

    viewChord(2); // Response -> PRs, never touched Terminal
    expect(onWrote).not.toHaveBeenCalled();
  });
});
