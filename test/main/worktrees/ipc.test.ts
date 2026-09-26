/**
 * `registerWorktreesIpc`: validation and the `IpcResult` envelope.
 *
 * `worktrees.integration.test.ts` already falsifies every refusal against a
 * real git repository; this file's job is the boundary the renderer
 * actually crosses -- wrong-shaped input, and the fold from
 * `SourceError | T` into `{ok:false,error}` / `{ok:true,value}`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANNELS, type IpcResult } from '../../../src/main/ipc/channels.js';
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import { runGitViaCli } from '../../../src/main/worktrees/git-run.js';
import { registerWorktreesIpc } from '../../../src/main/worktrees/ipc.js';
import type { WorktreesDeps } from '../../../src/main/worktrees/worktrees.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const made: string[] = [];

function tempRepo(): string {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'vam-wt-ipc-')));
  made.push(parent);
  const dir = join(parent, 'repo');
  mkdirSync(dir);
  const git = (args: readonly string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git(['init', '--quiet', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'vam test']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  git(['add', 'README.md']);
  git(['commit', '--quiet', '-m', 'initial']);
  return dir;
}

afterEach(() => {
  while (made.length > 0) {
    rmSync(made.pop() as string, { recursive: true, force: true });
  }
});

function harness(repo: string) {
  const handlers = new Map<string, Handler>();
  const projectId = projectIdOf(repo);
  const deps: WorktreesDeps = {
    run: runGitViaCli(),
    realpathFn: (p: string) => realpath(p),
    resolveProjectDirectory: async (id: string) => (id === projectId ? repo : null),
    knownProjectIds: async () => [projectId],
  };
  registerWorktreesIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    deps,
  );
  return { handlers, projectId };
}

describe('registerWorktreesIpc — validation', () => {
  it('refuses worktree:list with no project id', async () => {
    const { handlers } = harness(tempRepo());
    const result = (await handlers.get(CHANNELS.worktreeList)?.({})) as IpcResult<unknown>;
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-payload' }),
    });
  });

  it('refuses worktree:create with a missing name', async () => {
    const { handlers, projectId } = harness(tempRepo());
    const result = (await handlers.get(CHANNELS.worktreeCreate)?.(
      {},
      { projectId },
    )) as IpcResult<unknown>;
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-payload' }),
    });
  });

  it('refuses worktree:remove whose worktreeId is not an absolute path', async () => {
    const { handlers, projectId } = harness(tempRepo());
    const result = (await handlers.get(CHANNELS.worktreeRemove)?.(
      {},
      { projectId, worktreeId: 'relative/path' },
    )) as IpcResult<unknown>;
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-payload' }),
    });
  });

  it('refuses worktree:remove whose force flag is the wrong type', async () => {
    const { handlers, projectId } = harness(tempRepo());
    const result = (await handlers.get(CHANNELS.worktreeRemove)?.(
      {},
      { projectId, worktreeId: '/tmp/x', force: 'yes' },
    )) as IpcResult<unknown>;
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-payload' }),
    });
  });

  it('refuses worktree:remove with no projectId at all -- rule 6, not merely a bad shape elsewhere', async () => {
    const { handlers } = harness(tempRepo());
    const result = (await handlers.get(CHANNELS.worktreeRemove)?.(
      {},
      { worktreeId: '/tmp/x' },
    )) as IpcResult<unknown>;
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-payload' }),
    });
  });
});

describe('registerWorktreesIpc — the envelope, end to end against a real repo', () => {
  it('list answers ok:true with an empty array for a repo with no worktrees', async () => {
    const { handlers, projectId } = harness(tempRepo());
    const result = (await handlers.get(CHANNELS.worktreeList)?.(
      {},
      projectId,
    )) as IpcResult<unknown>;
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('create answers ok:true with the new worktree, and a second list sees it', async () => {
    const { handlers, projectId } = harness(tempRepo());
    const created = (await handlers.get(CHANNELS.worktreeCreate)?.(
      {},
      { projectId, name: 'feat' },
    )) as IpcResult<{ branch: string }>;
    expect(created.ok).toBe(true);
    expect(created.ok && created.value.branch).toBe('feat');

    const listed = (await handlers.get(CHANNELS.worktreeList)?.({}, projectId)) as IpcResult<
      readonly unknown[]
    >;
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it('a refusal from worktrees.ts crosses the bridge with its own code intact', async () => {
    const { handlers } = harness(tempRepo());
    const result = (await handlers.get(CHANNELS.worktreeList)?.(
      {},
      'claude-code:unknown-00000000',
    )) as IpcResult<unknown>;
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'unknown-project' }),
    });
  });

  it('remove answers ok:true and reports whether the branch was preserved', async () => {
    const { handlers, projectId } = harness(tempRepo());
    const created = (await handlers.get(CHANNELS.worktreeCreate)?.(
      {},
      { projectId, name: 'feat' },
    )) as IpcResult<{ worktreeId: string }>;
    const worktreeId = created.ok ? created.value.worktreeId : '';

    const removed = (await handlers.get(CHANNELS.worktreeRemove)?.(
      {},
      { projectId, worktreeId },
    )) as IpcResult<{ preservedBranch: boolean }>;

    expect(removed).toEqual({ ok: true, value: { preservedBranch: false } });
  });
});
