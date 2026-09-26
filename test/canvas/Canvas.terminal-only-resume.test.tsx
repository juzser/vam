// @vitest-environment happy-dom

/**
 * RESUME, FROM THE `terminal` GETTING-STARTED SCREEN, THROUGH THE REAL PORT.
 *
 * Nothing here spawns anything: the path is asserted through the source
 * port's `write.recordPrompt`, the same seam `Canvas.new-session.test.tsx`
 * asserts `createSession` through. `resumeInPane` (`Canvas.tsx`) is
 * `startSessionIn`'s twin -- this file is its twin's test, checked by value:
 * the row's OWN `resumeCommand` reaches `recordPrompt` verbatim, addressed
 * to the row's own id, and Start session (the primary act, shared with the
 * plain `unstarted` screen) still reaches the same write with the provider's
 * command instead.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const RESUME_COMMAND = 'claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const TERMINAL: Session = {
  id: 'pane:vam-alpha-aa11bb',
  title: 'fix the flaky test',
  epic: null,
  branch: null,
  status: 'terminal',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  vamControlled: true,
  pane: 'vam-alpha-aa11bb',
  resumeCommand: RESUME_COMMAND,
};

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [TERMINAL] }],
};

function sourceWith(): {
  source: CanvasSource;
  recorded: [string, string][];
  wrote: { count: number };
} {
  const recorded: [string, string][] = [];
  const wrote = { count: 0 };
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async (sessionId: string, prompt: string) => {
        recorded.push([sessionId, prompt]);
      },
    },
  };
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {
        wrote.count += 1;
      },
    },
    recorded,
    wrote,
  };
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('re-pairing after a hand-typed resume -- item 4 of the brief', () => {
  /**
   * THE OPERATOR TYPES `claude --resume <id>` THEMSELVES, no button pressed
   * at all. What the NEXT poll reports is exactly what a fresh `claude`
   * registering in this pane always reports: the same `Session.pane`, now on
   * a LIVE row keyed by the agent instead of the pane. `renameTab`
   * (`canvas/split.ts`) is what keeps the tab in place across that -- and it
   * is untouched by this feature, keyed purely on `Session.pane` matching
   * between polls, exactly as it already does for `unstarted -> running`.
   * This test is the same proof `Canvas.pane-row-resolves.test.tsx` makes for
   * that transition, made again for `terminal -> running`, since nothing
   * about `renameTab`'s own code path distinguishes the two statuses.
   */
  it('the tab follows the pane, deterministically, from `terminal` to a live row on the same conversation', async () => {
    const { rerender } = render(<Canvas model={MODEL} />);
    expect(document.querySelector('[data-terminal-only-start]')).not.toBeNull();
    const tabsInPane1 = () =>
      document.querySelectorAll('[data-split-pane="pane-1"] [data-session-tab]');
    expect(tabsInPane1()).toHaveLength(1);
    expect(tabsInPane1()[0]?.getAttribute('data-tab-status')).toBe('terminal');
    const LIVE: Session = {
      id: 'sess-a#4242',
      title: 'fix the flaky test',
      epic: null,
      branch: null,
      status: 'running',
      runningAgents: 0,
      activity: null,
      age: null,
      decisions: [{ id: 'd1', label: 'you', input: 'go on', output: null, commands: [] }],
      source: 'claude-code',
      vamControlled: true,
      // THE ONE FACT THAT TIES THEM TOGETHER, and the only one `renameTab`
      // reads: the same tmux pane the `terminal` row named.
      pane: 'vam-alpha-aa11bb',
    };
    await act(async () => {
      rerender(
        <Canvas
          model={{
            projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [LIVE] }],
          }}
        />,
      );
    });
    expect(document.querySelector('[data-terminal-only-start]')).toBeNull();
    // STILL ONE TAB, NOT TWO -- the proof this is a RENAME and not a close-
    // and-reopen, which would leave the old tab gone and a new one appended
    // instead of this exact tab changing what it says about itself.
    expect(tabsInPane1()).toHaveLength(1);
    expect(tabsInPane1()[0]?.getAttribute('data-tab-status')).toBe('running');
  });
});

describe('the terminal-only getting-started screen’s two acts', () => {
  it('Resume types the row’s OWN resumeCommand into the pane the row already owns', async () => {
    const { source, recorded, wrote } = sourceWith();
    render(<Canvas model={MODEL} source={source} />);
    const button = document.querySelector('[data-resume-in-pane]') as HTMLElement | null;
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
    expect(recorded).toEqual([['pane:vam-alpha-aa11bb', RESUME_COMMAND]]);
    expect(wrote.count).toBe(1);
  });

  it('Start session still reaches the SAME write, with the chosen provider’s command', async () => {
    const { source, recorded } = sourceWith();
    render(<Canvas model={MODEL} source={source} />);
    const codex = document.querySelector('[data-start-provider="codex"]') as HTMLElement | null;
    await act(async () => {
      codex?.click();
    });
    const start = document.querySelector('[data-start-session-button]') as HTMLElement | null;
    await act(async () => {
      start?.click();
    });
    expect(recorded).toEqual([['pane:vam-alpha-aa11bb', 'codex']]);
  });
});
