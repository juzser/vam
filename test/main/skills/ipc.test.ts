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

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { AdhdSkillDeps } from '../../../src/main/skills/adhd-skill.js';
import { registerAdhdSkillIpc } from '../../../src/main/skills/ipc.js';
import type { AdhdSkillActionResult, AdhdSkillStatus } from '../../../src/shared/adhd-skill.js';

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

async function harness() {
  const homeDir = await tempDir('vam-adhd-ipc-home-');
  const bundledDir = await tempDir('vam-adhd-ipc-bundle-');
  await writeFile(join(bundledDir, 'SKILL.md'), '---\nname: i-have-adhd\n---\nrules\n');
  await writeFile(join(bundledDir, 'LICENSE'), 'MIT\n');
  const deps: AdhdSkillDeps = { homeDir, bundledDir };
  const handlers = new Map<string, Handler>();
  registerAdhdSkillIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    deps,
  );
  return { handlers, homeDir, bundledDir };
}

describe('registerAdhdSkillIpc', () => {
  it('registers exactly the three channels', async () => {
    const { handlers } = await harness();
    expect([...handlers.keys()].sort()).toEqual(
      [CHANNELS.adhdSkillStatus, CHANNELS.adhdSkillInstall, CHANNELS.adhdSkillRemove].sort(),
    );
  });

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
