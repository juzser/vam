import { describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  LATEST_RELEASE_URL,
  type UpdateFetcher,
} from '../../src/main/update/check.js';

/**
 * Every test here injects its own fetcher. Nothing in this file reaches the
 * network -- there is no real request, and `globalThis.fetch` is never called.
 */
type Call = { url: string; headers: Record<string, string> };

/** Records what was asked for, so a test can assert the request's shape. */
const calls: Call[] = [];

function respond(status: number, body: unknown): UpdateFetcher {
  return vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    };
  });
}

const RELEASE = {
  tag_name: 'v0.1.0',
  html_url: 'https://github.com/juzser/vam/releases/tag/v0.1.0',
  draft: false,
  prerelease: false,
};

describe('checkForUpdate', () => {
  it('asks GitHub for the latest release, unauthenticated and without a query', async () => {
    calls.length = 0;
    const fetcher = respond(404, {});
    await checkForUpdate('0.0.0', { fetch: fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = calls[0];
    expect(call).toBeDefined();
    expect(call?.url).toBe(LATEST_RELEASE_URL);
    expect(call?.url).not.toContain('?');
    expect(Object.keys(call?.headers ?? {}).sort()).toEqual(['Accept', 'User-Agent']);
  });

  it('is quiet when the repository has published no releases at all', async () => {
    expect(await checkForUpdate('0.0.0', { fetch: respond(404, {}) })).toEqual({ kind: 'none' });
  });

  it('offers a newer release, handing over its URL', async () => {
    expect(await checkForUpdate('0.0.0', { fetch: respond(200, RELEASE) })).toEqual({
      kind: 'available',
      version: '0.1.0',
      url: RELEASE.html_url,
    });
  });

  it('offers nothing for an equal release', async () => {
    const body = { ...RELEASE, tag_name: 'v1.2.3' };
    expect(await checkForUpdate('1.2.3', { fetch: respond(200, body) })).toEqual({
      kind: 'up-to-date',
    });
  });

  it('offers nothing for an older release', async () => {
    const body = { ...RELEASE, tag_name: 'v0.9.0' };
    expect(await checkForUpdate('0.10.0', { fetch: respond(200, body) })).toEqual({
      kind: 'up-to-date',
    });
  });

  it('offers nothing for a prerelease, whether flagged or only tagged as one', async () => {
    const flagged = { ...RELEASE, tag_name: 'v9.0.0', prerelease: true };
    expect(await checkForUpdate('0.0.0', { fetch: respond(200, flagged) })).toEqual({
      kind: 'up-to-date',
    });
    const tagged = { ...RELEASE, tag_name: 'v9.0.0-rc.1' };
    expect(await checkForUpdate('0.0.0', { fetch: respond(200, tagged) })).toEqual({
      kind: 'up-to-date',
    });
  });

  it('offers nothing for a draft', async () => {
    const body = { ...RELEASE, tag_name: 'v9.0.0', draft: true };
    expect(await checkForUpdate('0.0.0', { fetch: respond(200, body) })).toEqual({
      kind: 'up-to-date',
    });
  });

  it('reports a network failure as its own fact, not as an error', async () => {
    const fetcher: UpdateFetcher = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    });
    expect(await checkForUpdate('0.0.0', { fetch: fetcher })).toEqual({
      kind: 'unknown',
      reason: 'network',
    });
  });

  it('distinguishes a rate-limited response from a network failure', async () => {
    expect(await checkForUpdate('0.0.0', { fetch: respond(403, {}) })).toEqual({
      kind: 'unknown',
      reason: 'rate-limited',
    });
    expect(await checkForUpdate('0.0.0', { fetch: respond(429, {}) })).toEqual({
      kind: 'unknown',
      reason: 'rate-limited',
    });
  });

  it('treats any other refusal as a network fact', async () => {
    expect(await checkForUpdate('0.0.0', { fetch: respond(500, {}) })).toEqual({
      kind: 'unknown',
      reason: 'network',
    });
  });

  it('distinguishes a malformed body from both', async () => {
    for (const body of [null, 'not json', {}, { tag_name: 'v1.0.0' }, { html_url: 'x' }]) {
      expect(await checkForUpdate('0.0.0', { fetch: respond(200, body) })).toEqual({
        kind: 'unknown',
        reason: 'malformed',
      });
    }
    const throwing: UpdateFetcher = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    expect(await checkForUpdate('0.0.0', { fetch: throwing })).toEqual({
      kind: 'unknown',
      reason: 'malformed',
    });
  });

  it('offers nothing when the running version itself is not comparable', async () => {
    expect(await checkForUpdate('dev', { fetch: respond(200, RELEASE) })).toEqual({
      kind: 'up-to-date',
    });
  });
});
