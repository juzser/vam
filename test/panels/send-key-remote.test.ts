// @vitest-environment happy-dom

/**
 * `sendKeyRemote`, mocking `fetch` and the pairing token store -- never a
 * real network call. `test/main/remote/send-key-route.test.ts` covers the
 * SERVER side of this same call; this is the client's own half.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendKeyRemote } from '../../src/renderer/panels/send-key-remote.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetch(handler: (url: string, init: RequestInit) => Promise<unknown> | unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const record = { url: String(url), init: init ?? {} };
    calls.push(record);
    const body = await handler(record.url, record.init);
    return {
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('sendKeyRemote', () => {
  it('posts sessionId and key to /api/send-key, with no auth header when unpaired', async () => {
    const calls = stubFetch(() => ({ ok: true, value: null }));
    const result = await sendKeyRemote('row-1', 'escape');
    expect(result).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/send-key');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ sessionId: 'row-1', key: 'escape' });
    expect(
      (calls[0]?.init.headers as Record<string, string> | undefined)?.authorization,
    ).toBeUndefined();
  });

  it('carries the stored pairing token as a bearer header, read fresh each call', async () => {
    localStorage.setItem('vam.remote.token', 'a-real-token');
    const calls = stubFetch(() => ({ ok: true, value: null }));
    await sendKeyRemote('row-1', 'tab');
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.authorization).toBe(
      'Bearer a-real-token',
    );
  });

  it('maps a refused envelope to "refused", never throwing the SourceError', async () => {
    stubFetch(() => ({
      ok: false,
      error: { kind: 'refused', code: 'no-terminal', message: 'vam has no terminal here' },
    }));
    const result = await sendKeyRemote('row-1', 'enter');
    expect(result).toBe('refused');
  });

  it('maps a transport failure to "unavailable", never rejecting', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(sendKeyRemote('row-1', 'space')).resolves.toBe('unavailable');
  });

  it('maps an answer that is not an envelope to "unavailable"', async () => {
    stubFetch(() => ({ not: 'an envelope' }));
    const result = await sendKeyRemote('row-1', 'backspace');
    expect(result).toBe('unavailable');
  });

  it('maps a body that does not even parse as JSON to "unavailable"', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => {
        throw new Error('not json');
      },
    })) as unknown as typeof fetch;
    const result = await sendKeyRemote('row-1', 'back-tab');
    expect(result).toBe('unavailable');
  });
});
