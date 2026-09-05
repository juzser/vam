// @vitest-environment happy-dom

/**
 * Screen one, at a phone width: the list, and the four things that are gone.
 *
 * The list itself is `SessionList`, re-hosted rather than rewritten, so this
 * file asserts the SHELL around it -- what is drawn, what is unmounted, and
 * that a tap moves to screen two and the chevron comes back.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { installPhoneGlobals, MODEL, phoneSource, rows, shell } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the phone list screen', () => {
  it('draws the list and none of the three columns', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    expect(shell('list')).not.toBeNull();
    expect(document.querySelector('[data-canvas-pane]')).toBeNull();
    expect(document.querySelector('[data-action-pane]')).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('keeps the sidebar hierarchy exactly as the desktop draws it', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    expect(document.querySelector('[data-project-heading]')).not.toBeNull();
    expect(document.querySelector('[data-project-rows]')).not.toBeNull();
    expect(document.querySelector('[data-sidebar-pane]')).not.toBeNull();
  });

  it('says where the rows came from — a dropped tunnel must not look idle', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    const readout = document.querySelector('[data-source]');
    expect(readout?.textContent).toContain('Claude Code');
    // In the app bar, not in a canvas top bar that is not drawn.
    expect(readout?.closest('header')).not.toBeNull();
  });

  it('draws no mode cell and no usage bars: neither exists on a phone', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    expect(document.querySelector('[data-mode]')).toBeNull();
    expect(document.querySelector('[data-usage]')).toBeNull();
    expect(document.querySelector('[data-status-bar]')).toBeNull();
    expect(document.querySelector('[data-phone-status-bar]')).not.toBeNull();
  });

  it('pushes the session screen on a tap and pops it on the chevron', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    const row = rows()[0];
    if (row === undefined) throw new Error('no session row');
    act(() => {
      fireEvent.click(row);
    });
    expect(shell('session')).not.toBeNull();
    expect(shell('list')).toBeNull();

    const back = document.querySelector('[data-phone-back]');
    expect(back?.getAttribute('aria-label')).toBe('back to sessions');
    act(() => {
      fireEvent.click(back as Element);
    });
    expect(shell('list')).not.toBeNull();
  });

  it('does not arm the chord grammar: `,` opens nothing', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    // On the desktop this is the settings chord. Here every keystroke is a
    // soft-keyboard event behind a focus guard already known to leak, so the
    // window listener is never bound at all.
    expect(document.querySelector('[data-settings-overlay]')).toBeNull();
  });
});
