/**
 * The TEMPLATE, on both platform branches.
 *
 * Deliberately the smaller half. Asserting a template literal is close to
 * reading your own input back, so the real guard is in
 * `test/electron/launch.test.ts`, which walks what `Menu.setApplicationMenu`
 * actually installed in a launched Electron. What only this file can cover is
 * the NON-DARWIN branch, unreachable on the harness's one platform: a Windows
 * build with no way to quit would otherwise ship unnoticed.
 */

import { describe, expect, it } from 'vitest';
import { buildMenuTemplate } from '../../src/main/menu.js';

type Node = { role?: string; submenu?: readonly Node[] };

const roles = (nodes: readonly Node[]): string[] =>
  nodes.flatMap((node) => [
    ...(node.role === undefined ? [] : [node.role]),
    ...roles(node.submenu ?? []),
  ]);

const rolesOn = (platform: NodeJS.Platform): string[] =>
  roles(buildMenuTemplate(platform) as readonly Node[]);

describe('buildMenuTemplate', () => {
  it.each(['darwin', 'win32', 'linux'] as const)(
    'claims no zoom role and no close role on %s',
    (platform) => {
      const found = rolesOn(platform);
      expect(found.filter((r) => ['resetZoom', 'zoomIn', 'zoomOut', 'close'].includes(r))).toEqual(
        [],
      );
      // ...and does not reach them indirectly: `viewMenu` contains all three.
      expect(found).not.toContain('viewMenu');
    },
  );

  it.each(['darwin', 'win32', 'linux'] as const)(
    'keeps the edit roles the clipboard depends on, on %s',
    (platform) => {
      expect(rolesOn(platform)).toContain('editMenu');
    },
  );

  it('gives a non-macOS build a way to quit, which the app menu would not', () => {
    // `appMenu` does not exist off macOS; `fileMenu` is where Quit lives there.
    expect(rolesOn('win32')).toContain('fileMenu');
    expect(rolesOn('darwin')).toContain('appMenu');
  });

  it('omits the macOS-only window items off macOS', () => {
    expect(rolesOn('linux')).not.toContain('front');
    expect(rolesOn('darwin')).toContain('front');
  });

  it.each(['darwin', 'win32', 'linux'] as const)(
    'offers a reload, on %s, because vam had no way to refresh itself at all',
    (platform) => {
      // Operator: "Cmd+R to refresh vam."
      //
      // IT HAS TO BE A MENU ITEM, and that is the whole argument. Owning the
      // template removed Electron's default menu, and with it the `reload`
      // role -- so Cmd+R did nothing in the packaged app. A renderer binding
      // would have answered the key but not the REASON: the moment worth
      // reloading for is the one where the page is wedged, and a wedged page
      // does not answer keydowns. A native key equivalent is matched before
      // the page sees it, which is the same property this file's header
      // treats as a hazard everywhere else and is the point here.
      const found = rolesOn(platform);
      expect(found).toContain('reload');
      // And it does NOT arrive via `viewMenu`, which would bring the three
      // zoom roles back with it.
      expect(found).not.toContain('viewMenu');
    },
  );

  it('spells the accelerator out rather than inheriting it', () => {
    // `role: 'reload'` carries CmdOrCtrl+R on every platform today. Written
    // down, it is a promise this repo keeps rather than one Electron's
    // defaults keep for it -- and `test/electron/launch.test.ts` reads the
    // same string back off the BUILT menu.
    type Item = { accelerator?: string; role?: string; submenu?: readonly Item[] };
    const flat = (nodes: readonly Item[]): Item[] =>
      nodes.flatMap((node) => [node, ...flat(node.submenu ?? [])]);
    const reload = flat(buildMenuTemplate('darwin') as readonly Item[]).find(
      (item) => item.role === 'reload',
    );
    expect(reload?.accelerator).toBe('CommandOrControl+R');
  });
});
