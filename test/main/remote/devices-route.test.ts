/**
 * WHAT A PAIRED DEVICE MAY LEARN ABOUT THE OTHER PAIRED DEVICES.
 *
 * Operator instruction: "on mobile the settings part can be removed; remote
 * only needs to show the paired devices". The first half is done in the
 * renderer; this is what makes the second half possible at all, because the
 * phone is the BROWSER build and has no `window.api.remote` -- the pairing
 * screen it was reaching for is an IPC bridge that exists only in the Electron
 * shell. Without a route, the one door left on a phone opens onto an apology.
 *
 * WHAT IT DISCLOSES, and why that is the right amount. The names, ids and
 * timestamps of the devices the operator has paired -- and nothing else. NO
 * TOKEN: `PairedDevice` has no field for one (`devices.ts`: "it is returned
 * once and never again"), so this is not a matter of remembering to strip it.
 * The caller is already a device that can type into a running agent and close
 * sessions; knowing that a phone named "the kitchen iPad" is also paired is a
 * far smaller fact than the ones it already holds.
 *
 * READ-ONLY, AND THE ASYMMETRY IS DELIBERATE. There is no route to remove a
 * device. Revocation from a device that can itself be revoked is a fight the
 * operator cannot referee from either end, and the desktop is the thing that
 * holds the registry file. "Only show the list" is what was asked for and also
 * what is safe.
 *
 * It is an ordinary authenticated route: no token, no route. The sweep in
 * `stream-cookie.test.ts` covers it for the cookie, this file covers the rest.
 */

import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceDirectory, Identity } from '../../../src/main/remote/auth.js';
import type { PairedDevice } from '../../../src/main/remote/devices.js';
import {
  type RemoteServerOptions,
  registeredRoutePaths,
  startRemoteServer,
} from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';

const PAIRED: Identity = { deviceId: 'device-1', name: 'the paired phone' };
const TOKEN = 'a-token-this-server-minted';

const DEVICES: readonly PairedDevice[] = [
  { deviceId: 'device-1', name: 'the paired phone', pairedAt: 1_700_000_000_000, lastSeenAt: 1 },
  { deviceId: 'device-2', name: 'a second one', pairedAt: 1_700_000_100_000, lastSeenAt: 2 },
];

const devices: DeviceDirectory = { find: (token) => (token === TOKEN ? PAIRED : null) };

const descriptor = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: {},
  declines: {},
  viewerScope: 'operator',
} as unknown as MainSource['descriptor'];

const source = {
  descriptor,
  load: async () => [],
} as unknown as MainSource;

const servers: Server[] = [];

async function start(over: Partial<RemoteServerOptions> = {}): Promise<string> {
  const server = await startRemoteServer({
    port: 0,
    devices,
    allowWrites: false,
    source,
    subscribe: () => () => {},
    audit: () => {},
    pairedDevices: () => DEVICES,
    ...over,
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

const bearer = { authorization: `Bearer ${TOKEN}` };

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('GET /api/devices', () => {
  it('answers the paired devices, and says which one is asking', async () => {
    const base = await start();
    const answer = await fetch(`${base}/api/devices`, { headers: bearer });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      ok: true,
      value: {
        // THE CALLER'S OWN ID, so the list can mark "this device" rather than
        // making the operator match a name they typed weeks ago. It is not new
        // information: the caller authenticated as it.
        you: 'device-1',
        devices: DEVICES,
      },
    });
  });

  it('is registered as a READ, so a read-only server still carries it', async () => {
    const paths = registeredRoutePaths({
      port: 0,
      devices,
      allowWrites: false,
      source,
      subscribe: () => () => {},
      pairedDevices: () => DEVICES,
    });
    expect(paths).toContain('/api/devices');
  });

  /**
   * NOT REGISTERED AT ALL where there is no registry to read -- the table has
   * no entry and the process answers 404, which is this server's standing
   * answer to "a capability that is not here". Not a polite refusal: a route
   * that exists and declines is one bug away from a route that exists and
   * complies.
   */
  it('does not exist where no registry was supplied', async () => {
    const base = await start({ pairedDevices: undefined });
    const answer = await fetch(`${base}/api/devices`, { headers: bearer });
    expect(answer.status).toBe(404);
  });

  it('refuses an unpaired caller with the uniform 401', async () => {
    const base = await start();
    const answer = await fetch(`${base}/api/devices`);
    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
  });

  /**
   * THE ONLY DEVICE-SHAPED ROUTE IS THE READ, and it answers GET. Asserted
   * over the whole table rather than as a list of names, so a `POST
   * /api/remove-device` added later fails this on the day it is added --
   * which is the only day anyone would look.
   */
  it('offers no route that changes a device, over the whole table', async () => {
    const base = await start({ allowWrites: true });
    const paths = registeredRoutePaths({
      port: 0,
      devices,
      allowWrites: true,
      source,
      subscribe: () => () => {},
      pairedDevices: () => DEVICES,
    });
    expect(paths.filter((path) => /device|revoke|unpair|pair/i.test(path))).toEqual([
      '/api/devices',
    ]);
    // And it is a read: anything else on that path is refused by method.
    const post = await fetch(`${base}/api/devices`, { method: 'POST', headers: bearer });
    expect(post.status).toBe(405);
  });

  /**
   * THE THING THAT MUST NEVER BE IN THE ANSWER. `PairedDevice` has no token
   * field, so this cannot regress by forgetting to strip one -- it can only
   * regress by someone widening the type. That is exactly the change this
   * assertion is here to fail.
   */
  it('carries no credential of any kind', async () => {
    const base = await start();
    const text = await (await fetch(`${base}/api/devices`, { headers: bearer })).text();
    expect(text).not.toContain(TOKEN);
    expect(text.toLowerCase()).not.toContain('token');
    expect(text.toLowerCase()).not.toContain('secret');
  });
});
