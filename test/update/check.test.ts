import { describe, expect, it, vi } from 'vitest';
import {
  type CheckTarget,
  checkForUpdate,
  LATEST_RELEASE_URL,
  type UpdateFetcher,
} from '../../src/main/update/check.js';
import { type FollowFn, UpdateHttpError } from '../../src/main/update/http.js';

/**
 * Every test injects its own fetchers. Nothing here reaches the network.
 */
type Call = { url: string; headers: Record<string, string> };
const calls: Call[] = [];

function respond(status: number, body: unknown): UpdateFetcher {
  return vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  });
}

const SHA = `${'A'.repeat(86)}==`;
const ZIP = 'vam-1.0.0-mac-arm64.zip';
const ZIP_URL = `https://github.com/juzser/vam/releases/download/v1.0.0/${ZIP}`;
const FRAG_URL = 'https://github.com/juzser/vam/releases/download/v1.0.0/vam-update-darwin.json';

const MAC: CheckTarget = { platform: 'darwin', arch: 'arm64', installKind: 'mac-zip' };

const fragment = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  version: '1.0.0',
  platform: 'darwin',
  files: [
    { name: ZIP, arch: 'arm64', kind: 'mac-zip', size: 1000, sha512: SHA },
    { name: 'vam-1.0.0-mac-x64.zip', arch: 'x64', kind: 'mac-zip', size: 1100, sha512: SHA },
  ],
  ...over,
});

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/juzser/vam/releases/tag/v1.0.0',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'vam-update-darwin.json', browser_download_url: FRAG_URL, size: 300 },
    { name: ZIP, browser_download_url: ZIP_URL, size: 1000 },
    {
      name: 'vam-1.0.0-mac-x64.zip',
      browser_download_url: ZIP_URL.replace('arm64', 'x64'),
      size: 1100,
    },
  ],
  ...over,
});

function serveFragment(body: unknown, status = 200): FollowFn {
  return vi.fn(async () => {
    if (status !== 200) throw new UpdateHttpError('network', 'status', status);
    const data = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
    return {
      status,
      body: (async function* () {
        yield data;
      })(),
    };
  });
}

const run = (
  current: string,
  api: UpdateFetcher,
  follow: FollowFn = serveFragment(fragment()),
  target: CheckTarget = MAC,
) => checkForUpdate(current, target, { fetch: api, follow });

