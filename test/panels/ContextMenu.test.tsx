// @vitest-environment happy-dom

/**
 * THE RIGHT-CLICK MENU, as one component rather than a fourth copy.
 *
 * Operator: "add popover actions on right click -- for instance right-click a
 * session in the sidebar to rename, remove... try it for the tab, the detail
 * pane and the In bubble too."
 *
 * `grep -rn onContextMenu src/renderer/` returned NOTHING before this: vam had
 * no right-click anywhere. What it did have was the same menu written inline
 * TWICE -- the group heading's and the project heading's, in `SessionList.tsx`
 * -- identical down to the class string. Four surfaces now want one, so the
 * fifth copy is a component instead. The two that already ship are deliberately
 * NOT migrated here: they are shipped behaviour with their own tests, and
 * rewriting them to prove a new primitive is how a refactor turns into a
 * regression.
 *
 * WHAT THIS COMPONENT OWES, and every item below is one of those debts:
 *   - it opens where the pointer is, and stays on screen when the pointer is
 *     near an edge;
 *   - the keyboard can reach it WITHOUT a pointer (the Menu key and Shift+F10
 *     both fire `contextmenu`, which is why there is one handler and not two);
 *   - Escape closes it and Tab is not the only way out;
 *   - an item that cannot act is DRAWN AND DISABLED with its reason, never
 *     silently absent -- the house rule this project already keeps for the
 *     keystroke strip and the composer;
 *   - picking an item closes the menu, so no caller has to remember to.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContextMenu,
  type ContextMenuItem,
  placeMenu,
} from '../../src/renderer/panels/ContextMenu.js';

afterEach(cleanup);

const panel = () => document.querySelector<HTMLElement>('[data-context-menu]');
const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const item = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-context-menu-item="${id}"]`);

function draw(over: Partial<Parameters<typeof ContextMenu>[0]> = {}) {
  const picked = vi.fn();
  const closed = vi.fn();
  const defaults: ContextMenuItem[] = [
    { id: 'rename', label: 'Rename session', onPick: picked },
    { id: 'icon', label: 'Change icon', onPick: () => {} },
    { id: 'close', label: 'Close session', onPick: () => {}, danger: true },
  ];
  render(
    <ContextMenu
      label="session actions"
      items={defaults}
      at={{ x: 100, y: 100 }}
      onClose={closed}
      {...over}
    />,
  );
  return { picked, closed };
}

describe('what the menu draws', () => {
  it('is a menu, named, with one menuitem per action', () => {
    draw();
    expect(panel()?.getAttribute('role')).toBe('menu');
    expect(panel()?.getAttribute('aria-label')).toBe('session actions');
    expect(items().map((el) => el.textContent)).toEqual([
      'Rename session',
      'Change icon',
      'Close session',
    ]);
  });

  it('opens where the pointer was', () => {
    draw({ at: { x: 240, y: 180 } });
    expect(panel()?.style.left).toBe('240px');
    expect(panel()?.style.top).toBe('180px');
  });

  it('places itself from the same geometry the pure function computes', () => {
    draw({ at: { x: 900, y: 700 } });
    const placed = placeMenu({ x: 900, y: 700 }, 3, {
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    });
    expect(panel()?.style.left).toBe(`${placed.left}px`);
    expect(panel()?.style.top).toBe(`${placed.top}px`);
  });
});

/**
 * THE GEOMETRY, AS THE PURE FUNCTION IT IS.
 *
 * It was tested through the component first, and that was a measurement
 * rather than a test: with a viewport of 1024x768, deleting the flip entirely
 * left every assertion green, because the CLAMP alone already keeps a panel
 * inside the viewport. The two do different jobs and only one of them is
 * about where the pointer is -- so the property below is not "on screen", it
 * is THE MENU DOES NOT COVER THE POINT THAT WAS CLICKED, which is the whole
 * reason a context menu flips instead of merely clamping.
 *
 * `MENU_WIDTH` is 184 and a three-item panel is 98 tall (3 x 30 + 8); the
 * numbers below are written out so a change to either constant fails here
 * rather than silently moving every menu.
 */
