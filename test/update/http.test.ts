import { describe, expect, it, vi } from 'vitest';
import { fetchFollowing, readAll, UpdateHttpError } from '../../src/main/update/http.js';

/**
 * No network: every test injects a fetcher that hands back real `Response`
 * objects, so the header and stream behaviour is the platform's own.
 */
const ASSET = 'https://github.com/juzser/vam/releases/download/v1.0.0/vam.zip';
const CDN = 'https://release-assets.githubusercontent.com/abc/vam.zip';

function redirect(to: string, status = 302): Response {
  return new Response(null, { status, headers: { location: to } });
}

function bytes(...parts: string[]): Response {
  return new Response(new Blob(parts));
}

async function text(result: Awaited<ReturnType<typeof fetchFollowing>>): Promise<string> {
  return new TextDecoder().decode(await readAll(result.body));
}

describe('fetchFollowing', () => {
  it('asks with redirect: manual and follows an allowed redirect', async () => {
    const seen: Array<{ url: string; redirect: unknown }> = [];
    const fetcher = vi.fn(async (url: string, init: { redirect: 'manual' }) => {
      seen.push({ url, redirect: init.redirect });
      return url === ASSET ? redirect(CDN) : bytes('payload');
    });
    const result = await fetchFollowing(ASSET, { maxBytes: 100, fetcher });
    expect(await text(result)).toBe('payload');
    expect(seen).toEqual([
      { url: ASSET, redirect: 'manual' },
      { url: CDN, redirect: 'manual' },
    ]);
  });

  it('resolves a relative Location against the current URL', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url === ASSET ? redirect('/other/vam.zip') : bytes('ok'),
    );
    await text(await fetchFollowing(ASSET, { maxBytes: 100, fetcher }));
    expect(fetcher).toHaveBeenLastCalledWith('https://github.com/other/vam.zip', expect.anything());
  });

  it('refuses a redirect to a host outside the allowlist', async () => {
    const fetcher = vi.fn(async () => redirect('https://evil.example/vam.zip'));
    await expect(fetchFollowing(ASSET, { maxBytes: 100, fetcher })).rejects.toMatchObject({
      code: 'network',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to plain http', async () => {
    const fetcher = vi.fn(async () => redirect('http://github.com/x'));
    await expect(fetchFollowing(ASSET, { maxBytes: 100, fetcher })).rejects.toBeInstanceOf(
      UpdateHttpError,
    );
  });

  it('refuses a starting URL that is not allowed, without fetching', async () => {
    const fetcher = vi.fn();
    await expect(
      fetchFollowing('https://evil.example/x', { maxBytes: 100, fetcher }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('gives up after 5 redirect hops', async () => {
    const fetcher = vi.fn(async () => redirect(CDN));
    await expect(fetchFollowing(ASSET, { maxBytes: 100, fetcher })).rejects.toMatchObject({
      code: 'network',
    });
    // The first request plus five followed hops.
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('treats a redirect with no Location as a failure', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302 }));
    await expect(fetchFollowing(ASSET, { maxBytes: 100, fetcher })).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('reports a non-success final status with the status attached', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(fetchFollowing(ASSET, { maxBytes: 100, fetcher })).rejects.toMatchObject({
      code: 'network',
      status: 404,
    });
  });

  it('rejects a Content-Length above the cap before reading the body', async () => {
    const fetcher = vi.fn(async () => new Response('x', { headers: { 'content-length': '101' } }));
    await expect(fetchFollowing(ASSET, { maxBytes: 100, fetcher })).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('aborts when the stream exceeds the cap despite a small or missing Content-Length', async () => {
    const fetcher = vi.fn(async () => bytes('a'.repeat(60), 'b'.repeat(60)));
    const result = await fetchFollowing(ASSET, { maxBytes: 100, fetcher });
    await expect(readAll(result.body)).rejects.toMatchObject({ code: 'too-large' });
  });

  it('reports progress with received bytes and the announced total', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(10));
        c.enqueue(new Uint8Array(15));
        c.close();
      },
    });
    const fetcher = vi.fn(
      async () => new Response(stream, { headers: { 'content-length': '25' } }),
    );
    const onProgress = vi.fn();
    const result = await fetchFollowing(ASSET, { maxBytes: 100, fetcher, onProgress });
    await readAll(result.body);
    expect(onProgress.mock.calls).toEqual([
      [10, 25],
      [25, 25],
    ]);
  });

  it('propagates an abort as a network error', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')));
        }),
    );
    const pending = fetchFollowing(ASSET, { maxBytes: 100, fetcher, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'network' });
  });

  it('idle watchdog: a body that stalls is aborted', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(1));
      },
    });
    const fetcher = vi.fn(async () => new Response(stream));
    const result = await fetchFollowing(ASSET, { maxBytes: 100, fetcher, idleMs: 30 });
    await expect(readAll(result.body)).rejects.toMatchObject({ code: 'network' });
  }, 2000);

  it('idle watchdog: headers that never arrive are aborted', async () => {
    const fetcher = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')));
        }),
    );
    await expect(
      fetchFollowing(ASSET, { maxBytes: 100, fetcher, idleMs: 30 }),
    ).rejects.toMatchObject({ code: 'network' });
  }, 2000);

  it('a fetch rejection becomes a network error', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(fetchFollowing(ASSET, { maxBytes: 100, fetcher })).rejects.toMatchObject({
      code: 'network',
    });
  });
});
