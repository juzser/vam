/**
 * THE CI-SIDE GENERATOR OF THE UPDATE FRAGMENT, pinned to the client parser.
 *
 * `scripts/update-manifest.cjs` runs in each release matrix job and writes
 * `dist-app/vam-update-<platform>.json`. The client
 * (`src/shared/update-manifest.ts`) trusts nothing it did not validate, so the
 * two halves must agree on the format: the cross-check below feeds the
 * generator's output to the client's own `parseManifest`.
 *
 * File names are classified by pattern, and the patterns encode a fact read
 * from electron-builder (`builder-util/out/arch.js`, `getArtifactArchName`):
 * for an AppImage the x64 arch is spelled `x86_64`, not `x64`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { fragmentName, parseManifest } from '../../src/shared/update-manifest.js';

const require = createRequire(import.meta.url);
const SCRIPT = fileURLToPath(new URL('../../scripts/update-manifest.cjs', import.meta.url));
const PKG = fileURLToPath(new URL('../../package.json', import.meta.url));

type File = {
  readonly name: string;
  readonly arch: string;
  readonly kind: string;
  readonly size: number;
  readonly sha512: string;
};
type Script = {
  classify(name: string): { arch: string; kind: string } | null;
  sha512Base64(data: Uint8Array | string): string;
  buildManifest(input: { version: string; platform: string; files: File[] }): unknown;
  main(distDir: string, platform: string, opts?: { version?: string }): string;
};
const script = require(SCRIPT) as Script;

// RFC 6234 test vector: SHA-512("abc"), base64.
const ABC_SHA512_B64 =
  '3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==';

describe('classify', () => {
  it.each([
    ['vam-0.2.0-mac-arm64.zip', { arch: 'arm64', kind: 'mac-zip' }],
    ['vam-0.2.0-mac-x64.zip', { arch: 'x64', kind: 'mac-zip' }],
    ['vam-0.2.0-win-x64-setup.exe', { arch: 'x64', kind: 'nsis' }],
    ['vam-0.2.0-win-arm64-setup.exe', { arch: 'arm64', kind: 'nsis' }],
    ['vam-0.2.0-linux-x86_64.AppImage', { arch: 'x64', kind: 'appimage' }],
    ['vam-0.2.0-linux-arm64.AppImage', { arch: 'arm64', kind: 'appimage' }],
    ['vam-0.2.0-rc.1-mac-arm64.zip', { arch: 'arm64', kind: 'mac-zip' }],
  ])('%s', (name, expected) => {
    expect(script.classify(name)).toEqual(expected);
  });

  it.each([
    'vam-0.2.0-mac-arm64.dmg',
    'vam-0.2.0-mac-arm64.zip.blockmap',
    'vam-0.2.0-win-x64.zip',
    'vam-0.2.0-win-x64-setup.exe.blockmap',
    'vam-0.2.0-linux-x64.AppImage', // electron-builder spells it x86_64
    'vam-update-darwin.json',
    'builder-effective-config.yaml',
    'other-0.2.0-mac-arm64.zip',
  ])('ignores %s', (name) => {
    expect(script.classify(name)).toBeNull();
  });
});

describe('sha512Base64', () => {
  it("matches the RFC 6234 vector for 'abc'", () => {
    expect(script.sha512Base64('abc')).toBe(ABC_SHA512_B64);
    expect(script.sha512Base64(Buffer.from('abc'))).toBe(ABC_SHA512_B64);
  });
});

describe('buildManifest', () => {
  it('produces schema 1 with the given files', () => {
    const file: File = {
      name: 'vam-0.2.0-mac-arm64.zip',
      arch: 'arm64',
      kind: 'mac-zip',
      size: 3,
      sha512: ABC_SHA512_B64,
    };
    expect(script.buildManifest({ version: '0.2.0', platform: 'darwin', files: [file] })).toEqual({
      schema: 1,
      version: '0.2.0',
      platform: 'darwin',
      files: [file],
    });
  });
});

describe('main', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function dist(names: readonly string[]): string {
    const d = mkdtempSync(join(tmpdir(), 'vam-manifest-'));
    dirs.push(d);
    for (const n of names) writeFileSync(join(d, n), 'abc');
    // electron-builder leaves `*-unpacked` / `mac-arm64` directories; skipped.
    mkdirSync(join(d, 'mac-arm64'));
    return d;
  }
  const MAC = ['vam-0.2.0-mac-arm64.zip', 'vam-0.2.0-mac-x64.zip'];
  const read = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

  it('writes a fragment the client parser accepts (mac)', () => {
    const d = dist([...MAC, 'vam-0.2.0-mac-arm64.dmg', 'vam-0.2.0-mac-x64.zip.blockmap']);
    const out = script.main(d, 'darwin', { version: '0.2.0' });
    expect(out).toBe(join(d, fragmentName('darwin')));
    const parsed = parseManifest(read(out), { version: 'v0.2.0', platform: 'darwin' });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.files.map((f) => f.name).sort()).toEqual(MAC);
    expect(parsed.files[0]).toMatchObject({ size: 3, sha512: ABC_SHA512_B64 });
  });

  it('writes win32 and linux fragments the client parser accepts', () => {
    const w = dist(['vam-0.2.0-win-x64-setup.exe', 'vam-0.2.0-win-x64.zip']);
    const wp = parseManifest(read(script.main(w, 'win32', { version: '0.2.0' })), {
      version: '0.2.0',
      platform: 'win32',
    });
    expect('error' in wp).toBe(false);
    if ('error' in wp) return;
    expect(wp.files.map((f) => f.kind)).toEqual(['nsis']);

    const l = dist(['vam-0.2.0-linux-x86_64.AppImage']);
    const lp = parseManifest(read(script.main(l, 'linux', { version: '0.2.0' })), {
      version: '0.2.0',
      platform: 'linux',
    });
    expect('error' in lp).toBe(false);
    if ('error' in lp) return;
    expect(lp.files[0]).toMatchObject({ arch: 'x64', kind: 'appimage' });
  });

  it('ignores files from another version', () => {
    const d = dist([...MAC, 'vam-0.1.0-mac-arm64.zip']);
    const m = read(script.main(d, 'darwin', { version: '0.2.0' })) as { files: File[] };
    expect(m.files).toHaveLength(2);
  });

  it('fails when a required asset is missing', () => {
    expect(() =>
      script.main(dist(['vam-0.2.0-mac-arm64.zip']), 'darwin', { version: '0.2.0' }),
    ).toThrow(/x64/);
    expect(() => script.main(dist([]), 'win32', { version: '0.2.0' })).toThrow(/nsis/);
    expect(() => script.main(dist([]), 'linux', { version: '0.2.0' })).toThrow(/appimage/);
  });

  it('rejects an unknown platform', () => {
    expect(() => script.main(dist([]), 'freebsd', { version: '0.2.0' })).toThrow(/platform/);
  });

  it('defaults the version to package.json', () => {
    const pkg = read(PKG) as { version: string };
    const d = dist([`vam-${pkg.version}-linux-x86_64.AppImage`]);
    const m = read(script.main(d, 'linux')) as { version: string };
    expect(m.version).toBe(pkg.version);
  });
});
