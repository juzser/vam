import { describe, expect, it, vi } from 'vitest';
import {
  detectInstallKind,
  installBlocker,
  prepareInstall,
} from '../../src/main/update/install.js';

describe('detectInstallKind', () => {
  const yes = { exists: () => true };
  const no = { exists: () => false };

  it('darwin: a bundle is mac-zip, anything else unsupported', () => {
    expect(detectInstallKind('darwin', {}, '/Applications/vam.app/Contents/MacOS/vam')).toBe(
      'mac-zip',
    );
    expect(detectInstallKind('darwin', {}, '/x/node_modules/electron/dist/Electron')).toBe(
      'unsupported',
    );
  });

  it('linux: APPIMAGE absolute and existing is appimage', () => {
    const env = { APPIMAGE: '/home/u/vam.AppImage' };
    expect(detectInstallKind('linux', env, '/tmp/.mount_x/vam', yes)).toBe('appimage');
    expect(detectInstallKind('linux', env, '/tmp/.mount_x/vam', no)).toBe('unsupported');
    expect(detectInstallKind('linux', {}, '/usr/bin/vam', yes)).toBe('unsupported');
    expect(detectInstallKind('linux', { APPIMAGE: 'rel/vam.AppImage' }, '/x', yes)).toBe(
      'unsupported',
    );
  });

  it('win32: nsis only when the uninstaller sits beside the exe', () => {
    const exec = 'C:\\Users\\u\\AppData\\Local\\Programs\\vam\\vam.exe';
    const seen: string[] = [];
    const kind = detectInstallKind('win32', {}, exec, {
      exists: (p) => {
        seen.push(p);
        return true;
      },
    });
    expect(kind).toBe('nsis');
    expect(seen).toEqual(['C:\\Users\\u\\AppData\\Local\\Programs\\vam\\Uninstall vam.exe']);
    expect(detectInstallKind('win32', {}, exec, no)).toBe('unsupported');
  });

  it('unknown platforms are unsupported', () => {
    expect(detectInstallKind('freebsd', {}, '/x', yes)).toBe('unsupported');
  });
});

describe('installBlocker', () => {
  const execPath = '/Applications/vam.app/Contents/MacOS/vam';
  it('mac: delegates to the location rules', () => {
    expect(installBlocker('mac-zip', { env: {}, execPath }, { isWritable: () => true })).toBeNull();
    expect(
      installBlocker('mac-zip', { env: {}, execPath }, { isWritable: () => false }),
    ).toMatchObject({
      code: 'not-writable',
    });
  });
  it('unsupported is unsupported-install; nsis has no pre-check', () => {
    expect(installBlocker('unsupported', { env: {}, execPath })).toMatchObject({
      code: 'unsupported-install',
    });
    expect(installBlocker('nsis', { env: {}, execPath })).toBeNull();
  });
});

describe('prepareInstall', () => {
  it('refuses an unsupported install without side effects', async () => {
    const r = await prepareInstall({
      kind: 'unsupported',
      version: '0.2.0',
      filePath: '/x',
      updatesDir: '/u',
      execPath: '/x',
      env: {},
      pid: 1,
    });
    expect(r).toMatchObject({ ok: false, code: 'unsupported-install' });
    vi.restoreAllMocks();
  });
});
