/**
 * `readUsage`'s failure-mapping table, and the one test that matters most:
 * the token must never appear in anything this function returns, throws, or
 * logs, on ANY path -- see the last `describe` block.
 */

import { describe, expect, it, vi } from 'vitest';
import { readUsage } from '../../../src/main/usage/reader.js';

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const REAL_BODY = {
  five_hour: {
    utilization: 40.0,
    resets_at: '2026-09-03T11:40:00.429991+00:00',
    limit_dollars: null,
  },
  seven_day: {
    utilization: 30.0,
    resets_at: '2026-09-07T06:00:00.430008+00:00',
    limit_dollars: null,
  },
  limits: [{ kind: 'session', percent: 40, severity: 'normal', is_active: true }],
  spend: { percent: 0 },
  member_dashboard_available: false,
};

describe('readUsage', () => {
  it('maps the real response body to kind: ok with 40 and 30', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, REAL_BODY));

    const snapshot = await readUsage({ readToken: async () => 'a-fake-token', fetch: fetchSpy });

    expect(snapshot.kind).toBe('ok');
    if (snapshot.kind !== 'ok') throw new Error('unreachable');
    expect(snapshot.windows.fiveHour).toMatchObject({ kind: 'known', percent: 40 });
    expect(snapshot.windows.sevenDay).toMatchObject({ kind: 'known', percent: 30 });
    expect(typeof snapshot.observedAt).toBe('string');
  });

  it('sends the token as a bearer header and a user agent naming claude-code', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, REAL_BODY));

    await readUsage({ readToken: async () => 'the-token', fetch: fetchSpy });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer the-token',
          'User-Agent': expect.stringContaining('claude-code'),
        }),
      }),
    );
  });

  it('maps a missing token to no-token', async () => {
    const fetchSpy = vi.fn();

    const snapshot = await readUsage({ readToken: async () => null, fetch: fetchSpy });

    expect(snapshot).toEqual({ kind: 'unknown', reason: 'no-token' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps HTTP 401 to unauthorized', async () => {
    const snapshot = await readUsage({
      readToken: async () => 'expired-token',
      fetch: async () => jsonResponse(401, { error: 'unauthorized' }),
    });

    expect(snapshot).toEqual({ kind: 'unknown', reason: 'unauthorized' });
  });

  it('maps HTTP 500 to request-failed', async () => {
    const snapshot = await readUsage({
      readToken: async () => 'a-token',
      fetch: async () => jsonResponse(500, { error: 'server error' }),
    });

    expect(snapshot).toEqual({ kind: 'unknown', reason: 'request-failed' });
  });

  it('maps a thrown network error to request-failed', async () => {
    const snapshot = await readUsage({
      readToken: async () => 'a-token',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    expect(snapshot).toEqual({ kind: 'unknown', reason: 'request-failed' });
  });
});

/**
 * THE SECURITY TEST. It catches: a `readUsage` that logs the request/error
 * for debugging (`console.log`/`console.error` with the header or the raw
 * error attached), or that forwards a caught error's `message` into the
 * `UsageSnapshot` it returns -- both are real shapes a "just log it and
 * return unknown" patch could take, and both would put the token where the
 * renderer (or a saved log file) could read it. The assertion is on the
 * ACTUAL returned value and the ACTUAL console output, not on a comment
 * saying the function is careful.
 */
describe('readUsage never lets the token escape', () => {
  it('keeps the token out of the returned snapshot and every console call, even when the error message contains it', async () => {
    const secretToken = 'sk-ant-oat01-do-not-let-this-leak-anywhere';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const snapshot = await readUsage({
      readToken: async () => secretToken,
      fetch: async () => {
        // A network error whose message happens to carry the header it
        // failed to send -- a realistic shape for a proxy/TLS failure log.
        throw new Error(`request failed: Authorization: Bearer ${secretToken}`);
      },
    });

    expect(snapshot).toEqual({ kind: 'unknown', reason: 'request-failed' });
    expect(JSON.stringify(snapshot)).not.toContain(secretToken);

    const allConsoleText = [
      ...consoleErrorSpy.mock.calls,
      ...consoleLogSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
    ]
      .flat()
      // `String(v)` rather than `JSON.stringify(v)`: an `Error`'s `message` is
      // NOT an own enumerable property, so `JSON.stringify(new Error('x'))`
      // is `'{}'` and a leaked token inside `error.message` would sail
      // through undetected. `String(error)` includes the message (via
      // `Error.prototype.toString`), which is what a real terminal or log
      // file would actually show an operator.
      .map((v) => String(v))
      .join(' ');
    expect(allConsoleText).not.toContain(secretToken);

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('keeps the token out of the snapshot on the unauthorized (401) path too', async () => {
    const secretToken = 'sk-ant-oat01-another-secret-value';

    const snapshot = await readUsage({
      readToken: async () => secretToken,
      fetch: async () => jsonResponse(401, { error: 'invalid token' }),
    });

    expect(snapshot).toEqual({ kind: 'unknown', reason: 'unauthorized' });
    expect(JSON.stringify(snapshot)).not.toContain(secretToken);
  });
});
