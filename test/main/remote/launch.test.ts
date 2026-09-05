/**
 * What the environment must say before vam will listen, and how the team's
 * signing keys are held.
 *
 * No fixture here names a real team, a real audience or a real address: this
 * file is the one place a genuine Access tag would be pasted, and this is a
 * public repository. The key-set fetcher is injected -- nothing reaches
 * Cloudflare.
 */

import { describe, expect, it, vi } from 'vitest';
import { accessKeySet, remoteConfigFromEnv } from '../../../src/main/remote/launch.js';

const ENV = {
  VAM_REMOTE_PORT: '7890',
  VAM_ACCESS_TEAM: 'example-team',
  VAM_ACCESS_AUD: 'audience-tag',
};

describe('remoteConfigFromEnv', () => {
  it('is off unless a port is asked for', () => {
    expect(remoteConfigFromEnv({})).toBeNull();
    expect(remoteConfigFromEnv({ VAM_ACCESS_TEAM: 'example-team' })).toBeNull();
  });

  it('refuses a port with no Access configuration, and says why', () => {
    expect(() => remoteConfigFromEnv({ VAM_REMOTE_PORT: '7890' })).toThrow(/Cloudflare Access/i);
    expect(() => remoteConfigFromEnv({ ...ENV, VAM_ACCESS_AUD: '' })).toThrow(/Cloudflare Access/i);
    expect(() => remoteConfigFromEnv({ ...ENV, VAM_ACCESS_TEAM: '' })).toThrow(
      /Cloudflare Access/i,
    );
  });

  it('refuses a team name that is not a bare subdomain label', () => {
    expect(() => remoteConfigFromEnv({ ...ENV, VAM_ACCESS_TEAM: 'a team/../x' })).toThrow(
      /team name/i,
    );
  });

  it('refuses a port that is not a port', () => {
    expect(() => remoteConfigFromEnv({ ...ENV, VAM_REMOTE_PORT: 'soon' })).toThrow(/port/i);
    expect(() => remoteConfigFromEnv({ ...ENV, VAM_REMOTE_PORT: '99999' })).toThrow(/port/i);
  });

  it('derives the issuer from the team and is read-only by default', () => {
    const config = remoteConfigFromEnv(ENV);
    expect(config).toMatchObject({
      port: 7890,
      allowWrites: false,
      auth: { audience: 'audience-tag', issuer: 'https://example-team.cloudflareaccess.com' },
    });
  });

  it('allows writes only on an explicit opt-in', () => {
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WRITES: 'yes please' })?.allowWrites).toBe(
      false,
    );
    expect(remoteConfigFromEnv({ ...ENV, VAM_REMOTE_WRITES: '1' })?.allowWrites).toBe(true);
  });
});

describe('accessKeySet', () => {
  const keys = [{ kid: 'key-one', kty: 'RSA' }];
  const ok = () =>
    vi.fn(async () => ({ ok: true, json: async () => ({ keys }) }) as unknown as Response);

  it('fetches the team key set once and reuses it', async () => {
    const fetcher = ok();
    const load = accessKeySet('example-team', 60_000, fetcher);
    expect(await load()).toEqual(keys);
    expect(await load()).toEqual(keys);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://example-team.cloudflareaccess.com/cdn-cgi/access/certs',
    );
  });

  it('re-fetches once the cache has aged out, so a rotated key is picked up', async () => {
    vi.useFakeTimers();
    const fetcher = ok();
    const load = accessKeySet('example-team', 60_000, fetcher);
    await load();
    vi.setSystemTime(Date.now() + 61_000);
    await load();
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('answers no keys when the key set cannot be read, so every token is refused', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await accessKeySet('example-team', 60_000, failing)()).toEqual([]);
  });

  it('answers no keys on a non-200, rather than caching a rejection page', async () => {
    const notOk = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response);
    const load = accessKeySet('example-team', 60_000, notOk);
    expect(await load()).toEqual([]);
    expect(await load()).toEqual([]);
    expect(notOk).toHaveBeenCalledTimes(2);
  });
});
