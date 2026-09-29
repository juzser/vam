// @vitest-environment happy-dom

// The notifier speaks only for vam's scope; (d)-(k) pin what is NOT in the gate.

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { DEFAULT_SESSION_FILTERS } from '../../src/renderer/domain/session-filter.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const GAP = { code: 'listing-unreadable', message: 'tmux unreadable' } as const;
const CAPS = new Proxy({}, { get: () => false });
const real: CanvasSource = {
  kind: 'session',
  onWrote: () => {},
  source: {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: CAPS,
    declines: {},
    viewerScope: { kind: 'unscoped', warning: 'x' },
    load: async () => [],
    members: [{ id: 'claude-code', label: 'CC', capabilities: CAPS, declines: {} }],
  } as unknown as SessionSource,
};

const s = (id: string, over: Partial<Session> = {}): Session => ({
  id,
  title: id,
  epic: null,
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  ...over,
});
const foreign = (id: string, over: Partial<Session> = {}) =>
  s(id, { vamControlled: false, ...over });
const model = (sessions: Session[], id = 'claude-code:alpha'): CanvasModel => ({
  projects: [{ id, name: 'alpha', source: 'claude-code', sessions }],
});
const waiting = { status: 'waiting' } as const;
const show = vi.fn().mockResolvedValue(true);
const close = vi.fn().mockResolvedValue(undefined);
const shown = () => show.mock.calls.map((c) => (c[0] as { sessionId: string }).sessionId);
const store = (prefs: object) => localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
const filters = (over: object) => store({ filters: { ...DEFAULT_SESSION_FILTERS, ...over } });

function poll(source: CanvasSource, ...models: CanvasModel[]) {
  const view = render(<Canvas source={source} model={models[0] as CanvasModel} />);
  for (const m of models.slice(1)) view.rerender(<Canvas source={source} model={m} />);
  return view;
}

beforeAll(() => {
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
});
beforeEach(() => {
  show.mockClear();
  close.mockClear();
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  (window as unknown as { api: unknown }).api = {
    notify: { show, close, test: vi.fn(), onActivated: () => () => {} },
  };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  (window as unknown as { api?: unknown }).api = undefined;
});

describe('outside vam scope: silent', () => {
  it('(a) a foreign crossing is silent while an owned one in the same rerender notifies', () => {
    poll(real, model([s('own'), foreign('f')]), model([s('own', waiting), foreign('f', waiting)]));
    expect(shown()).toEqual(['own']);
  });
  it('(b) a hidden-project session and a dismissed session are silent', () => {
    store({
      hiddenProjects: { 'claude-code': ['claude-code:gone'] },
      dismissedSessions: { 'claude-code': { dis: { at: 'now', activity: null } } },
    });
    const both = (over: Partial<Session>): CanvasModel => ({
      projects: [
        ...model([s('hid', over)], 'claude-code:gone').projects,
        ...model([s('dis', over), s('own', over)]).projects,
      ],
    });
    poll(real, both({}), both(waiting));
    expect(shown()).toEqual(['own']);
  });
  it('(c) a session that drops out of scope gets its banner closed', () => {
    const f = (over: Partial<Session>) => model([foreign('f', over)]);
    const view = poll(real, f({ vamListingGap: GAP }), f({ vamListingGap: GAP, ...waiting }));
    expect(shown()).toEqual(['f']);
    view.rerender(<Canvas source={real} model={f(waiting)} />);
    expect(close).toHaveBeenCalledWith({ sourceId: 'claude-code', sessionId: 'f' });
  });
});

describe('in scope, or deliberately not gated: notifies', () => {
  it('(d) a foreign crossing notifies with hideForeign off', () => {
    filters({ hideForeign: false });
    poll(real, model([foreign('f')]), model([foreign('f', waiting)]));
    expect(shown()).toEqual(['f']);
  });
  it('(e) in a listing gap the foreign rule stands down; rows waiting at gap open do not burst', () => {
    const m = (b: Session['status'], gap: boolean) =>
      model(
        ['old', 'new'].map((id) =>
          foreign(id, {
            status: id === 'old' ? 'waiting' : b,
            ...(gap ? { vamListingGap: GAP } : {}),
          }),
        ),
      );
    poll(real, m('running', false), m('running', true));
    expect(show).not.toHaveBeenCalled();
    cleanup();
    poll(real, m('running', true), m('waiting', true));
    expect(shown()).toEqual(['new']);
  });
  it('(f) in the demo a foreign crossing notifies', () => {
    poll(
      { kind: 'demo', note: 'demo data' },
      model([foreign('f')]),
      model([foreign('f', waiting)]),
    );
    expect(shown()).toEqual(['f']);
  });
  it.each([
    ['(g) hideEnded', {}, { ended: true }],
    ['(h) hideIdle', { hideIdle: true }, {}],
    ['(i) hideAgentWorktrees', { hideAgentWorktrees: true }, { isAgentWorktree: true }],
    ['(j) hideAgentStarted/onlyPrompted', { hideAgentStarted: true, onlyPrompted: true }, {}],
  ])('%s is not in the gate', (_name, f, over) => {
    filters(f);
    const from = _name.includes('hideIdle') ? 'idle' : 'running';
    poll(
      real,
      model([s('x', { ...over, status: from })]),
      model([s('x', { ...over, ...waiting })]),
    );
    expect(shown()).toEqual(['x']);
  });
  it('(k) a status pill that hides the row does not suppress the notification', () => {
    const view = poll(real, model([s('q')]));
    fireEvent.click(document.querySelector('[data-filter-toggle]') as HTMLButtonElement);
    fireEvent.click(document.querySelector('[data-status-pill="done"]') as HTMLButtonElement);
    expect(document.querySelector('[data-session-row="q"]')).toBeNull();
    view.rerender(<Canvas source={real} model={model([s('q', waiting)])} />);
    expect(shown()).toEqual(['q']);
  });
  it('(l) a text query that hides the row does not suppress the notification', () => {
    const view = poll(real, model([s('q')]));
    fireEvent.keyDown(document.body, { key: '/' });
    const box = document.querySelector<HTMLInputElement>('input[placeholder="Search sessions"]');
    expect(box).not.toBeNull();
    fireEvent.change(box as HTMLInputElement, { target: { value: 'zzz-no-match' } });
    expect(document.querySelector('[data-session-row="q"]')).toBeNull();
    view.rerender(<Canvas source={real} model={model([s('q', waiting)])} />);
    expect(shown()).toEqual(['q']);
  });
});
