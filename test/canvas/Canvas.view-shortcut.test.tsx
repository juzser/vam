// @vitest-environment happy-dom

/**
 * The view digits are answered by the CHORD MACHINE, and by nothing else.
 *
 * `Alt+<digit>` used to be a second `window` keydown listener inside
 * `DetailPanel.tsx`, deliberately outside the binding system. Promoting it to
 * a real `pickView` action moved the listener here — the canvas's own, the
 * one that already resolves every other chord — and DELETED the panel's,
 * rather than leaving two listeners on one keystroke.
 *
 * That deletion is what the first two cases below actually measure, and they
 * measure it the only way that cannot be faked: through the OVERRIDE. A
 * rebound digit must work at its new key, and an UNBOUND one must do nothing
 * at all. A surviving hard-wired listener passes neither — it would answer
 * `Alt-3` after the operator unbound it, which is precisely the "both answer
 * one keystroke" hole promotion was for.
 *
 * The rest is the contract the panel's listener held and this one inherits,
 * re-measured at its new home: the digit resolves BY NAME through
 * `tabForDigit` (A5.4/A15.6 — never by position in the drawn bar), a name
 * this source has withdrawn refuses ALOUD instead of falling through, a
 * digit past the last view says so, and anything that is not a bare
 * `Alt+<digit>` is left alone.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { NO_BINDINGS, setActiveBindings } from '../../src/renderer/keyboard/chords.js';

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
    decisions: [{ id: `d-${id}`, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] }],
  };
}

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

beforeEach(() => setActiveBindings(NO_BINDINGS));
afterEach(() => {
  setActiveBindings(NO_BINDINGS);
  cleanup();
});

function key(init: globalThis.KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
}

/** A bare `Alt+<digit>` — `code` is the physical key, which is what the
 *  grammar spells `Alt-<digit>` off. */
const altDigit = (digit: number, extra: globalThis.KeyboardEventInit = {}) =>
  key({ key: String(digit), code: `Digit${digit}`, ctrlKey: true, altKey: true, ...extra });

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pressed = (view: string) => q(`[data-view="${view}"]`)?.getAttribute('aria-pressed');
const note = () => q<HTMLElement>('[data-view-note]');

describe('the binding table is the ONLY route from a key to a view', () => {
  it('follows the operator to a rebound key, which a hard-wired listener could not', () => {
    render(<Canvas model={MODEL} />);
    // AFTER the render: `prefs.ts` hands the grammar the stored overrides on
    // every read, and mounting the canvas is a read, so seeding the
    // singleton first would be overwritten by the shell's own empty
    // preferences. This is also the real order — the operator rebinds in
    // settings, closes the overlay, and then presses the key.
    setActiveBindings({ 'pickView:2': ['q'] });
    key({ key: 'q' });
    expect(pressed('prs')).toBe('true');
  });

  it('goes SILENT when the digit is unbound — the panel keeps no listener of its own', () => {
    // The empty array is the honest spelling of "I unbound this". A second
    // listener matching `event.code` would answer anyway, and this is the
    // case that catches it.
    render(<Canvas model={MODEL} />);
    setActiveBindings({ 'pickView:2': [] });
    altDigit(2);
    expect(pressed('prs')).toBe('false');
    expect(pressed('response')).toBe('true');
  });
});

