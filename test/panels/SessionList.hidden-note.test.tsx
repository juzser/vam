// @vitest-environment happy-dom

/**
 * THE SIDEBAR'S OWN QUIET LINE, ONCE IT CAN GO AWAY ON ITS OWN.
 *
 * `SessionList.test.tsx`'s own "the foreign-hidden quiet line" describe block
 * already proves the line's TEXT and its `Show` route for a given
 * `foreignHiddenCount`; this file is the operator's own follow-on ask, split
 * out for the reason `session-list-props.ts`'s header gives ("until a second
 * file needed a row to look at"): the note must not sit in the footer
 * forever once it has been seen -- it auto-hides after
 * `FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS`, pauses that clock while the operator is
 * actually on it, offers a Dismiss button for "now, not in eight seconds",
 * and — either way — stays quiet for that SAME `foreignHiddenCount` rather
 * than reappearing on the next poll. It reappears only once the count grows
 * past whatever it was last acknowledged at, and that watermark survives a
 * remount (a relaunch) via `prefs/foreign-hidden-note.ts`.
 *
 * FAKE TIMERS EVERYWHERE, even for cases that read as instantaneous: every
 * hide (auto or Dismiss) runs `FOREIGN_HIDDEN_NOTE_FADE_MS`'s own exit fade
 * before the note actually unmounts (`foreignNoteClosing` in
 * `SessionList.tsx`), so a real assertion has to get PAST that fade rather
 * than racing it. `vi.advanceTimersByTimeAsync`, not the sync
 * `advanceTimersByTime`: the fade's own timer is scheduled by a `useEffect`
 * that only runs once React flushes the state update the FIRST timer caused,
 * and only the async form drains that microtask between ticks.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS,
  FOREIGN_HIDDEN_NOTE_FADE_MS,
  SessionList,
} from '../../src/renderer/panels/SessionList.js';
import { readAcknowledgedForeignHiddenCount } from '../../src/renderer/prefs/foreign-hidden-note.js';
import { baseProps } from './session-list-props.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Past the note's own exit fade, so a test never reads the DOM mid-fade. */
const PAST_FADE = FOREIGN_HIDDEN_NOTE_FADE_MS + 100;

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe('the foreign-hidden note auto-hides and can be dismissed', () => {
  it('appears the moment the count is nonzero', () => {
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    expect(container.querySelector('[data-foreign-hidden]')).not.toBeNull();
  });

  it(`auto-hides ${FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS}ms after it appears`, async () => {
    vi.useFakeTimers();
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    expect(container.querySelector('[data-foreign-hidden]')).not.toBeNull();
    // Two separate ticks, not one: the first CROSSES the auto-hide boundary
    // and fires the acknowledge, which only THEN lets the exit-fade effect
    // schedule its own (real, fake-clocked) timer -- a single combined
    // advance ends before that freshly-registered timer gets a turn.
    await advance(FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS + 10);
    await advance(PAST_FADE);
    expect(container.querySelector('[data-foreign-hidden]')).toBeNull();
  });

  it('does not auto-hide before the constant has elapsed', async () => {
    vi.useFakeTimers();
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    await advance(FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS - 500);
    expect(container.querySelector('[data-foreign-hidden]')).not.toBeNull();
  });

  it('pauses the countdown while the pointer is over the note, and resumes on leave', async () => {
    vi.useFakeTimers();
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    const note = container.querySelector('[data-foreign-hidden]') as Element;

    // Most of the way through the window, then the pointer arrives.
    await advance(FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS - 500);
    fireEvent.mouseEnter(note);
    // Well past what the ORIGINAL countdown would have allowed, had it kept
    // running underneath the hover.
    await advance(FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS);
    expect(container.querySelector('[data-foreign-hidden]'), 'paused by the hover').not.toBeNull();

    // Leaving resumes the clock rather than restarting it: ~500ms was left
    // when the pointer arrived.
    fireEvent.mouseLeave(note);
    await advance(400);
    expect(
      container.querySelector('[data-foreign-hidden]'),
      'not yet the remainder',
    ).not.toBeNull();
    // Two ticks again, for the same reason as the plain auto-hide test: the
    // first crosses the remaining-200ms boundary and fires the acknowledge,
    // the second lets the exit fade it just scheduled actually run.
    await advance(200 + 10);
    await advance(PAST_FADE);
    expect(container.querySelector('[data-foreign-hidden]'), 'the remainder elapsed').toBeNull();
  });

  it('keeps focus inside the note from being timed out from under the operator', async () => {
    vi.useFakeTimers();
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    const dismiss = container.querySelector('[data-foreign-hidden-dismiss]') as HTMLElement;
    fireEvent.focus(dismiss);
    await advance(FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS + PAST_FADE);
    expect(container.querySelector('[data-foreign-hidden]'), 'focus paused it').not.toBeNull();
  });

  /**
   * HOVER AND FOCUS USED TO SHARE ONE PAUSE FLAG (cross-provider review
   * finding): both `onMouseEnter`/`onFocus` set it true and both
   * `onMouseLeave`/`onBlur` set it false, so leaving hover while focus was
   * STILL inside the note (the operator's pointer left after tabbing to
   * Dismiss, say) un-paused the clock out from under a still-focused control.
   * Hover and focus must be tracked separately and the countdown paused while
   * EITHER is active, not just whichever set the flag last.
   */
  it('stays paused when the mouse leaves but focus is still inside the note', async () => {
    vi.useFakeTimers();
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    const note = container.querySelector('[data-foreign-hidden]') as Element;
    const dismiss = container.querySelector('[data-foreign-hidden-dismiss]') as HTMLElement;

    fireEvent.mouseEnter(note);
    fireEvent.focus(dismiss);
    fireEvent.mouseLeave(note);
    // Two ticks, as elsewhere in this file: the first would CROSS the
    // auto-hide boundary and fire the acknowledge if the clock had actually
    // resumed on mouseLeave, the second would let the exit fade that fire
    // just scheduled actually finish and unmount. If focus is still correctly
    // holding the pause, NEITHER tick should move the note at all.
    await advance(FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS + 10);
    await advance(PAST_FADE);
    expect(
      container.querySelector('[data-foreign-hidden]'),
      'focus should still hold the pause after the pointer left',
    ).not.toBeNull();
  });

  it('Dismiss hides it right away, without waiting for the timer', async () => {
    vi.useFakeTimers();
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    fireEvent.click(container.querySelector('[data-foreign-hidden-dismiss]') as Element);
    // Nowhere NEAR the 8s auto-hide window -- only the short exit fade.
    await advance(PAST_FADE);
    expect(container.querySelector('[data-foreign-hidden]')).toBeNull();
  });

  it('carries an aria-label of "Dismiss"', () => {
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    const dismiss = container.querySelector('[data-foreign-hidden-dismiss]');
    expect(dismiss?.getAttribute('aria-label')).toBe('Dismiss');
  });

  it('records the acknowledged count on Dismiss, so a relaunch does not nag about it', () => {
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    fireEvent.click(container.querySelector('[data-foreign-hidden-dismiss]') as Element);
    expect(readAcknowledgedForeignHiddenCount()).toBe(2);
  });

  it('does not reappear on a later render at the SAME count', async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <SessionList {...baseProps([])} foreignHiddenCount={2} />,
    );
    fireEvent.click(container.querySelector('[data-foreign-hidden-dismiss]') as Element);
    await advance(PAST_FADE);
    expect(container.querySelector('[data-foreign-hidden]')).toBeNull();
    // A poll that comes back with the exact same workspace, re-rendering this
    // same mounted component -- not a fresh mount, not a fresh count.
    rerender(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    expect(container.querySelector('[data-foreign-hidden]')).toBeNull();
  });

  it('reappears once the count grows past what was dismissed', async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <SessionList {...baseProps([])} foreignHiddenCount={2} />,
    );
    fireEvent.click(container.querySelector('[data-foreign-hidden-dismiss]') as Element);
    await advance(PAST_FADE);
    expect(container.querySelector('[data-foreign-hidden]')).toBeNull();
    // A new foreign session joined the two already dismissed.
    rerender(<SessionList {...baseProps([])} foreignHiddenCount={3} />);
    const notice = container.querySelector('[data-foreign-hidden-count]');
    expect(notice?.textContent).toContain('3 sessions hidden');
  });

  it('does not reappear across a remount (a relaunch) at the same count', async () => {
    vi.useFakeTimers();
    const first = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    fireEvent.click(first.container.querySelector('[data-foreign-hidden-dismiss]') as Element);
    await advance(PAST_FADE);
    first.unmount();
    const second = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    expect(second.container.querySelector('[data-foreign-hidden]')).toBeNull();
  });

  /**
   * PHONE, TOO. The list screen draws this exact component -- `SessionList.
   * test.tsx`'s own "withdraws on a phone once the getting-started screen
   * owns this line" already proves the WITHDRAWAL half (an empty phone list
   * hands the sentence to `GettingStarted.tsx` instead); this is the other
   * half, `hasOwnSession: true` keeping `showGettingStarted` false the same
   * way a phone with at least one row of its own does, so the note (Dismiss
   * included) draws here rather than nowhere.
   */
  it('draws on the phone list screen too, once something of its own is on it', () => {
    const { container } = render(
      <SessionList {...baseProps([])} foreignHiddenCount={2} phone hasOwnSession />,
    );
    expect(container.querySelector('[data-foreign-hidden]')).not.toBeNull();
    const dismiss = container.querySelector('[data-foreign-hidden-dismiss]');
    expect(dismiss).not.toBeNull();
    // The SAME phone floor `Show` already wears — `vam-tap`, so
    // `.vam-phone .vam-tap`'s `min-height`/`min-width: 44px` wins over the
    // 26px square this button paints at on the desktop.
    expect(dismiss?.className).toContain('vam-tap');
  });

  /**
   * A BROWSER THAT REFUSES STORAGE MUST NOT TAKE THE SIDEBAR DOWN WITH IT --
   * `prefs/foreign-hidden-note.test.ts` already falsifies the module in
   * isolation; this is the same failure exercised through the real click, in
   * a real render, the way `remote-token.ts`'s callers are never tested in
   * isolation alone either.
   */
  it('does not crash when localStorage throws on Dismiss', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const { container } = render(<SessionList {...baseProps([])} foreignHiddenCount={2} />);
    expect(() =>
      fireEvent.click(container.querySelector('[data-foreign-hidden-dismiss]') as Element),
    ).not.toThrow();
    await advance(PAST_FADE);
    expect(container.querySelector('[data-foreign-hidden]')).toBeNull();
    vi.unstubAllGlobals();
  });
});
