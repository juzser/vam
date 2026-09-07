/**
 * What the environment must say before vam will listen.
 *
 * No fixture here names a real machine, tailnet or device: this file is
 * exactly where a genuine MagicDNS name would be pasted, and this is a public
 * repository. Nothing here opens a socket or reaches the network.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_REMOTE_PORT, remoteConfigFromEnv } from '../../../src/main/remote/launch.js';

const ENV = { VAM_REMOTE_PORT: '7890' };

describe('remoteConfigFromEnv', () => {
  it('opens on the default port when the environment says nothing at all -- a packaged app launched from Finder has no shell to set VAM_REMOTE_PORT in', () => {
    expect(remoteConfigFromEnv({})).toEqual({ port: DEFAULT_REMOTE_PORT, allowWrites: false });
    expect(remoteConfigFromEnv({ VAM_REMOTE_PORT: '' })).toEqual({
      port: DEFAULT_REMOTE_PORT,
      allowWrites: false,
    });
  });

  it('VAM_REMOTE_PORT still overrides the default, for a developer who sets it', () => {
    expect(remoteConfigFromEnv(ENV)).toEqual({ port: 7890, allowWrites: false });
  });

  it('refuses a port that is not a port, exactly as before', () => {
    for (const port of ['0', '-1', '99999', 'eight', '80.5']) {
      expect(() => remoteConfigFromEnv({ VAM_REMOTE_PORT: port })).toThrow(/not a port/i);
    }
  });

  it('opens no write route unless writes are asked for exactly', () => {
    expect(remoteConfigFromEnv(ENV).allowWrites).toBe(false);
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WRITES: 'true' }).allowWrites).toBe(false);
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WRITES: '1' }).allowWrites).toBe(true);
  });

  it('writes default to off, and the persisted preference is what turns them on', () => {
    expect(remoteConfigFromEnv(ENV, false).allowWrites).toBe(false);
    expect(remoteConfigFromEnv(ENV, true).allowWrites).toBe(true);
    // A packaged app with no persisted preference yet reads the same as an
    // explicit `false`.
    expect(remoteConfigFromEnv(ENV).allowWrites).toBe(false);
  });

  it('VAM_REMOTE_WRITES overrides the persisted preference either way', () => {
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WRITES: '1' }, false).allowWrites).toBe(true);
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WRITES: 'no' }, true).allowWrites).toBe(false);
  });

  it('reads an empty web root as absent, so an unset variable cannot serve /', () => {
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WEB_ROOT: '' })).not.toHaveProperty('webRoot');
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WEB_ROOT: '/tmp/web' }).webRoot).toBe(
      '/tmp/web',
    );
  });

  it('carries no bind address: the server binds loopback and Serve proxies to it', () => {
    expect(remoteConfigFromEnv(ENV)).toEqual({ port: 7890, allowWrites: false });
  });
});
