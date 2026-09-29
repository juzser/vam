// @vitest-environment happy-dom

/**
 * The start screen's keyboard shortcut: `Mod-Enter` (Select mode) runs the
 * SAME start call the "Start session" button makes, with the provider and
 * permission chosen on screen. With no start screen mounted for the focused
 * session the chord is refused with a reason.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const PANE = 'vam-alpha-aa11bb';

const UNSTARTED: Session = {
  id: `pane:${PANE}`,
  title: PANE,
  epic: null,
  branch: null,
  status: 'unstarted',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  vamControlled: true,
  pane: PANE,
};

const RUNNING: Session = { ...UNSTARTED, id: 'a1', pane: undefined, status: 'running' };

function modelWith(session: Session): CanvasModel {
  return { projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session] }] };
}

function sourceWith(): { source: CanvasSource; recorded: [string, string][] } {
  const recorded: [string, string][] = [];
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
    source: { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} },
    recorded,
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
  Reflect.deleteProperty(window, 'api');
});

async function pressStart() {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

describe('the start chord', () => {
  it('starts once with the on-screen provider and permission', async () => {
    (window as unknown as { api: unknown }).api = {};
    const { source, recorded } = sourceWith();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      document.querySelector<HTMLElement>('[data-start-provider="codex"]')?.click();
      document.querySelector<HTMLElement>('[data-start-permission-option="yolo"]')?.click();
    });
    await pressStart();
    expect(recorded).toEqual([[UNSTARTED.id, 'codex --dangerously-bypass-approvals-and-sandbox']]);
  });

  it('is refused with a reason when no start screen is on show', async () => {
    const { source, recorded } = sourceWith();
    render(<Canvas model={modelWith(RUNNING)} source={source} />);
    await pressStart();
    expect(recorded).toEqual([]);
    expect(statusBar()).toContain('no start screen');
  });
});
