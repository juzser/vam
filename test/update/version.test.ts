import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion, VERSION } from '../../src/shared/update.js';

/**
 * THE VERSION VAM SHOWS, AND WHY IT IS A CONSTANT WITH A TEST BEHIND IT.
 *
 * Operator: "add an update section in settings, show the version and a check
 * for updates button." The version has to be readable by the RENDERER, and the
 * renderer has two builds: the Electron shell, where `app.getVersion()` exists
 * one process away, and a plain page served over HTTP to the paired phone,
 * where it does not exist at all and there is no bridge to ask across.
 *
 * The alternatives were worse. A Vite `define` would have to be added to three
 * configs (`vite.config.ts`, `vite.web.config.ts`, `electron.vite.config.ts`)
 * and a fourth for vitest, and the failure of forgetting one is a build that
 * prints `undefined` at the operator. Importing `package.json` into the
 * renderer drags a dependency list into a bundle to read one string.
 *
 * So: one constant, in the one module both builds already share, and THIS --
 * a test that fails the moment it disagrees with `package.json`, which is the
 * file electron-builder stamps into the app. The duplication is real and it is
 * pinned; a release bump that touches one and not the other is red.
 */
describe('the shipped version', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  };

  it('is exactly what package.json ships', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('is a version this app can compare, or the update check is decorative', () => {
    // `checkForUpdate` returns `up-to-date` when either side does not parse,
    // so a version like `0.1.0-dev` would make "is there a newer one" answer
    // no, forever, quietly.
    expect(parseVersion(VERSION)).not.toBeNull();
  });
});

describe('parseVersion', () => {
  it('accepts a bare release version', () => {
    expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('accepts the `v` prefix GitHub tags conventionally carry', () => {
    expect(parseVersion('v0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
  });

  it('rejects a prerelease, so it can never be offered as an upgrade', () => {
    expect(parseVersion('1.0.0-beta.1')).toBeNull();
    expect(parseVersion('v2.0.0-rc1')).toBeNull();
  });

  it('rejects build metadata, junk and empty input', () => {
    for (const raw of ['1.0.0+build.5', 'nightly', '1.2', '1.2.3.4', '', 'v', 'v1.x.0']) {
      expect(parseVersion(raw), raw).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  const table: ReadonlyArray<readonly [string, string, number]> = [
    ['0.0.0', '0.0.0', 0],
    ['0.0.0', 'v0.1.0', -1],
    // Semver ordering is not string ordering: '0.10.0' < '0.9.0' as text.
    ['0.10.0', '0.9.0', 1],
    ['0.9.0', '0.10.0', -1],
    ['1.0.0', '0.99.99', 1],
    ['v1.2.3', '1.2.4', -1],
    ['1.2.4', 'v1.2.3', 1],
    ['2.0.0', '10.0.0', -1],
    ['v1.0.0', '1.0.0', 0],
  ];

  for (const [a, b, expected] of table) {
    it(`${a} vs ${b} -> ${expected}`, () => {
      const left = parseVersion(a);
      const right = parseVersion(b);
      expect(left).not.toBeNull();
      expect(right).not.toBeNull();
      expect(compareVersions(left as never, right as never)).toBe(expected);
    });
  }
});
