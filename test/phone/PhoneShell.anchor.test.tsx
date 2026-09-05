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
import { installPhoneGlobals, MODEL, phoneSource, rows, chips as stepChips } from './harness.js';

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

  it('draws no step rail in either keyboard state, and still reports the state', () => {
    openSession();
    // Was: the rail is drawn, hidden while typing, and drawn again on blur.
    // The rail is gone in BOTH states now, so the half of that decision worth
    // keeping is the state itself -- `RemoteLimits` and the stylesheet still
    // read it, and a `data-phone-keyboard` that stopped changing would be a
    // silent regression the removal could hide.
    expect(document.querySelector('[data-step-rail]')).toBeNull();
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
    expect(document.querySelector('[data-step-rail]')).toBeNull();
  });

  it('has no step control left to make it a different document', () => {
    openSession();
    // Was: tapping chip one swaps the pane to that step's output. There is no
    // chip; the pane is pinned to the newest step, which is what this screen
    // is for. The stick rule itself is unchanged and covered by
    // `test/panels/stick-to-bottom.test.ts`.
    expect(stepChips()).toHaveLength(0);
    expect(pane()).toContain('the gate said yes');
  });
});
