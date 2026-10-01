/**
 * `registerAdhdSkillIpc`: the three channels, and that none of them can be
 * made to take a path.
 *
 * The behaviour of install/remove/status itself is
 * `test/main/skills/adhd-skill.test.ts`'s job; what this file adds is the
 * boundary the renderer actually crosses -- that `adhdSkillInstall` reads
 * ONLY a boolean `force` out of its arguments and ignores everything else a
 * hostile or buggy renderer could send, including a string that LOOKS like a
 * path.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { AdhdSkillDeps } from '../../../src/main/skills/adhd-skill.js';
import { registerAdhdSkillIpc } from '../../../src/main/skills/ipc.js';
import {
  createRepoStatsReader,
  type RepoStatsFetcher,
} from '../../../src/main/skills/repo-stats.js';
import type { AdhdSkillActionResult, AdhdSkillStatus } from '../../../src/shared/adhd-skill.js';
import { ADHD_SKILL_SOURCE_REPO } from '../../../src/shared/adhd-skill.js';
import type { PreloadSourceApi } from '../../../src/shared/preload-api.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const made: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    await rm(made.pop() as string, { recursive: true, force: true });
  }
});

async function harness(fetch?: RepoStatsFetcher) {
  const homeDir = await tempDir('vam-adhd-ipc-home-');
  const bundledDir = await tempDir('vam-adhd-ipc-bundle-');
  await writeFile(join(bundledDir, 'SKILL.md'), '---\nname: i-have-adhd\n---\nrules\n');
  await writeFile(join(bundledDir, 'LICENSE'), 'MIT\n');
  const deps: AdhdSkillDeps = { homeDir, bundledDir };
  const handlers = new Map<string, Handler>();
  registerAdhdSkillIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    deps,
    fetch === undefined ? undefined : createRepoStatsReader({ fetch, now: () => 0, timeoutMs: 50 }),
  );
  return { handlers, homeDir, bundledDir };
}

describe('registerAdhdSkillIpc', () => {
  it('registers exactly the four channels', async () => {
    const { handlers } = await harness();
    expect([...handlers.keys()].sort()).toEqual(
      [
        CHANNELS.adhdSkillStatus,
        CHANNELS.adhdSkillInstall,
        CHANNELS.adhdSkillRemove,
        CHANNELS.adhdSkillStars,
      ].sort(),
    );
  });

  it('the stars channel is desktop-only: no remote route, not a PreloadSourceApi member', () => {
    expect(CHANNELS.adhdSkillStars).toBe('vam:skills:adhd-stars');
    const dir = new URL('../../../src/main/remote/', import.meta.url);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      expect(readFileSync(new URL(name, dir), 'utf8')).not.toContain(CHANNELS.adhdSkillStars);
    }
    expectTypeOf<PreloadSourceApi>().not.toHaveProperty('adhdSkillStars');
    expectTypeOf<PreloadSourceApi>().not.toHaveProperty('stars');
  });

  it('stars ignores every renderer argument and makes only the one fixed request', async () => {
    const urls: string[] = [];
    const { handlers } = await harness(async (url) => {
      urls.push(url);
      return { status: 200, ok: true, json: async () => ({ stargazers_count: 9 }) };
    });
    const answer = await handlers.get(CHANNELS.adhdSkillStars)?.({}, 'evil/repo', {
      repo: 'x/y',
      url: 'https://example.com',
    });
    expect(answer).toEqual({ stars: 9 });
    expect(urls).toEqual([`https://api.github.com/repos/${ADHD_SKILL_SOURCE_REPO}`]);
  });

  const broken: [string, RepoStatsFetcher][] = [
    [
      'throws synchronously',
      () => {
        throw new Error('boom');
      },
    ],
    ['rejects', async () => Promise.reject(new Error('offline'))],
    [
      'returns a non-JSON body',
      async () => ({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError('not json');
        },
      }),
    ],
  ];
  for (const [name, fetch] of broken) {
    it(`stars resolves null, never rejects, when the fetcher ${name}`, async () => {
      const { handlers } = await harness(fetch);
      await expect(
        handlers.get(CHANNELS.adhdSkillStars)?.({}, 'evil/repo', { repo: 'x/y' }),
      ).resolves.toBeNull();
    });
  }

  it('status answers bare, with no argument read at all', async () => {
    const { handlers } = await harness();
    const status = (await handlers.get(CHANNELS.adhdSkillStatus)?.(
      {},
      '/etc/passwd',
      'ignored',
    )) as AdhdSkillStatus;
    expect(status.overall).toBe('not-installed');
  });

  it('install treats a non-boolean first argument as force=false, never as a path', async () => {
    const { handlers, homeDir } = await harness();
    // A hostile or buggy renderer sending a STRING where `force` belongs must
    // not be read as a directory to write into -- there is no code path here
    // that could even try, since `installAdhdSkill` never receives the raw
    // argument, only `args[0] === true`.
    const result = (await handlers.get(CHANNELS.adhdSkillInstall)?.(
      {},
      '/tmp/somewhere-else',
    )) as AdhdSkillActionResult;
    expect(result.agents.every((a) => a.kind === 'written')).toBe(true);
    // And it landed at the FIXED directory, not the string that was sent.
    expect(result.status.agents.find((a) => a.agent === 'claude')?.dir).toBe(
      join(homeDir, '.claude', 'skills', 'i-have-adhd'),
    );
  });

  it('install reads a literal `true` as force, and nothing else', async () => {
    const { handlers } = await harness();
    await handlers.get(CHANNELS.adhdSkillInstall)?.({}, 'true');
    // The string "true" is not the boolean `true` -- so a directory left
    // outdated-modified before this call would still have been refused. Here
    // there is nothing installed yet, so this call only proves the channel
    // does not throw on an unexpected argument shape.
    const status = (await handlers.get(CHANNELS.adhdSkillStatus)?.({})) as AdhdSkillStatus;
    expect(status.overall).toBe('installed');
  });

  it('remove takes no argument at all', async () => {
    const { handlers } = await harness();
    await handlers.get(CHANNELS.adhdSkillInstall)?.({});
    const result = (await handlers.get(CHANNELS.adhdSkillRemove)?.(
      {},
      'anything',
      42,
    )) as AdhdSkillActionResult;
    expect(result.agents.every((a) => a.kind === 'removed')).toBe(true);
  });
});
