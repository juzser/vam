import { describe, expect, it } from 'vitest';
import { SmithApiError, SmithClient, SmithUnreachableError } from '../../src/adapter/client.js';

type Call = { url: string; init: RequestInit | undefined };

/** A fetch that records what it was asked and answers with what you pass in. */
function stub(response: { ok?: boolean; status?: number; body?: unknown; throws?: unknown }): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (response.throws !== undefined) {
      throw response.throws;
    }
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    } as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function client(fetch: typeof globalThis.fetch, baseUrl = 'http://127.0.0.1:8080') {
  return new SmithClient({ baseUrl, fetch });
}

describe('reads', () => {
  it('asks the overview route', async () => {
    const { fetch, calls } = stub({ body: { runningSessions: [], alerts: {} } });
    await client(fetch).overview();
    expect(calls[0]?.url).toBe('http://127.0.0.1:8080/api/overview');
  });

  it('scopes a timeline to its session, escaped', async () => {
    const { fetch, calls } = stub({ body: [] });
    await client(fetch).timeline('factory/sse 1');
    expect(calls[0]?.url).toContain('/api/timeline?session=factory%2Fsse%201');
  });

  it('trims a trailing slash off the base rather than doubling it', async () => {
    // `${base}//api/x` is a 404 whose cause is invisible in the UI.
    const { fetch, calls } = stub({ body: {} });
    await client(fetch, 'http://127.0.0.1:8080/').overview();
    expect(calls[0]?.url).toBe('http://127.0.0.1:8080/api/overview');
  });
});

describe('writes', () => {
  it('posts the prompt with its session', async () => {
    const { fetch, calls } = stub({ body: { eventId: 'e1' } });
    await client(fetch).recordPrompt('factory-sse-1', 'chạy lại task-4');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(calls[0]?.init?.method).toBe('POST');
    expect(body.sessionId).toBe('factory-sse-1');
    expect(body.prompt).toBe('chạy lại task-4');
  });

  it('never sends a causal parent of its own', async () => {
    // vam polls. Any causal id it held would be stale by the time you pressed
    // Enter, and a write chained onto a stale parent is the corruption §6
    // warns about. The server resolves it from the session's own last event.
    const { fetch, calls } = stub({ body: {} });
    await client(fetch).recordPrompt('s1', 'xin chào');
    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty('causalParent');
  });

  it('stamps an actor so the log records a person did this', async () => {
    const { fetch, calls } = stub({ body: {} });
    await client(fetch).recordPrompt('s1', 'xin chào');
    expect(JSON.parse(String(calls[0]?.init?.body)).actor).toBe('operator');
  });

  it('sends waiver decisions as a batch under its envelope', async () => {
    const { fetch, calls } = stub({ body: { applied: 2 } });
    await client(fetch).applyWaivers({ sessionId: 's1' }, [
      { fingerprint: 'fp-1', decision: 'granted', operatorNote: 'nit, waive' },
      { fingerprint: 'fp-2', decision: 'denied', operatorNote: 'sửa đi' },
    ]);
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toContain('/api/waivers/apply-batch');
    expect(body.decisions).toHaveLength(2);
    expect(body.sessionId).toBe('s1');
  });

  it('routes a lesson approval and a rejection to different paths', async () => {
    const approve = stub({ body: {} });
    await client(approve.fetch).transitionLesson('l-1', 'approve');
    expect(approve.calls[0]?.url).toContain('/api/lessons/l-1/approve');

    const reject = stub({ body: {} });
    await client(reject.fetch).transitionLesson('l-1', 'reject');
    expect(reject.calls[0]?.url).toContain('/api/lessons/l-1/reject');
  });

  it('never sets acceptDuplicate on the operator’s behalf', async () => {
    const { fetch, calls } = stub({ body: {} });
    await client(fetch).transitionLesson('l-1', 'approve', { note: 'ok' });
    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty('acceptDuplicate');
  });
});

describe('when the factory refuses', () => {
  it('keeps the factory’s own code and message', async () => {
    // The message names the actual problem. Collapsing it into "failed" throws
    // away the one thing black-smith just told us.
    const { fetch } = stub({
      ok: false,
      status: 400,
      body: {
        error: { code: 'write.bad-request', message: 'Request body must include "sessionId".' },
      },
    });
    await expect(client(fetch).recordPrompt('', 'x')).rejects.toMatchObject({
      name: 'SmithApiError',
      code: 'write.bad-request',
      message: 'Request body must include "sessionId".',
      status: 400,
    });
  });

  it('falls back to the status when the body is not an error shape', async () => {
    const { fetch } = stub({ ok: false, status: 502, body: '<html>bad gateway</html>' });
    await expect(client(fetch).overview()).rejects.toBeInstanceOf(SmithApiError);
  });

  it('tells a dead server apart from a rejected write', async () => {
    // Different problems, different sentences: one is "black-smith chưa chạy",
    // the other is "what you sent was wrong".
    const { fetch } = stub({ throws: new TypeError('fetch failed') });
    await expect(client(fetch).overview()).rejects.toBeInstanceOf(SmithUnreachableError);
  });
});
