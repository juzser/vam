// @vitest-environment happy-dom

/**
 * THE OPERATOR'S REPORT: "when I start a new project in a particular repo
 * while sessions of that repo are running elsewhere, the sidebar shows only
 * the session I just created, but the tab strip shows every session from the
 * other sources."
 *
 * Root cause: A11.1's adoption effect and `drawnPaneTabs` both read
 * `Canvas.tsx`'s `allEntries` -- the UNFILTERED set -- so a project's foreign
 * (`vamControlled: false`) and dismissed sessions got auto-adopted as tabs
 * and drawn in the strip the moment the project loaded, though `hideForeign`
 * (on by default) and the dismissal already kept both off the sidebar.
 * `Canvas.dismissed-foreign-count.test.tsx` pins the sidebar half of this;
 * this file pins the tab strip, which is what the operator actually saw.
 *
 * `Canvas`'s own default `source` prop is `READ_ONLY_SOURCE`
 * (`kind: 'demo'`), and the foreign filter carves the demo out on purpose
 * (`Canvas.demo-foreign.test.tsx`) -- so every case below passes an explicit
 * `kind: 'session'` source, the same minimal shape
 * `Canvas.dismissed-foreign-count.test.tsx` uses.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
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
  vamControlled: true,
  ...over,
});

/** One project: the session just started (vam's), one running outside vam
 *  entirely (foreign), and one the operator already dismissed. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'claude-code:blacksmith',
      name: 'blacksmith',
      source: 'claude-code',
      sessions: [
        session('vam-started', { title: 'vam-started' }),
        session('foreign-elsewhere', { title: 'foreign-elsewhere', vamControlled: false }),
        session('dismissed-row', { title: 'dismissed-row' }),
      ],
    },
  ],
};

/** `MODEL`'s one project, with a different session list -- spelled out
 *  rather than `{ ...MODEL.projects[0], sessions }`, which `noUncheckedIndexed
 *  Access` types as possibly `undefined`. */
function modelWith(sessions: readonly Session[]): CanvasModel {
  return {
    projects: [
      { id: 'claude-code:blacksmith', name: 'blacksmith', source: 'claude-code', sessions },
    ],
  };
}

function seed(prefs: Record<string, unknown>) {
  localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}

/** The exact shape `prefs.ts`'s `dismissedSessions` reads, pinned identically
 *  in `Canvas.dismissed-foreign-count.test.tsx`. */
function seedDismissed(source: string, sessionId: string) {
  seed({
    dismissedSessions: {
      [source]: { [sessionId]: { at: new Date().toISOString(), activity: null } },
    },
  });
}

const rowIds = () =>
  [...document.querySelectorAll('[data-session-row]')]
    .map((el) => el.getAttribute('data-session-row') ?? '')
    .sort();
const tabsIn = (paneEl: Element | null | undefined) =>
  [...(paneEl?.querySelectorAll('[data-tab-select]') ?? [])].map((el) => el.textContent);
const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);

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

describe('the tab strip shows exactly the sessions the sidebar shows for a project', () => {
  it('does not adopt a foreign or a dismissed session as a tab', () => {
    seedDismissed('claude-code', 'dismissed-row');
    render(<Canvas model={MODEL} source={realSource()} />);
    // The sidebar's own contract, pinned already by
    // `Canvas.dismissed-foreign-count.test.tsx` -- restated here as the
    // baseline this test compares the strip against.
    expect(rowIds()).toEqual(['vam-started']);
    expect(tabsIn(paneFor('pane-1'))).toEqual(['vam-started']);
  });

  it('with hideForeign off and nothing dismissed, the strip and the sidebar both show every row', () => {
    seed({ filters: { hideForeign: false } });
    render(<Canvas model={MODEL} source={realSource()} />);
    expect(rowIds().sort()).toEqual(['dismissed-row', 'foreign-elsewhere', 'vam-started'].sort());
    expect(tabsIn(paneFor('pane-1')).slice().sort()).toEqual(
      ['dismissed-row', 'foreign-elsewhere', 'vam-started'].sort(),
    );
  });

  it('a tab already open leaves when its session turns foreign at runtime', () => {
    const { rerender } = render(<Canvas model={MODEL} source={realSource()} />);
    // Start with nothing hidden -- both rows are tabs of the one pane.
    act(() => {
      rerender(
        <Canvas
          model={modelWith([
            session('vam-started', { title: 'vam-started' }),
            session('will-turn-foreign', { title: 'will-turn-foreign' }),
          ])}
          source={realSource()}
        />,
      );
    });
    expect(tabsIn(paneFor('pane-1'))).toEqual(['vam-started', 'will-turn-foreign']);
    // The same session, now positively reported as not vam's.
    act(() => {
      rerender(
        <Canvas
          model={modelWith([
            session('vam-started', { title: 'vam-started' }),
            session('will-turn-foreign', { title: 'will-turn-foreign', vamControlled: false }),
          ])}
          source={realSource()}
        />,
      );
    });
    expect(tabsIn(paneFor('pane-1'))).toEqual(['vam-started']);
  });
});
