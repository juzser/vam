// @vitest-environment happy-dom

/**
 * THE DEMO'S OWN FOREIGN ROW SURVIVES `hideForeign`.
 *
 * `fixtures/demo.ts`'s `vam-build-1` is `vamControlled: false` on purpose --
 * "THE UNANSWERABLE HALF, drawn on purpose. vam did not start this session,
 * so no Submit is offered over the card at all" -- and a dozen guards under
 * `e2e/` read that row to test exactly that. Stage 1's new `hideForeign`
 * default (`session-filter.ts`) reads the SAME field, and reading it strictly
 * would take that row off the demo canvas the moment the default shipped --
 * caught for real by `e2e/split-panes-shots.mjs` and
 * `e2e/prompt-suggest-shots.mjs`, both of which timed out waiting for
 * `[data-session-row="vam-build-1"]` against the built bundle.
 *
 * `Canvas.tsx`'s `entries` memo carries the fix: `source.kind === 'demo'`
 * stands `isHiddenByForeignFilter` down, the same way `sendPromptFor`
 * already branches on the same `source.kind` a few hundred lines up. This
 * pins that a REAL (non-demo) session source gets no such exemption --
 * `hideForeign` narrows it exactly as `session-filter.foreign.test.ts`
 * already proves the predicate does.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource, SourceCapabilities } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const caps = (over: Partial<SourceCapabilities> = {}): SourceCapabilities => ({
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
  ...over,
});

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id,
  title: id,
  epic: null,
  branch: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  ...over,
});

const modelWith = (over: Partial<Session> = {}): CanvasModel => ({
  projects: [
    {
      id: 'claude-code:alpha',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('vam-build-1', { vamControlled: false, ...over })],
    },
  ],
});

const rows = () =>
  [...document.querySelectorAll('[data-session-row]')].map((el) =>
    el.getAttribute('data-session-row'),
  );

beforeAll(() => {
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

describe('a foreign session on the demo canvas', () => {
  it('is NOT hidden by the shipped hideForeign default', () => {
    render(<Canvas model={modelWith()} source={{ kind: 'demo', note: 'demo data' }} />);
    expect(rows()).toEqual(['vam-build-1']);
  });

  it('the same foreign session IS hidden on a real session source', () => {
    const sessionSource: SessionSource = {
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: caps(),
      declines: {},
      viewerScope: { kind: 'unscoped', warning: 'invented' },
      load: async () => modelWith().projects,
      members: [{ id: 'claude-code', label: 'Claude Code', capabilities: caps(), declines: {} }],
    };
    const source: CanvasSource = { kind: 'session', source: sessionSource, onWrote: () => {} };
    render(<Canvas model={modelWith()} source={source} />);
    expect(rows()).toEqual([]);
  });

  it('an operator-controlled row is never affected either way', () => {
    render(
      <Canvas
        model={modelWith({ vamControlled: true })}
        source={{ kind: 'demo', note: 'demo data' }}
      />,
    );
    expect(rows()).toEqual(['vam-build-1']);
  });
});
