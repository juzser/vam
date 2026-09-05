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
import {
  chips,
  FIVE_STEPS,
  installPhoneGlobals,
  MODEL,
  phoneSource,
  rows,
  views,
} from './harness.js';

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

  it('draws no tab strip in the body: the views moved to the topbar', () => {
    openSession();
    // Was: Terminal withdrawn from the body strip, Response present. The strip
    // is not drawn on a phone at all; the same views are icon buttons in the
    // app bar (below). Terminal's structural withdrawal is still asserted where
    // the strip still exists -- `test/panels/DetailPanel.test.tsx`, 'the
    // Terminal tab is offered only by a source that has one' -- and the
    // withdrawal reaches the topbar because both read `visibleTabs`.
    expect(document.querySelector('[data-view-tabs]')).toBeNull();
    expect(document.querySelectorAll('[data-tab]')).toHaveLength(0);
    expect(views().map((b) => b.getAttribute('data-phone-view'))).toEqual([
      'response',
      'prs',
      'agents',
    ]);
  });

  it('says which view is on by more than colour', () => {
    openSession();
    expect(views().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    // The second channel, which is a shape and not a hue: only the selected
    // control draws the underline mark. WCAG 1.4.1 -- this codebase has
    // shipped a Level A colour-alone failure before.
    expect(document.querySelectorAll('[data-phone-view-mark]')).toHaveLength(1);
    expect(views()[0]?.querySelector('[data-phone-view-mark]')).not.toBeNull();
  });

  it('takes the tap on the 44 box and paints on a 30 skin inside it', () => {
    openSession();
    // The complaint the shipped screenshots explain: a control reads as too
    // big when the BORDER is drawn at 44, not when the hit is. Asserted as
    // classes because Tailwind's utilities are generated at build time and
    // happy-dom lays nothing out -- a real 390px measurement is Playwright's.
    for (const button of views()) {
      expect(button.className, 'the hit box keeps the 44 floor').toContain('min-h-[44px]');
      expect(button.className, 'and paints nothing itself').not.toContain('border-line');
      const skin = button.querySelector('[data-tap-skin]') as HTMLElement;
      expect(skin, 'the painted skin').not.toBeNull();
      expect(skin.className).toContain('h-[30px]');
      expect(skin.className).toContain('w-[30px]');
      // Orca's dominant glyph size, and above the 14 its own comment calls
      // "read as decoration". Asserted on the drawn SVG, which is the one
      // place a size that does not reach the glyph would show.
      const glyph = skin.querySelector('svg');
      expect(glyph?.getAttribute('width')).toBe('16');
    }
  });

  it('switches the body when a view icon is tapped', () => {
    openSession();
    expect(document.querySelector('[data-action-pane]')).not.toBeNull();
    act(() => {
      fireEvent.click(views()[1] as Element);
    });
    expect(document.querySelector('[data-prs]'), 'the PRs view').not.toBeNull();
    expect(views().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(views()[1]?.querySelector('[data-phone-view-mark]')).not.toBeNull();
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
