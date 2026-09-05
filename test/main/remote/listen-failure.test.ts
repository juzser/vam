/**
 * A port that is already taken must not end the operator's session.
 *
 * The remote endpoint is one optional surface; every tmux session vam drives
 * is reached through the desktop app. A `listen` that fails with no `'error'`
 * listener is an uncaught exception in main, which under Electron takes the
 * whole app down at launch -- so the assertion here is on BOTH halves: the
 * promise settles as a refusal that names the port, and nothing escapes to
 * the process. Everything binds 127.0.0.1 on an ephemeral port; nothing here
 * reaches a network.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceDirectory } from '../../../src/main/remote/auth.js';
import { startRemoteServer } from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';

const devices: DeviceDirectory = { find: () => null };
const source = {
  descriptor: { id: 'claude-code', capabilities: {}, declines: {} },
  load: async () => [],
} as unknown as MainSource;

const squatters: Server[] = [];

afterEach(async () => {
  await Promise.all(
    squatters
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/** A process already holding a loopback port, exactly as a second vam would. */
async function squat(): Promise<number> {
  const server = createServer(() => {});
  squatters.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('a remote port that is already in use', () => {
  it('refuses with the port in the message instead of crashing the process', async () => {
    const port = await squat();
    const uncaught: unknown[] = [];
    const record = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', record);
    try {
      await expect(
        startRemoteServer({
          port,
          devices,
          allowWrites: false,
          source,
          subscribe: () => () => {},
        }),
      ).rejects.toThrow(new RegExp(`${port}`));
      // The operator has to be told WHICH port and WHY: "already in use" is
      // the one cause they can act on without reading a log.
      await expect(
        startRemoteServer({
          port,
          devices,
          allowWrites: false,
          source,
          subscribe: () => () => {},
        }),
      ).rejects.toThrow(/in use/i);
      // A settled rejection and an uncaught exception are not the same event:
      // only the first one leaves the app alive.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', record);
    }
  });
});
