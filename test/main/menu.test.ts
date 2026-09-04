/**
 * Releasing Cmd+W from the window, so the canvas can have it.
 *
 * `src/main/index.ts` never builds an application menu, so Electron installs
 * its DEFAULT one, whose Window submenu carries `role: 'close'` with the
 * accelerator Cmd+W. On macOS a native menu's key equivalent is matched
 * before the key reaches the page, so the renderer's `Mod-w` binding would
 * be dead in the packaged app while passing every renderer test.
 *
 * The walk is pure and is what this file asserts. The one thing it cannot
 * assert is the AppKit behaviour on the other side of the mutation -- see the
 * comment in `src/main/menu.ts`.
 */

import { describe, expect, it } from 'vitest';
import { releaseCloseItem } from '../../src/main/menu.js';

type Item = {
  role?: string;
  label?: string;
  enabled?: boolean;
  visible?: boolean;
  submenu?: { items: Item[] } | undefined;
};

const defaultishMenu = () => ({
  items: [
    { label: 'vam', submenu: { items: [{ role: 'quit', enabled: true, visible: true }] } },
    {
      label: 'Window',
      submenu: {
        items: [
          { role: 'minimize', enabled: true, visible: true },
          { role: 'close', label: 'Close Window', enabled: true, visible: true },
        ],
      },
    },
  ] as Item[],
});

describe('releaseCloseItem', () => {
  it('finds the close item however deep the submenu is, and takes it out of play', () => {
    const menu = defaultishMenu();
    expect(releaseCloseItem(menu)).toBe(true);
    const close = menu.items[1]?.submenu?.items[1];
    expect(close?.enabled).toBe(false);
    expect(close?.visible).toBe(false);
  });

  it('leaves every other item alone — Quit above all', () => {
    const menu = defaultishMenu();
    releaseCloseItem(menu);
    const quit = menu.items[0]?.submenu?.items[0];
    expect(quit?.enabled).toBe(true);
    expect(quit?.visible).toBe(true);
    expect(menu.items[1]?.submenu?.items[0]?.enabled).toBe(true);
  });

  it('reports honestly when there is no close item to release', () => {
    expect(releaseCloseItem({ items: [{ role: 'quit' }] })).toBe(false);
  });

  it('answers false for no menu at all, rather than throwing into app startup', () => {
    expect(releaseCloseItem(null)).toBe(false);
  });
});
