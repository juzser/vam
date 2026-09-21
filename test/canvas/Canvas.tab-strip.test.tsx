// @vitest-environment happy-dom

/**
 * The tab strip's own icon slot — now empty of the session icon — and
 * clicking a tab.
 *
 * 0.2 migration, step 2 routed the tab through the shared chain
 * (`resolveSessionGlyph`, pinned in isolation at
 * `test/panels/session-icon.test.ts`) so that a tab fell back to its
 * project's glyph the way the (now-deleted) canvas root node did — the two
 * surfaces disagreed the moment one carried a project icon and no session
 * icon of its own. The operator has since taken the slot away entirely: "put
 * the provider glyph after the indicator, on the tab name. Remove the session
 * icon from the tab."
 *
 * What this half of the file pins therefore TURNED OVER rather than
 * disappeared. The three cases it drove — no icon anywhere, a project icon
 * inherited, a session icon of its own — are exactly the three that must now
 * draw nothing, and together they are the cheapest proof that what was
 * removed is the CHAIN and not one link of it. The slot is not idle: the
 * provider glyph has it, as a SIBLING of the select button, which is asserted
 * here and measured in full in `Canvas.tab-indicators.test.tsx`.
 *
 * The second half relocates `Canvas.keyboard.test.tsx`'s "a canvas card is
 * clickable, and a click focuses that session": every session used to be a
 * clickable graph card, open or not, so clicking one was how you first
 * reached it. The tab strip only draws OPEN tabs — the sidebar row is now the
 * one way to reach a session that has no tab yet — so what a click on the
 * strip can still prove is narrower: it moves focus among tabs already open,
 * same as the graph card did for the cards it drew.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, icon: string | null = null): Session {
  return {
    id,
    title: id,
    icon,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const tabIcon = (id: string) =>
  document.querySelector(`[data-session-tab] [data-session-icon="${id}"]`);

const focusedTitle = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';
/** The tab strip's own select button for a session, found by its title —
 *  the button carries no id of its own, only the strip's `key`. */
const tabSelect = (title: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-tab-select]')].find(
    (el) => el.textContent === title,
  );
const activeTabs = () => [...document.querySelectorAll('[data-session-tab][data-active="true"]')];

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

afterEach(cleanup);

describe('the tab strip draws no session icon at all, whichever link of the chain has one', () => {
  it('shows nothing when neither the session nor its project has chosen a glyph', () => {
    const model: CanvasModel = {
      projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
    };
    render(<Canvas model={model} />);
    expect(tabIcon('a1')).toBeNull();
  });

  it('does not fall back to the project glyph — the link that used to be the loud one', () => {
    const model: CanvasModel = {
      projects: [
        { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')], icon: '🏭' },
      ],
    };
    render(<Canvas model={model} />);
    expect(tabIcon('a1')).toBeNull();
    expect(tabSelect('a1')?.textContent).toBe('a1');
  });

  it('does not draw the session’s own glyph either', () => {
    const model: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1', '🦊')],
          icon: '🏭',
        },
      ],
    };
    render(<Canvas model={model} />);
    expect(tabIcon('a1')).toBeNull();
    expect(tabSelect('a1')?.textContent).toBe('a1');
  });

  it('draws the provider glyph in that slot instead, outside the title button', () => {
    // The slot did not go quiet, it changed hands. Inside the button the
    // glyph would truncate with a long title; outside it, it cannot.
    const model: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1', '🦊')],
          icon: '🏭',
        },
      ],
    };
    render(<Canvas model={model} />);
    const tab = document.querySelector('[data-session-tab]');
    expect(tab?.querySelector('[data-tab-source]')?.getAttribute('data-tab-source')).toBe(
      'claude-code',
    );
    expect(tab?.querySelector('[data-tab-select] [data-tab-source]')).toBeNull();
  });
});

describe('clicking a tab moves focus to it', () => {
  const MODEL: CanvasModel = {
    projects: [
      { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
    ],
  };

  it('moves focus to the session whose tab was clicked', () => {
    render(<Canvas model={MODEL} />);
    // a1 is focused on mount; open a2's tab too by walking the sidebar to it.
    press('j');
    expect(focusedTitle()).toBe('a2');
    act(() => tabSelect('a1')?.click());
    expect(focusedTitle()).toBe('a1');
  });

  it('leaves exactly one tab active after a click, not two', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    act(() => tabSelect('a1')?.click());
    expect(activeTabs()).toHaveLength(1);
  });

  it('keeps the keyboard working after a click, from the clicked tab', () => {
    render(<Canvas model={MODEL} />);
    press('j'); // a2
    act(() => tabSelect('a1')?.click());
    expect(focusedTitle()).toBe('a1');
    // The sidebar cursor moved WITH the click, through the same
    // `setFocusedSessionId` every other focus change uses — not a second,
    // parallel notion of where the keyboard is.
    press('j');
    expect(focusedTitle()).toBe('a2');
  });
});
