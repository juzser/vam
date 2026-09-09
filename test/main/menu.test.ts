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
});