describe('checkForUpdate: the API request', () => {
  it('asks GitHub for the latest release, unauthenticated and without a query', async () => {
    calls.length = 0;
    const fetcher = respond(404, {});
    await run('0.0.0', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls[0]?.url).toBe(LATEST_RELEASE_URL);
    expect(calls[0]?.url).not.toContain('?');
    expect(Object.keys(calls[0]?.headers ?? {}).sort()).toEqual(['Accept', 'User-Agent']);
  });

  it('is quiet when the repository has published no releases', async () => {
    expect(await run('0.0.0', respond(404, {}))).toEqual({ kind: 'none' });
  });

  it('distinguishes rate limiting from a network failure', async () => {
    for (const status of [403, 429]) {
      expect(await run('0.0.0', respond(status, {}))).toEqual({
        kind: 'error',
        code: 'rate-limited',
      });
    }
    expect(await run('0.0.0', respond(500, {}))).toEqual({ kind: 'error', code: 'network' });
  });

  it('reports a thrown fetch as network', async () => {
    const fetcher: UpdateFetcher = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    expect(await run('0.0.0', fetcher)).toEqual({ kind: 'error', code: 'network' });
  });

  it('reports a malformed body', async () => {
    for (const body of [null, 'x', {}, { tag_name: 'v1.0.0' }, { html_url: 'x' }]) {
      expect(await run('0.0.0', respond(200, body))).toEqual({ kind: 'error', code: 'malformed' });
    }
    const throwing: UpdateFetcher = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    expect(await run('0.0.0', throwing)).toEqual({ kind: 'error', code: 'malformed' });
  });

  it('bounds the request with a timeout', async () => {
    let captured: AbortSignal | undefined;
    const hanging: UpdateFetcher = vi.fn(
      (_url, init) =>
        new Promise<Awaited<ReturnType<UpdateFetcher>>>((_resolve, reject) => {
          captured = init.signal;
          init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    const status = await checkForUpdate('0.0.0', MAC, { fetch: hanging, timeoutMs: 20 });
    expect(captured).toBeInstanceOf(AbortSignal);
    expect(status).toEqual({ kind: 'error', code: 'network' });
  }, 1000);
});

describe('checkForUpdate: is it newer', () => {
  it('up-to-date for equal, older, draft, prerelease (flagged or tagged), unparseable', async () => {
    const follow = vi.fn();
    const go = (cur: string, over: Record<string, unknown>) =>
      run(cur, respond(200, release(over)), follow);
    expect(await go('1.0.0', {})).toEqual({ kind: 'up-to-date' });
    expect(await go('1.2.0', {})).toEqual({ kind: 'up-to-date' });
    expect(await go('0.0.0', { draft: true })).toEqual({ kind: 'up-to-date' });
    expect(await go('0.0.0', { prerelease: true })).toEqual({ kind: 'up-to-date' });
    expect(await go('0.0.0', { tag_name: 'v9.0.0-rc.1' })).toEqual({ kind: 'up-to-date' });
    expect(await go('dev', {})).toEqual({ kind: 'up-to-date' });
    expect(follow).not.toHaveBeenCalled();
  });

  it('compares numerically, not as text', async () => {
    const follow = vi.fn();
    expect(await run('0.10.0', respond(200, release({ tag_name: 'v0.9.0' })), follow)).toEqual({
      kind: 'up-to-date',
    });
  });

  it('refuses a release page that is not an https github.com URL', async () => {
    for (const url of [
      'file:///etc/passwd',
      'http://github.com/juzser/vam/releases/tag/v1.0.0',
      'https://github.example.invalid/x',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(await run('0.1.0', respond(200, release({ html_url: url })))).toEqual({
        kind: 'error',
        code: 'malformed',
      });
    }
  });
});

describe('checkForUpdate: the manifest and asset', () => {
  it('offers the asset for this platform and arch, url taken from the release assets', async () => {
    const follow = serveFragment(fragment());
    const result = await run('0.1.0', respond(200, release()), follow);
    expect(result).toEqual({
      kind: 'available',
      version: '1.0.0',
      notesUrl: 'https://github.com/juzser/vam/releases/tag/v1.0.0',
      asset: { name: ZIP, url: ZIP_URL, size: 1000, sha512: SHA, kind: 'mac-zip' },
    });
    expect(follow).toHaveBeenCalledTimes(1);
    expect((follow as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(FRAG_URL);
  });

  it('never crosses architectures', async () => {
    const result = await run('0.1.0', respond(200, release()), undefined, {
      ...MAC,
      arch: 'x64',
    });
    expect(result).toMatchObject({ kind: 'available', asset: { name: 'vam-1.0.0-mac-x64.zip' } });
  });

  it('is incomplete when the fragment asset is missing (and fetches nothing)', async () => {
    const follow = vi.fn();
    const body = release({ assets: [] });
    expect(await run('0.1.0', respond(200, body), follow)).toEqual({ kind: 'incomplete' });
    expect(follow).not.toHaveBeenCalled();
  });

  it('is incomplete when the fragment download 404s', async () => {
    expect(await run('0.1.0', respond(200, release()), serveFragment({}, 404))).toEqual({
      kind: 'incomplete',
    });
  });

  it('is incomplete when the referenced asset is not attached to the release', async () => {
    const body = release({
      assets: release().assets.filter((a) => a.name !== ZIP),
    });
    expect(await run('0.1.0', respond(200, body))).toEqual({ kind: 'incomplete' });
  });

  it('is incomplete when the release asset size disagrees with the manifest', async () => {
    const body = release({
      assets: release().assets.map((a) => (a.name === ZIP ? { ...a, size: 999 } : a)),
    });
    expect(await run('0.1.0', respond(200, body))).toEqual({ kind: 'incomplete' });
  });

  it('is incomplete when the manifest has no file for this arch', async () => {
    const only = fragment({ files: [fragment().files[1]] });
    expect(await run('0.1.0', respond(200, release()), serveFragment(only))).toEqual({
      kind: 'incomplete',
    });
  });

  it('is malformed for a bad, mismatched or oversized fragment', async () => {
    for (const bad of [
      'not json{',
      { schema: 2 },
      fragment({ version: '0.9.9' }),
      fragment({ platform: 'linux' }),
    ]) {
      expect(await run('0.1.0', respond(200, release()), serveFragment(bad))).toEqual({
        kind: 'error',
        code: 'malformed',
      });
    }
    const big: FollowFn = vi.fn(async () => {
      throw new UpdateHttpError('too-large', 'big');
    });
    expect(await run('0.1.0', respond(200, release()), big)).toEqual({
      kind: 'error',
      code: 'malformed',
    });
  });

  it('is a network error when the fragment fetch fails otherwise', async () => {
    const boom: FollowFn = vi.fn(async () => {
      throw new UpdateHttpError('network', 'reset');
    });
    expect(await run('0.1.0', respond(200, release()), boom)).toEqual({
      kind: 'error',
      code: 'network',
    });
  });

  it('refuses an asset URL outside the allowed hosts', async () => {
    const body = release({
      assets: release().assets.map((a) =>
        a.name === ZIP ? { ...a, browser_download_url: 'https://evil.example/vam.zip' } : a,
      ),
    });
    expect(await run('0.1.0', respond(200, body))).toEqual({ kind: 'error', code: 'malformed' });
  });

  it('for an unsupported install, offers the release without an asset or a fragment fetch', async () => {
    const follow = vi.fn();
    const result = await run('0.1.0', respond(200, release()), follow, {
      ...MAC,
      installKind: 'unsupported',
    });
    expect(result).toEqual({
      kind: 'available',
      version: '1.0.0',
      notesUrl: 'https://github.com/juzser/vam/releases/tag/v1.0.0',
      asset: null,
    });
    expect(follow).not.toHaveBeenCalled();
  });
});
