/**
 * THE AD-HOC SIGNATURE THE PACKAGED MAC APP CARRIES, and why.
 *
 * With `mac.identity: null`, electron-builder signs nothing, and what ships
 * is Electron's own LINKER-SIGNED binary: `codesign -dv` reads
 * `Identifier=Electron`, `flags=0x20002(adhoc,linker-signed)`, `Sealed
 * Resources=none`. macOS's notification centre identifies an application by
 * its code signature, not by `Info.plist`, so that bundle has no identity of
 * its own to be granted anything under -- measured, not assumed: there is no
 * record for vam in `com.apple.ncprefs.plist` at all, and a notification from
 * it fails with `UNErrorDomain error 1`.
 *
 * A real ad-hoc signature (`codesign --force --deep --sign -` with
 * `--identifier com.vam.app`) is free, needs no certificate, and gives the
 * bundle a stable identity with sealed resources. It is NOT notarisation and
 * NOT a Developer ID: Gatekeeper still interrupts the first launch exactly as
 * before. What it changes is that the bundle can be told apart from every
 * other Electron app on the machine.
 *
 * This file pins the hook's decisions. The bundle itself is verified by
 * running `codesign` on the real output of `electron-builder --dir`, which is
 * a build step and not a unit test; the argv here is the same one.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const HOOK = fileURLToPath(new URL('../../scripts/adhoc-sign-mac.cjs', import.meta.url));
const CONFIG = fileURLToPath(new URL('../../electron-builder.config.cjs', import.meta.url));

type Context = {
  readonly electronPlatformName: string;
  readonly appOutDir: string;
  readonly packager: { readonly appInfo: { readonly productFilename: string } };
};

type Hook = {
  readonly IDENTIFIER: string;
  readonly signArgv: (appPath: string) => readonly string[];
  readonly afterPack: (
    context: Context,
    run?: (file: string, args: readonly string[]) => void,
  ) => Promise<boolean>;
};

const hook = require(HOOK) as Hook;

const mac: Context = {
  electronPlatformName: 'darwin',
  appOutDir: '/tmp/dist-app/mac-arm64',
  packager: { appInfo: { productFilename: 'vam' } },
};

describe('the argv', () => {
  it('is a real ad-hoc signature with the app’s own identifier and sealed resources', () => {
    expect(hook.IDENTIFIER).toBe('com.vam.app');
    expect(hook.signArgv('/x/vam.app')).toEqual([
      '--force',
      '--deep',
      '--sign',
      '-',
      '--identifier',
      'com.vam.app',
      '/x/vam.app',
    ]);
  });

  it('uses the appId the config declares, so the two cannot drift', () => {
    const config = require(CONFIG) as { readonly appId: string };
    expect(hook.IDENTIFIER).toBe(config.appId);
  });
});

describe('the hook', () => {
  it('signs the .app in the mac output directory', async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const signed = await hook.afterPack(mac, (file, args) => {
      calls.push({ file, args });
    });
    expect(signed).toBe(true);
    expect(calls).toEqual([
      { file: 'codesign', args: hook.signArgv('/tmp/dist-app/mac-arm64/vam.app') },
    ]);
  });

  it('does nothing for linux or windows', async () => {
    for (const platform of ['linux', 'win32']) {
      const calls: unknown[] = [];
      const signed = await hook.afterPack({ ...mac, electronPlatformName: platform }, (file) => {
        calls.push(file);
      });
      expect(signed, platform).toBe(false);
      expect(calls, platform).toEqual([]);
    }
  });

  it('lets a codesign failure fail the build rather than shipping the linker-signed bundle', async () => {
    await expect(
      hook.afterPack(mac, () => {
        throw new Error('codesign: boom');
      }),
    ).rejects.toThrow('codesign: boom');
  });
});

describe('the config', () => {
  it('registers the hook as afterPack, where a real identity would still sign after it', () => {
    // `afterPack` runs BEFORE electron-builder's own signing pass (verified
    // in app-builder-lib's `platformPackager.doPack`), so the day a Developer
    // ID is configured, its signature lands on top of this one and wins. An
    // `afterSign` hook would do the opposite and clobber the real signature.
    const config = require(CONFIG) as { readonly afterPack: unknown; readonly mac: { identity: unknown } };
    expect(config.afterPack).toBe(hook.afterPack);
    expect(config.mac.identity).toBeNull();
  });
});