describe('where the panel lands', () => {
  const viewport = { width: 1000, height: 800 };

  it('opens down and to the right of the pointer when there is room', () => {
    expect(placeMenu({ x: 100, y: 100 }, 3, viewport)).toEqual({ left: 100, top: 100 });
  });

  it('opens to the LEFT of the pointer rather than over it, near the right edge', () => {
    const placed = placeMenu({ x: 900, y: 100 }, 3, viewport);
    // Its right edge is the pointer: the menu is beside the click, not on it.
    expect(placed.left + 184).toBeLessThanOrEqual(900);
    expect(placed.left).toBe(716);
  });

  it('opens ABOVE the pointer rather than over it, near the bottom edge', () => {
    const placed = placeMenu({ x: 100, y: 750 }, 3, viewport);
    expect(placed.top + 98).toBeLessThanOrEqual(750);
    expect(placed.top).toBe(652);
  });

  it('clamps as well as flips, for a click in the top-left corner', () => {
    // Flipping a click at (2, 2) would put the panel at -182: the flip is
    // what keeps it off the pointer and the clamp is what keeps it on screen,
    // and a corner needs both.
    expect(placeMenu({ x: 2, y: 2 }, 3, viewport)).toEqual({ left: 6, top: 6 });
  });

  it('stays on screen even when the viewport is smaller than the menu', () => {
    const placed = placeMenu({ x: 150, y: 150 }, 8, { width: 160, height: 120 });
    expect(placed.left).toBe(6);
    expect(placed.top).toBe(6);
  });

  it('grows downward with the item count, so a long menu flips sooner', () => {
    const three = placeMenu({ x: 100, y: 600 }, 3, viewport);
    const eight = placeMenu({ x: 100, y: 600 }, 8, viewport);
    expect(three.top).toBe(600);
    // Eight items are 248 tall and would run past 800, so this one goes up.
    expect(eight.top).toBeLessThan(600);
  });
});

describe('what the menu does', () => {
  it('runs the item and closes, so no caller has to remember to', () => {
    const { picked, closed } = draw();
    item('rename')?.click();
    expect(picked).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('puts the keyboard on the first item, so the Menu key is enough', () => {
    draw();
    expect(document.activeElement).toBe(item('rename'));
  });

  it('closes on Escape', () => {
    const { closed } = draw();
    fireEvent.keyDown(panel() as HTMLElement, { key: 'Escape' });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('closes on a pointer landing anywhere else', () => {
    const { closed } = draw();
    fireEvent.pointerDown(document.body);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('does not close on a pointer inside itself', () => {
    const { closed } = draw();
    fireEvent.pointerDown(item('icon') as HTMLElement);
    expect(closed).not.toHaveBeenCalled();
  });

  /**
   * `j`/`k` BESIDE THE ARROWS, because this is vam: an operator who walks the
   * session list with `j` and the question options with `j` should not have to
   * change hands for a menu. The arrows are what every assistive technology
   * expects of `role="menu"`, so both are live and neither is rebindable here.
   */
  it('walks with the arrows and with j and k', () => {
    draw();
    fireEvent.keyDown(panel() as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('icon'));
    fireEvent.keyDown(panel() as HTMLElement, { key: 'j' });
    expect(document.activeElement).toBe(item('close'));
    fireEvent.keyDown(panel() as HTMLElement, { key: 'k' });
    expect(document.activeElement).toBe(item('icon'));
    fireEvent.keyDown(panel() as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('rename'));
  });

  it('wraps at both ends, as a menu does', () => {
    draw();
    fireEvent.keyDown(panel() as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('close'));
    fireEvent.keyDown(panel() as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('rename'));
  });
});

describe('an item that cannot act', () => {
  const withBlocked: ContextMenuItem[] = [
    { id: 'copy', label: 'Copy prompt', onPick: () => {} },
    {
      id: 'cancel',
      label: 'Cancel this turn',
      onPick: () => {},
      unavailable: 'vam did not start this session',
    },
  ];

  it('is drawn and disabled rather than missing, and says why', () => {
    draw({ items: withBlocked });
    const blocked = item('cancel');
    expect(blocked).not.toBeNull();
    expect(blocked?.disabled).toBe(true);
    expect(blocked?.title).toBe('vam did not start this session');
    // The reason is in the accessible name too: `title` opens on hover and on
    // nothing else, which is no route at all for a keyboard or a screen reader.
    expect(blocked?.textContent).toContain('vam did not start this session');
  });

  it('does not run and does not close when clicked', () => {
    const onPick = vi.fn();
    const { closed } = draw({
      items: [{ ...withBlocked[1], onPick } as ContextMenuItem],
    });
    item('cancel')?.click();
    expect(onPick).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });

  it('is skipped by the keyboard walk, which would otherwise strand it', () => {
    draw({
      items: [
        { id: 'a', label: 'A', onPick: () => {} },
        { id: 'b', label: 'B', onPick: () => {}, unavailable: 'no' },
        { id: 'c', label: 'C', onPick: () => {} },
      ],
    });
    expect(document.activeElement).toBe(item('a'));
    fireEvent.keyDown(panel() as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('c'));
  });

  it('takes the opening focus only when nothing else can', () => {
    draw({
      items: [
        { id: 'b', label: 'B', onPick: () => {}, unavailable: 'no' },
        { id: 'c', label: 'C', onPick: () => {} },
      ],
    });
    expect(document.activeElement).toBe(item('c'));
  });
});
