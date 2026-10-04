/**
 * `createRepoStatsReader`: the one anonymous, cached GitHub star read the
 * skill row asks for. Everything runs on an injected fetcher and clock, so
 * no test touches the network.
 */

import { describe, expect, it } from 'vitest';
import {
  createRepoStatsReader,
  REPO_STATS_FAILURE_TTL_MS,
  REPO_STATS_SUCCESS_TTL_MS,
  type RepoStatsFetcher,
} from '../../../src/main/skills/repo-stats.js';
import { ADHD_SKILL_SOURCE_REPO } from '../../../src/shared/adhd-skill.js';

type Call = { url: string; init: Parameters<RepoStatsFetcher>[1] };

function reply(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function harness(respond: (call: Call) => ReturnType<RepoStatsFetcher>) {
  const calls: Call[] = [];
  let now = 1_000_000;
  const read = createRepoStatsReader({
    fetch: (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    },
    now: () => now,
    timeoutMs: 25,
  });
  return {
    calls,
    read,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('createRepoStatsReader', () => {
  it('answers the stargazers_count of a 200 body', async () => {
    const h = harness(async () => reply(200, { stargazers_count: 42 }));
    expect(await h.read()).toEqual({ stars: 42 });
  });

  it('accepts zero as a real count', async () => {
    const h = harness(async () => reply(200, { stargazers_count: 0 }));
    expect(await h.read()).toEqual({ stars: 0 });
  });

  it('keeps a success for six hours, then fetches again', async () => {
    const h = harness(async () => reply(200, { stargazers_count: 7 }));
    await h.read();
    h.advance(REPO_STATS_SUCCESS_TTL_MS - 1);
    expect(await h.read()).toEqual({ stars: 7 });
    expect(h.calls).toHaveLength(1);
    h.advance(1);
    await h.read();
    expect(h.calls).toHaveLength(2);
  });

  it('two concurrent calls make one fetch', async () => {
    const h = harness(async () => reply(200, { stargazers_count: 5 }));
    const [a, b] = await Promise.all([h.read(), h.read()]);
    expect(a).toEqual({ stars: 5 });
    expect(b).toEqual({ stars: 5 });
    expect(h.calls).toHaveLength(1);
  });

  const failures: [string, (call: Call) => ReturnType<RepoStatsFetcher>][] = [
    ['offline (the fetcher rejects)', async () => Promise.reject(new Error('ENOTFOUND'))],
    [
      'a timeout',
      (call) =>
        new Promise((_resolve, reject) => {
          call.init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ],
    [
      'a synchronous throw',
      () => {
        throw new Error('boom');
      },
    ],
    ['403', async () => reply(403, { message: 'rate limit' })],
    ['429', async () => reply(429, {})],
    ['500', async () => reply(500, {})],
    ['a body without stargazers_count', async () => reply(200, {})],
    ['a negative count', async () => reply(200, { stargazers_count: -1 })],
    ['a non-integer count', async () => reply(200, { stargazers_count: 1.5 })],
    ['a string count', async () => reply(200, { stargazers_count: '42' })],
    ['a null body', async () => reply(200, null)],
    [
      'a non-JSON body',
      async () => ({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }),
    ],
  ];

  for (const [name, respond] of failures) {
    it(`answers null on ${name}, never throws, and does not retry for 15 minutes`, async () => {
      const h = harness(respond);
      expect(await h.read()).toBeNull();
      h.advance(REPO_STATS_FAILURE_TTL_MS - 1);
      expect(await h.read()).toBeNull();
      expect(h.calls).toHaveLength(1);
      h.advance(1);
      expect(await h.read()).toBeNull();
      expect(h.calls).toHaveLength(2);
    });
  }

  it('SAFETY: one fixed https GET to api.github.com, no credentials, two headers', async () => {
    const h = harness(async () => reply(200, { stargazers_count: 1 }));
    await h.read();
    expect(h.calls).toHaveLength(1);
    const { url, init } = h.calls[0] as Call;
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.host).toBe('api.github.com');
    expect(parsed.pathname).toBe(`/repos/${ADHD_SKILL_SOURCE_REPO}`);
    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe('');
    expect(init.headers).toEqual({
      'User-Agent': 'vam',
      Accept: 'application/vnd.github+json',
    });
    expect((init as { method?: string }).method ?? 'GET').toBe('GET');
    expect(init.signal).toBeDefined();
  });
});
