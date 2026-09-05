// @vitest-environment happy-dom

/**
 * Screen two: the step rail, the output, and the two limits that must read as
 * stated rather than as broken controls.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { VISIBLE_DECISION_COUNT } from '../../src/renderer/domain/selectors.js';
import { chips, FIVE_STEPS, installPhoneGlobals, MODEL, phoneSource, rows } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Screen two, opened the only way it can be: by tapping a row. */
function openSession(): void {
  render(<Canvas model={MODEL} source={phoneSource()} />);
  const row = rows()[0];
  if (row === undefined) throw new Error('no session row');
  act(() => {
    fireEvent.click(row);
  });
}

describe('the phone session screen', () => {
  it('draws one chip per decision, not the three a grid cell holds', () => {
    openSession();
    expect(FIVE_STEPS.length).toBeGreaterThan(VISIBLE_DECISION_COUNT);
    expect(chips()).toHaveLength(FIVE_STEPS.length);
    // Oldest first, so the numbers on the chips are the numbers STEP n/N counts.
    expect(chips()[0]?.textContent).toContain('researcher');
    expect(document.querySelector('[data-step-rail]')?.textContent).toContain(
      `STEP ${FIVE_STEPS.length}/${FIVE_STEPS.length}`,
    );
  });

  it('opens on the newest step, and a tap moves to another one', () => {
    openSession();
    const pane = () => document.querySelector('[data-action-pane]')?.textContent ?? '';
    expect(pane()).toContain('the gate said yes');

    const first = chips()[0];
    if (first === undefined) throw new Error('no chip');
    act(() => {
      fireEvent.click(first);
    });
    expect(pane()).toContain('the researcher read');
    // `aria-current`, not `aria-selected`: these are buttons moving a position
    // in a chain, and the region they change is no `tabpanel` of theirs.
    expect(first.getAttribute('aria-current')).toBe('step');
    expect(first.getAttribute('role')).toBeNull();
  });

  it('opens on the newest step again after a chevron and a second tap', () => {
    openSession();
    const first = chips()[0];
    if (first === undefined) throw new Error('no chip');
    act(() => {
      fireEvent.click(first);
    });
    expect(document.querySelector('[data-step-rail]')?.textContent).toContain('STEP 1/5');

    act(() => {
      fireEvent.click(document.querySelector('[data-phone-back]') as Element);
    });
    const row = rows()[0];
    act(() => {
      fireEvent.click(row as Element);
    });
    // Leaving the screen does not move `focusedId`, so a reset keyed on the
    // session id would never fire for the session you just left.
    expect(document.querySelector('[data-step-rail]')?.textContent).toContain('STEP 5/5');
    expect(document.querySelector('[data-action-pane]')?.textContent).toContain(
      'the gate said yes',
    );
  });

  it('withdraws the Terminal tab structurally, rather than showing it disabled', () => {
    openSession();
    const tabs = [...document.querySelectorAll('[data-tab]')].map((t) => t.textContent);
    expect(tabs.some((t) => t?.includes('Terminal'))).toBe(false);
    expect(tabs.some((t) => t?.includes('Response'))).toBe(true);
  });

  it('draws the composer and no mode row', () => {
    openSession();
    expect(document.querySelector('[data-prompt-record]')).not.toBeNull();
    expect(document.querySelector('[data-mode-row]')).toBeNull();
  });

  it('carries closing a session where it can be seen, and only there', async () => {
    const closed: string[] = [];
    render(
      <Canvas
        model={MODEL}
        source={phoneSource({
          closeSession: async (id) => {
            closed.push(id);
          },
        })}
      />,
    );
    act(() => {
      fireEvent.click(rows()[0] as Element);
    });
    const control = document.querySelector('[data-phone-close]');
    expect(control?.getAttribute('aria-label')).toBe('close session');
    // At the trailing edge of the app bar -- a whole screen away from the row
    // whose top-right corner the hover-revealed `x` sat invisibly over.
    expect(control?.closest('header')).not.toBeNull();
    expect(control?.closest('[data-session-row]')).toBeNull();
    await act(async () => {
      fireEvent.click(control as Element);
    });
    // The same seam the `x` chord goes through, so this is one route with two
    // entrances rather than a phone-only way to end a session.
    expect(closed).toEqual(['a1']);
  });

  it('renders no Submit: a pick cannot travel from a browser', () => {
    openSession();
    expect(document.querySelector('[data-question-submit]')).toBeNull();
  });

  it('does not draw the composer at all on a read-only server', () => {
    render(
      <Canvas
        model={MODEL}
        source={phoneSource({
          capabilities: { recordPrompt: false },
          declines: { recordPrompt: 'this server registers no write routes' },
        })}
      />,
    );
    const row = rows()[0];
    if (row === undefined) throw new Error('no session row');
    act(() => {
      fireEvent.click(row);
    });
    expect(document.querySelector('[data-composer-bar]')).toBeNull();
    expect(document.querySelector('[data-prompt-record]')).toBeNull();
  });
});
