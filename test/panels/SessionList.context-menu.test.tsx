// @vitest-environment happy-dom

/**
 * RIGHT-CLICK A SESSION ROW.
 *
 * Operator: "add popover actions on right click -- for instance right-click a
 * session in the sidebar to rename, remove..."
 *
 * THE GAP WAS REAL AND IT WAS BIGGER THAN A CONVENIENCE. A session row offered
 * the mouse exactly one action, the hover `x`. Renaming a session was `r` and
 * changing its icon was `s`, both KEYBOARD-ONLY: there was no pointer route to
 * either, on any surface, and an operator who works this list with a mouse
 * could not reach half of what the list can do.
 *
 * WHY THESE THREE AND NOT A FOURTH. The menu offers what the chord table
 * already offers for the focused row -- `r`, `s`, `x` -- and nothing invented
 * for the occasion. "Remove" in the operator's phrasing is `x`: a session is a
 * live process on a cwd, not a stored record, so ending it IS removing it, and
 * the only surface with a separate "Remove" is the project heading one level
 * up (where it hides a project AND ends what vam started, behind a confirm).
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, makeSession, twoProjects } from './session-list-props.js';

afterEach(cleanup);

const row = (id: string) => document.querySelector<HTMLElement>(`[data-session-row="${id}"]`);
const menu = () => document.querySelector<HTMLElement>('[data-context-menu]');
const entry = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-context-menu-item="${id}"]`);

/**
 * ON THE ROW BUTTON, which is where a real right-click lands: the button is
 * `w-full` and fills its wrapper, so there is no wrapper-only area to hit.
 * It is also the element the KEYBOARD focuses, and the Menu key and Shift+F10
 * fire `contextmenu` on the focused element -- so the one handler serves both
 * routes, and neither is a static `<div>` carrying a pointer-only affordance.
 */
const openOn = (id: string, at = { clientX: 120, clientY: 200 }) => {
  fireEvent.contextMenu(row(id) as HTMLElement, at);
};

function draw(over: Parameters<typeof baseProps>[0] extends never ? never : object = {}) {
  const props = { ...baseProps(twoProjects()), ...over };
  render(<SessionList {...props} />);
  return props;
}

describe('the row menu opens', () => {
  it('draws nothing until a right-click', () => {
    draw();
    expect(menu()).toBeNull();
  });

  it('opens on a right-click, named for the session it acts on', () => {
    draw();
    openOn('a1');
    expect(menu()).not.toBeNull();
    expect(menu()?.getAttribute('aria-label')).toBe('actions for alpha one');
  });

  it('opens where the pointer was, not at the row', () => {
    draw();
    openOn('a1', { clientX: 300, clientY: 410 });
    expect(menu()?.style.left).toBe('300px');
    expect(menu()?.style.top).toBe('410px');
  });

  /**
   * THE BROWSER'S OWN MENU MUST NOT OPEN TOO. Two menus at once is the one
   * outcome worse than none, and in Electron the native one is the shell's,
   * not the app's -- it would offer Reload and Inspect Element over a session
   * list. `preventDefault` on the event is the only thing that stops it.
   */
  it('takes the event from the browser', () => {
    draw();
    const opened = fireEvent.contextMenu(row('a1') as HTMLElement, { clientX: 10, clientY: 10 });
    expect(opened).toBe(false);
  });

  it('moves to the row that was right-clicked second', () => {
    draw();
    openOn('a1');
    expect(menu()?.getAttribute('aria-label')).toBe('actions for alpha one');
    openOn('b1');
    expect(menu()?.getAttribute('aria-label')).toBe('actions for beta one');
  });

  /**
   * THE KEYBOARD OPENS IT TOO, and this is the test that makes the a11y
   * suppression in `SessionList.tsx` honest rather than convenient.
   *
   * `noStaticElementInteractions` exists to catch a gesture only a mouse can
   * make. `contextmenu` is not one: the Menu key and Shift+F10 both fire it,
   * on the FOCUSED element -- which here is the row's own button, one level
   * inside the wrapper carrying the handler. So the case below dispatches the
   * event on the button and asserts the menu opens anyway, which is the whole
   * of the keyboard route: the event bubbles, and a keyboard operator never
   * has to reach the wrapper.
   */
  it('opens from the close button beside it, which is also focusable', () => {
    draw();
    const x = document.querySelector<HTMLElement>('[aria-label="close alpha one"]');
    fireEvent.contextMenu(x as HTMLElement, { clientX: 0, clientY: 0 });
    expect(menu()?.getAttribute('aria-label')).toBe('actions for alpha one');
  });

  it('closes on Escape', () => {
    draw();
    openOn('a1');
    fireEvent.keyDown(menu() as HTMLElement, { key: 'Escape' });
    expect(menu()).toBeNull();
  });
});

