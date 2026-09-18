/**
 * vam builds its own application menu.
 *
 * With no `Menu.setApplicationMenu` call, Electron installs its DEFAULT
 * template, and a native menu matches its key equivalents BEFORE the keydown
 * reaches the page. Read off the built menu of the launched app, that default
 * claimed:
 *
 *   View > Actual Size   [resetzoom]  CommandOrControl+0
 *   View > Zoom In       [zoomin]     CommandOrControl+Plus
 *   View > Zoom Out      [zoomout]    CommandOrControl+-
 *   File > Close Window  [close]      CommandOrControl+W
 *
 * All four are keys vam wants: the operator asked for zoom to be gone, and
 * `src/renderer/keyboard/chords.ts` binds `Mod-w` to close the focused
 * SESSION. This file used to hide and disable that `close` item and hope
 * AppKit's validation would then decline the key -- a platform property it
 * admitted it could not assert. Owning the template removes the question:
 * the item is not there, so there is nothing to match.
 *
 * ADDED SINCE: a View menu with ONE item, `reload` (Cmd+R). vam had no
 * refresh at all once the default menu went, and the operator asked for one.
 * It is built by hand rather than taken from `viewMenu`, which would bring the
 * three zoom roles back with it -- see `reloadItem` below.
 *
 * KEPT DELIBERATELY: on macOS the clipboard works THROUGH the menu, so
 * dropping the Edit roles kills Cmd+C/V/X/A app-wide with no error anywhere.
 * `appMenu`/`editMenu`/`fileMenu` are taken as Electron's own roles rather
 * than retyped, and `test/electron/launch.test.ts` asserts each surviving
 * role off the BUILT menu. `viewMenu` is the one standard role not used: it
 * is where `resetZoom`, `zoomIn` and `zoomOut` live.
 */

import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * By hand, because Electron's `windowMenu` role contains `role: 'close'` on
 * macOS -- the Cmd+W this exists to give back to the renderer.
 *
 * `role: 'zoom'` is the macOS green-button WINDOW zoom. It carries no
 * accelerator and is unrelated to page zoom.
 */
function windowSubmenu(isMac: boolean): MenuItemConstructorOptions[] {
  if (!isMac) {
    return [{ role: 'minimize' }];
  }
  return [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }];
}

/**
 * Reload, and the reason it is a MENU ITEM rather than a chord.
 *
 * Operator: "Cmd+R to refresh vam." Owning the template above removed
 * Electron's default menu, and the `reload` role went with it -- so Cmd+R did
 * nothing at all in the packaged app.
 *
 * A binding in `chords.ts` would have answered the KEY without answering the
 * REASON: the moment worth reloading for is the one where the renderer is
 * wedged, and a wedged renderer does not answer keydowns. A native key
 * equivalent is matched BEFORE the page sees it -- the property this file's
 * header treats as a hazard for every other key, and the whole point for this
 * one.
 *
 * BY HAND, NOT `role: 'viewMenu'`: that role carries `resetZoom`, `zoomIn` and
 * `zoomOut`, which are exactly the three key equivalents this file exists to
 * keep out of the menu. One item, named, with its accelerator written down
 * rather than inherited from Electron's defaults.
 *
 * `reload` and not `forceReload`: a soft reload re-runs the renderer from the
 * files it already has, which is what "refresh vam" means. `forceReload`
 * bypasses the cache, which matters to a browser and not to an app whose
 * renderer is loaded off disk.
 */
function reloadItem(): MenuItemConstructorOptions {
  return { role: 'reload', label: 'Reload', accelerator: 'CommandOrControl+R' };
}

/** The template as a value, so the non-darwin branch is reachable in a test. */
export function buildMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin';
  return [
    // macOS: About/Services/Hide/Quit. Elsewhere `fileMenu`, which is where
    // Quit lives -- the only way out once the default menu is gone.
    isMac ? { role: 'appMenu' } : { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [reloadItem()] },
    { label: 'Window', role: 'window', submenu: windowSubmenu(isMac) },
  ];
}

/** Install it. Called once, at `app.whenReady`, before the window exists. */
export function applyApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(process.platform)));
}
