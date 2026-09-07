// @vitest-environment happy-dom

/**
 * The tab strip's own icon slot, and clicking a tab.
 *
 * 0.2 migration, step 2: `TabStrip` used to read `entry.session.icon` alone,
 * so a tab never fell back to its project's glyph the way the (now-deleted)
 * canvas root node already did — the two surfaces disagreed the moment one
 * carried a project icon and no session icon of its own. Routing the tab
 * through the shared chain (`resolveSessionGlyph`, pinned in isolation at
 * `test/panels/session-icon.test.ts`) fixes that disagreement; this file pins
 * the chain actually being live at the one surface that draws it now.
 *
 * Deliberately not the module's own `Monitor` placeholder: a tab nobody has
 * picked an icon for draws nothing rather than a mark every unpicked tab
 * would share.
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

const focusedTitle = () => document.querySelector('[data-prompt-target]')?.textContent ?? '';
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

describe('the tab strip draws the fallback chain, not the bare session field', () => {
  it('shows nothing when neither the session nor its project has chosen a glyph', () => {
    const model: CanvasModel = {
      projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
    };
    render(<Canvas model={model} />);
    expect(tabIcon('a1')).toBeNull();
  });

  it('falls back to the project glyph when the session has none of its own', () => {
    const model: CanvasModel = {
      projects: [
        { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')], icon: '🏭' },
      ],
    };
    render(<Canvas model={model} />);
    expect(tabIcon('a1')?.textContent).toBe('🏭');
  });

  it('prefers the session’s own glyph over its project’s', () => {
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
    expect(tabIcon('a1')?.textContent).toBe('🦊');
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
