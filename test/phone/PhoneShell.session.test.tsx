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
    expect(first.getAttribute('aria-selected')).toBe('true');
  });

  it('withdraws the Terminal tab structurally, rather than showing it disabled', () => {
    openSession();
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs.some((t) => t?.includes('Terminal'))).toBe(false);
    expect(tabs.some((t) => t?.includes('Response'))).toBe(true);
  });

  it('draws the composer and no mode row', () => {
    openSession();
    expect(document.querySelector('[data-prompt-record]')).not.toBeNull();
    expect(document.querySelector('[data-mode-row]')).toBeNull();
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
