/**
 * "Arbitrary file read and write over a network is at least as serious as
 * typing into a running agent" -- the task instruction this file exists to
 * hold. `src/main/remote/server.ts`'s `UNSERVED` ledger names why the
 * terminal surface, renaming and governance carry no network route; `files`
 * must be named in the SAME breath as `src/main/files/ipc.ts`'s two IPC
 * channels, not as a follow-up, so there is never a build where the
 * capability exists on the desktop bridge and the remote refusal does not.
 *
 * Two things are held here, deliberately apart:
 *
 *  1. `UNSERVED.files` is present and says why (documentation, and the one
 *     line a mutation that deletes the entry makes vanish).
 *  2. `routesFor` -- read through `registeredRoutePaths`, the same derived
 *     sweep `stream-cookie.test.ts` and `phone-shell.test.ts` already use --
 *     never registers a path answering to `files`, in EITHER write mode.
 *     This is the actual enforcement: `UNSERVED` alone is prose, and prose
 *     does not stop a route from being added next to it by accident.
 */

import { describe, expect, it } from 'vitest';
import type { DeviceDirectory } from '../../../src/main/remote/auth.js';
import {
  type RemoteServerOptions,
  registeredRoutePaths,
  UNSERVED,
} from '../../../src/main/remote/server.js';
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

describe('UNSERVED.files', () => {
  it('is present and names why, in the server’s own words', () => {
    expect(UNSERVED.files).toBeTruthy();
    expect(UNSERVED.files).toMatch(/file/i);
  });

  it('reads at least as serious as the terminal’s own standing here', () => {
    // Not a byte-for-byte match -- the point is that the SAME severity
    // argument is made, not that the sentence is copied.
    expect(UNSERVED.files).toMatch(/running agent/i);
  });
});

/**
 * FALSIFICATION TARGET: "remove the `UNSERVED.files` entry and confirm
 * something notices." Deleting the entry above makes the first `describe`
 * block red immediately (`UNSERVED.files` becomes `undefined`) -- this block
 * proves the SEPARATE, structural guarantee holds regardless of that entry:
 * no `/api/files*` route exists in the table `routesFor` builds, read-only or
 * not.
 */
describe('no network route answers to files, in either write mode', () => {
  it('a read-only server carries no files route', () => {
    const paths = registeredRoutePaths(baseOptions(false));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.toLowerCase()).not.toContain('file');
    }
  });

  it('a read-write server carries no files route either', () => {
    const paths = registeredRoutePaths(baseOptions(true));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.toLowerCase()).not.toContain('file');
    }
  });
});
