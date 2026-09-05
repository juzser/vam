/**
 * A registry vam could not read, and a write that did not land.
 *
 * Refusing every request when the file cannot be read is right: an unreadable
 * registry authorises nobody. OVERWRITING IT ON THE NEXT GRANT IS NOT, and
 * the two were one decision -- `read` swallowed every error into "no
 * devices", so the next pairing wrote a one-device file over whatever was
 * there. And a grant whose durable write failed reached no desktop surface at
 * all: the prompt vanished and the screen went back to waiting.
 *
 * Every path here is a fresh temporary directory. No token is a real one.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDeviceRegistry } from '../../../src/main/remote/devices.js';

const fresh = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), 'vam-registry-')), 'remote-devices.json');

describe('a device registry that could not be read', () => {
  it('refuses every token, and refuses to overwrite the file it could not read', async () => {
    const path = await fresh();
    const corrupt = '{"version":1,"devices":[{"deviceId":"d1","token":"t1"';
    await writeFile(path, corrupt);
    const registry = await openDeviceRegistry({ path });

    // Fail closed, unchanged: nothing is admitted on a file vam cannot read.
    expect(registry.find('t1')).toBeNull();
    expect(registry.list()).toEqual([]);
    // ...but the desktop is told the difference between this and "empty".
    expect(registry.trouble()).toBe('unreadable');
    await expect(registry.grant('a phone')).rejects.toThrow(/could not be read/i);
    expect(await readFile(path, 'utf8')).toBe(corrupt);
  });

  it('still reads a missing file as no devices, which is what it means', async () => {
    const registry = await openDeviceRegistry({ path: await fresh() });
    expect(registry.trouble()).toBeNull();
    await expect(registry.grant('a phone')).resolves.toBeTruthy();
  });
});

describe('a grant whose durable write failed', () => {
  it('rejects and records the failure, so a desktop surface can say it', async () => {
    const path = await fresh();
    const registry = await openDeviceRegistry({ path });
    expect(registry.trouble()).toBeNull();
    // The write cannot land: the name the registry renames onto is a
    // directory. Same shape as a full or read-only volume from here.
    await mkdir(path, { recursive: true });

    await expect(registry.grant('a phone')).rejects.toThrow();
    expect(registry.trouble()).toBe('write-failed');
    // A credential is not valid until its durable write succeeded.
    expect(registry.list()).toEqual([]);
  });
});