describe('what the row menu offers', () => {
  it('offers the three the chord table already offers for this row', () => {
    draw({ onRenameSession: vi.fn(), onPickSessionIcon: vi.fn() });
    openOn('a1');
    expect([...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)).toEqual(
      [
        'Rename session',
        'Change session icon',
        // Drawn and disabled, carrying its reason: this harness wires no
        // reopen route, which is the phone shell's case too.
        'Reopen session — not available here',
        'Close session',
      ],
    );
  });

  /**
   * REOPEN, END TO END THROUGH THE ROW. `SessionList.reopen.test.ts` pins the
   * item's rules; this pins that a right-click on a row the source has
   * MEASURED as ended reaches the callback with that row's id -- the wiring
   * the pure test cannot see.
   */
  it('reopens the row that was right-clicked, when its source says it ended', () => {
    const onReopen = vi.fn();
    // `twoProjects()` answers ENTRIES, and the row menu reads the session on
    // the entry it was opened over -- so the mark goes on that session.
    const entries = twoProjects();
    const withEnded = entries.map((e, index) =>
      index === 0 ? { ...e, session: { ...e.session, ended: true } } : e,
    );
    const props = { ...baseProps(withEnded), onReopen, canReopen: true };
    render(<SessionList {...props} />);
    openOn('a1');
    const item = entry('reopen') as HTMLButtonElement;
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    expect(onReopen).toHaveBeenCalledWith('a1');
  });

  /** And the 409 rule, on the surface the operator actually touches. */
  it('will not reopen a row that is still running', () => {
    const onReopen = vi.fn();
    draw({ onReopen, canReopen: true });
    openOn('a1');
    const item = entry('reopen') as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    fireEvent.click(item);
    expect(onReopen).not.toHaveBeenCalled();
  });

  it('renames the row that was right-clicked, not the focused one', () => {
    const onRenameSession = vi.fn();
    draw({ onRenameSession, focusedSessionId: 'a2' });
    openOn('b1');
    fireEvent.click(entry('rename') as HTMLElement);
    expect(onRenameSession).toHaveBeenCalledWith('b1');
    expect(menu()).toBeNull();
  });

  it('picks the icon for the row that was right-clicked', () => {
    const onPickSessionIcon = vi.fn();
    draw({ onPickSessionIcon });
    openOn('a2');
    fireEvent.click(entry('icon') as HTMLElement);
    expect(onPickSessionIcon).toHaveBeenCalledWith('a2');
  });

  it('closes the row that was right-clicked', () => {
    const onClose = vi.fn();
    draw({ onClose });
    openOn('a2');
    fireEvent.click(entry('close') as HTMLElement);
    expect(onClose).toHaveBeenCalledWith('a2');
  });

  /**
   * A CALLER THAT CANNOT RENAME SAYS SO IN THE MENU. `onRenameSession` is
   * optional because the phone shell draws this list too and has no rename
   * flow to offer -- and a menu that silently drops an item would change shape
   * between two surfaces showing the same row.
   */
  it('disables what this caller cannot do, with the reason', () => {
    draw({ onRenameSession: undefined, onPickSessionIcon: undefined });
    openOn('a1');
    expect(entry('rename')?.disabled).toBe(true);
    expect(entry('rename')?.textContent).toContain('not available here');
    expect(entry('close')?.disabled).toBe(false);
  });

  /**
   * A ROW MID-CLOSE TAKES NO ORDERS -- the same fact `pendingAction` already
   * carries for the row button and the `x`. Closing can take the full stop
   * timeout, and a rename issued into those fifteen seconds would be a rename
   * of something on its way out.
   */
  it('refuses everything while the row is already closing', () => {
    draw({ pendingAction: 'a1', onRenameSession: vi.fn() });
    openOn('a1');
    expect(entry('rename')?.disabled).toBe(true);
    expect(entry('close')?.disabled).toBe(true);
    expect(entry('close')?.textContent).toContain('already closing');
  });
});
