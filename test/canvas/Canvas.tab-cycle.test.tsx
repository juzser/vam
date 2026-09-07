// @vitest-environment happy-dom

/**
 * `h`/`l` re-homed: previous/next open tab, wrapping.
 *
 * 0.2 migration, step 2: the graph is gone, and with it the spatial walk
 * `h`/`l` used to keep along a session's own row of cards (`nextNode`,
 * `keyboard/spatial-nav.ts`). The deletion and this re-homing landed in the
 * same commit — `nextNode`'s only caller was this branch — to the exact
 * spec: previous/next SESSION TAB, Select mode only, wrapping at both ends
 * (unlike `j`/`k`, which stop dead at the ends of the sidebar's own list —
 * see `Canvas.keyboard.test.tsx`'s "walking the sidebar with j and k").
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
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
      sessions: [session('a1'), session('a2'), session('a3')],
    },
  ],
};

const focusedTitle = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';
const promptInput = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

afterEach(cleanup);

describe('h and l walk the open tabs, not the sidebar', () => {
  it('wraps from the last open tab back to the first with l', () => {
    render(<Canvas model={MODEL} />);
    // a1 is focused (and its tab opened) on mount; j opens a2 then a3 the same
    // way — each landing opens a tab, per the "opening a session opens a tab"
    // effect — so the open set is [a1, a2, a3] in that order.
    press('j');
    press('j');
    expect(focusedTitle()).toBe('a3');
    press('l');
    expect(focusedTitle()).toBe('a1');
  });

  it('wraps from the first open tab back to the last with h', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    press('j');
    expect(focusedTitle()).toBe('a3');
    press('l'); // to a1, the wrap the test above pins
    expect(focusedTitle()).toBe('a1');
    press('h');
    expect(focusedTitle()).toBe('a3');
  });

  it('steps to the middle tab without wrapping when there is room', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    press('j');
    press('h');
    expect(focusedTitle()).toBe('a2');
  });

  // No test for the `openTabs.length === 0` branch inside this case: the
  // shared "land on the first survivor" guard just above it already returns
  // for every focusedSessionId/sessionIds combination that would produce an
  // empty `openTabs` here, because the "opening a session opens a tab"
  // effect keeps them in lockstep -- reaching this branch would need
  // `focusedSessionId` to be a live session with no open tab, which the
  // coupling above never produces. Defensive, not dead: a future change to
  // that coupling is exactly what would make it reachable.

  it('leaves l alone in Insert mode — the pane cursor owns it there', () => {
    render(<Canvas model={MODEL} />);
    press('j'); // a2
    press('I'); // into the response pane
    const before = focusedTitle();
    press('l');
    // Insert's `l` branch returns without touching tab focus, so the sidebar
    // cursor — what the tab strip's active id also mirrors — does not move.
    expect(focusedTitle()).toBe(before);
    expect(promptInput()).not.toBeNull();
  });
});

describe('l reads a fresh tab list, not a closure captured before the model changed', () => {
  /**
   * 0.2 migration, A13.1: `openTabs` (an owned, persisted set with its own
   * lightweight `×`) is gone — every session in the active project is
   * always a tab, a pure projection of `entries`. There is no longer a
   * cheap way to shrink the tab ring without a real session ending, so the
   * trigger this test uses is the realistic one: a poll bringing back a
   * narrower model, exactly what a session ending between two keystrokes
   * looks like from this file's own vantage point. The property under test
   * is unchanged — `l`'s `onKeyDown` effect must read the CURRENT
   * `projectTabIds`, not one captured when the listener was attached.
   */
  it('does not wrap onto a session the model no longer reports', () => {
    const { rerender } = render(<Canvas model={MODEL} />);
    press('j'); // a2
    press('j'); // a3
    press('k'); // back to a2, tab ring still [a1, a2, a3]
    expect(focusedTitle()).toBe('a2');

    // a3 ends between two keystrokes -- every other dependency the keydown
    // effect reads (`focusedSessionId`, `sessionIds`, `mode`, ...) is
    // otherwise unchanged. If the effect's listener still closes over the
    // 3-tab ring from BEFORE this poll, `l` from a2 wraps to a3 -- a
    // session that is no longer there. Fresh, it wraps against the real
    // 2-tab ring and lands on a1.
    const NARROWED: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1'), session('a2')],
        },
      ],
    };
    rerender(<Canvas model={NARROWED} />);

    press('l');
    expect(focusedTitle()).toBe('a1');
  });
});
