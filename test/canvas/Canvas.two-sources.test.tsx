// @vitest-environment happy-dom

/**
 * TWO SOURCES ON ONE CANVAS, and the row-level facts that stopped being
 * app-level facts the moment there were two.
 *
 * vam read `SessionSource.capabilities` -- one answer for the whole window --
 * because it served one source. With Claude Code and Codex together, that
 * answer is the OR: a Terminal tab exists in the app, and does NOT exist for a
 * Codex row, which vam did not start and has no pane into. This file mounts
 * the shell with both and moves the cursor between them.
 *
 * Every id, label and model name below is invented. Nothing here reads
 * `~/.codex` or spawns anything.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource, SourceCapabilities } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const caps = (over: Partial<SourceCapabilities> = {}): SourceCapabilities => ({
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
  ...over,
});

const NO_PANE = 'vam did not start this session and has no pane into it';

const session = (id: string, source: string, over: Partial<Session> = {}): Session => ({
  id,
  title: id,
  icon: null,
  epic: null,
  branch: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source,
  ...over,
});

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'claude-code:alpha',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', 'claude-code', { vamControlled: true })],
    },
    {
      id: 'codex:alpha',
      name: 'alpha',
      source: 'codex',
      sessions: [
        session('00000000-1111-2222-3333-444444444444', 'codex', {
          title: 'a codex thread',
          vamControlled: false,
          model: 'an-invented-model',
        }),
      ],
    },
  ],
};

const sessionSource: SessionSource = {
  id: 'claude-code+codex',
  label: 'Claude Code + Codex',
  capabilities: caps({ terminal: true }),
  declines: {},
  viewerScope: { kind: 'unscoped', warning: 'invented' },
  load: async () => MODEL.projects,
  write: { recordPrompt: async () => {} },
  members: [
    {
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: caps({ terminal: true }),
      declines: {},
    },
    { id: 'codex', label: 'Codex', capabilities: caps(), declines: { terminal: NO_PANE } },
  ],
};

const SOURCE: CanvasSource = {
  kind: 'session',
  source: sessionSource,
  onWrote: () => {},
};

const views = () =>
  [...document.querySelectorAll('[data-view]')].map((el) => el.getAttribute('data-view'));
const focusedTitle = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';
const modelButton = () => document.querySelector('[data-model-picker]');

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeAll(() => {
  // The shell measures; happy-dom reports zero for everything, which is fine
  // for every assertion here.
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
});

afterEach(cleanup);

describe('a canvas serving two sources', () => {
  it('draws the Terminal view for a row whose source has a pane', () => {
    render(<Canvas model={MODEL} source={SOURCE} />);
    expect(focusedTitle()).toContain('a1');
    expect(views()).toContain('terminal');
  });

  it('withdraws it for the Codex row, which its own source declines', () => {
    render(<Canvas model={MODEL} source={SOURCE} />);
    press('j');
    expect(focusedTitle()).toContain('a codex thread');
    // The OR says the app has a terminal. This row does not, and a tab that
    // could only apologise is worse than no tab.
    expect(views()).not.toContain('terminal');
    // Every other view is untouched: withdrawing one capability is not
    // withdrawing the pane.
    expect(views()).toContain('response');
  });

  it('shows the model its source recorded, on a control that cannot change it', () => {
    render(<Canvas model={MODEL} source={SOURCE} />);
    press('j');
    const button = modelButton();
    expect(button?.getAttribute('data-model-picker-state')).toBe('disabled');
    expect(button?.textContent).toContain('an-invented-model');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.getAttribute('aria-label')).toContain('an-invented-model');
  });

  it('gives the Claude Code row back its terminal when the cursor returns', () => {
    render(<Canvas model={MODEL} source={SOURCE} />);
    press('j');
    expect(views()).not.toContain('terminal');
    press('k');
    expect(views()).toContain('terminal');
  });
});
