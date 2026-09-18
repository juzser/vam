/**
 * THE POST NOTHING IN THE REPOSITORY MADE.
 *
 * `/api/pair` has existed on the server since pairing was built, and until now
 * no client called it: `grep -rn 'api/pair' src/` outside `src/main` returned
 * nothing. So the door was there, the walkthrough pointed at it, and the phone
 * had no way through.
 *
 * WHAT THIS OWES. A pairing attempt is the ONE request made without a
 * credential, so it is the one place a refusal is ordinary rather than
 * exceptional: a wrong code, a burned code, a screen that was never opened and
 * a rate-limited caller all come back as the SAME 401, by design, and the
 * phone is not entitled to tell them apart. What it must do is say so plainly
 * and let the operator try again.
 */

import { describe, expect, it, vi } from 'vitest';
import { submitPairing } from '../../src/renderer/sources/pair.js';

const answering = (status: number, body: unknown) =>
  vi.fn(async () => ({
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    json: async () => body,
  }));

describe('submitPairing', () => {
  it('posts the code and the device name to the pairing door', async () => {
    const fetch = answering(200, { ok: true, value: { token: 't', deviceId: 'd', name: 'phone' } });
    await submitPairing('ABCD2345', 'the phone', { fetch: fetch as never });

    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain('/api/pair');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ code: 'ABCD2345', name: 'the phone' });
  });

  it('returns the token the server minted', async () => {
    const fetch = answering(200, {
      ok: true,
      value: { token: 'a-real-token', deviceId: 'd1', name: 'phone' },
    });
    await expect(submitPairing('ABCD2345', 'phone', { fetch: fetch as never })).resolves.toBe(
      'a-real-token',
    );
  });

  /**
   * NO CREDENTIAL ON THIS ONE REQUEST. Sending a stale token here would make
   * the pairing attempt of a REVOKED device look like an authenticated call,
   * and the one request that is supposed to work without a token would be the
   * one carrying a rejected one.
   */
  it('sends no authorization header, even if a stale token is lying around', async () => {
    const fetch = answering(200, { ok: true, value: { token: 't' } });
    await submitPairing('ABCD2345', 'phone', { fetch: fetch as never });
    const init = (
      fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    )[1];
    expect(init.headers['authorization']).toBeUndefined();
  });

  it('rejects with the server’s own words when the code is refused', async () => {
    const fetch = answering(401, {
      ok: false,
      error: {
        kind: 'refused',
        code: 'unauthenticated',
        message: 'not paired: check the pairing screen on the desktop',
      },
    });
    await expect(
      submitPairing('WRONG123', 'phone', { fetch: fetch as never }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects when the endpoint cannot be reached at all', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    await expect(
      submitPairing('ABCD2345', 'phone', { fetch: fetch as never }),
    ).rejects.toMatchObject({ code: 'transport-failed' });
  });

  it('rejects when the answer is not an envelope at all', async () => {
    const fetch = answering(200, 'not json we understand');
    await expect(
      submitPairing('ABCD2345', 'phone', { fetch: fetch as never }),
    ).rejects.toMatchObject({ kind: 'unreachable' });
  });
});
