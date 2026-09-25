// @vitest-environment happy-dom

/**
 * THE MERGE OF PR 457 ("Close never leaves an undismissable row behind")
 * WITH STAGE 1'S OWN `foreignHiddenCount`.
 *
 * Two rows can now be off the sidebar for two DIFFERENT, independent
 * reasons: `hideForeign` hides a row `vamControlled: false`, and a
 * dismissal (`prefs.dismissedSessions`) hides a row the operator asked to
 * stop seeing, regardless of ownership. `Canvas.tsx`'s `entries` memo must
 * apply both filters together (a dismissed foreign row must not reappear
 * because only one of the two rules fired), and its `foreignHiddenCount`
 * memo -- the number `SessionList.tsx`'s quiet line reports as "vam did not
 * start them" -- must not ALSO count a row that is off screen for the
 * dismissal reason: the status bar's own "N dismissed -- restore" control
 * already accounts for it, and counting it twice, under two different
 * explanations, would tell the operator two contradicting stories about the
 * same row.
 *
 * Two foreign rows, `hideForeign` at its shipped default (on): one
 * pre-seeded into `prefs.dismissedSessions`, one not. Both must be off the
 * sidebar; only the second may be attributed to "hidden because foreign".
 */

import { cleanup, render } from '@testing-library/react';
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

/**
 * `Canvas`'s OWN DEFAULT `source` PROP IS `READ_ONLY_SOURCE`, and
 * `READ_ONLY_SOURCE.kind` IS `'demo'` (`sources/source.ts`) -- the same carve
 * -out `Canvas.demo-foreign.test.tsx` pins. Rendering `<Canvas model={...} />`
 * with no `source` override would exempt every row here from `hideForeign`
 * for the wrong reason (the demo carve-out, not the thing this file is
 * actually testing), so every test below passes an explicit `kind: 'session'`
 * source -- the same minimal shape `Canvas.demo-foreign.test.tsx`'s own "the
 * same foreign session IS hidden on a real session source" case uses.
 */
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
  vamControlled: false,
  ...over,
});

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'claude-code:alpha',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        session('dismissed-and-foreign', { title: 'dismissed-and-foreign' }),
        session('still-foreign', { title: 'still-foreign' }),
      ],
    },
  ],
};

const rowIds = () =>
  [...document.querySelectorAll('[data-session-row]')]
    .map((el) => el.getAttribute('data-session-row') ?? '')
    .sort();

function seed(prefs: Record<string, unknown>) {
  localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}

/** The exact shape `prefs.ts`'s `dismissedSessions` reads: source -> row id
 *  -> `{at, activity}`, `activity: null` so `isSessionDismissed` never lifts
 *  it (a later `null` reading is silence, not news). */
function seedDismissed(source: string, sessionId: string) {
  seed({
    dismissedSessions: {
      [source]: { [sessionId]: { at: new Date().toISOString(), activity: null } },
    },
  });
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

describe('a dismissed row that is also foreign', () => {
  it('is off the sidebar for BOTH reasons -- dismissal does not need hideForeign, and vice versa', () => {
    seedDismissed('claude-code', 'dismissed-and-foreign');
    render(<Canvas model={MODEL} source={realSource()} />);
    expect(rowIds()).toEqual([]);
  });

  it('is not counted by the foreign-hidden quiet line -- the status bar already counts it', () => {
    seedDismissed('claude-code', 'dismissed-and-foreign');
    const { container } = render(<Canvas model={MODEL} source={realSource()} />);
    const notice = container.querySelector('[data-foreign-hidden-count]');
    // Only "still-foreign" -- the dismissed row must not inflate this to 2.
    expect(notice?.textContent).toContain('1 session hidden');
    expect(notice?.textContent).not.toContain('2 session');
  });

  it('with nothing dismissed, both rows count as foreign-hidden', () => {
    const { container } = render(<Canvas model={MODEL} source={realSource()} />);
    const notice = container.querySelector('[data-foreign-hidden-count]');
    expect(notice?.textContent).toContain('2 sessions hidden');
  });
});

/**
 * THE SAME COMPOSITION, ON THE OTHER AXIS. Dismissal must survive a listing
 * gap the same way it survives `hideForeign` above -- `entries`'s own comment
 * says so ("DISMISSED IS ALWAYS APPLIED, EVEN WHILE `vamListingGap` STANDS
 * THE OTHER TWO DOWN") -- so a row the operator explicitly dismissed must not
 * reappear just because tmux could not be read this poll.
 */
describe('a dismissed row, while a listing gap stands hideForeign/hideEnded down', () => {
  const GAP = { code: 'listing-unreadable', message: 'tmux rewrote its separators' } as const;
  const GAPPED_MODEL: CanvasModel = {
    projects: [
      {
        id: 'claude-code:alpha',
        name: 'alpha',
        source: 'claude-code',
        sessions: [
          session('dismissed-row', { title: 'dismissed-row', vamListingGap: GAP }),
          session('other-row', { title: 'other-row', vamListingGap: GAP }),
        ],
      },
    ],
  };

  it('stays off the sidebar -- a listing gap explains OTHER rows, not this operator decision', () => {
    seedDismissed('claude-code', 'dismissed-row');
    render(<Canvas model={GAPPED_MODEL} source={realSource()} />);
    expect(rowIds()).toEqual(['other-row']);
  });
});
