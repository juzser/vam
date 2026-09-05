/**
 * The paired devices, on disk.
 *
 * Per-device tokens rather than one shared secret: compromising one device
 * must not expose the others, and revoking one must not lock out the rest.
 *
 * Every token here is generated in-process, no device name is a real one, and
 * every path is a temporary directory. Nothing reaches a network.
 */

import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDeviceRegistry } from '../../../src/main/remote/devices.js';

const roots: string[] = [];

async function fresh(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vam-devices-'));
  roots.push(root);
  return join(root, 'nested', 'devices.json');
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await chmod(root, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

describe('openDeviceRegistry', () => {
  it('starts empty when there is no file yet', async () => {
    const registry = await openDeviceRegistry({ path: await fresh() });
    expect(registry.list()).toEqual([]);
    expect(registry.find('anything at all')).toBeNull();
  });

  it('refuses to open when its directory cannot be created', async () => {
    const path = await fresh();
    // A FILE where the registry's directory belongs: `mkdir` fails with
    // ENOTDIR whatever the process's privileges are.
    await writeFile(dirname(path), 'in the way');
    await expect(openDeviceRegistry({ path })).rejects.toThrow();
  });

  it('grants a token that resolves to the device it named', async () => {
    const registry = await openDeviceRegistry({ path: await fresh() });
    const { identity, token } = await registry.grant('a phone');
    expect(registry.find(token)).toEqual(identity);
    expect(identity.name).toBe('a phone');
  });

  it('mints at least 256 bits, from the CSPRNG', async () => {
    const registry = await openDeviceRegistry({ path: await fresh() });
    const first = await registry.grant('a phone');
    const second = await registry.grant('a tablet');
    expect(Buffer.from(first.token, 'base64url').length).toBeGreaterThanOrEqual(32);
    expect(first.token).not.toBe(second.token);
    expect(first.identity.deviceId).not.toBe(second.identity.deviceId);
  });

  it('returns the token once: the list a UI reads carries no credential', async () => {
    const path = await fresh();
    const registry = await openDeviceRegistry({ path });
    const { token } = await registry.grant('a phone');
    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed[0]).toMatchObject({ name: 'a phone' });
  });

  it('persists the grant BEFORE handing it out, and survives a restart', async () => {
    const path = await fresh();
    const first = await openDeviceRegistry({ path });
    const { identity, token } = await first.grant('a phone');
    const second = await openDeviceRegistry({ path });
    expect(second.find(token)).toEqual(identity);
  });

  it('keeps the file readable by its owner alone', async () => {
    const path = await fresh();
    const registry = await openDeviceRegistry({ path });
    await registry.grant('a phone');
    expect((await stat(path)).mode & 0o077).toBe(0);
    expect((await stat(dirname(path))).mode & 0o077).toBe(0);
  });

  it('refuses a token it never minted, however close', async () => {
    const registry = await openDeviceRegistry({ path: await fresh() });
    const { token } = await registry.grant('a phone');
    expect(registry.find(`${token}x`)).toBeNull();
    expect(registry.find(token.slice(0, -1))).toBeNull();
    expect(registry.find('')).toBeNull();
  });

  it('finds a device among many, without an early exit on the first miss', async () => {
    const registry = await openDeviceRegistry({ path: await fresh() });
    const grants = [];
    for (let i = 0; i < 8; i += 1) {
      grants.push(await registry.grant(`device ${i}`));
    }
    for (const { identity, token } of grants) {
      expect(registry.find(token)).toEqual(identity);
    }
  });

  it('reads a corrupt file as no devices rather than crashing the process', async () => {
    const path = await fresh();
    const registry = await openDeviceRegistry({ path });
    const { token } = await registry.grant('a phone');
    await writeFile(path, 'not json at all');
    const reopened = await openDeviceRegistry({ path });
    expect(reopened.list()).toEqual([]);
    expect(reopened.find(token)).toBeNull();
  });
});

describe('revocation', () => {
  it('removes one device and leaves the others paired', async () => {
    const path = await fresh();
    const registry = await openDeviceRegistry({ path });
    const phone = await registry.grant('a phone');
    const tablet = await registry.grant('a tablet');
    await registry.remove(phone.identity.deviceId);
    expect(registry.find(phone.token)).toBeNull();
    expect(registry.find(tablet.token)).toEqual(tablet.identity);
    expect(JSON.stringify(await readFile(path, 'utf8'))).not.toContain(phone.token);
  });

  it('revokes every device at once', async () => {
    const registry = await openDeviceRegistry({ path: await fresh() });
    const phone = await registry.grant('a phone');
    await registry.grant('a tablet');
    await registry.removeAll();
    expect(registry.list()).toEqual([]);
    expect(registry.find(phone.token)).toBeNull();
  });

  it('tells the server to drop that device, and only that device', async () => {
    const onRevoked = vi.fn();
    const registry = await openDeviceRegistry({ path: await fresh(), onRevoked });
    const phone = await registry.grant('a phone');
    await registry.grant('a tablet');
    await registry.remove(phone.identity.deviceId);
    expect(onRevoked).toHaveBeenCalledTimes(1);
    expect(onRevoked).toHaveBeenCalledWith(phone.identity.deviceId);
  });

  it('persists before the in-memory swap: a failed write leaves the device paired', async () => {
    const path = await fresh();
    const registry = await openDeviceRegistry({ path });
    const phone = await registry.grant('a phone');
    // Replace the containing directory with a FILE: every write below now
    // fails with ENOTDIR, whatever the process's privileges are.
    const dir = dirname(path);
    await rm(dir, { recursive: true, force: true });
    await writeFile(dir, 'in the way');
    await expect(registry.remove(phone.identity.deviceId)).rejects.toThrow();
    // Still paired, because the durable write is what decides.
    expect(registry.find(phone.token)).toEqual(phone.identity);
  });

  it('does not mint a token it could not persist', async () => {
    const path = await fresh();
    const registry = await openDeviceRegistry({ path });
    const dir = dirname(path);
    await rm(dir, { recursive: true, force: true });
    await writeFile(dir, 'in the way');
    await expect(registry.grant('a phone')).rejects.toThrow();
    expect(registry.list()).toEqual([]);
  });
});

describe('last seen', () => {
  it('records when a device was last heard from', async () => {
    let now = 1_000;
    const registry = await openDeviceRegistry({ path: await fresh(), now: () => now });
    const { identity, token } = await registry.grant('a phone');
    expect(registry.list()[0]?.pairedAt).toBe(1_000);
    now = 5_000;
    expect(registry.find(token)).toEqual(identity);
    expect(registry.list()[0]?.lastSeenAt).toBe(5_000);
  });
});
