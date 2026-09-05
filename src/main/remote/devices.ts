/**
 * The paired devices, and the tokens that name them.
 *
 * PER-DEVICE TOKENS, NOT ONE SHARED SECRET. Compromising one device must not
 * expose the others, and revoking one must not lock out the rest -- which is
 * also the only reason the "Paired devices" list can offer Remove at all. A
 * pairing you cannot undo is one you should not offer.
 *
 * Two orderings here are load-bearing:
 *
 *  - A CREDENTIAL IS NOT VALID UNTIL ITS DURABLE WRITE SUCCEEDS. `grant`
 *    persists before it returns the token, so a phone never holds one this
 *    machine will forget on restart.
 *  - REMOVAL PERSISTS BEFORE THE IN-MEMORY SWAP. A revocation that took effect
 *    in memory and failed on disk would come back at the next launch, which is
 *    the one direction a revocation must never fail in.
 *
 * The file lives under Electron `userData` with owner-only permissions. That
 * is a speed bump, not a boundary: anything running as the operator can read
 * it, exactly as it can read the sessions this endpoint serves.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { constantTimeEquals, type DeviceDirectory, type Identity } from './auth.js';

/** 32 bytes: 256 bits, base64url, never in a URL, hash or query string. */
const TOKEN_BYTES = 32;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** What the desktop list renders. NO TOKEN: it is returned once and never again. */
export type PairedDevice = {
  readonly deviceId: string;
  readonly name: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number;
};

type StoredDevice = PairedDevice & { readonly token: string };

export type Grant = { readonly identity: Identity; readonly token: string };

export type DeviceRegistry = DeviceDirectory & {
  list(): readonly PairedDevice[];
  grant(name: string): Promise<Grant>;
  remove(deviceId: string): Promise<void>;
  removeAll(): Promise<void>;
};

export type RegistryOptions = {
  readonly path: string;
  readonly now?: () => number;
  /** Called once per revoked device, so the server can drop its SSE stream. */
  readonly onRevoked?: (deviceId: string) => void;
};

/** The registry's home under Electron `userData`. */
export const registryPath = (userData: string): string => join(userData, 'remote-devices.json');

const isDevice = (value: unknown): value is StoredDevice => {
  const row = value as Record<string, unknown> | null;
  return (
    typeof row === 'object' &&
    row !== null &&
    typeof row.deviceId === 'string' &&
    typeof row.token === 'string' &&
    typeof row.name === 'string' &&
    typeof row.pairedAt === 'number' &&
    typeof row.lastSeenAt === 'number'
  );
};

async function read(path: string): Promise<StoredDevice[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const rows = (parsed as { devices?: unknown }).devices;
    // A file we cannot read is NO DEVICES, never "every device": the safe
    // direction is the one that refuses requests rather than admitting them.
    return Array.isArray(rows) ? rows.filter(isDevice) : [];
  } catch {
    return [];
  }
}

async function persist(path: string, devices: readonly StoredDevice[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
  await chmod(dirname(path), DIR_MODE);
  // Written beside the target and renamed: a crash mid-write must not leave a
  // half-file that reads as "no devices" and silently unpairs everything.
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, devices }), { mode: FILE_MODE });
  await chmod(temporary, FILE_MODE);
  await rename(temporary, path);
}

export async function openDeviceRegistry(options: RegistryOptions): Promise<DeviceRegistry> {
  const now = options.now ?? (() => Date.now());
  // The directory is created and hardened AT OPEN, so a registry this process
  // could never write is a refusal to start rather than a pairing that fails
  // at the moment the operator tries to use it.
  await mkdir(dirname(options.path), { recursive: true, mode: DIR_MODE });
  await chmod(dirname(options.path), DIR_MODE);
  let devices = await read(options.path);

  const identityOf = (device: StoredDevice): Identity => ({
    deviceId: device.deviceId,
    name: device.name,
  });

  return {
    /**
     * CONSTANT TIME OVER EVERY ENTRY. The loop does not `break` and does not
     * return early on a miss: an early exit answers faster the fewer entries
     * it walked, which leaks how far down the list a guess landed. The
     * comparison itself is `constantTimeEquals`, never `===`.
     *
     * A unit test cannot see any of this -- a timing property is invisible to
     * an assertion. THIS COMMENT AND REVIEW ARE THE GUARD.
     */
    find(token: string): Identity | null {
      let found: StoredDevice | null = null;
      for (const device of devices) {
        if (constantTimeEquals(device.token, token)) {
          found = device;
        }
      }
      if (found === null) {
        return null;
      }
      // Last-seen is kept in memory and written out by the next durable
      // change: a disk write per request would put the file system in the
      // request path, and this figure is a convenience, not a credential.
      devices = devices.map((device) =>
        device.deviceId === found.deviceId ? { ...device, lastSeenAt: now() } : device,
      );
      return identityOf(found);
    },

    list(): readonly PairedDevice[] {
      return devices.map(({ token: _token, ...rest }) => rest);
    },

    async grant(name: string): Promise<Grant> {
      const at = now();
      const device: StoredDevice = {
        deviceId: randomUUID(),
        name,
        token: randomBytes(TOKEN_BYTES).toString('base64url'),
        pairedAt: at,
        lastSeenAt: at,
      };
      const next = [...devices, device];
      // Persist FIRST. A token this machine would forget is worse than a
      // pairing that visibly failed.
      await persist(options.path, next);
      devices = next;
      return { identity: identityOf(device), token: device.token };
    },

    async remove(deviceId: string): Promise<void> {
      const next = devices.filter((device) => device.deviceId !== deviceId);
      if (next.length === devices.length) {
        return;
      }
      await persist(options.path, next);
      devices = next;
      options.onRevoked?.(deviceId);
    },

    async removeAll(): Promise<void> {
      const revoked = devices.map((device) => device.deviceId);
      await persist(options.path, []);
      devices = [];
      for (const deviceId of revoked) {
        options.onRevoked?.(deviceId);
      }
    },
  };
}
