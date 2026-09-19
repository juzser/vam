// @vitest-environment happy-dom

/**
 * RIGHT-CLICK A SESSION TAB.
 *
 * Operator: "...try it for the tab, the detail pane and the In bubble too."
 *
 * THE SAME THREE THE SIDEBAR ROW OFFERS, because a tab and a row are the same
 * session seen twice. What differs is what each surface ALREADY gave the
 * mouse: the row had its hover `x`, and so does the tab, and neither had any
 * route at all to `r` (rename) or `s` (change icon). Two surfaces disagreeing
 * about what you can do to one session would be worse than either gap.
 *
 * DRIVEN THROUGH `Canvas`, not through `TabStrip` in isolation. The whole
 * point of the menu is that it acts on the tab the pointer named rather than
 * on the focused session, and a strip rendered alone has no focused session to
 * be wrong about.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, title: string): Session {
  return {
    id,
    title,
    icon: null,
    epic: null,
    branch: null,
    status: 'idle',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [{ id: `${id}-d`, label: 'plan', input: 'in', output: 'out', commands: [] }],
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [session('a1', 'alpha one'), session('a2', 'alpha two')],
    },
  ],
};

afterEach(cleanup);

const menu = () => document.querySelector<HTMLElement>('[data-context-menu]');
const entryOf = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-context-menu-item="${id}"]`);
const tabs = () => [...document.querySelectorAll<HTMLElement>('[data-session-tab]')];
/**
 * THE TAB'S OWN BUTTON, which is where a real right-click lands and where the
 * KEYBOARD focuses -- the Menu key and Shift+F10 fire `contextmenu` on the
 * focused element, so one handler serves both routes. A handler on the tab's
 * static wrapper would have served only the pointer.
 */
const tabFor = (title: string): HTMLElement => {
  const found = tabs().find((el) => el.textContent?.includes(title) === true);
  if (found === undefined) throw new Error(`no tab for ${title}`);
  const button = found.querySelector<HTMLElement>('[data-tab-select]');
  if (button === null) throw new Error(`no select button in the tab for ${title}`);
  return button;
};
const press = (key: string) => {
  act(() => {
    fireEvent.keyDown(window, { key });
  });
};

/** Opens a2's tab beside a1's, so the strip has two to tell apart. */
function twoTabs() {
  render(<Canvas model={MODEL} />);
  press('j');
  expect(tabs()).toHaveLength(2);
}

describe('the tab menu', () => {
  it('draws nothing until a right-click', () => {
    twoTabs();
    expect(menu()).toBeNull();
  });

  it('opens on a right-click, named for the tab’s session', () => {
    twoTabs();
    act(() => {
      fireEvent.contextMenu(tabFor('alpha one'), { clientX: 40, clientY: 30 });
    });
    expect(menu()?.getAttribute('aria-label')).toBe('actions for alpha one');
  });

  it('takes the event from the browser, so the shell menu stays shut', () => {
    twoTabs();
    let opened = true;
    act(() => {
      opened = fireEvent.contextMenu(tabFor('alpha one'), { clientX: 40, clientY: 30 });
    });
    expect(opened).toBe(false);
  });

  it('offers the same three the sidebar row offers', () => {
    twoTabs();
    act(() => {
      fireEvent.contextMenu(tabFor('alpha two'), { clientX: 40, clientY: 30 });
    });
    expect([...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)).toEqual(
      ['Rename session', 'Change session icon', 'Close session'],
    );
  });

  /**
   * THE TAB THE POINTER NAMED, not the focused one -- the property the whole
   * menu exists for. After `j` the cursor is on a2; right-clicking a1's tab
   * and renaming must open the editor on A1.
   */
  it('renames the tab that was right-clicked, not the focused session', () => {
    twoTabs();
    act(() => {
      fireEvent.contextMenu(tabFor('alpha one'), { clientX: 40, clientY: 30 });
    });
    act(() => {
      fireEvent.click(entryOf('rename') as HTMLElement);
    });
    const editor = document.querySelector<HTMLInputElement>('input[aria-label="rename session"]');
    expect(editor).not.toBeNull();
    expect(editor?.value).toBe('alpha one');
  });

  /** The keyboard route -- see the long note in the sidebar's own suite. The
   *  Menu key fires `contextmenu` on the focused element, which in a tab is
   *  the select button inside it, never the wrapper. */
  it('opens from the tab’s close button too, the other focusable stop in it', () => {
    twoTabs();
    const x = document.querySelector<HTMLElement>('[aria-label="close session alpha one"]');
    act(() => {
      fireEvent.contextMenu(x as HTMLElement, { clientX: 0, clientY: 0 });
    });
    expect(menu()?.getAttribute('aria-label')).toBe('actions for alpha one');
  });

  it('closes on Escape without acting', () => {
    twoTabs();
    act(() => {
      fireEvent.contextMenu(tabFor('alpha one'), { clientX: 40, clientY: 30 });
    });
    act(() => {
      fireEvent.keyDown(menu() as HTMLElement, { key: 'Escape' });
    });
    expect(menu()).toBeNull();
    expect(tabs()).toHaveLength(2);
  });
});
