// @vitest-environment happy-dom

/**
 * THE GETTING-STARTED SCREEN, WIRED: `Canvas.tsx` is the one place that knows
 * whether vam has a session to show ANYWHERE -- `entries`, the same filtered
 * list the sidebar and the tab strip already agree on -- so it is the one
 * place that can honestly opt `DetailPanel`'s `gettingStarted` prop in.
 * `DetailPanel.getting-started.test.tsx` covers the screen's own contract
 * once handed that prop; this file covers the WIRING: when Canvas hands it
 * over, with what data, and that "New project" on this screen is the exact
 * same write path as the Projects header's own `+` (`Canvas.new-project.
 * test.tsx`) -- no second implementation.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { clearEvents } from '../../src/renderer/errors/log.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id,
  title: id,
  epic: null,
  branch: null,
  status: 'done',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  ...over,
});

const EMPTY_MODEL: CanvasModel = { projects: [] };

/** One project, one session vam did NOT start -- hidden by `hideForeign`,
 *  which defaults on, so `entries` (the visible/filtered set) is empty while
 *  the workspace is not. */
const ALL_FOREIGN_MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', { vamControlled: false })],
    },
  ],
};

const ONE_VISIBLE_MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

const CHOSEN = '/srv/work/orchard';

type Spawned = [string, string][];

function sourceWith(canCreate: boolean): { source: CanvasSource; spawned: Spawned } {
  const spawned: Spawned = [];
  const writes = canCreate
    ? {
        createSession: async () => {},
        createSessionIn: async (cwd: string, title: string) => {
          spawned.push([cwd, title]);
        },
      }
    : {};
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
      createSession: canCreate,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
      resumeSession: false,
    },
    declines: canCreate ? {} : { createSession: 'this source has no way to start one' },
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {}, ...writes },
  };
  return {
    source: { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} },
    spawned,
  };
}

/** Installs a picker, or -- with `undefined` -- the browser build's absence of one. */
function withDialog(chooseDirectory?: () => Promise<string | null>) {
  const api =
    chooseDirectory === undefined
      ? undefined
      : { dialog: { chooseDirectory: async () => chooseDirectory() } };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
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
  Object.defineProperty(window, 'api', { value: undefined, configurable: true, writable: true });
});

const gettingStarted = () => document.querySelector('[data-getting-started]');

describe('the getting-started screen, wired from Canvas', () => {
  it('shows with an empty model -- first launch, nothing exists yet', () => {
    const { source } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={EMPTY_MODEL} source={source} />);
    expect(gettingStarted()).not.toBeNull();
    expect(document.querySelector('[data-getting-started-hidden]')).toBeNull();
  });

  /**
   * "PICK ONE FROM THE SIDEBAR" IS A LIE WITH NOTHING TO PICK. The strip's
   * own empty-state sentence is right for a pane a split emptied while
   * OTHER sessions sit in the sidebar (`Canvas.pane-tabs.test.tsx`); it
   * contradicted the getting-started screen 40px below it the moment the
   * whole app was empty -- the operator's own finding, reading the first
   * screenshot. `entries.length === 0` is the SAME signal `gettingStarted`
   * reads, so the two can never disagree about whether there is a sidebar
   * row to point at.
   */
  it('the tab strip says "no sessions yet", never "pick one from the sidebar", with nothing to pick', () => {
    const { source } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={EMPTY_MODEL} source={source} />);
    const strip = document.querySelector('[data-tab-strip]');
    expect(strip?.textContent).toBe('no sessions yet');
    expect(strip?.textContent).not.toContain('pick one from the sidebar');
  });

  it('shows, with the hidden-count line, when every session is foreign', () => {
    const { source } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={ALL_FOREIGN_MODEL} source={source} />);
    expect(gettingStarted()).not.toBeNull();
    const hidden = document.querySelector('[data-getting-started-hidden]');
    expect(hidden?.textContent).toContain('1 session hidden');
  });

  it('is absent the moment any session is visible', () => {
    const { source } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={ONE_VISIBLE_MODEL} source={source} />);
    expect(gettingStarted()).toBeNull();
  });

  it('New project on this screen is the SAME write path as the Projects header — no second implementation', async () => {
    const { source, spawned } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={EMPTY_MODEL} source={source} />);
    await act(async () => {
      (document.querySelector('[data-getting-started-new-project]') as HTMLElement).click();
    });
    expect(spawned).toEqual([[CHOSEN, 'orchard']]);
  });

  it('withdraws the button and says so, with no directory picker (the browser build)', () => {
    const { source } = sourceWith(true);
    withDialog();
    render(<Canvas model={EMPTY_MODEL} source={source} />);
    expect(document.querySelector('[data-getting-started-new-project]')).toBeNull();
    expect(document.querySelector('[data-getting-started-decline]')?.textContent).toMatch(
      /desktop app/,
    );
  });

  it('withdraws the button and refuses in the SOURCE’s own words, when it cannot create at all', () => {
    const { source } = sourceWith(false);
    withDialog(async () => CHOSEN);
    render(<Canvas model={EMPTY_MODEL} source={source} />);
    expect(document.querySelector('[data-getting-started-new-project]')).toBeNull();
    expect(document.querySelector('[data-getting-started-decline]')?.textContent).toContain(
      'this source has no way to start one',
    );
  });

  it('Show flips hideForeign, and the screen steps aside once a session is visible', async () => {
    const { source } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={ALL_FOREIGN_MODEL} source={source} />);
    await act(async () => {
      (document.querySelector('[data-getting-started-show]') as HTMLElement).click();
    });
    expect(gettingStarted()).toBeNull();
    expect(document.querySelectorAll('[data-session-row]')).toHaveLength(1);
  });
});

describe('New session, with no project to start one in', () => {
  it('the sidebar foot button reads "New project" and triggers it -- never a dead end', async () => {
    const { source, spawned } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={EMPTY_MODEL} source={source} />);
    const button = document.querySelector('[data-sidebar-add]') as HTMLElement;
    expect(button.textContent).toContain('New project');
    expect(button.textContent).not.toContain('New session');
    await act(async () => {
      button.click();
    });
    expect(spawned).toEqual([[CHOSEN, 'orchard']]);
  });

  it('the `o` chord does the same -- one path, not two', async () => {
    const { source, spawned } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={EMPTY_MODEL} source={source} />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    });
    expect(spawned).toEqual([[CHOSEN, 'orchard']]);
  });
});