describe('the digit still names a view, and still refuses aloud', () => {
  it('Alt-2 opens PRs', () => {
    render(<Canvas model={MODEL} />);
    altDigit(2);
    expect(pressed('prs')).toBe('true');
    expect(note()).toBeNull();
  });

  /**
   * THE BUG A15.6 ABOLISHED, re-falsified at the new listener. This source
   * declares no terminal, so the bar reads Response · PRs · Agents and
   * Agents sits THIRD. `Alt-3` must still mean Terminal — the name digit 3
   * owns in `TABS`, always — and refuse, never slide onto whatever moved
   * into third place.
   */
  it('Alt-3 refuses by NAME once Terminal is withdrawn, never falling through to Agents', () => {
    render(<Canvas model={MODEL} />);
    expect(q('[data-view="terminal"]')).toBeNull();
    altDigit(3);
    expect(pressed('response')).toBe('true');
    expect(pressed('agents')).toBe('false');
    expect(note()?.getAttribute('role')).toBe('status');
    expect(note()?.textContent ?? '').toContain('Terminal');
  });

  it('Alt-4 still opens Agents — a surviving view keeps its own digit', () => {
    render(<Canvas model={MODEL} />);
    altDigit(4);
    expect(pressed('agents')).toBe('true');
    expect(note()).toBeNull();
  });

  /**
   * `Alt-5` now names Files (`TABS[4]`) — a real view this test's fixture
   * source does not offer (no `window.api.files` in a jsdom test), so it
   * refuses BY NAME, the same shape `Alt-3`/Terminal already does above, not
   * as "no view 5". `Alt-6` is what is actually past `TABS`' own length now.
   */
  it('Alt-5 refuses by NAME once Files is withdrawn, never landing on Response silently', () => {
    render(<Canvas model={MODEL} />);
    altDigit(5);
    expect(pressed('response')).toBe('true');
    expect(note()?.getAttribute('role')).toBe('status');
    expect(note()?.textContent ?? '').toContain('Files');
    /**
     * AND IT NAMES THE RIGHT REASON, which the name alone cannot tell apart.
     * Every other withdrawn view is a SOURCE capability, so the shared
     * wording is "this source has none" -- but no source declares a file
     * bridge and none ever will (`panels/tabs.ts`'s own header), so blaming
     * the source here would send the operator looking for a setting on a
     * thing that has no say in it. The bridge is the desktop app's.
     */
    expect(note()?.textContent ?? '').not.toContain('this source');
    expect(note()?.textContent ?? '').toContain('desktop app');
  });

  it('says how many views exist for a digit that names none, and moves nothing', () => {
    render(<Canvas model={MODEL} />);
    altDigit(6);
    expect(pressed('response')).toBe('true');
    expect(note()?.getAttribute('role')).toBe('status');
    expect(note()?.textContent ?? '').toContain('no view 6');
  });

  it('clears the refusal as soon as a press lands somewhere', () => {
    render(<Canvas model={MODEL} />);
    altDigit(3);
    expect(note()).not.toBeNull();
    altDigit(2);
    expect(pressed('prs')).toBe('true');
    expect(note()).toBeNull();
  });
});

describe('it claims one combination and declines the rest', () => {
  it('leaves a bare digit and a differently-modified one alone', () => {
    render(<Canvas model={MODEL} />);
    // The chord is exactly Ctrl+Option+<digit>. A bare digit is text, Cmd or
    // Shift on top of it is a different chord, and none of them may reach the
    // view bar. `{ ctrlKey: false }` alone is deliberately NOT in this list:
    // that is Option+<digit>, which the operator cancelled and which
    // `pick-view-binding.test.ts` asserts resolves to nothing on either
    // platform -- asserting it here as well would be asserting it through a
    // second layer for no extra information.
    for (const extra of [
      { ctrlKey: false, altKey: false },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      altDigit(2, extra);
    }
    expect(pressed('prs')).toBe('false');
    expect(pressed('response')).toBe('true');
  });

  /**
   * WHAT THE COMPOSER KEEPS, AND WHAT IT NO LONGER KEEPS -- and the second
   * half is a real change, recorded rather than discovered.
   *
   * It used to keep BOTH. The view row was a bare `Alt+<digit>`, and
   * `Canvas.tsx`'s typing guard lets a focused INPUT|TEXTAREA keep every key
   * that is not a Cmd/Ctrl chord, so the chord simply never reached the
   * grammar from inside the prompt box. That was an ACCIDENT OF THE MODIFIER
   * rather than a decision: nothing in this repo ever argued that a view must
   * not be switchable while writing a prompt, and the neighbouring digit row
   * is deliberately reachable there -- "the operator is in the prompt box,
   * which is where the reason to look at another tab comes from".
   *
   * The three-key chord the operator asked for carries Ctrl, so it passes that
   * guard and the two digit families now behave alike from inside the box.
   * vam cancels the keystroke's default the way it cancels every chord it
   * resolves, so nothing is typed into the prompt on the way.
   *
   * A BARE DIGIT IS STILL THE BOX'S, which is the half that must not move: it
   * is text, and typing `2` into a prompt has to stay typing.
   */
  it('takes the three-key chord in the composer, and leaves a typed digit alone', () => {
    render(<Canvas model={MODEL} />);
    const box = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(box, 'no composer to type into').not.toBeNull();
    const typeInBox = (modifiers: KeyboardEventInit) => {
      act(() => {
        box?.dispatchEvent(
          new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true, ...modifiers }),
        );
      });
    };
    typeInBox({});
    expect(pressed('response'), 'a typed digit switched a view').toBe('true');
    typeInBox({ ctrlKey: true, altKey: true });
    expect(pressed('prs'), 'the view chord did not fire from the composer').toBe('true');
    expect(note()).toBeNull();
  });

  it('still switches by click, which the promotion had no business changing', () => {
    render(<Canvas model={MODEL} />);
    fireEvent.click(q<HTMLButtonElement>('[data-view="agents"]') as HTMLButtonElement);
    expect(pressed('agents')).toBe('true');
  });
});
