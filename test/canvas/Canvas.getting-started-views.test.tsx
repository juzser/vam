// @vitest-environment happy-dom

/** EVENT #21/#23: with no session visible the pane shows Get started, with no
 *  view switcher and silent view chords; a session or a sibling changes that. */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { clearEvents } from '../../src/renderer/errors/log.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

vi.setConfig({ testTimeout: 30_000 });

const sess = (id: string) =>
  ({
    id,
    title: id,
    status: 'done',
    branch: null,
    epic: null,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  }) as unknown as Session;
const modelOf = (...ids: string[]): CanvasModel => ({
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: ids.map(sess) }],
});
const NOTHING = modelOf();
const ONE = modelOf('a1');

/** `dismiss`: `closeSession` refuses `not-vam-started`, so a closed row is
 *  dismissed, leaving `entries` while staying in the unfiltered model. */
function makeSource(dismiss = false): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: { recordPrompt: true, closeSession: dismiss },
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

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const gettingStarted = () => q('[data-getting-started]');
const switcher = () => q('[data-view-overlay]') ?? q('nav[data-view-tabs]');
const selectedView = () => q('[data-view][aria-pressed="true"]')?.getAttribute('data-view') ?? null;
const statusText = () => q('[data-status-bar]')?.textContent ?? '';

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });
}
const viewChord = (n: number) =>
  press(String(n), { ctrlKey: true, altKey: true, code: `Digit${n}` });

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
beforeEach(clearEvents);
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function paletteViewEntry() {
  press('k', { metaKey: true });
  const input = q<HTMLInputElement>('[data-command-palette] input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '/View: PRs' } });
  const item = [...document.querySelectorAll('[cmdk-item]')].find((el) =>
    (el.textContent ?? '').includes('View: PRs'),
  );
  expect(item).toBeDefined();
  act(() => (item as HTMLElement).click());
}

const silent = (before: string) => {
  expect(gettingStarted()).not.toBeNull();
  expect(q('[data-view-note]')).toBeNull();
  expect(statusText()).toBe(before);
  expect(localStorage.getItem('vam.prefs.v1') ?? '').not.toContain('"detailTab"');
};

describe('Get started draws no view switcher and the view chords do nothing', () => {
  it.each([
    ['unseeded', {}],
    ['seeded to Terminal', { detailTab: 'Terminal' }],
  ])('the switcher is absent while Get started is on screen (%s)', (_name, prefs) => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
    render(<Canvas model={NOTHING} source={makeSource()} />);
    expect(gettingStarted()).not.toBeNull();
    expect(switcher()).toBeNull();
    expect(q('[data-view]')).toBeNull();
  });

  it.each([
    ['Ctrl-Alt-digit', () => [2, 1].forEach(viewChord)],
    ['a bare digit in Select mode', () => press('2', { code: 'Digit2' })],
    ['the palette’s view entry', paletteViewEntry],
  ])('%s changes nothing and says nothing', (_name, act1) => {
    render(<Canvas model={NOTHING} source={makeSource()} />);
    const before = statusText();
    act1();
    silent(before);
  });

  it('a digit typed into a focused text input still lands in it', () => {
    render(<Canvas model={NOTHING} source={makeSource()} />);
    const box = document.createElement('input');
    document.body.appendChild(box);
    box.focus();
    expect(fireEvent.keyDown(box, { key: '2', code: 'Digit2' })).toBe(true);
    box.remove();
  });

  it('once one own session is focused the switcher is back', () => {
    const source = makeSource();
    const view = render(<Canvas model={NOTHING} source={source} />);
    expect(switcher()).toBeNull();
    view.rerender(<Canvas model={ONE} source={source} />);
    expect(gettingStarted()).toBeNull();
    expect(switcher()).not.toBeNull();
    viewChord(2);
    expect(selectedView()).toBe('prs');
    viewChord(1);
    expect(selectedView()).toBe('response');
  });

  it('an empty split pane beside a session keeps the switcher and the chords', () => {
    render(<Canvas model={ONE} source={makeSource()} />);
    press('z');
    press('v');
    expect(document.querySelectorAll('[data-split-pane]').length).toBeGreaterThan(1);
    expect(gettingStarted()).toBeNull();
    expect(switcher()).not.toBeNull();
    viewChord(2);
    expect(selectedView()).toBe('prs');
  });
});

describe('the pane shows Get started once nothing is visible anywhere', () => {
  it.each([
    ['no projects and no sessions', { projects: [] }],
    ['projects, but no sessions', NOTHING],
  ])('%s', (_name, model) => {
    render(<Canvas model={model} />);
    expect(gettingStarted()).not.toBeNull();
  });

  it.each([
    [
      'the x key',
      () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })),
    ],
    ['its tab’s ×', () => q<HTMLButtonElement>('[data-tab-close]')?.click()],
  ])('the last open session is closed with %s', async (_name, close) => {
    render(<Canvas model={ONE} source={makeSource(true)} />);
    expect(gettingStarted()).toBeNull();
    await act(async () => close());
    expect(document.querySelectorAll('[data-session-row]')).toHaveLength(0);
    expect(gettingStarted()).not.toBeNull();
  });

  it('the source then reports the session gone', () => {
    const source = makeSource(true);
    const view = render(<Canvas model={ONE} source={source} />);
    view.rerender(<Canvas model={NOTHING} source={source} />);
    expect(gettingStarted()).not.toBeNull();
  });
});
