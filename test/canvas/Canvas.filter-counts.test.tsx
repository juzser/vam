// @vitest-environment happy-dom

/**
 * THE FILTER POPOVER'S STATUS PILLS COUNT THE ROWS THE LIST WOULD DRAW.
 *
 * The operator's report (event #35): "the number of sessions in Filter does
 * not look right, especially the status part". The pills used to count every
 * entry by status, over a set the list never shows: sessions outside vam's
 * scope, dismissed, ended under hide-ended, idle under hide-idle, agent
 * worktrees, foreign, origin-hidden. `domain/session-view.ts`'s
 * `visibleSessions` is now the one pipeline both the list and the pills read.
 *
 * The fixture holds one session of each kind that pipeline removes, plus
 * ordinary running, waiting and done ones.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import {
  DEFAULT_SESSION_FILTERS,
  STATUS_FILTERS,
} from '../../src/renderer/domain/session-filter.js';
import type { SessionSource, SourceCapabilities } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const caps: SourceCapabilities = {
  liveUpdates: false,
  recordPrompt: false,
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
};

/** A real (non-demo) source, so the foreign rule applies. */
function realSource(): CanvasSource {
  const sessionSource: SessionSource = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: caps,
    declines: {},
    viewerScope: { kind: 'unscoped', warning: 'invented' },
    load: async () => [],
    members: [{ id: 'claude-code', label: 'Claude Code', capabilities: caps, declines: {} }],
  };
  return { kind: 'session', source: sessionSource, onWrote: () => {} };
}

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

function model(runBStatus: Session['status'] = 'running'): CanvasModel {
  return {
    projects: [
      {
        id: 'claude-code:alpha',
        name: 'alpha',
        source: 'claude-code',
        sessions: [
          session('run-a', { status: 'running' }),
          session('run-b', { status: runBStatus }),
          session('wait-a', { status: 'waiting' }),
          session('done-a'),
          session('done-b'),
          // Each one below is something the list never shows under All.
          session('ended-a', { ended: true }),
          session('idle-a', { status: 'idle' }),
          session('wt-a', { status: 'running', isAgentWorktree: true }),
          session('foreign-a', { vamControlled: false }),
          session('origin-a', { origin: { startedBy: 'agent', promptCount: 0 } }),
          session('dismissed-a'),
        ],
      },
      {
        id: 'claude-code:hidden',
        name: 'hidden',
        source: 'claude-code',
        sessions: [session('oos-a', { status: 'running' })],
      },
    ],
  };
}

const rowIds = () =>
  [...document.querySelectorAll('[data-session-row]')]
    .map((el) => el.getAttribute('data-session-row') ?? '')
    .sort();

const pill = (key: string) =>
  document.querySelector<HTMLButtonElement>(`[data-status-pill="${key}"]`);
const countOf = (key: string) =>
  Number(/(\d+)$/.exec(pill(key)?.textContent ?? '')?.[1] ?? Number.NaN);
const tallyNow = () => Object.fromEntries(STATUS_FILTERS.map(([key]) => [key, countOf(key)]));

function seedPrefs() {
  localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({
      filters: { ...DEFAULT_SESSION_FILTERS, hideIdle: true },
      hiddenProjects: { 'claude-code': ['claude-code:hidden'] },
      dismissedSessions: {
        'claude-code': { 'dismissed-a': { at: new Date().toISOString(), activity: null } },
      },
    }),
  );
}

function openPopover() {
  act(() => {
    fireEvent.click(document.querySelector('[data-filter-toggle]') as Element);
  });
}

function search(text: string) {
  act(() => {
    fireEvent.click(document.querySelector('[aria-label="search sessions"]') as Element);
  });
  const input = document.querySelector<HTMLInputElement>('[aria-label="filter sessions"]');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
      this: HTMLElement,
      v: string,
    ) => void;
    setter.call(input as HTMLInputElement, text);
    (input as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(key: string) {
  act(() => {
    fireEvent.click(pill(key) as Element);
  });
}

/** Per key: the pill's count, then the ids the list draws once it is clicked. */
function readEveryPill(): Record<string, { count: number; rows: string[] }> {
  const out: Record<string, { count: number; rows: string[] }> = {};
  for (const [key] of STATUS_FILTERS) {
    const count = countOf(key);
    click(key);
    out[key] = { count, rows: rowIds() };
  }
  return out;
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
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('EC-46 -- a pill count equals the rows the list draws for that pill', () => {
  it('pins the rows each pill lists (passes at base: the list itself did not change)', () => {
    seedPrefs();
    render(<Canvas model={model()} source={realSource()} />);
    openPopover();
    const read = readEveryPill();
    expect(read.all?.rows).toEqual(['done-a', 'done-b', 'run-a', 'run-b', 'wait-a']);
    expect(read.running?.rows).toEqual(['run-a', 'run-b']);
    expect(read.waiting?.rows).toEqual(['wait-a']);
    expect(read.done?.rows).toEqual(['done-a', 'done-b', 'ended-a']);
  });

  it('every pill reads exactly the number of rows its own selection draws', () => {
    seedPrefs();
    render(<Canvas model={model()} source={realSource()} />);
    openPopover();
    const read = readEveryPill();
    const mismatches = Object.entries(read)
      .filter(([, { count, rows }]) => count !== rows.length)
      .map(([key, { count, rows }]) => `${key}: pill ${count}, rows ${rows.length}`);
    expect(mismatches).toEqual([]);
  });

  it('holds with a text query entered, and the pins narrow with it', () => {
    seedPrefs();
    render(<Canvas model={model()} source={realSource()} />);
    openPopover();
    search('-a');
    // The popover stays open while the box is typed into.
    if (pill('all') === null) openPopover();
    const read = readEveryPill();
    expect(read.all?.rows).toEqual(['done-a', 'run-a', 'wait-a']);
    expect(read.running?.rows).toEqual(['run-a']);
    expect(read.waiting?.rows).toEqual(['wait-a']);
    expect(read.done?.rows).toEqual(['done-a', 'ended-a']);
    const mismatches = Object.entries(read)
      .filter(([, { count, rows }]) => count !== rows.length)
      .map(([key, { count, rows }]) => `${key}: pill ${count}, rows ${rows.length}`);
    expect(mismatches).toEqual([]);
  });

  it('no count depends on the selected pill: the whole tally is unchanged by clicking', () => {
    seedPrefs();
    render(<Canvas model={model()} source={realSource()} />);
    openPopover();
    const first = tallyNow();
    for (const [key] of STATUS_FILTERS) {
      click(key);
      expect(tallyNow()).toEqual(first);
    }
  });
});

describe('EC-47 -- the counts are live', () => {
  it('moving a session from running to done updates both pills in the same render', () => {
    seedPrefs();
    const view = render(<Canvas model={model('running')} source={realSource()} />);
    openPopover();
    const before = tallyNow();
    view.rerender(<Canvas model={model('done')} source={realSource()} />);
    const after = tallyNow();
    expect(after.running).toBe((before.running ?? 0) - 1);
    expect(after.done).toBe((before.done ?? 0) + 1);
  });
});
