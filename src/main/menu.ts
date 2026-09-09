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

/** The template as a value, so the non-darwin branch is reachable in a test. */
export function buildMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin';
  return [
    // macOS: About/Services/Hide/Quit. Elsewhere `fileMenu`, which is where
    // Quit lives -- the only way out once the default menu is gone.
    isMac ? { role: 'appMenu' } : { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'Window', role: 'window', submenu: windowSubmenu(isMac) },
  ];
}

/** Install it. Called once, at `app.whenReady`, before the window exists. */
export function applyApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(process.platform)));
}
