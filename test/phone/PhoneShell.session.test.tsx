// @vitest-environment happy-dom

/**
 * Screen two: the output, the composer, and the two limits that must read as
 * stated rather than as broken controls.
 *
 * The step rail and the view tabs USED to be asserted here. They are gone from
 * the phone (see `PhoneShell.tsx` and `DetailPanel.tsx`), so the assertions
 * below are their replacements rather than their deletion: the same questions,
 * with the answer this screen now gives.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
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
  it('draws no step rail and no step chips, on a session with five steps', () => {
    openSession();
    expect(FIVE_STEPS.length).toBe(5);
    // Was: one chip per decision, plus `STEP n/N`. The rail is session-BROWSING
    // chrome and this screen is for reading the newest output and replying, so
    // the count it drew has no strip left to sit in.
    expect(document.querySelector('[data-step-rail]')).toBeNull();
    expect(chips()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('STEP ');
  });

  it('opens on the newest step, with no control that moves off it', () => {
    openSession();
    const pane = () => document.querySelector('[data-action-pane]')?.textContent ?? '';
    expect(pane()).toContain('the gate said yes');
    // The oldest step's output, which a chip used to reach. Nothing on this
    // screen reaches it now -- that is the cost, stated.
    expect(pane()).not.toContain('the researcher read');
  });

  it('opens on the newest step again after a chevron and a second tap', () => {
    openSession();
    act(() => {
      fireEvent.click(document.querySelector('[data-phone-back]') as Element);
    });
    const row = rows()[0];
    act(() => {
      fireEvent.click(row as Element);
    });
    // The decision this test has always held: a re-open of the SAME session
    // shows what the session just did. It used to be at risk from a `step`
    // state whose reset was keyed on the session id; the state is gone, and
    // "newest" is now derived on every render, so the risk is structural.
    expect(document.querySelector('[data-action-pane]')?.textContent).toContain(
      'the gate said yes',
    );
  });

  it('offers no view tabs at all, so there is no tab to withdraw', () => {
    openSession();
    // Was: Terminal withdrawn, Response present. Terminal's structural
    // withdrawal is still asserted where the bar still exists -- `test/panels/
    // DetailPanel.test.tsx`, 'the Terminal tab is offered only by a source that
    // has one'. Here the whole bar is gone, which takes PRs and Agents with it.
    expect(document.querySelector('[data-view-tabs]')).toBeNull();
    expect(document.querySelectorAll('[data-tab]')).toHaveLength(0);
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
