/**
 * Giving Cmd+W to the canvas instead of to the window.
 *
 * THE FACT FIRST: this app builds no application menu -- nothing in `src/`
 * imports `Menu` or calls `Menu.setApplicationMenu` -- so Electron installs
 * its DEFAULT template. On macOS that template's Window submenu contains
 * `role: 'close'`, whose accelerator is Cmd+W, and a native menu matches its
 * key equivalents in `performKeyEquivalent`, BEFORE the event reaches the web
 * page. So `Mod-w` in `chords.ts` would be dead in the packaged app while
 * every renderer test passed: the operator would press it and vam would
 * vanish instead of the session stopping. That is exactly the "sometimes
 * closes a session, sometimes closes the app" surprise the binding must not
 * become.
 *
 * The remedy is small on purpose: ONE item is taken out of play, and nothing
 * else about the default menu changes -- Quit, Copy, Paste, Minimise and the
 * rest all keep their keys. vam is a single-window app, so the item removed
 * is the one whose only job was to close the window Cmd+Q already closes.
 *
 * WHAT IS PROVEN AND WHAT IS NOT. The walk below is pure and unit-tested. The
 * step after it -- that AppKit then declines to match Cmd+W and lets the key
 * fall through to the page -- is a property of the platform, not of this
 * code, and it cannot be asserted without launching the app and typing into
 * it. It rests on hidden and disabled items failing menu-item validation, so
 * `performKeyEquivalent` returns NO and the responder chain carries on. Both
 * flags are set rather than one, and the menu is re-applied afterwards so the
 * change is not left to in-place mutation semantics. If a future launch test
 * ever shows Cmd+W still closing the window, this is the file to fix -- not
 * the binding in `chords.ts`.
 */

import { Menu } from 'electron';

/** The slice of a menu this walks, so the walk is testable without electron. */
type MenuItemLike = {
  role?: string | undefined;
  enabled?: boolean;
  visible?: boolean;
  submenu?: MenuLike | undefined;
};
type MenuLike = { items: MenuItemLike[] } | null | undefined;

/**
 * Disable and hide the `close` role wherever it sits in the tree. Returns
 * whether one was found, so a caller can say so rather than assume it.
 */
export function releaseCloseItem(menu: MenuLike): boolean {
  if (menu === null || menu === undefined) {
    return false;
  }
  let found = false;
  for (const item of menu.items) {
    if (item.role === 'close') {
      item.enabled = false;
      item.visible = false;
      found = true;
      continue;
    }
    if (releaseCloseItem(item.submenu)) {
      found = true;
    }
  }
  return found;
}

/**
 * Do it to the live application menu. Called once at startup; safe to call
 * when there is no menu (Linux and Windows builds may have none), where it
 * simply reports that nothing needed releasing.
 */
export function releaseCloseAccelerator(): boolean {
  const menu = Menu.getApplicationMenu();
  const released = releaseCloseItem(menu as unknown as MenuLike);
  if (released && menu !== null) {
    // Re-applied rather than trusting in-place mutation to reach the native
    // menu on every platform.
    Menu.setApplicationMenu(menu);
  }
  return released;
}
