import { describe, expect, it } from 'vitest';
import { type Manifest, selectAsset } from '../../src/shared/update-manifest.js';

const SHA = `${'A'.repeat(86)}==`;
const f = (name: string, arch: 'arm64' | 'x64', kind: 'mac-zip' | 'nsis' | 'appimage') => ({
  name,
  arch,
  kind,
  size: 1,
  sha512: SHA,
});
const manifest = (platform: Manifest['platform'], files: Manifest['files']): Manifest => ({
  schema: 1,
  version: '0.2.0',
  platform,
  files,
});

describe('selectAsset', () => {
  const mac = manifest('darwin', [
    f('a-arm64.zip', 'arm64', 'mac-zip'),
    f('a-x64.zip', 'x64', 'mac-zip'),
  ]);

  it('picks the file for the running arch', () => {
    expect(
      selectAsset(mac, { platform: 'darwin', arch: 'x64', installKind: 'mac-zip' })?.name,
    ).toBe('a-x64.zip');
    expect(
      selectAsset(mac, { platform: 'darwin', arch: 'arm64', installKind: 'mac-zip' })?.name,
    ).toBe('a-arm64.zip');
  });

  it('never crosses architectures', () => {
    const only = manifest('darwin', [f('a-x64.zip', 'x64', 'mac-zip')]);
    expect(
      selectAsset(only, { platform: 'darwin', arch: 'arm64', installKind: 'mac-zip' }),
    ).toBeNull();
  });

  it('matches the install kind', () => {
    const win = manifest('win32', [f('s.exe', 'x64', 'nsis')]);
    expect(selectAsset(win, { platform: 'win32', arch: 'x64', installKind: 'nsis' })?.name).toBe(
      's.exe',
    );
    expect(
      selectAsset(win, { platform: 'win32', arch: 'x64', installKind: 'unsupported' }),
    ).toBeNull();
    expect(
      selectAsset(win, { platform: 'win32', arch: 'x64', installKind: 'appimage' }),
    ).toBeNull();
  });

  it('returns null on a platform mismatch', () => {
    expect(
      selectAsset(mac, { platform: 'linux', arch: 'x64', installKind: 'appimage' }),
    ).toBeNull();
  });

  it('selects the AppImage on linux', () => {
    const lin = manifest('linux', [f('v.AppImage', 'x64', 'appimage')]);
    expect(
      selectAsset(lin, { platform: 'linux', arch: 'x64', installKind: 'appimage' })?.name,
    ).toBe('v.AppImage');
  });
});
