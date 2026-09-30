import { describe, expect, it, vi } from 'vitest';
import {
  launchWinInstall,
  nsisUninstallerPath,
  prepareWinInstall,
  winInstallArgs,
} from '../../src/main/update/install-win.js';

describe('winInstallArgs', () => {
  it('is silent, marks the run as an update, and starts the app afterwards', () => {
    expect(winInstallArgs()).toEqual(['/S', '--updated', '--force-run']);
  });
});

describe('nsisUninstallerPath', () => {
  it('sits beside the app executable', () => {
    expect(nsisUninstallerPath('C:\\P\\vam\\vam.exe')).toBe('C:\\P\\vam\\Uninstall vam.exe');
  });
});

describe('prepareWinInstall', () => {
  const isFile = () => true;
  it('accepts the setup exe inside the updates dir', () => {
    const r = prepareWinInstall(
      {
        installerPath: 'C:\\U\\updates\\vam-0.2.0-win-x64-setup.exe',
        updatesDir: 'C:\\U\\updates',
      },
      { isFile },
    );
    expect(r).toEqual({
      ok: true,
      handle: { kind: 'nsis', installerPath: 'C:\\U\\updates\\vam-0.2.0-win-x64-setup.exe' },
    });
  });
  it('rejects a path outside the updates dir or that is not an exe', () => {
    expect(
      prepareWinInstall(
        { installerPath: 'C:\\Other\\a.exe', updatesDir: 'C:\\U\\updates' },
        { isFile },
      ),
    ).toMatchObject({ ok: false, code: 'install-failed' });
    expect(
      prepareWinInstall(
        { installerPath: 'C:\\U\\updates\\a.zip', updatesDir: 'C:\\U\\updates' },
        { isFile },
      ),
    ).toMatchObject({ ok: false });
  });
  it('rejects a missing file', () => {
    expect(
      prepareWinInstall(
        { installerPath: 'C:\\U\\updates\\a.exe', updatesDir: 'C:\\U\\updates' },
        { isFile: () => false },
      ),
    ).toMatchObject({ ok: false, code: 'install-failed' });
  });
});

describe('launchWinInstall', () => {
  it('spawns the installer detached, hidden, unref-ed', () => {
    const unref = vi.fn();
    const spawner = vi.fn(() => ({ unref }));
    launchWinInstall({ kind: 'nsis', installerPath: 'C:\\U\\setup.exe' }, spawner);
    expect(spawner).toHaveBeenCalledWith('C:\\U\\setup.exe', ['/S', '--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(unref).toHaveBeenCalled();
  });
});
