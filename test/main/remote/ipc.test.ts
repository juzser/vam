/**
 * The channel between the pairing screen and the pairing code.
 *
 * The last test in this file is the load-bearing one. `open()` is the only
 * thing that clears the failure lockout, and it clears it BECAUSE pressing it
 * is a human standing at this desktop. That argument survives only while no
 * request from the network can reach it -- so the property is asserted against
 * a real server with real routes, not against a reading of the code.
 *
 * Nothing here reaches a network: every request goes to 127.0.0.1 on a port
 * the kernel chose, and no hostname, token or device name is a real one.
 */

import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { openDeviceRegistry } from '../../../src/main/remote/devices.js';
import type { ServeAddress } from '../../../src/main/remote/hostname.js';
import { type RemoteState, registerRemoteIpc } from '../../../src/main/remote/ipc.js';
import { createPairing } from '../../../src/main/remote/pairing.js';
import { createStreamRegistry, startRemoteServer } from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';

const NO_CLI: ServeAddress = { kind: 'unavailable', reason: 'no-cli' };
/** A literal invented for this test; nothing minted it and nothing accepts it. */
const TOKEN = 'a-token-only-this-test-knows';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, listener);
    },
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler for ${channel}`);
      return await handler({}, ...args);
    },
  };
}

async function wire(over: { address?: ServeAddress; allowWrites?: boolean } = {}) {
  const path = join(await mkdtemp(join(tmpdir(), 'vam-remote-ipc-')), 'devices.json');
  const streams = createStreamRegistry();
  const devices = await openDeviceRegistry({
    path,
    onRevoked: (deviceId) => streams.closeFor(deviceId),
  });
  const pairing = createPairing({ grant: (name) => devices.grant(name) });
  const ipcMain = fakeIpcMain();
  registerRemoteIpc(ipcMain, {
    pairing,
    devices,
    allowWrites: over.allowWrites ?? true,
    readAddress: async () => over.address ?? NO_CLI,
  });
  const state = (channel: string, ...args: unknown[]) =>
    ipcMain.invoke(channel, ...args) as Promise<RemoteState>;
  return { pairing, devices, streams, ipcMain, state };
}

describe('the pairing channel', () => {
  it('mints a code when the operator opens the screen, and reports the address', async () => {
    const { state } = await wire({
      address: { kind: 'found', url: 'https://example-machine.example-tailnet.ts.net' },
    });

    const before = await state(CHANNELS.remoteState);
    expect(before.view.code).toBeNull();

    const opened = await state(CHANNELS.pairingOpen);
    expect(opened.view.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(opened.view.expiresAtMs).toBeGreaterThan(opened.nowMs);
    expect(opened.address).toEqual({
      kind: 'found',
      url: 'https://example-machine.example-tailnet.ts.net',
    });
    expect(opened.allowWrites).toBe(true);
  });

  it('clears an armed throttle, which is the operator recovering their own machine', async () => {
    const { pairing, state } = await wire();
    for (let knock = 0; knock < 10; knock += 1) {
      await pairing.submit('WRONGWRONG', 'a phone', '127.0.0.1');
    }
    expect((await state(CHANNELS.remoteState)).view.throttledUntilMs).toBeGreaterThan(0);

    const opened = await state(CHANNELS.pairingOpen);

    expect(opened.view.throttledUntilMs).toBe(0);
    expect(opened.view.code).not.toBeNull();
  });

  it('grants on approve and refuses on deny', async () => {
    const { pairing, state } = await wire();

    const first = await state(CHANNELS.pairingOpen);
    const denied = pairing.submit(first.view.code ?? '', 'a phone', '127.0.0.1');
    expect((await state(CHANNELS.remoteState)).view.awaiting).toEqual({
      name: 'a phone',
      source: '127.0.0.1',
    });
    await state(CHANNELS.pairingDeny);
    expect(await denied).toEqual({ ok: false, reason: 'denied' });
    expect((await state(CHANNELS.remoteState)).devices).toEqual([]);

    const second = await state(CHANNELS.pairingOpen);
    const allowed = pairing.submit(second.view.code ?? '', 'a phone', '127.0.0.1');
    await state(CHANNELS.pairingApprove);
    const outcome = await allowed;

    expect(outcome.ok).toBe(true);
    const after = await state(CHANNELS.remoteState);
    expect(after.devices.map((device) => device.name)).toEqual(['a phone']);
    expect(after.view.pairedName).toBe('a phone');
  });

  it('removing a device revokes it and drops that device stream, leaving the others open', async () => {
    const { pairing, devices, streams, state } = await wire();
    const grant = async (name: string) => {
      const opened = await state(CHANNELS.pairingOpen);
      const outcome = pairing.submit(opened.view.code ?? '', name, '127.0.0.1');
      await state(CHANNELS.pairingApprove);
      return await outcome;
    };
    await grant('a phone');
    await grant('a tablet');
    const [phone, tablet] = devices.list();
    const closedPhone = vi.fn();
    const closedTablet = vi.fn();
    streams.add(phone?.deviceId ?? '', closedPhone);
    streams.add(tablet?.deviceId ?? '', closedTablet);

    const after = await state(CHANNELS.deviceRemove, phone?.deviceId);

    expect(after.devices.map((device) => device.name)).toEqual(['a tablet']);
    expect(closedPhone).toHaveBeenCalledTimes(1);
    expect(closedTablet).not.toHaveBeenCalled();
  });

  it('refuses a device id that is not one, without touching the list', async () => {
    const { pairing, state } = await wire();
    const opened = await state(CHANNELS.pairingOpen);
    const outcome = pairing.submit(opened.view.code ?? '', 'a phone', '127.0.0.1');
    await state(CHANNELS.pairingApprove);
    await outcome;

    const after = await state(CHANNELS.deviceRemove, 42);

    expect(after.devices).toHaveLength(1);
  });

  it('revoke-all empties the list and closes every stream', async () => {
    const { pairing, devices, streams, state } = await wire();
    const opened = await state(CHANNELS.pairingOpen);
    const outcome = pairing.submit(opened.view.code ?? '', 'a phone', '127.0.0.1');
    await state(CHANNELS.pairingApprove);
    await outcome;
    const closed = vi.fn();
    streams.add(devices.list()[0]?.deviceId ?? '', closed);

    const after = await state(CHANNELS.deviceRemoveAll);

    expect(after.devices).toEqual([]);
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe('what the network can reach', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((r) => server.close(r))));
  });

  /** Every path this server has a route for, plus the one it special-cases. */
  const PATHS = [
    '/api/describe',
    '/api/load',
    '/api/stream',
    '/api/pair',
    '/api/record-prompt',
    '/api/close-session',
    '/api/rename-session',
    '/api/create-session',
    '/api/open',
    '/api/approve',
    '/api/deny',
    '/api/pairing/open',
    '/',
  ];

  it('cannot call open, approve or deny from any route, by any method', async () => {
    const open = vi.fn();
    const approve = vi.fn();
    const deny = vi.fn();
    const pairing = createPairing({
      grant: async () => ({ identity: { deviceId: 'd', name: 'a phone' }, token: 'a-token' }),
    });
    // The desktop's WHOLE `Pairing`, with the three desktop-only acts watched.
    // Held in a variable rather than written inline because `PairPort` admits
    // `submit` alone -- the excess-property check on a literal is itself part
    // of this property, and it must not be what makes the test pass.
    const watched = { ...pairing, open, approve, deny };
    const server = await startRemoteServer({
      port: 0,
      host: '127.0.0.1',
      // Paired, so a route that refuses does so on its own terms rather than
      // stopping at the door -- an unauthenticated sweep would prove nothing.
      devices: { find: (token) => (token === TOKEN ? { deviceId: 'd', name: 'a phone' } : null) },
      allowWrites: true,
      pairing: watched,
      source: {
        descriptor: { id: 'claude-code', label: 'Claude Code' },
        load: async () => [],
      } as unknown as MainSource,
      subscribe: () => () => {},
      audit: () => {},
    });
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const base = `http://127.0.0.1:${address.port}`;

    const seen: number[] = [];
    for (const path of PATHS) {
      for (const method of ['GET', 'POST', 'DELETE'] as const) {
        const answer = await fetch(`${base}${path}`, {
          method,
          headers: { authorization: `Bearer ${TOKEN}` },
          // `/api/stream` answers forever by design; the assertion is about
          // what was CALLED, so the connection is cut rather than awaited.
          signal: AbortSignal.timeout(250),
          ...(method === 'POST' ? { body: '{"code":"AAAABBBB","name":"a phone"}' } : {}),
        }).catch(() => undefined);
        if (answer !== undefined) seen.push(answer.status);
      }
    }

    // The sweep found a live server, not a closed port: without this the two
    // assertions below would pass against no requests at all.
    expect(seen).toContain(200);
    expect(open).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(deny).not.toHaveBeenCalled();
  });
});
