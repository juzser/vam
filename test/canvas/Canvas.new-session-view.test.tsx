// @vitest-environment happy-dom

/** EVENT #22: a session vam creates opens on Response, not on the seeded
 *  `prefs.detailTab`, and never writes it; an operator's pick wins. */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas, START_PANE_WAIT_TIMEOUT_MS } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { setActiveStreamingTerminal } from '../../src/renderer/prefs/streaming-terminal.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

vi.setConfig({ testTimeout: 30_000 });

const session = (id: string, over: Partial<Session> = {}): Session =>
  ({ id, title: id, status: 'done', branch: null, decisions: [], ...over }) as Session;

const modelWith = (...sessions: Session[]): CanvasModel => ({
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }],
});

/** Offers a terminal (so a Terminal seed is a real view) and can create. */
function sourceWith(createSession: () => Promise<void> = async () => {}): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: { recordPrompt: true, deliverPrompt: true, createSession: true, terminal: true },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async () => {},
      createSession,
      createSessionIn: async () => {},
    },
  };
  return { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} };
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
const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement | null)?.click();
  });

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

const SCREEN = { kind: 'ok', name: 'x', text: '', cursor: { kind: 'unreadable' } };

beforeEach(() => {
  (window as unknown as { api: unknown }).api = {
    terminal: {
      read: vi.fn(async () => SCREEN),
    },
    dialog: { chooseDirectory: async () => '/srv/work/orchard' },
  };
  // Previous run left on Terminal; the classic renderer draws it lightly.
  const p = { detailTab: 'Terminal', streamingTerminal: false, streamingTerminalMigrated: true };
  localStorage.setItem('vam.prefs.v1', JSON.stringify(p));
  setActiveStreamingTerminal(false);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(window, 'api');
  setActiveStreamingTerminal(true);
});

const PANE = 'vam-alpha-aa11bb';
const OWN = { source: 'claude-code', pane: PANE } as const;
const unstarted = () =>
  session(`pane:${PANE}`, { ...OWN, status: 'unstarted', vamControlled: true });
const successor = () => session('a2', OWN);
const tabNamed = (name: string) =>
  [...document.querySelectorAll('[data-tab-select]')].find((e) =>
    (e.textContent ?? '').includes(name),
  ) ?? null;
const rerenderWith = (view: ReturnType<typeof render>, source: CanvasSource, ...s: Session[]) =>
  act(async () => {
    view.rerender(<Canvas model={modelWith(...s)} source={source} />);
  });
const A1 = session('a1');
const A2 = session('a2');
const trigger = (route: string) =>
  route === 'o' ? press('o') : click(document.querySelector(route));
/** Render `start` and create through `route`; nothing new has arrived yet. */
async function begin(route: string, start: Session[], source = sourceWith()) {
  const view = render(<Canvas model={modelWith(...start)} source={source} />);
  await trigger(route);
  return { source, view };
}
/** Render `start`, click `route`, then the source reports `next`. */
async function create(route: string, start: Session[], next: Session[]) {
  const { source, view } = await begin(route, start);
  await rerenderWith(view, source, ...next);
  return { source, view };
}
const waiting = () => document.querySelector('[data-pane-starting]') !== null;
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
const F1 = session('f1', { vamControlled: false });
const BOTH_ROUTES = [['o'], ['[data-tab-new]']];
const a2 = () => click(tabNamed('a2'));

describe('a session vam creates opens on Response, whatever the last run left', () => {
  it('base line: an existing session still opens on the seed (precedence 3)', () => {
    render(<Canvas model={modelWith(A1)} source={sourceWith()} />);
    expect(selectedView()).toBe('terminal');
  });

  it.each([
    ['the pane’s new-tab route', '[data-tab-new]', [A1], [A1, A2], 'a2', false],
    ['the newSession chord (o)', 'o', [A1], [A1, A2], 'a2', true],
    [
      'the sidebar’s New session control',
      '[data-new-session-in-project="p1"]',
      [A1],
      [A1, A2],
      'a2',
      true,
    ],
    ['New project, from the Projects header', '[data-new-project]', [], [A1], 'a1', false],
  ])('%s', async (_name, route, start, next, active, needsPick) => {
    await create(route, start, next);
    if (needsPick) await a2();
    expect(activeTab()).toBe(active);
    expect(selectedView()).toBe('response');
    expect(storedTab()).toBe('Terminal');
  });
});

