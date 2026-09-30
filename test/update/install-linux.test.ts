import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  launchLinuxInstall,
  linuxInstallBlocker,
  linuxInstallPlan,
  prepareLinuxInstall,
} from '../../src/main/update/install-linux.js';

describe('linuxInstallPlan', () => {
  it('stages beside the target with mode 0o755', () => {
    expect(linuxInstallPlan('/home/u/apps/vam.AppImage')).toEqual({
      target: '/home/u/apps/vam.AppImage',
      tempPath: '/home/u/apps/.vam.AppImage.update-tmp',
      mode: 0o755,
    });
  });
});

describe('linuxInstallBlocker', () => {
  const ok = { isFile: () => true, isWritable: () => true };
  const env = { APPIMAGE: '/home/u/vam.AppImage' };
  it('allows an existing AppImage in a writable dir', () => {
    expect(linuxInstallBlocker(env, ok)).toBeNull();
  });
  it('needs APPIMAGE to be an absolute existing file', () => {
    expect(linuxInstallBlocker({}, ok)).toMatchObject({ code: 'unsupported-install' });
    expect(linuxInstallBlocker({ APPIMAGE: 'x.AppImage' }, ok)).toMatchObject({
      code: 'unsupported-install',
    });
    expect(linuxInstallBlocker(env, { ...ok, isFile: () => false })).toMatchObject({
      code: 'unsupported-install',
    });
  });
  it('needs a writable directory', () => {
    expect(linuxInstallBlocker(env, { ...ok, isWritable: () => false })).toMatchObject({
      code: 'not-writable',
    });
  });
});

describe('replace an AppImage in a real directory', () => {
  let dir: string;
  let target: string;
  let download: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vam-linux-'));
    mkdirSync(join(dir, 'apps'));
    mkdirSync(join(dir, 'updates'));
    target = join(dir, 'apps', 'vam.AppImage');
    download = join(dir, 'updates', 'vam-0.2.0-linux-x86_64.AppImage');
    writeFileSync(target, 'old');
    chmodSync(target, 0o755);
    writeFileSync(download, 'new', { mode: 0o600 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(process.platform === 'win32')(
    'prepare stages without replacing; launch renames over it, mode 0o755, then relaunches',
    async () => {
      const r = await prepareLinuxInstall({ filePath: download, env: { APPIMAGE: target } });
      expect(r.ok).toBe(true);
      if (!r.ok || r.handle.kind !== 'appimage') return;
      expect(readFileSync(target, 'utf8')).toBe('old');
      expect(statSync(r.handle.plan.tempPath).mode & 0o777).toBe(0o755);

      const unref = vi.fn();
      const spawn = vi.fn(() => ({ unref }));
      const out = await launchLinuxInstall(r.handle, {
        rename: (await import('node:fs/promises')).rename,
        rm: async () => undefined,
        spawn,
      });
      expect(out.replaced).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('new');
      expect(statSync(target).mode & 0o777).toBe(0o755);
      expect(readdirSync(join(dir, 'apps'))).toEqual(['vam.AppImage']);
      expect(spawn).toHaveBeenCalledWith(target, ['--updated'], {
        detached: true,
        stdio: 'ignore',
      });
      expect(unref).toHaveBeenCalled();
    },
  );

  it.skipIf(process.platform === 'win32')(
    'a failed rename drops the staged copy and still relaunches the old file',
    async () => {
      const r = await prepareLinuxInstall({ filePath: download, env: { APPIMAGE: target } });
      if (!r.ok || r.handle.kind !== 'appimage') throw new Error('prepare failed');
      const spawn = vi.fn(() => ({ unref: () => undefined }));
      const out = await launchLinuxInstall(r.handle, {
        rename: async () => {
          throw new Error('EXDEV');
        },
        rm: (await import('node:fs/promises')).rm,
        spawn,
      });
      expect(out.replaced).toBe(false);
      expect(readFileSync(target, 'utf8')).toBe('old');
      expect(readdirSync(join(dir, 'apps'))).toEqual(['vam.AppImage']);
      expect(spawn).toHaveBeenCalled();
    },
  );

  it('prepare fails install-failed and cleans up when the copy fails', async () => {
    const rm = vi.fn(async () => undefined);
    const r = await prepareLinuxInstall(
      { filePath: download, env: { APPIMAGE: target } },
      {
        isFile: () => true,
        isWritable: () => true,
        copyFile: async () => {
          throw new Error('ENOSPC');
        },
        chmod: async () => undefined,
        rm,
      },
    );
    expect(r).toMatchObject({ ok: false, code: 'install-failed' });
    expect(rm).toHaveBeenCalled();
  });
});
