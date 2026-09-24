// @vitest-environment happy-dom

/**
 * The session tab strip -- screen two's other axis. Which SESSION is shown,
 * not which facet of it (`ViewIcons` already answers that one).
 *
 * `MODEL` (`harness.ts`) already carries two sessions in one project --
 * `a1` waiting, `a2` done -- which is the common ">=2" case this strip is
 * built for. A one-session model is built locally, once, for the 0px case.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import { installPhoneGlobals, MODEL, phoneSource, rows, session } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function openSession(model: CanvasModel = MODEL): void {
  render(<Canvas model={model} source={phoneSource()} />);
  const row = rows()[0];
  if (row === undefined) throw new Error('no session row');
  act(() => {
    fireEvent.click(row);
  });
}

const ONE_SESSION: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', { title: 'nightly sweep', status: 'waiting' })],
    },
  ],
};

const tabs = () => [...document.querySelectorAll('[data-phone-session-tab]')];

describe('the session tab strip', () => {
  it('is not drawn at all for a project with one session', () => {
    openSession(ONE_SESSION);
    expect(document.querySelector('[data-phone-session-tabs]')).toBeNull();
  });

  it('is drawn for a project with two sessions, one tab per session', () => {
    openSession();
    expect(document.querySelector('[data-phone-session-tabs]')).not.toBeNull();
    expect(tabs()).toHaveLength(2);
  });

  it('marks the focused session with aria-pressed and a mark, not colour alone', () => {
    openSession();
    expect(tabs().map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(document.querySelectorAll('[data-phone-session-mark]')).toHaveLength(1);
    expect(tabs()[0]?.querySelector('[data-phone-session-mark]')).not.toBeNull();
  });

  it('switches the focused session on a tab tap, without a second history entry', () => {
    openSession();
    expect(document.querySelector('[data-prompt-target]')?.textContent).toBe('nightly sweep');
    act(() => {
      fireEvent.click(tabs()[1] as Element);
    });
    expect(document.querySelector('[data-prompt-target]')?.textContent).toBe('second thing');
    // A lateral tab switch is not an `openSession` push: one chevron tap (or
    // one back gesture) must still return to the list in one step.
    act(() => {
      fireEvent.click(document.querySelector('[data-phone-back]') as Element);
    });
    expect(document.querySelector('[data-phone-shell]')?.getAttribute('data-phone-shell')).toBe(
      'list',
    );
  });

  it('badges the waiting tab with a glyph, and says so in its label', () => {
    openSession();
    // `a1` is `waiting` in the shared fixture.
    const waitingTab = tabs()[0];
    expect(waitingTab?.getAttribute('aria-label')).toContain('waiting');
    expect(document.querySelector('[data-phone-session-waiting-badge]')).not.toBeNull();
    // Only the waiting tab carries the badge -- `a2` is `done`.
    expect(tabs()[1]?.querySelector('[data-phone-session-waiting-badge]')).toBeNull();
  });

  it('never uses a status token on a tab that is not that status', () => {
    openSession();
    const doneTab = tabs()[1] as HTMLElement;
    const dot = doneTab.querySelector('[data-phone-session-status]');
    expect(dot?.className).toContain('bg-done');
    expect(dot?.className).not.toContain('bg-waiting');
  });

  /**
   * THE TWO CONTROLS THAT USED TO BE PINNED BESIDE THE TABS, AND ARE NOT.
   *
   * A `+` and a `‹` sat fixed outside the scroller. Measured at 390px they
   * held 88px of the row, which left the chips 266px: the third chip was
   * always off screen and every name clipped at the 104px cap. Both duplicated
   * the list screen -- `+` called `sidebar.onAddInProject`, which IS the
   * list's per-project add, and `‹` unwound to that same list, only
   * pre-scrolled -- so a whole session tab was spent reaching two things one
   * tap on the back chevron already reaches. Cut on the operator's
   * instruction.
   *
   * ASSERTED AS AN ABSENCE HERE AND AS ROOM IN `e2e/phone-core-loop.pw.ts`,
   * where the third chip is measured on screen: this environment lays nothing
   * out, so it can say the controls are gone and not that the tabs got the
   * room.
   */
  it('pins nothing beside the tabs: the row is the scroller and the tabs', () => {
    openSession();
    expect(document.querySelector('[data-phone-session-add]'), 'the pinned +').toBeNull();
    expect(document.querySelector('[data-phone-session-expand]'), 'the pinned ‹').toBeNull();
    const strip = document.querySelector('[data-phone-session-tabs]');
    // Every button left in the strip is a tab. A control that came back
    // without a hook of its own would fail here rather than silently rejoin.
    const buttons = [...(strip?.querySelectorAll('button') ?? [])];
    expect(buttons.length).toBe(tabs().length);
    expect(buttons.every((b) => b.hasAttribute('data-phone-session-tab'))).toBe(true);
  });

  it('still leaves the list one tap away, by the route that always did it', () => {
    openSession();
    act(() => {
      fireEvent.click(document.querySelector('[data-phone-back]') as Element);
    });
    expect(document.querySelector('[data-phone-shell]')?.getAttribute('data-phone-shell')).toBe(
      'list',
    );
    expect(document.querySelector('[data-project-heading][data-project-id="p1"]')).not.toBeNull();
  });

  it('takes the tap on a 44 box and paints on a 30 skin, same as the view icons', () => {
    openSession();
    for (const tab of tabs()) {
      expect(tab.className).toContain('min-h-[44px]');
      const skin = tab.querySelector('[data-tap-skin]');
      expect(skin).not.toBeNull();
      expect(skin?.className).toContain('h-[30px]');
    }
  });
});
