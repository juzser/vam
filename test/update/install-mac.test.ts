import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appBundleFromExecPath,
  launchMacInstall,
  macInstallBlocker,
  macInstallScript,
  prepareMacInstall,
  shellQuote,
} from '../../src/main/update/install-mac.js';
import { fakeChild } from './fake-child.js';

const posix = process.platform !== 'win32';
const MSG = 'Move vam to /Applications and try again';

describe('appBundleFromExecPath', () => {
  it('finds the .app bundle of a packaged executable', () => {
    expect(appBundleFromExecPath('/Applications/vam.app/Contents/MacOS/vam')).toBe(
      '/Applications/vam.app',
    );
  });
  it('is null outside a bundle (dev electron, random binary)', () => {
    expect(appBundleFromExecPath('/usr/local/bin/node')).toBeNull();
    expect(appBundleFromExecPath('/Applications/vam.app/Contents/Frameworks/x')).toBeNull();
  });
});

describe('macInstallBlocker', () => {
  const writable = { isWritable: () => true };
  const ro = { isWritable: () => false };
  it('allows a writable /Applications install', () => {
    expect(macInstallBlocker('/Applications/vam.app', writable)).toBeNull();
  });
  it('refuses an App Translocation path, even when writable', () => {
    const b = macInstallBlocker('/private/var/folders/x/AppTranslocation/ABC/d/vam.app', writable);
    expect(b).toEqual({ code: 'translocated', message: MSG });
  });
  it('refuses a mounted disk image that is not writable', () => {
    expect(macInstallBlocker('/Volumes/vam/vam.app', ro)).toEqual({
      code: 'read-only',
      message: MSG,
    });
  });
  it('refuses any other non-writable location', () => {
    expect(macInstallBlocker('/Applications/vam.app', ro)).toEqual({
      code: 'not-writable',
      message: MSG,
    });
  });
  it('asks writability of the parent directory, where the swap happens', () => {
    const asked: string[] = [];
    macInstallBlocker('/Applications/vam.app', {
      isWritable: (p) => {
        asked.push(p);
        return true;
      },
    });
    expect(asked).toEqual(['/Applications']);
  });
});

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded single quotes', () => {
    expect(shellQuote('/a b/c')).toBe("'/a b/c'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

const base = {
  pid: 4242,
  appPath: "/Applications/my apps/it's vam.app",
  newAppPath: '/Users/x/Library/Application Support/vam/updates/staging-0.2.0/vam.app',
  stagingDir: '/Users/x/Library/Application Support/vam/updates/staging-0.2.0',
  backupPath: "/Applications/my apps/it's vam.app.update-backup",
  logPath: '/Users/x/Library/Application Support/vam/updates/install.log',
};

describe('macInstallScript', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vam-mac-script-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('quotes every path so spaces and single quotes cannot break out', () => {
    const script = macInstallScript(base);
    expect(script).toContain(shellQuote(base.appPath));
    expect(script).toContain(shellQuote(base.newAppPath));
    expect(script).toContain(shellQuote(base.backupPath));
    expect(script).toContain(shellQuote(base.logPath));
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
  });

  it.skipIf(!posix)('is valid sh (sh -n), also with hostile paths', () => {
    const file = join(dir, 'a.sh');
    writeFileSync(file, macInstallScript(base));
    const r = spawnSync('/bin/sh', ['-n', file], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const hostile = macInstallScript({ ...base, appPath: `/tmp/$(touch pwn)"; \`x\` '\n.app` });
    writeFileSync(file, hostile);
    expect(spawnSync('/bin/sh', ['-n', file]).status).toBe(0);
  });
});

describe.skipIf(!posix)('macInstallScript run against fake bundles', () => {
  let dir: string;
  let bin: string;
  let app: string;
  let staging: string;
  let newApp: string;
  let backup: string;
  let log: string;
  let calls: string;

  function put(path: string, text: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  function stub(name: string): string {
    const p = join(bin, name);
    writeFileSync(p, `#!/bin/sh\necho "${name} $*" >> ${shellQuote(calls)}\n`);
    chmodSync(p, 0o755);
    return p;
  }
  function run(opts: Partial<Parameters<typeof macInstallScript>[0]> = {}) {
    // A spawned-and-exited child is a pid that is certainly not alive.
    const dead = spawnSync('/usr/bin/true').pid;
    const script = macInstallScript({
      pid: dead,
      appPath: app,
      newAppPath: newApp,
      stagingDir: staging,
      backupPath: backup,
      logPath: log,
      waitSeconds: 2,
      commands: { open: stub('open'), xattr: stub('xattr') },
      ...opts,
    });
    const file = join(dir, 'install.sh');
    writeFileSync(file, script, { mode: 0o700 });
    return spawnSync('/bin/sh', [file], { encoding: 'utf8' });
  }
  const read = (p: string) => readFileSync(p, 'utf8');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vam mac it's-"));
    bin = join(dir, 'bin');
    mkdirSync(bin);
    app = join(dir, 'Apps dir', "vam's.app");
    staging = join(dir, 'updates', 'staging-0.2.0');
    newApp = join(staging, 'vam.app');
    backup = `${app}.update-backup`;
    log = join(dir, 'updates', 'install.log');
    calls = join(dir, 'calls.txt');
    writeFileSync(calls, '');
    put(join(app, 'Contents', 'v'), 'old');
    put(join(newApp, 'Contents', 'v'), 'new');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('swaps the bundle, clears quarantine, removes backup and staging, relaunches the new app', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(read(join(app, 'Contents', 'v'))).toBe('new');
    expect(existsSync(backup)).toBe(false);
    expect(existsSync(staging)).toBe(false);
    const c = read(calls);
    expect(c).toContain(`xattr -cr ${app}`);
    expect(c).toContain(`open ${app}`);
    expect(existsSync(log)).toBe(true);
  });

  it('rolls back and relaunches the old app when the new bundle cannot be moved in', () => {
    rmSync(newApp, { recursive: true });
    const r = run();
    expect(r.status).not.toBe(0);
    expect(read(join(app, 'Contents', 'v'))).toBe('old');
    expect(existsSync(backup)).toBe(false);
    expect(read(calls)).toContain(`open ${app}`);
    expect(read(log)).toMatch(/rolled back/i);
  });

  it('leaves the old app untouched when it cannot be moved aside', () => {
    const r = run({ backupPath: join(dir, 'no', 'such', 'dir', 'b.app') });
    expect(r.status).not.toBe(0);
    expect(read(join(app, 'Contents', 'v'))).toBe('old');
    expect(existsSync(newApp)).toBe(true);
    expect(read(calls)).toContain(`open ${app}`);
  });

  it('aborts untouched when the app never exits within the timeout', () => {
    const r = run({ pid: process.pid, waitSeconds: 1 });
    expect(r.status).not.toBe(0);
    expect(read(join(app, 'Contents', 'v'))).toBe('old');
    expect(existsSync(newApp)).toBe(true);
    expect(read(calls)).toBe('');
    expect(read(log)).toMatch(/timed out/i);
  });
});

describe('prepareMacInstall', () => {
  function deps(over: Record<string, unknown> = {}) {
    const calls: Array<[string, string[]]> = [];
    const removed: string[] = [];
    const made: string[] = [];
    const written: Array<{ path: string; mode: number | undefined }> = [];
    return {
      calls,
      removed,
      made,
      written,
      d: {
        isWritable: () => true,
        exec: async (cmd: string, args: string[]) => {
          calls.push([cmd, args]);
          return { stdout: cmd.endsWith('plutil') ? '0.2.0\n' : '' };
        },
        rm: async (p: string) => {
          removed.push(p);
        },
        mkdir: async (p: string) => {
          made.push(p);
        },
        writeFile: async (p: string, _t: string, mode: number) => {
          written.push({ path: p, mode });
        },
        ...over,
      },
    };
  }
  const input = {
    version: '0.2.0',
    zipPath: '/u/updates/vam-0.2.0-mac-arm64.zip',
    updatesDir: '/u/updates',
    execPath: '/Applications/vam.app/Contents/MacOS/vam',
    pid: 99,
  };

  it('extracts with ditto into staging-<version>, verifies the version, writes a 0o700 script', async () => {
    const { d, calls, written, removed, made } = deps();
    const r = await prepareMacInstall(input, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(removed).toContain('/u/updates/staging-0.2.0');
    expect(made).toContain('/u/updates/staging-0.2.0');
    expect(calls[0]).toEqual([
      '/usr/bin/ditto',
      ['-x', '-k', input.zipPath, '/u/updates/staging-0.2.0'],
    ]);
    expect(calls[1]?.[0]).toBe('/usr/bin/plutil');
    expect(calls[1]?.[1]).toContain('/u/updates/staging-0.2.0/vam.app/Contents/Info.plist');
    expect(written[0]?.mode).toBe(0o700);
    expect(r.handle.kind).toBe('mac-zip');
    expect(r.handle.scriptPath).toBe(written[0]?.path);
  });

  it('refuses translocated installs before touching anything', async () => {
    const { d, calls } = deps();
    const r = await prepareMacInstall(
      { ...input, execPath: '/private/var/x/AppTranslocation/A/d/vam.app/Contents/MacOS/vam' },
      d,
    );
    expect(r).toMatchObject({ ok: false, code: 'translocated', message: MSG });
    expect(calls).toEqual([]);
  });

  it('is unsupported-install when not running from a bundle', async () => {
    const { d } = deps();
    const r = await prepareMacInstall({ ...input, execPath: '/opt/electron' }, d);
    expect(r).toMatchObject({ ok: false, code: 'unsupported-install' });
  });

  it('fails install-failed and cleans staging when the zip version differs', async () => {
    const { d, removed } = deps({
      exec: async (cmd: string) => ({ stdout: cmd.endsWith('plutil') ? '0.1.9\n' : '' }),
    });
    const r = await prepareMacInstall(input, d);
    expect(r).toMatchObject({ ok: false, code: 'install-failed' });
    expect(removed.filter((p) => p === '/u/updates/staging-0.2.0').length).toBe(2);
  });

  it('fails install-failed when ditto fails', async () => {
    const { d } = deps({
      exec: async () => {
        throw new Error('ditto: boom');
      },
    });
    const r = await prepareMacInstall(input, d);
    expect(r).toMatchObject({ ok: false, code: 'install-failed' });
  });
});

describe('launchMacInstall', () => {
  const handle = { kind: 'mac-zip', scriptPath: '/u/updates/install-0.2.0.sh' } as const;
  it('runs the script through /bin/sh, detached, unref-ed', async () => {
    const unref = vi.fn();
    const spawner = vi.fn(() => fakeChild({ unref }));
    await launchMacInstall(handle, spawner);
    expect(spawner).toHaveBeenCalledWith('/bin/sh', [handle.scriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    expect(unref).toHaveBeenCalled();
  });
  it('survives a spawn error and settles', async () => {
    const child = fakeChild({ error: new Error('EAGAIN') });
    await expect(launchMacInstall(handle, () => child)).resolves.toBeUndefined();
    expect(child.listenerCount('error')).toBeGreaterThan(0);
  });
  it('never hangs when the child emits nothing', async () => {
    await launchMacInstall(handle, () => fakeChild({ silent: true }), 20);
  });
});
