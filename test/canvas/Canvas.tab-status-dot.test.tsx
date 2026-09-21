// @vitest-environment happy-dom

/**
 * Every tab reports its session's status, not just the one you are looking at.
 *
 * `TAB_STATUS_INK` was applied only when `active`, so three of its four
 * statuses could never be seen: the tab you are on is not the one that needs
 * to tell you something. The strip holds every session of the project, which
 * makes it the densest status surface in the app, and it reported nothing.
 *
 * The active tab keeps the ink so the two channels stay separable; every tab
 * REPORTS its status, on the tab element itself. What it DRAWS for it is the
 * subject of `Canvas.tab-indicators.test.tsx`: the dot this file was named
 * for is gone, a busy tab wears the sidebar's own mark and a resting one
 * wears nothing. The mark's paint -- its contrast against the dimmed
 * `opacity-85` treatment -- is measured in a real browser by
 * `e2e/tab-strip-shots.mjs`; pinned here is only that each tab carries its
 * own status, and that the ink stays the active tab's.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session, SessionStatus } from '../../src/renderer/domain/model.js';

function session(id: string, status: SessionStatus): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        session('a1', 'done'),
        session('a2', 'waiting'),
        session('a3', 'failed'),
        session('a4', 'running'),
      ],
    },
  ],
};

/** status by tab title, read off the tabs themselves. */
function statuses(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const tab of document.querySelectorAll('[data-session-tab]')) {
    const title = tab.querySelector('[data-tab-select]')?.textContent ?? '';
    out[title] = tab.getAttribute('data-tab-status');
  }
  return out;
}

afterEach(cleanup);

describe('the strip reports status on every tab', () => {
  it('marks the inactive tabs too, each with its own status', () => {
    render(<Canvas model={MODEL} />);
    expect(statuses()).toEqual({ a1: 'done', a2: 'waiting', a3: 'failed', a4: 'running' });
  });

  it('keeps the status ink reserved for the active tab', () => {
    render(<Canvas model={MODEL} />);
    const inked = [...document.querySelectorAll('[data-session-tab]')].filter((tab) =>
      (tab.querySelector('[data-tab-select]')?.className ?? '').includes('text-'),
    );
    expect(inked).toHaveLength(1);
    expect(inked[0]?.getAttribute('data-active')).toBe('true');
  });
});
