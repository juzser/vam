// @vitest-environment happy-dom

/**
 * The settings overlay's left navigation, after the cards restructure.
 *
 * THE MODEL CHANGED FROM TABS TO JUMP LINKS. Every card is now on screen at
 * once (collapsed or not), so a nav item no longer SELECTS a single visible
 * panel from a set of hidden ones -- it JUMPS to a card that was already
 * there, scrolling its header into view. Two properties survive the change
 * unchanged, because they were never about tabs specifically: EVERY card
 * stays mounted (never removed for lacking focus, only ever collapsed), and
 * focus follows the "current" pointer and stays IN THE NAV, never diving into
 * a card -- with automatic activation, a cursor that dived into each card
 * would leave the operator a whole nav's worth of arrow presses from the list
 * they were steering.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { SECTIONS } from '../../src/renderer/settings/sections.js';

/** The end of the nav, read off the list rather than spelled: the two
 *  assertions below are about the ENDS, not about which section is there. */
const last = SECTIONS[SECTIONS.length - 1]?.id ?? 'interface';

/**
 * ONE STEP FROM THE TOP, read off the list for the same reason `last` is:
 * every assertion below is about STEPPING -- that an arrow, a wrap or
 * `Ctrl-Tab` moves the "current" pointer by one and takes the scroll and the
 * focus with it -- never about which section happens to be one step away, so
 * a literal here is a test that reddens whenever the nav gains a destination
 * while saying nothing about the key that moved.
 */
const second = SECTIONS[1]?.id ?? 'interface';

/** happy-dom does not implement `scrollIntoView`; a no-op stub is all `go`
 *  needs, since the assertions below are about FOCUS and the "current"
 *  pointer (`aria-current`), never about scroll position. */
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

const nav = (id: string) =>
  document.querySelector<HTMLElement>(`[data-settings-nav-item="${id}"]`) as HTMLElement;
const card = (id: string) =>
  document.querySelector<HTMLElement>(`[data-settings-panel="${id}"]`) as HTMLElement;
/** The card whose CONTENT is not folded shut -- distinct from "current" (the
 *  nav's own pointer): a card can be scrolled past, collapsed, or both, and
 *  none of that is what "current" means any more. */
const rowsHidden = (id: string) =>
  card(id)?.querySelector('[data-settings-rows]')?.closest('[hidden]') !== null;

describe('the nav lists every section once, in a stable order', () => {
  /**
   * The operator asked for the Layout section to go. It was the only control
   * that could hide a pane, so this asserts the whole feature is gone --
   * the section, its card, and the per-pane tiles inside it -- rather than
   * only that the nav item stopped being drawn.
   */
  it('offers no layout section: hiding a pane is not a thing vam does', () => {
    open();
    expect(SECTIONS.map((s) => s.id)).not.toContain('layout');
    expect(document.querySelector('[data-settings-panel="layout"]')).toBeNull();
    expect(document.querySelectorAll('[data-pane-toggle]').length).toBe(0);
  });

  it('names every section once, in a stable order', () => {
    open();
    const ids = [...document.querySelectorAll('[data-settings-nav-item]')].map(
      (el) => el.getAttribute('data-settings-nav-item') ?? '',
    );
    expect(ids).toEqual(SECTIONS.map((s) => s.id));
  });

  it('mounts every card, all of them un-hidden by their nav state (only a fold hides one)', () => {
    open();
    for (const section of SECTIONS) {
      expect(card(section.id), `${section.id} is not mounted`).not.toBeNull();
      expect(rowsHidden(section.id), `${section.id} is folded shut by default`).toBe(false);
    }
  });

  it('gives the nav item the same name as the card it jumps to', () => {
    open();
    for (const section of SECTIONS) {
      expect(nav(section.id).textContent).toBe(
        card(section.id).querySelector('[data-settings-heading]')?.textContent,
      );
    }
  });
});