describe('a view the operator picks wins over vam’s choice', () => {
  it('a new session switched to Terminal stays there across a round trip', async () => {
    await create('[data-tab-new]', [A1], [A1, A2]);
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

describe('a started row and its hand-over keep the Response view', () => {
  it('an unstarted row started through onStart lands on Response after hand-over', async () => {
    const source = sourceWith();
    const view = render(<Canvas model={modelWith(A1, unstarted())} source={source} />);
    await click(tabNamed(PANE));
    viewChord(1);
    expect(selectedView()).toBe('response');
    await click(document.querySelector('[data-start-session-button]'));
    await rerenderWith(view, source, A1, successor());
    await a2();
    expect(activeTab()).toBe('a2');
    expect(selectedView()).toBe('response');
  });

  it.each([
    ['inherits the new row’s Response record (renameTab path)', null, 'response'],
    ['travels with an operator pick on the new row', 3, 'terminal'],
  ])('the successor id %s', async (_name, pick, expected) => {
    const { source, view } = await create('[data-tab-new]', [A1], [A1, unstarted()]);
    expect(activeTab()).toContain(PANE);
    if (pick !== null) viewChord(pick);
    expect(selectedView()).toBe(expected);
    await rerenderWith(view, source, A1, successor());
    await a2();
    expect(activeTab()).toBe('a2');
    expect(selectedView()).toBe(expected);
  });
});

describe('the wait for vam’s own row', () => {
  it.each(BOTH_ROUTES)(
    'a foreign row arriving first neither ends the wait nor takes vam’s Response record (%s)',
    async (route) => {
      const prefs = {
        detailTab: 'Terminal',
        streamingTerminal: false,
        streamingTerminalMigrated: true,
      };
      localStorage.setItem(
        'vam.prefs.v1',
        JSON.stringify({ ...prefs, filters: { hideForeign: false } }),
      );
      const { source, view } = await begin(route, [A1]);
      await rerenderWith(view, source, A1, F1);
      expect(waiting()).toBe(true);
      expect(activeTab()).not.toBe('f1');
      await rerenderWith(view, source, A1, F1, A2);
      expect(waiting()).toBe(false);
      if (route === 'o') await a2();
      expect(activeTab()).toBe('a2');
      expect(selectedView()).toBe('response');
      expect(storedTab()).toBe('Terminal');
      await click(document.querySelector('[data-session-row="f1"]'));
      expect(activeTab()).toBe('f1');
      expect(selectedView()).toBe('terminal');
    },
  );

  it.each(BOTH_ROUTES)(
    'the wait ends at START_PANE_WAIT_TIMEOUT_MS when vam’s own row never arrives (%s)',
    async (route) => {
      vi.useFakeTimers();
      const { source, view } = await begin(route, [A1]);
      await advance(START_PANE_WAIT_TIMEOUT_MS - 1);
      expect(waiting()).toBe(true);
      await advance(1);
      expect(waiting()).toBe(false);
      await rerenderWith(view, source, A1, A2);
      expect(activeTab()).toBe('a1');
      await a2();
      expect(selectedView()).toBe('terminal');
      expect(storedTab()).toBe('Terminal');
    },
  );

  it.each(BOTH_ROUTES)(
    'a second create’s wait outlives the first create’s deadline (%s)',
    async (route) => {
      vi.useFakeTimers();
      const { source, view } = await begin(route, [A1]);
      await advance(START_PANE_WAIT_TIMEOUT_MS / 2);
      await trigger(route);
      await advance(START_PANE_WAIT_TIMEOUT_MS / 2 + 1);
      expect(waiting()).toBe(true);
      await rerenderWith(view, source, A1, A2);
      expect(waiting()).toBe(false);
      if (route === 'o') await a2();
      expect(activeTab()).toBe('a2');
      expect(selectedView()).toBe('response');
    },
  );

  it('a write slower than START_PANE_WAIT_TIMEOUT_MS never arms the pane’s pending tab', async () => {
    vi.useFakeTimers();
    let settle = () => {};
    const slow = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const { source, view } = await begin(
      '[data-tab-new]',
      [A1],
      sourceWith(() => slow),
    );
    await advance(START_PANE_WAIT_TIMEOUT_MS + 1);
    expect(waiting()).toBe(false);
    settle();
    await rerenderWith(view, source, A1, A2);
    expect(activeTab()).toBe('a1');
    await a2();
    expect(selectedView()).toBe('terminal');
  });
});
