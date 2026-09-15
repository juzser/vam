/**
 * `registerFilesListIpc`: the channel that lets the renderer DISCOVER a path
 * inside a live session's own directory, before it ever has one to hand
 * `filesRead`/`filesWrite`. Mirrors `attach-image.test.ts`'s own shape --
 * resolve a session id to a cwd, `realpath` it, then do the real work -- with
 * an in-memory `ReadDir` standing in for the disk (`list.test.ts` already
 * falsifies the walk itself).
 */

import { describe, expect, it } from 'vitest';
import type { RealpathFn } from '../../../src/main/files/authorize.js';
import type { DirentLike, ReadDir } from '../../../src/main/files/list.js';
import { type ResolveSessionCwd, registerFilesListIpc } from '../../../src/main/files/list-ipc.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness(input: {
  resolveCwd?: ResolveSessionCwd;
  realpathFn?: RealpathFn;
  readDir?: ReadDir;
}) {
  let handler: Handler | undefined;
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      if (channel === CHANNELS.filesList) handler = listener;
    },
  };
  registerFilesListIpc(
    ipcMain,
    input.resolveCwd ?? (async () => '/root'),
    input.realpathFn ?? (async (p) => p),
    input.readDir ?? (async () => []),
  );
  if (handler === undefined) throw new Error('filesList channel not registered');
  const call = handler;
  return {
    invoke: (...args: unknown[]) => call(undefined, ...args),
  };
}

const dirent = (name: string, kind: 'file' | 'dir'): DirentLike => ({
  name,
  isDirectory: () => kind === 'dir',
  isFile: () => kind === 'file',
});

describe('registerFilesListIpc', () => {
  it('resolves the session id to a cwd, and lists what is under it', async () => {
    const { invoke } = harness({
      resolveCwd: async (id) => (id === 's1' ? '/home/s1' : null),
      readDir: async (dir) =>
        dir === '/home/s1' ? [dirent('a.txt', 'file'), dirent('b.txt', 'file')] : [],
    });
    const result = (await invoke('s1')) as { ok: true; value: { root: string; files: string[] } };
    expect(result.ok).toBe(true);
    expect(result.value.root).toBe('/home/s1');
    expect(result.value.files).toEqual(['/home/s1/a.txt', '/home/s1/b.txt']);
  });

  it('refuses invalid-payload for a non-string, empty, or missing session id', async () => {
    const { invoke } = harness({});
    for (const bad of [undefined, 42, '']) {
      const result = (await invoke(bad)) as { ok: false; error: { code: string } };
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('invalid-payload');
    }
  });

  it('refuses unknown-session when nothing live answers to the id', async () => {
    const { invoke } = harness({ resolveCwd: async () => null });
    const result = (await invoke('ghost')) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('unknown-session');
    expect(result.error.message).toContain('ghost');
  });

  it('refuses unreadable when the cwd itself cannot be resolved through the real filesystem', async () => {
    const { invoke } = harness({
      resolveCwd: async () => '/gone',
      realpathFn: async () => {
        throw new Error('ENOENT');
      },
    });
    const result = (await invoke('s1')) as { ok: false; error: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('unreadable');
  });

  it('lists off the REALPATH-resolved cwd, not the raw one main was told', async () => {
    const { invoke } = harness({
      resolveCwd: async () => '/link',
      realpathFn: async (p) => (p === '/link' ? '/real' : p),
      readDir: async (dir) => (dir === '/real' ? [dirent('x.txt', 'file')] : []),
    });
    const result = (await invoke('s1')) as { ok: true; value: { root: string; files: string[] } };
    expect(result.value.root).toBe('/real');
    expect(result.value.files).toEqual(['/real/x.txt']);
  });
});