describe('the nav is steerable without a mouse', () => {
  it('opens with focus on the first item, not on the close button', () => {
    open();
    expect(document.activeElement).toBe(nav('interface'));
  });

  it('moves the "current" pointer with the arrows, wrapping, and scrolls the card it lands on into view', () => {
    open();
    fireEvent.keyDown(nav('interface'), { key: 'ArrowDown' });
    expect(nav(second).getAttribute('aria-current')).toBe('true');
    expect(nav('interface').getAttribute('aria-current')).toBeNull();
    expect(card(second).scrollIntoView).toHaveBeenCalled();
    fireEvent.keyDown(nav(second), { key: 'ArrowUp' });
    expect(nav('interface').getAttribute('aria-current')).toBe('true');
    // Wrapping: up from the first lands on the last -- whichever that is.
    // Named from `SECTIONS` rather than spelled, because this assertion is
    // about the WRAP and a literal here goes stale every time a section is
    // added.
    fireEvent.keyDown(nav('interface'), { key: 'ArrowUp' });
    expect(nav(last).getAttribute('aria-current')).toBe('true');
  });

  it('keeps focus on the nav item it moved to, never inside a card', () => {
    open();
    fireEvent.keyDown(nav('interface'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(nav(second));
    expect(card(second).contains(document.activeElement)).toBe(false);
  });

  it('jumps to the ends with Home and End', () => {
    open();
    fireEvent.keyDown(nav('interface'), { key: 'End' });
    expect(nav(last).getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(nav(last), { key: 'Home' });
    expect(nav('interface').getAttribute('aria-current')).toBe('true');
  });

  it('is one tab stop: the current item rovers, the others are skipped', () => {
    open();
    expect(nav('interface').tabIndex).toBe(0);
    expect(nav(second).tabIndex).toBe(-1);
    fireEvent.keyDown(nav('interface'), { key: 'ArrowDown' });
    expect(nav(second).tabIndex).toBe(0);
    expect(nav('interface').tabIndex).toBe(-1);
  });

  it('moves the pointer on Ctrl-Tab from inside a card, and takes focus back to the nav', () => {
    open();
    // Any focusable control inside any card makes the point; this one is in
    // Interface because it is the first thing on screen.
    const field = screen.getByLabelText('out text size');
    act(() => (field as HTMLElement).focus());
    fireEvent.keyDown(field, { key: 'Tab', ctrlKey: true });
    expect(nav(second).getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(nav(second));
    fireEvent.keyDown(nav(second), { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(nav('interface').getAttribute('aria-current')).toBe('true');
  });
});

describe('below md the same nav is a horizontally scrolling strip', () => {
  /** One nav reaches the accessibility tree, never two: Tailwind's `hidden`
   *  leaves both markups in the document, and two navs over one state
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
      expect(document.querySelectorAll('[role="toolbar"]').length).toBe(1);
      expect(document.querySelectorAll('[data-settings-nav-item]').length).toBe(SECTIONS.length);
      expect(document.querySelector('[data-settings-nav]')?.getAttribute('aria-orientation')).toBe(
        'horizontal',
      );
      // Still one nav state, not two components with two: the strip steers the
      // same sections with the same keys.
      fireEvent.keyDown(nav('interface'), { key: 'ArrowRight' });
      expect(nav(second).getAttribute('aria-current')).toBe('true');
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
  it('gives every nav item, every card header, and the close button a visible ring', () => {
    open();
    const items = [...document.querySelectorAll('[data-settings-nav-item]')];
    const headers = SECTIONS.map((s) => card(s.id).querySelector('button[aria-expanded]'));
    // A12.1 retired the LayoutPicker's `[data-layout-option]` tiles with the
    // three canvas presets, and the `[data-pane-toggle]` tiles that replaced
    // them went with the whole Layout section. The nav items, the card
    // headers and the close button are the corpus this panel has left.
    const ringed = [...items, ...headers, screen.getByRole('button', { name: 'close' })];
    // Derived, not counted: this guard exists to prove it examined a real
    // corpus, and a hard-coded floor turns into a false red the moment a
    // section is added or retired.
    expect(items.length).toBe(SECTIONS.length);
    for (const el of ringed) {
      expect(el, 'a control in the corpus is missing').not.toBeNull();
      expect((el as HTMLElement).className, `${el?.textContent} has no focus ring`).toContain(
        'focus-visible:outline-ink',
      );
      expect((el as HTMLElement).className).not.toContain('outline-none');
    }
  });

  /** Three focusable controls shipped with NO visible ring at all — a 2.4.7
   *  failure on the live surface, not a refinement. Asserted here because the
   *  corpus above cannot reach them: two exist only while a binding is
   *  overridden, and all three live in a card no test opens by default. */
  it('rings the three controls in the keyboard card that had none', () => {
    open({ ...EMPTY_PREFS, keyBindings: { rename: ['p'] } });
    fireEvent.click(nav('keyboard'));
    const ringed = [
      screen.getByRole('button', { name: 'reset shortcuts' }),
      document.querySelector('[data-binding-slot="rename:0"]') as HTMLElement,
      document.querySelector('[data-binding-reset="rename"]') as HTMLElement,
    ];
    for (const el of ringed) {
      expect(el, 'the control is not on the surface').not.toBeNull();
      expect(el.className, `${el.getAttribute('aria-label')} has no focus ring`).toContain(
        'focus-visible:outline-ink',
      );
    }
  });
});
