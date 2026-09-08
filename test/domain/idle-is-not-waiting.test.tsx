// @vitest-environment happy-dom

/**
 * `idle` is its own status, and the amber is spent only on a real demand.
 *
 * The CLI's interactive row carries `status: 'busy' | 'idle' | 'waiting'`, and
 * vam folded the last two together: everything that was not `busy` became
 * `waiting`. Measured against the real CLI on a working machine, `idle` was
 * three of five interactive rows -- so the sidebar's loud "needs you" count,
 * the tab dots and the phone list were all reporting a demand for every
 * session the operator had simply finished with. A signal that cries wolf is
 * worse than no signal, and this file is what stops the fold coming back.
 *
 * What is pinned here is the SEPARATION, on every surface a status is drawn:
 * an idle session is never counted as waiting, never painted in the waiting
 * amber, and never confused with `done` -- which means a background job that
 * ENDED, not a live session sitting there ready for the next thing.
 */

import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session, SessionStatus } from '../../src/renderer/domain/model.js';
import { orderedInProject, waitingCount } from '../../src/renderer/domain/selectors.js';
import { PALETTE_TOKENS } from '../../src/renderer/prefs/prefs.js';

function session(id: string, status: SessionStatus): Session {
  return {
    id,
    title: id,
    icon: null,
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
        session('a1', 'waiting'),
        session('a2', 'idle'),
        session('a3', 'idle'),
        session('a4', 'done'),
      ],
    },
  ],
};

const tabs = () => [...document.querySelectorAll('[data-session-tab]')];
const titleOf = (tab: Element) => tab.querySelector('[data-tab-select]')?.textContent ?? '';
const dotOf = (id: string) =>
  tabs()
    .find((tab) => titleOf(tab) === id)
    ?.querySelector('[data-tab-status]') ?? null;

afterEach(cleanup);

describe('idle is not waiting', () => {
  it('leaves the "N need you" count to the sessions that actually need you', () => {
    expect(waitingCount(MODEL)).toBe(1);
  });

  it('gives every tab its own status, with idle distinct from both waiting and done', () => {
    render(<Canvas model={MODEL} />);
    const marks = Object.fromEntries(
      tabs().map((tab) => [
        titleOf(tab),
        tab.querySelector('[data-tab-status]')?.getAttribute('data-tab-status') ?? null,
      ]),
    );
    expect(marks).toEqual({ a1: 'waiting', a2: 'idle', a3: 'idle', a4: 'done' });
  });

  it('paints the idle tab dot in the idle token, never the waiting amber and never done', () => {
    render(<Canvas model={MODEL} />);
    const idle = dotOf('a2')?.className ?? '';
    expect(idle).toContain('bg-idle');
    expect(idle).not.toContain('bg-waiting');
    expect(idle).not.toContain('bg-done');
    expect(dotOf('a1')?.className ?? '').toContain('bg-waiting');
  });

  it('paints the sidebar row dot in the idle token too', () => {
    render(<Canvas model={MODEL} />);
    const row = document.querySelector('[data-session-row="a2"]')?.innerHTML ?? '';
    expect(row).toContain('bg-idle');
    expect(row).not.toContain('bg-waiting');
  });

  it('ranks an idle session below what is working and ABOVE what is over -- it is the last rung you can still type into', () => {
    const project = {
      id: 'p2',
      name: 'beta',
      source: 'claude-code',
      sessions: [
        session('b-done', 'done'),
        session('b-failed', 'failed'),
        session('b-idle', 'idle'),
        session('b-running', 'running'),
        session('b-waiting', 'waiting'),
      ],
    };
    expect(orderedInProject(project).map((s) => s.id)).toEqual([
      'b-waiting',
      'b-running',
      'b-idle',
      'b-done',
      'b-failed',
    ]);
  });

  it('offers the idle colour to the theme picker, like every other status', () => {
    expect(PALETTE_TOKENS.map((entry) => entry.token)).toContain('--vam-idle');
  });

  it('defines the idle token in BOTH themes -- an unset one falls through to the other half of the stylesheet', () => {
    const css = readFileSync('src/renderer/styles.css', 'utf8');
    expect(css.match(/--vam-idle:\s*#[0-9a-f]{6}/gi) ?? []).toHaveLength(2);
    expect(css).toContain('--color-idle: var(--vam-idle)');
  });
});
