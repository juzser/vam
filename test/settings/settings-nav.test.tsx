// @vitest-environment happy-dom

/**
 * The settings overlay's left navigation.
 *
 * THE MODEL CHANGED TWICE. First, from TABS (one panel visible, the rest
 * mounted-but-hidden) to JUMP LINKS over a single scrolling page (the cards
 * restructure: every card mounted at once, an item scrolled to a card that
 * was already there). Now, the settings-views restructure (item C: "each
 * section in Settings should be its own view, not one long scroll") turns
 * activation back into a MOUNT DECISION: selecting a nav item is what puts a
 * section's `SettingsCard` in the document at all, and removes whichever one
 * was there before. `aria-current` still marks the selected item (the
 * jump-link pattern's own "you are here", not the exclusive-tabs role this
 * never went back to being — every OTHER section is simply absent, not
 * merely hidden, which is a different reason for the same markup). Focus
 * still follows the "current" pointer and stays IN THE NAV, never diving
 * into a card — with automatic activation, a cursor that dived into each
 * card would leave the operator a whole nav's worth of arrow presses from
 * the list they were steering.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { isDesktopOnlySection, SECTIONS } from '../../src/renderer/settings/sections.js';

/**
 * EVERY SECTION THIS FILE'S OWN NAV ACTUALLY OFFERS -- no `window.api` stub
 * anywhere below, so `isDesktopShell()` reads `false` throughout (the
 * browser-build case), and Skills (`isDesktopOnlySection`, item D) is not
 * one of them. `SECTIONS` itself is the WHOLE catalogue this build could
 * ever draw a nav item for; this file is about the nav's own behaviour, not
 * about which capability gates which section, so it steers by the list the
 * nav actually renders rather than by the raw catalogue.
 */
const VISIBLE_SECTIONS = SECTIONS.filter((section) => !isDesktopOnlySection(section.id));

/** The end of the nav, read off the list rather than spelled: the two
 *  assertions below are about the ENDS, not about which section is there. */
const last = VISIBLE_SECTIONS[VISIBLE_SECTIONS.length - 1]?.id ?? 'interface';

/**
 * ONE STEP FROM THE TOP, read off the list for the same reason `last` is:
 * every assertion below is about STEPPING -- that an arrow, a wrap or
 * `Ctrl-Tab` moves the "current" pointer by one and takes the mount with
 * it -- never about which section happens to be one step away, so a literal
 * here is a test that reddens whenever the nav gains a destination while
 * saying nothing about the key that moved.
 */
const second = VISIBLE_SECTIONS[1]?.id ?? 'interface';

afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

const nav = (id: string) =>
  document.querySelector<HTMLElement>(`[data-settings-nav-item="${id}"]`) as HTMLElement;
/** `null` unless this is the ONE section currently mounted -- the
 *  single-section-view restructure's own fact, replacing "always mounted,
 *  maybe folded". */
const card = (id: string) => document.querySelector<HTMLElement>(`[data-settings-panel="${id}"]`);

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
    expect(ids).toEqual(VISIBLE_SECTIONS.map((s) => s.id));
  });

  it('mounts exactly one card at a time -- the selected section, and no other', () => {
    open();
    for (const section of VISIBLE_SECTIONS) {
      fireEvent.click(nav(section.id));
      expect(card(section.id), `${section.id} did not mount when selected`).not.toBeNull();
      for (const other of VISIBLE_SECTIONS) {
        if (other.id === section.id) continue;
        expect(card(other.id), `${other.id} stayed mounted beside ${section.id}`).toBeNull();
      }
    }
  });

  it('gives the nav item the same name as the card it selects', () => {
    open();
    for (const section of VISIBLE_SECTIONS) {
      fireEvent.click(nav(section.id));
      expect(nav(section.id).textContent).toBe(
        card(section.id)?.querySelector('[data-settings-heading]')?.textContent,
      );
    }
  });
});

describe('the nav is steerable without a mouse', () => {
  it('opens with focus on the first item, not on the close button', () => {
    open();
    expect(document.activeElement).toBe(nav('interface'));
  });

  it('moves the "current" pointer with the arrows, wrapping, and mounts the card it lands on', () => {
    open();
    fireEvent.keyDown(nav('interface'), { key: 'ArrowDown' });
    expect(nav(second).getAttribute('aria-current')).toBe('true');
    expect(nav('interface').getAttribute('aria-current')).toBeNull();
    expect(card(second)).not.toBeNull();
    expect(card('interface')).toBeNull();
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
    expect(card(second)?.contains(document.activeElement)).toBe(false);
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

  it('selects on Enter and on Space, a native <button>’s own behaviour', () => {
    // No handler in this file does this on purpose -- `navItemProps` renders
    // a real `<button type="button">`, which activates on both keys without
    // being told to. Asserted here as the CONTRACT (a native click fires),
    // since a future refactor to a `<div role="button">` would need to add
    // both back by hand and could silently drop one.
    open();
    fireEvent.click(nav(second));
    expect(nav(second).getAttribute('aria-current')).toBe('true');
    expect(card(second)).not.toBeNull();
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
      expect(document.querySelectorAll('[data-settings-nav-item]').length).toBe(
        VISIBLE_SECTIONS.length,
      );
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
  it('gives every nav item and the close button a visible ring', () => {
    // CARD HEADERS DROPPED FROM THIS CORPUS: the settings-views restructure
    // (item C) retired the collapsible card header BUTTON (`aria-expanded`)
    // in favour of a plain, non-interactive heading (`primitives.tsx`'s
    // `SettingsCard`) -- there is nothing left there for a focus ring to
    // mark. The nav items and the close button are the corpus this panel
    // has left; `AdvancedDisclosure`'s own toggle (a real button, still
    // interactive) is asserted by its own test file, not swept in here,
    // since not every section has one.
    open();
    const items = [...document.querySelectorAll('[data-settings-nav-item]')];
    const ringed = [...items, screen.getByRole('button', { name: 'close' })];
    // Derived, not counted: this guard exists to prove it examined a real
    // corpus, and a hard-coded floor turns into a false red the moment a
    // section is added or retired.
    expect(items.length).toBe(VISIBLE_SECTIONS.length);
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

/**
 * "BACK TO APP", replacing the rail's own "Sections" eyebrow. Operator: put a
 * left-arrow row reading "Back to app" at the top of the desktop rail, in
 * place of the plain label, closing Settings the same way Esc/`×` already do.
 */
describe('the rail\'s own "Back to app" row', () => {
  const back = () => document.querySelector<HTMLElement>('[data-settings-back]');

  it('replaces the "Sections" eyebrow rather than sitting beside it', () => {
    open();
    expect(document.querySelector('[data-settings-nav]')?.textContent).not.toContain('Sections');
    expect(back()).not.toBeNull();
    expect(back()?.textContent).toContain('Back to app');
  });

  it('is a real button, reachable by keyboard, with a visible focus ring', () => {
    open();
    expect(back()?.tagName).toBe('BUTTON');
    expect(back()?.className).toContain('focus-visible:outline-ink');
  });

  it('clears the 44px touch floor', () => {
    open();
    const rect = back()?.getBoundingClientRect();
    // happy-dom lays out nothing, so the floor is read off the class that
    // sets it rather than a measured box — `Canvas.settings.test.tsx` and
    // the e2e chrome shots are what prove the paint.
    expect(back()?.className).toContain('h-[44px]');
    expect(rect).toBeDefined();
  });

  it('closes the overlay on click — the same path Esc and `×` already use', () => {
    const { onClose } = open();
    fireEvent.click(back() as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
