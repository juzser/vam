// @vitest-environment happy-dom

/**
 * Where the output is anchored — the wiring, not the rule.
 *
 * `stick-to-bottom.ts` already holds the rule and `test/panels/
 * stick-to-bottom.test.ts` already covers it; neither is touched. What is new
 * on a phone is that the composer sits under the output on the same screen, so
 * the one thing worth asserting is that focusing the composer is not treated
 * as a focus change: `shouldStick` reads `focusChanged`, and a keyboard opening
 * is not a different document. The naive version scrolls to the bottom on
 * composer focus, which throws away the operator's place every time they tap
 * the box.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { chips, installPhoneGlobals, MODEL, phoneSource, rows } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const box = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-prompt-box] textarea, textarea[data-prompt-box]',
  );
const pane = () => document.querySelector('[data-action-pane]')?.textContent ?? '';
const screen = () => document.querySelector('[data-phone-shell="session"]');

function openSession(): void {
  render(<Canvas model={MODEL} source={phoneSource()} />);
  const row = rows()[0];
  if (row === undefined) throw new Error('no session row');
  act(() => {
    fireEvent.click(row);
  });
}

describe('the output and the composer on one screen', () => {
  it('does not change the document when the composer takes focus', () => {
    openSession();
    const input = box();
    expect(input).not.toBeNull();
    act(() => {
      fireEvent.focusIn(input as HTMLTextAreaElement);
    });
    // Same step, same output: nothing about the keyboard opening is a focus
    // change, so the stick rule is never asked to move anything.
    expect(pane()).toContain('the gate said yes');
    expect(pane()).not.toContain('the researcher read');
  });

  it('takes the step rail out of the way while the keyboard is up, and puts it back', () => {
    openSession();
    expect(document.querySelector('[data-step-rail]')).not.toBeNull();
    const input = box();
    act(() => {
      fireEvent.focusIn(input as HTMLTextAreaElement);
    });
    expect(screen()?.getAttribute('data-phone-keyboard')).toBe('open');
    expect(document.querySelector('[data-step-rail]')).toBeNull();

    act(() => {
      fireEvent.focusOut(input as HTMLTextAreaElement);
    });
    expect(screen()?.getAttribute('data-phone-keyboard')).toBe('closed');
    expect(document.querySelector('[data-step-rail]')).not.toBeNull();
  });

  it('IS a different document when the step changes', () => {
    openSession();
    const first = chips()[0];
    if (first === undefined) throw new Error('no chip');
    act(() => {
      fireEvent.click(first);
    });
    expect(pane()).toContain('the researcher read');
  });
});
