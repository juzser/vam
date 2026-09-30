// @vitest-environment happy-dom

/**
 * EVENT #22: a new session opens on the Response view. A session with no
 * `viewBySession` record opens on `viewSeed`, which is `prefs.detailTab` as
 * the previous run left it, so every route that creates a session must record
 * Response for it, and none of them may write the preference. (The Start
 * button lives on the Response view, so a started row already has one.)
 *
 * Precedence: (1) a session vam creates or starts this run opens on Response;
 * (2) a view the operator picks for it wins from then on; (3) an existing
 * session with no pick this run still opens on the seed.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { setActiveStreamingTerminal } from '../../src/renderer/prefs/streaming-terminal.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

// Each case renders a whole canvas; a loaded machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 });

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

const modelWith = (...sessions: Session[]): CanvasModel => ({
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }],
});

/** A source that offers a terminal (so a Terminal seed is a real view), can
 *  create. */
function sourceWith(): { source: CanvasSource } {
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
      createSession: true,
      governance: false,
      pullRequests: false,
      terminal: true,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async () => {},
      createSession: async () => {},
      createSessionIn: async () => {},
    },
  };
  return {
    source: { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} },
  };
}

const selectedView = () =>
  document.querySelector('[data-view][aria-pressed="true"]')?.getAttribute('data-view') ?? null;
const activeTab = () =>
  document.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')?.textContent ??
  null;
const storedTab = () =>
  (JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}') as { detailTab?: unknown }).detailTab;

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}
const viewChord = (n: number) =>
  press(String(n), { ctrlKey: true, altKey: true, code: `Digit${n}` });
const click = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLElement | null)?.click();
  });
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

beforeEach(() => {
  (window as unknown as { api: unknown }).api = {
    terminal: {
      read: vi.fn(async () => ({
        kind: 'ok',
        name: 'vam-alpha-a1b2c3',
        text: 'the screen',
        cursor: { kind: 'unreadable' },
      })),
      send: vi.fn(async () => 'sent'),
    },
    dialog: { chooseDirectory: async () => '/srv/work/orchard' },
  };
  // The previous run was left on Terminal; the classic renderer keeps the
  // Terminal view light enough to draw in a unit environment.
  localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({
      detailTab: 'Terminal',
      streamingTerminal: false,
      streamingTerminalMigrated: true,
    }),
  );
  setActiveStreamingTerminal(false);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(window, 'api');
  setActiveStreamingTerminal(true);
});

describe('a session vam creates opens on Response, whatever the last run left', () => {
  it('base line: an existing session still opens on the seed (precedence 3)', () => {
    const { source } = sourceWith();
    render(<Canvas model={modelWith(session('a1'))} source={source} />);
    expect(selectedView()).toBe('terminal');
  });

  it('(i) the pane’s new-tab route', async () => {
    const { source } = sourceWith();
    const view = render(<Canvas model={modelWith(session('a1'))} source={source} />);
    await click(document.querySelector('[data-tab-new]'));
    await act(async () => {
      view.rerender(<Canvas model={modelWith(session('a1'), session('a2'))} source={source} />);
    });
    expect(activeTab()).toBe('a2');
    expect(selectedView()).toBe('response');
    expect(storedTab()).toBe('Terminal');
  });

  it('(ii) the newSession chord (o)', async () => {
    const { source } = sourceWith();
    const view = render(<Canvas model={modelWith(session('a1'))} source={source} />);
    press('o');
    await act(async () => {
      view.rerender(<Canvas model={modelWith(session('a1'), session('a2'))} source={source} />);
    });
    await click(
      [...document.querySelectorAll('[data-tab-select]')].find((e) => e.textContent === 'a2') ??
        null,
    );
    expect(activeTab()).toBe('a2');
    expect(selectedView()).toBe('response');
    expect(storedTab()).toBe('Terminal');
  });

  it('(ii) the sidebar’s New session control', async () => {
    const { source } = sourceWith();
    const view = render(<Canvas model={modelWith(session('a1'))} source={source} />);
    await click(document.querySelector('[data-new-session-in-project="p1"]'));
    await act(async () => {
      view.rerender(<Canvas model={modelWith(session('a1'), session('a2'))} source={source} />);
    });
    await click(
      [...document.querySelectorAll('[data-tab-select]')].find((e) => e.textContent === 'a2') ??
        null,
    );
    expect(activeTab()).toBe('a2');
    expect(selectedView()).toBe('response');
    expect(storedTab()).toBe('Terminal');
  });

  it('(ii) New project, from the Projects header', async () => {
    const { source } = sourceWith();
    const view = render(<Canvas model={{ projects: [] }} source={source} />);
    await click(document.querySelector('[data-new-project]'));
    await act(async () => {
      view.rerender(<Canvas model={modelWith(session('a1'))} source={source} />);
    });
    expect(activeTab()).toBe('a1');
    expect(selectedView()).toBe('response');
    expect(storedTab()).toBe('Terminal');
  });
});

describe('a view the operator picks wins over vam’s choice', () => {
  it('(2) a new session switched to Terminal stays there across a round trip', async () => {
    const { source } = sourceWith();
    const view = render(<Canvas model={modelWith(session('a1'))} source={source} />);
    await click(document.querySelector('[data-tab-new]'));
    await act(async () => {
      view.rerender(<Canvas model={modelWith(session('a1'), session('a2'))} source={source} />);
    });
    expect(selectedView()).toBe('response');
    viewChord(3);
    expect(selectedView()).toBe('terminal');
    press('1', { metaKey: true, code: 'Digit1' });
    expect(activeTab()).toBe('a1');
    press('2', { metaKey: true, code: 'Digit2' });
    expect(activeTab()).toBe('a2');
    expect(selectedView()).toBe('terminal');
  });
});
