/**
 * What the environment must say before vam will listen.
 *
 * No fixture here names a real machine, tailnet or device: this file is
 * exactly where a genuine MagicDNS name would be pasted, and this is a public
 * repository. Nothing here opens a socket or reaches the network.
 */

import { describe, expect, it } from 'vitest';
import { remoteConfigFromEnv } from '../../../src/main/remote/launch.js';

const ENV = { VAM_REMOTE_PORT: '7890' };

describe('remoteConfigFromEnv', () => {
  it('is off unless a port is asked for', () => {
    expect(remoteConfigFromEnv({})).toBeNull();
    expect(remoteConfigFromEnv({ VAM_REMOTE_PORT: '' })).toBeNull();
    expect(remoteConfigFromEnv({ VAM_REMOTE_WRITES: '1' })).toBeNull();
  });

  it('refuses a port that is not a port', () => {
    for (const port of ['0', '-1', '99999', 'eight', '80.5']) {
      expect(() => remoteConfigFromEnv({ VAM_REMOTE_PORT: port })).toThrow(/not a port/i);
    }
  });

  it('opens no write route unless writes are asked for exactly', () => {
    expect(remoteConfigFromEnv(ENV)?.allowWrites).toBe(false);
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WRITES: 'true' })?.allowWrites).toBe(false);
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WRITES: '1' })?.allowWrites).toBe(true);
  });

  it('reads an empty web root as absent, so an unset variable cannot serve /', () => {
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WEB_ROOT: '' })).not.toHaveProperty('webRoot');
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WEB_ROOT: '/tmp/web' })?.webRoot).toBe(
      '/tmp/web',
    );
  });

  it('carries no bind address: the server binds loopback and Serve proxies to it', () => {
    expect(remoteConfigFromEnv(ENV)).toEqual({ port: 7890, allowWrites: false });
  });
});
