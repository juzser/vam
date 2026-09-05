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
import type { RegistryTrouble } from './state.js';

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
  /** What is wrong with the file, when "no devices" is not the whole story. */
  trouble(): RegistryTrouble | null;
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

/**
 * TWO DECISIONS, NOT ONE. A file we cannot read is NO DEVICES, never "every
 * device" -- the safe direction refuses requests rather than admitting them.
 * That is authentication, and it stays. It is NOT a licence to overwrite the
 * file: a truncated or unreadable registry that reads as empty and is then
 * replaced by the next grant destroys every other pairing silently. So the
 * caller is told which of the two it got, and only ENOENT is "no devices".
 */
async function read(path: string): Promise<{ devices: StoredDevice[]; unreadable: boolean }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const rows = (parsed as { devices?: unknown }).devices;
    if (!Array.isArray(rows)) return { devices: [], unreadable: true };
    return { devices: rows.filter(isDevice), unreadable: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { devices: [], unreadable: code !== 'ENOENT' };
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

/**
 * The token's device, after looking at EVERY entry. The name is the contract.
 *
 * A `reduce` rather than a loop, deliberately: there is no `break` to add, no
 * `return` to move up, and no shape a later reader can "tidy" into an early
 * exit without visibly rewriting the function. An early exit answers faster
 * the fewer entries it walked, which tells a caller how far down the list its
 * guess landed; `constantTimeEquals` on each entry stops the same leak within
 * one comparison. The upstream design this was studied from uses `===` here.
 *
 * NEITHER PROPERTY IS VISIBLE TO AN ASSERTION -- timing is not something a
 * test can watch. `devices.test.ts` spies on the comparison and counts the
 * calls, which holds the loop's shape; nothing holds `constantTimeEquals`
 * itself but review.
 */
function matchAfterScanningEveryEntry(
  devices: readonly StoredDevice[],
  token: string,
): StoredDevice | null {
  return devices.reduce<StoredDevice | null>(
    (match, device) => (constantTimeEquals(device.token, token) ? device : match),
    null,
  );
}

export async function openDeviceRegistry(options: RegistryOptions): Promise<DeviceRegistry> {
  const now = options.now ?? (() => Date.now());
  // The directory is created and hardened AT OPEN, so a registry this process
  // could never write is a refusal to start rather than a pairing that fails
  // at the moment the operator tries to use it.
  await mkdir(dirname(options.path), { recursive: true, mode: DIR_MODE });
  await chmod(dirname(options.path), DIR_MODE);
  const opened = await read(options.path);
  let devices = opened.devices;
  let problem: RegistryTrouble | null = opened.unreadable ? 'unreadable' : null;

  /**
   * Every durable write goes through here, and it will not run over a file
   * this process could not read. The failure is remembered because the
   * desktop is where the human is: a grant that did not persist otherwise
   * reaches no surface at all (`ipc.ts` reads this into `RemoteState`).
   */
  const durable = async (next: readonly StoredDevice[]): Promise<void> => {
    if (problem === 'unreadable') {
      throw new Error(
        `the device registry at ${options.path} could not be read, so vam will not overwrite it`,
      );
    }
    try {
      await persist(options.path, next);
    } catch (error) {
      problem = 'write-failed';
      throw error;
    }
    problem = null;
  };

  const identityOf = (device: StoredDevice): Identity => ({
    deviceId: device.deviceId,
    name: device.name,
  });

  /**
   * DURABLE WRITES RUN ONE AT A TIME, and each recomputes its result from
   * `devices` INSIDE the critical section.
   *
   * Two concurrent revocations otherwise both capture the same starting list,
   * and the second write puts back the device the first removed -- while
   * `onRevoked` has already fired for it, so the operator watches a device
   * vanish from the list whose token still opens every route. A revocation
   * that reports success has to BE one; this is the ordering rule in the file
   * header, and interleaving is the way it fails without anything throwing.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const serialised = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    find(token: string): Identity | null {
      const found = matchAfterScanningEveryEntry(devices, token);
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

    trouble(): RegistryTrouble | null {
      return problem;
    },

    async grant(name: string): Promise<Grant> {
      return await serialised(async () => {
        const at = now();
        const device: StoredDevice = {
          deviceId: randomUUID(),
          name,
          token: randomBytes(TOKEN_BYTES).toString('base64url'),
          pairedAt: at,
          lastSeenAt: at,
        };
        // Read inside the critical section: a grant that captured `devices`
        // outside it would drop whatever a concurrent revocation removed.
        const next = [...devices, device];
        // Persist FIRST. A token this machine would forget is worse than a
        // pairing that visibly failed.
        await durable(next);
        devices = next;
        return { identity: identityOf(device), token: device.token };
      });
    },

    async remove(deviceId: string): Promise<void> {
      await serialised(async () => {
        const next = devices.filter((device) => device.deviceId !== deviceId);
        if (next.length === devices.length) {
          return;
        }
        await durable(next);
        devices = next;
        // Announced only after the durable write and the swap both succeeded:
        // dropping a device's streams while its token still works is the
        // worst of both answers.
        options.onRevoked?.(deviceId);
      });
    },

    async removeAll(): Promise<void> {
      await serialised(async () => {
        const revoked = devices.map((device) => device.deviceId);
        await durable([]);
        devices = [];
        for (const deviceId of revoked) {
          options.onRevoked?.(deviceId);
        }
      });
    },
  };
}
