// @vitest-environment happy-dom

/**
 * EVENT #23: the view switcher is meaningless on the Get started screen (no
 * session, so no views), so while the focused pane draws it the corner
 * switcher is not drawn and every view chord is a silent no-op. The moment a
 * session exists, or when an empty pane sits beside sessions, nothing changes.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

// Each case renders a whole canvas; a loaded machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 });

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
const ONE: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

function makeSource(): CanvasSource {
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
      terminal: false,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {} },
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
const bareDigit = (n: number) => press(String(n), { code: `Digit${n}` });

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

describe('Get started draws no view switcher and the view chords do nothing', () => {
  it('state 1: the switcher is absent while Get started is on screen', () => {
    render(<Canvas model={NOTHING} source={makeSource()} />);
    expect(gettingStarted()).not.toBeNull();
    expect(switcher()).toBeNull();
    expect(q('[data-view]')).toBeNull();
  });

  it('state 1: Ctrl-Alt-digit changes nothing and says nothing', () => {
    render(<Canvas model={NOTHING} source={makeSource()} />);
    const before = statusText();
    viewChord(2);
    viewChord(1);
    expect(gettingStarted()).not.toBeNull();
    expect(q('[data-view-note]')).toBeNull();
    expect(statusText()).toBe(before);
    expect(localStorage.getItem('vam.prefs.v1') ?? '').not.toContain('"detailTab"');
  });

  it('state 1: a bare digit in Select mode changes nothing and says nothing', () => {
    render(<Canvas model={NOTHING} source={makeSource()} />);
    const before = statusText();
    bareDigit(2);
    expect(q('[data-view-note]')).toBeNull();
    expect(statusText()).toBe(before);
    expect(localStorage.getItem('vam.prefs.v1') ?? '').not.toContain('"detailTab"');
  });

  it('state 1: the palette’s view entry is a silent no-op', () => {
    render(<Canvas model={NOTHING} source={makeSource()} />);
    press('k', { metaKey: true });
    const input = q<HTMLInputElement>('[data-command-palette] input');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { value: '/View: PRs' } });
    const item = [...document.querySelectorAll('[cmdk-item]')].find((el) =>
      (el.textContent ?? '').includes('View: PRs'),
    );
    if (item !== undefined) act(() => (item as HTMLElement).click());
    expect(q('[data-view-note]')).toBeNull();
    expect(localStorage.getItem('vam.prefs.v1') ?? '').not.toContain('"detailTab"');
  });

  it('state 1: a digit typed into a focused text input still lands in it', () => {
    render(<Canvas model={NOTHING} source={makeSource()} />);
    const box = document.createElement('input');
    document.body.appendChild(box);
    box.focus();
    const event = new KeyboardEvent('keydown', {
      key: '2',
      code: 'Digit2',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      box.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    box.remove();
  });

  it('state 2 (boundary): once one own session is focused the switcher is back', () => {
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

  it('state 3: an empty split pane beside a session keeps the switcher and the chords', () => {
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
