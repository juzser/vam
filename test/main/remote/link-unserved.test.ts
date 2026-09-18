/**
 * "Open this address" IS A DESKTOP ACT, and no network route may ask for it.
 *
 * `CHANNELS.linkOpen` states the claim in prose: it is not a member of
 * `PreloadSourceApi`, so `remote/server.ts` builds no route to it. Prose does
 * not stop a route being added beside it by accident, which is exactly the
 * argument `files-unserved.test.ts` makes about the file channels -- so this
 * holds the same structural guarantee, through the same derived sweep.
 *
 * WHY IT MATTERS MORE HERE THAN IT LOOKS. The link channel hands a URL to
 * `shell.openExternal` on THIS machine. A paired phone has its own browser and
 * needs nothing from vam to open a page; a route would instead let a remote
 * device make the operator's own desktop launch an address, which is a
 * different capability from anything the pairing screen grants and would need
 * its own decision.
 */

import { describe, expect, it } from 'vitest';
import type { DeviceDirectory } from '../../../src/main/remote/auth.js';
import { type RemoteServerOptions, registeredRoutePaths } from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';
import type { Project } from '../../../src/renderer/domain/model.js';

const devices: DeviceDirectory = { find: () => null };

const descriptor = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: { recordPrompt: true, closeSession: true },
  declines: {},
  viewerScope: 'operator',
} as unknown as MainSource['descriptor'];

const source: MainSource = {
  descriptor,
  load: async (): Promise<readonly Project[]> => [],
  closeSession: async () => null,
  recordPrompt: async () => null,
} as unknown as MainSource;

const baseOptions = (allowWrites: boolean): RemoteServerOptions => ({
  port: 0,
  devices,
  allowWrites,
  source,
  subscribe: () => () => {},
});

describe('no network route asks this machine to open an address', () => {
  for (const allowWrites of [false, true]) {
    it(`a ${allowWrites ? 'read-write' : 'read-only'} server carries no link route`, () => {
      const paths = registeredRoutePaths(baseOptions(allowWrites));
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.toLowerCase()).not.toContain('link');
        expect(path.toLowerCase()).not.toContain('open');
      }
    });
  }
});
