// @vitest-environment happy-dom

/**
 * EVENT #21: once every session is closed the main pane must show the Get
 * started screen, not a blank. The screen is DetailPanel's; what is decided
 * here is the `gettingStarted` prop Canvas builds for it: a pane with no entry
 * shows it once the first load has answered and `entries` is empty, whether
 * or not vam still owns hidden (dismissed or closed) sessions.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { clearEvents } from '../../src/renderer/errors/log.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const session = (id: string): Session => ({
  id,
  title: id,
  epic: null,
  branch: null,
  status: 'done',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
});

const NOTHING: CanvasModel = { projects: [] };
const PROJECT_ONLY: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [] }],
};
const ONE_OWN: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

/** A source whose `closeSession` refuses `not-vam-started`, which dismisses
 *  the row: it leaves `entries` and stays in the unfiltered model. */
function dismissingSource(): CanvasSource {
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
      closeSession: true,
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
      recordPrompt: async () => {},
      closeSession: async () => {
        throw { kind: 'refused', code: 'not-vam-started', message: 'not vam’s' };
      },
    },
  };
  return { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} };
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
beforeEach(() => {
  localStorage.clear();
  clearEvents();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const gettingStarted = () => document.querySelector('[data-getting-started]');

describe('the pane shows Get started once nothing is visible anywhere', () => {
  it('(i) no projects and no sessions (base line)', () => {
    render(<Canvas model={NOTHING} />);
    expect(gettingStarted()).not.toBeNull();
  });

  it('(ii) projects, but no sessions', () => {
    render(<Canvas model={PROJECT_ONLY} />);
    expect(gettingStarted()).not.toBeNull();
  });

  it('(iii) the last open session is closed with the x key', async () => {
    render(<Canvas model={ONE_OWN} source={dismissingSource()} />);
    expect(gettingStarted()).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    });
    expect(document.querySelectorAll('[data-session-row]')).toHaveLength(0);
    expect(gettingStarted()).not.toBeNull();
  });

  it('(iii) the last open session is closed with its tab’s ×', async () => {
    render(<Canvas model={ONE_OWN} source={dismissingSource()} />);
    expect(gettingStarted()).toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-tab-close]')?.click();
    });
    expect(document.querySelectorAll('[data-session-row]')).toHaveLength(0);
    expect(gettingStarted()).not.toBeNull();
  });

  it('(iii) the source then reports the session gone', async () => {
    const source = dismissingSource();
    const view = render(<Canvas model={ONE_OWN} source={source} />);
    expect(gettingStarted()).toBeNull();
    view.rerender(<Canvas model={PROJECT_ONLY} source={source} />);
    expect(gettingStarted()).not.toBeNull();
  });
});
