// @vitest-environment happy-dom

/**
 * The settings overlay's left navigation.
 *
 * Two properties are load-bearing and neither is visible to a reader of the
 * markup alone. First, ALL four panels stay mounted — `Canvas.settings` queries
 * the theme buttons, the zoom slider and the layout options immediately after
 * `,` without navigating anywhere, and those assertions are asserting something
 * true. Second, focus follows the SELECTION and stays in the nav: with
 * automatic activation, a cursor that dived into each panel would leave the
 * operator four arrow presses from the list they were steering.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { SECTIONS } from '../../src/renderer/settings/sections.js';

afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<SettingsOverlay prefs={prefs} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

const nav = (id: string) =>
  document.querySelector<HTMLElement>(`[data-settings-nav-item="${id}"]`) as HTMLElement;
const panel = (id: string) =>
  document.querySelector<HTMLElement>(`[data-settings-panel="${id}"]`) as HTMLElement;
const shown = () =>
  [...document.querySelectorAll<HTMLElement>('[data-settings-panel]')]
    .filter((el) => !el.hasAttribute('hidden'))
    .map((el) => el.getAttribute('data-settings-panel'));

describe('the nav is a tablist over four sections', () => {
  it('names every section once, in a stable order', () => {
    open();
    const labels = [...document.querySelectorAll('[data-settings-nav-item]')].map(
      (el) => el.getAttribute('data-settings-nav-item') ?? '',
    );
    expect(labels).toEqual(SECTIONS.map((s) => s.id));
  });

  it('mounts every panel and hides all but the open one', () => {
    open();
    for (const section of SECTIONS) {
      expect(panel(section.id), `${section.id} is not mounted`).not.toBeNull();
    }
    expect(shown()).toEqual(['appearance']);
  });

  it('points each panel at the nav item that names it', () => {
    open();
    for (const section of SECTIONS) {
      expect(panel(section.id).getAttribute('aria-labelledby')).toBe(nav(section.id).id);
      expect(nav(section.id).getAttribute('aria-controls')).toBe(panel(section.id).id);
    }
  });
});

describe('the nav is steerable without a mouse', () => {
  it('opens with focus on the selected item, not on the close button', () => {
    open();
    expect(document.activeElement).toBe(nav('appearance'));
  });

  it('moves selection with the arrows, wrapping, and shows the panel it lands on', () => {
    open();
    fireEvent.keyDown(nav('appearance'), { key: 'ArrowDown' });
    expect(shown()).toEqual(['layout']);
    expect(nav('layout').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(nav('layout'), { key: 'ArrowUp' });
    expect(shown()).toEqual(['appearance']);
    // Wrapping: up from the first lands on the last.
    fireEvent.keyDown(nav('appearance'), { key: 'ArrowUp' });
    expect(shown()).toEqual(['keyboard']);
  });

  it('keeps focus on the nav item it moved to, never inside the panel', () => {
    open();
    fireEvent.keyDown(nav('appearance'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(nav('layout'));
    expect(panel('layout').contains(document.activeElement)).toBe(false);
  });

  it('jumps to the ends with Home and End', () => {
    open();
    fireEvent.keyDown(nav('appearance'), { key: 'End' });
    expect(shown()).toEqual(['keyboard']);
    fireEvent.keyDown(nav('keyboard'), { key: 'Home' });
    expect(shown()).toEqual(['appearance']);
  });

  it('is one tab stop: the selected item rovers, the others are skipped', () => {
    open();
    expect(nav('appearance').tabIndex).toBe(0);
    expect(nav('layout').tabIndex).toBe(-1);
    fireEvent.keyDown(nav('appearance'), { key: 'ArrowDown' });
    expect(nav('layout').tabIndex).toBe(0);
    expect(nav('appearance').tabIndex).toBe(-1);
  });

  it('switches section on Ctrl-Tab from inside a panel, and takes focus back to the nav', () => {
    open();
    // Any focusable control inside any panel makes the point; this one is in
    // Appearance because the Canvas section has no control left to focus.
    const field = screen.getByLabelText('out text size');
    act(() => (field as HTMLElement).focus());
    fireEvent.keyDown(field, { key: 'Tab', ctrlKey: true });
    expect(shown()).toEqual(['layout']);
    expect(document.activeElement).toBe(nav('layout'));
    fireEvent.keyDown(nav('layout'), { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(shown()).toEqual(['appearance']);
  });
});

describe('below md the same nav is a segmented strip', () => {
  /** One tablist reaches the accessibility tree, never two: Tailwind's `hidden`
   *  leaves both markups in the document, and two tablists over one state
   *  announce every section twice. */
  it('renders one nav, and it is the strip when the window is narrow', () => {
    const wide = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (media: string) => ({
        media,
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    try {
      open();
      expect(document.querySelectorAll('[role="tablist"]').length).toBe(1);
      expect(document.querySelectorAll('[data-settings-nav-item]').length).toBe(SECTIONS.length);
      expect(document.querySelector('[data-settings-nav]')?.getAttribute('aria-orientation')).toBe(
        'horizontal',
      );
      // Still one nav state, not two components with two: the strip steers the
      // same sections with the same keys.
      fireEvent.keyDown(nav('appearance'), { key: 'ArrowRight' });
      expect(shown()).toEqual(['layout']);
    } finally {
      if (wide === undefined) {
        Reflect.deleteProperty(window, 'matchMedia');
      } else {
        Object.defineProperty(window, 'matchMedia', wide);
      }
    }
  });
});

describe('the overlay draws a focus indicator', () => {
  it('gives every nav item, tile and the close button a visible ring', () => {
    open();
    const ringed = [
      ...document.querySelectorAll('[data-settings-nav-item]'),
      ...document.querySelectorAll('[data-layout-option]'),
      screen.getByRole('button', { name: 'Esc' }),
    ];
    expect(ringed.length).toBeGreaterThan(8);
    for (const el of ringed) {
      expect(el.className, `${el.textContent} has no focus ring`).toContain(
        'focus-visible:outline-ink',
      );
      expect(el.className).not.toContain('outline-none');
    }
  });
});
