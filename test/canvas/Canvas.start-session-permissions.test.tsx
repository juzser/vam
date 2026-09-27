// @vitest-environment happy-dom

/**
 * SECURITY-SENSITIVE. `agentPermissions` (`prefs/agent-permissions.ts`)
 * reaches exactly one write: `startSessionIn`'s own `recordPrompt`, the
 * text typed into a FRESH pane at session creation.
 *
 *  - Manual (the default) types the bare command -- no flag, ever.
 *  - Yolo types exactly the right flag per provider
 *    (`shared/providers.ts`'s `sessionArgv`, verified against each
 *    provider's real `--help`), as a SEPARATE argv element joined once,
 *    never a string built by concatenation.
 *  - `resumeInPane` -- a DIFFERENT write, for a session that already existed
 *    -- types `entry.session.resumeCommand` verbatim, regardless of
 *    `agentPermissions`: the setting never reaches an already-running (or
 *    previously-run) session, only session CREATION.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

const TERMINAL: Session = {
  ...UNSTARTED,
  status: 'terminal',
  title: 'fix the flaky test',
  resumeCommand: 'claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

function modelWith(...sessions: readonly Session[]): CanvasModel {
  return { projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }] };
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
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {},
    },
    recorded,
  };
}

function seed(prefs: Record<string, unknown>): void {
  localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}

const startButton = () =>
  document.querySelector('[data-start-session-button]') as HTMLButtonElement | null;
const resumeButton = () =>
  document.querySelector('[data-resume-in-pane]') as HTMLButtonElement | null;

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
  vi.useRealTimers();
});

describe('agentPermissions: manual (the default) adds no flag', () => {
  it('types the bare command on Start', async () => {
    const { source, recorded } = sourceWith();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(recorded).toEqual([[UNSTARTED.id, 'claude']]);
  });

  it('an explicit manual setting is identical', async () => {
    seed({ agentPermissions: 'manual' });
    const { source, recorded } = sourceWith();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(recorded).toEqual([[UNSTARTED.id, 'claude']]);
  });
});

describe('agentPermissions: yolo appends exactly the right flag, per provider', () => {
  it('claude code', async () => {
    seed({ agentPermissions: 'yolo' });
    const { source, recorded } = sourceWith();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(recorded).toEqual([[UNSTARTED.id, 'claude --dangerously-skip-permissions']]);
  });

  it('codex, chosen from the same picker', async () => {
    seed({ agentPermissions: 'yolo' });
    const { source, recorded } = sourceWith();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      document.querySelector<HTMLElement>('[data-start-provider="codex"]')?.click();
    });
    await act(async () => {
      startButton()?.click();
    });
    expect(recorded).toEqual([[UNSTARTED.id, 'codex --dangerously-bypass-approvals-and-sandbox']]);
  });
});

describe('agentPermissions never reaches an already-existing session', () => {
  it('resumeInPane types the resume command verbatim, yolo or not', async () => {
    seed({ agentPermissions: 'yolo' });
    const { source, recorded } = sourceWith();
    render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(recorded).toEqual([[TERMINAL.id, TERMINAL.resumeCommand]]);
    expect(recorded[0]?.[1]).not.toContain('--dangerously');
  });
});
