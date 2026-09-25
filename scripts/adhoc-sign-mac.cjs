/**
 * Gives the packaged macOS app a real ad-hoc signature under its own name.
 *
 * WHAT `identity: null` LEAVES BEHIND. electron-builder signs nothing, so the
 * bundle ships with the signature Electron's own build put on the binary:
 * `codesign -dv` reads `Identifier=Electron`, `flags=0x20002(adhoc,linker-signed)`,
 * `Sealed Resources=none`. That is a signature in name only -- no resources
 * are sealed, and the identifier is the framework's, shared with every other
 * unsigned Electron app on the machine.
 *
 * WHY IT MATTERS. macOS's notification centre identifies an application by
 * its CODE SIGNATURE, not by `CFBundleIdentifier` in Info.plist. Measured on
 * the shipped bundle: `~/Library/Preferences/com.apple.ncprefs.plist` has no
 * record for vam at all, and a `Notification` from it fails with
 * `UNErrorDomain error 1` -- there is no identity to attribute anything to.
 *
 * WHAT THIS DOES. `codesign --force --deep --sign - --identifier com.vam.app`
 * on the .app after electron-builder has assembled it: a proper ad-hoc
 * signature (`flags=0x2(adhoc)`), with sealed resources, under the app's own
 * identifier. It needs no certificate and no account, and it makes the build
 * reproducible in the sense the config's `identity: null` comment wants -- the
 * same commit signs the same way on every machine.
 *
 * WHAT IT DOES NOT DO, so nobody reads this as more than it is. It is NOT
 * notarisation and NOT a Developer ID. Gatekeeper interrupts the first launch
 * exactly as before (`README.md`, `docs/signing.md`). Whether the notification
 * centre then delivers to an ad-hoc-signed bundle is a MEASUREMENT the app
 * takes for itself: a refusal is written to the error log verbatim
 * (`src/main/notify/notify.ts`), so the answer is read there, on the
 * operator's own machine, rather than guessed here.
 *
 * `afterPack`, NOT `afterSign`, and the choice is load-bearing. `afterPack`
 * runs before electron-builder's own signing pass (app-builder-lib,
 * `platformPackager.doPack`: `emitAfterPack` -> fuses -> `doSignAfterPack`),
 * so the day a Developer ID is configured, its signature is applied ON TOP of
 * this one and wins. An `afterSign` hook would run after it and clobber the
 * real signature with an ad-hoc one. Fuses are not configured, so nothing
 * touches the binary between this hook and the dmg/zip step.
 *
 * A failure here FAILS THE BUILD. Shipping the linker-signed bundle silently
 * would put the app back in the state this file exists to leave.
 */

const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

/** The same string `electron-builder.config.cjs` declares as `appId`; pinned by test. */
const IDENTIFIER = 'com.vam.app';

/** The argv, as a value, so the test can pin it and the build can run it. */
function signArgv(appPath) {
  return ['--force', '--deep', '--sign', '-', '--identifier', IDENTIFIER, appPath];
}

function runCodesign(file, args) {
  execFileSync(file, args, { stdio: 'inherit' });
}

/**
 * electron-builder's `afterPack` hook. `run` is injectable for the test; the
 * build passes nothing and gets the real `codesign`.
 *
 * @returns whether anything was signed.
 */
async function afterPack(context, run = runCodesign) {
  if (context.electronPlatformName !== 'darwin') {
    return false;
  }
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  run('codesign', signArgv(appPath));
  return true;
}

module.exports = { IDENTIFIER, signArgv, afterPack };
