/**
 * `registerFilesListIpc`: the channel that lets the renderer DISCOVER a path
 * inside a live session's own directory, before it ever has one to hand
 * `filesRead`/`filesWrite`. Mirrors `attach-image.test.ts`'s own shape --
 * resolve a session id to a cwd, `realpath` it, then do the real work -- with
 * an in-memory `ReadDir` standing in for the disk (`list.test.ts` already
 * falsifies the walk itself).
 */

import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('registerFilesListIpc with a dir argument', () => {
  const tree: Record<string, DirentLike[]> = {
    '/root': [dirent('a', 'dir'), dirent('r.txt', 'file')],
    '/root/a': [dirent('b.ts', 'file')],
  };
  const readDir: ReadDir = async (p) => tree[p] ?? [];

  it('lists the direct children of dir', async () => {
    const { invoke } = harness({ readDir });
    const result = (await invoke('s1', 'a')) as { ok: true; value: { entries: unknown[] } };
    expect(result.ok).toBe(true);
    expect(result.value.entries).toEqual([{ name: 'b.ts', kind: 'file' }]);
  });

  it('refuses ../ and an absolute path outside the cwd', async () => {
    const { invoke } = harness({ readDir });
    for (const bad of ['../etc', '/etc']) {
      const result = (await invoke('s1', bad)) as { ok: false; error: { kind: string } };
      expect(result.ok).toBe(false);
      expect(result.error.kind).toBe('refused');
    }
  });

  it('with no dir still returns the full walk', async () => {
    const { invoke } = harness({ readDir });
    const result = (await invoke('s1')) as { ok: true; value: { files: string[] } };
    expect(result.value.files).toEqual(['/root/a/b.ts', '/root/r.txt']);
  });
});

describe('registerFilesListIpc containment on a real disk', () => {
  it('refuses symlink escapes and malformed dirs with zero reads', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vam-list-'));
    try {
      const cwd = join(base, 'cwd');
      await mkdir(join(cwd, 'a'), { recursive: true });
      await mkdir(join(cwd, 'inner'), { recursive: true });
      await mkdir(join(base, 'outside'));
      await writeFile(join(base, 'outside', 'secret'), 'x');
      await symlink(join(base, 'outside'), join(cwd, 'link'));
      await symlink(join(cwd, 'inner'), join(cwd, 'inlink'));
      await writeFile(join(cwd, 'inner', 'f.txt'), 'x');
      const reads: string[] = [];
      const spy: ReadDir = async (p) => {
        reads.push(p);
        return readdir(p, { withFileTypes: true });
      };
      const { invoke } = harness({
        resolveCwd: async () => cwd,
        realpathFn: realpath,
        readDir: spy,
      });
      for (const bad of ['link', 'a/../../x', 42, {}, 'a\u0000b']) {
        const result = (await invoke('s1', bad)) as { ok: boolean; error?: { kind: string } };
        expect(result.ok).toBe(false);
        expect(result.error?.kind).toBe('refused');
      }
      expect(reads).toEqual([]);
      // A symlink to a directory inside the cwd is refused, not followed (EC-13).
      await mkdir(join(cwd, 'inner', 'sub'));
      const realCwd = await realpath(cwd);
      for (const dir of [
        'inlink',
        'inlink/sub',
        join(realCwd, 'inlink'),
        join(realCwd, 'inlink', 'sub'),
      ]) {
        const r = (await invoke('s1', dir)) as { ok: boolean; error?: { kind: string } };
        expect(r.ok).toBe(false);
        expect(r.error?.kind).toBe('refused');
      }
      expect(reads).toEqual([]);
      // A symlink child drops out of a listing.
      const top = (await invoke('s1', '')) as { ok: true; value: { entries: { name: string }[] } };
      expect(top.value.entries.map((e) => e.name)).toEqual(['a', 'inner']);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe('registerFilesListIpc dir edge cases on a real disk', () => {
  async function withTree(
    run: (ctx: {
      cwd: string;
      reads: string[];
      invoke: (...a: unknown[]) => unknown;
    }) => Promise<void>,
  ) {
    const base = await mkdtemp(join(tmpdir(), 'vam-list-edge-'));
    try {
      const cwd = join(base, 'cwd');
      await mkdir(join(cwd, 'a'), { recursive: true });
      await writeFile(join(cwd, 'a', 'f.txt'), 'x');
      await writeFile(join(cwd, 'file.txt'), 'x');
      const reads: string[] = [];
      const spy: ReadDir = async (p) => {
        reads.push(p);
        return readdir(p, { withFileTypes: true });
      };
      const { invoke } = harness({
        resolveCwd: async () => cwd,
        realpathFn: realpath,
        readDir: spy,
      });
      await run({ cwd: await realpath(cwd), reads, invoke });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }

  it("dir '.' lists the root itself", async () => {
    await withTree(async ({ invoke }) => {
      const r = (await invoke('s1', '.')) as { ok: true; value: { entries: { name: string }[] } };
      expect(r.ok).toBe(true);
      expect(r.value.entries.map((e) => e.name)).toEqual(['a', 'file.txt']);
    });
  });

  it('admits an absolute path inside the cwd', async () => {
    await withTree(async ({ cwd, invoke }) => {
      const r = (await invoke('s1', join(cwd, 'a'))) as {
        ok: true;
        value: { entries: unknown[]; dir: string };
      };
      expect(r.ok).toBe(true);
      expect(r.value.dir).toBe(join(cwd, 'a'));
      expect(r.value.entries).toEqual([{ name: 'f.txt', kind: 'file' }]);
    });
  });

  it('refuses a nonexistent dir with zero reads', async () => {
    await withTree(async ({ reads, invoke }) => {
      const r = (await invoke('s1', 'nope')) as { ok: false; error: { kind: string } };
      expect(r.ok).toBe(false);
      expect(r.error.kind).toBe('refused');
      expect(reads).toEqual([]);
    });
  });

  it('refuses (does not throw) when dir is a file', async () => {
    await withTree(async ({ invoke }) => {
      const r = (await invoke('s1', 'file.txt')) as { ok: false; error: { kind: string } };
      expect(r.ok).toBe(false);
      expect(r.error.kind).toBe('refused');
    });
  });

  it('refuses a sibling whose name merely prefixes the cwd', async () => {
    await withTree(async ({ cwd, invoke }) => {
      const r = (await invoke('s1', `${cwd}-evil`)) as { ok: false };
      expect(r.ok).toBe(false);
    });
  });
});

describe('registerFilesListIpc symlink refusal depth on a real disk', () => {
  type Refusal = { ok: boolean; error?: { kind: string; code: string } };

  async function withLinks(
    run: (ctx: {
      base: string;
      cwd: string;
      reads: string[];
      invoke: (...a: unknown[]) => Promise<unknown>;
    }) => Promise<void>,
    opts: { linkedCwd?: boolean } = {},
  ) {
    const base = await mkdtemp(join(tmpdir(), 'vam-list-sym-'));
    try {
      const cwd = join(base, 'cwd');
      await mkdir(join(cwd, 'real', 'deep'), { recursive: true });
      await mkdir(join(cwd, 'target'));
      await writeFile(join(cwd, 'target', 't.txt'), 'x');
      await writeFile(join(cwd, 'real', 'deep', 'x'), 'x');
      await writeFile(join(cwd, 'plain.txt'), 'x');
      await symlink(join(cwd, 'target'), join(cwd, 'inlink'));
      await symlink(join(cwd, 'target'), join(cwd, 'real', 'inner-link'));
      await symlink(join(cwd, 'plain.txt'), join(cwd, 'filelink'));
      await symlink(join(cwd, 'gone'), join(cwd, 'dangling'));
      const sessionCwd = opts.linkedCwd ? join(base, 'cwd-link') : cwd;
      if (opts.linkedCwd) await symlink(cwd, sessionCwd);
      const reads: string[] = [];
      const spy: ReadDir = async (p) => {
        reads.push(p);
        return readdir(p, { withFileTypes: true });
      };
      const { invoke } = harness({
        resolveCwd: async () => sessionCwd,
        realpathFn: realpath,
        readDir: spy,
      });
      await run({ base, cwd: await realpath(cwd), reads, invoke: async (...a) => invoke(...a) });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }

  it("refuses with code 'symlink' and no read for a symlink dir, with or without a trailing slash", async () => {
    await withLinks(async ({ reads, invoke }) => {
      for (const dir of ['inlink', 'inlink/', 'inlink//']) {
        const r = (await invoke('s1', dir)) as Refusal;
        expect(r.ok).toBe(false);
        expect(r.error?.code).toBe('symlink');
      }
      expect(reads).toEqual([]);
    });
  });

  it('refuses a symlink deeper in the path (real/inner-link/x) with zero reads', async () => {
    await withLinks(async ({ cwd, reads, invoke }) => {
      for (const dir of ['real/inner-link', 'real/inner-link/', 'real/inner-link/x']) {
        const r = (await invoke('s1', dir)) as Refusal;
        expect(r.ok).toBe(false);
        expect(r.error?.kind).toBe('refused');
      }
      const abs = (await invoke('s1', join(cwd, 'real', 'inner-link'))) as Refusal;
      expect(abs.error?.code).toBe('symlink');
      expect(reads).toEqual([]);
    });
  });

  it('refuses a symlink to a file and a dangling symlink with zero reads', async () => {
    await withLinks(async ({ reads, invoke }) => {
      for (const dir of ['filelink', 'dangling']) {
        const r = (await invoke('s1', dir)) as Refusal;
        expect(r.ok).toBe(false);
        expect(r.error?.kind).toBe('refused');
      }
      expect(reads).toEqual([]);
    });
  });

  it('still lists a real nested dir and omits every symlink child from its listing', async () => {
    await withLinks(async ({ cwd, invoke }) => {
      const nested = (await invoke('s1', 'real')) as {
        ok: true;
        value: { dir: string; entries: { name: string }[] };
      };
      expect(nested.ok).toBe(true);
      expect(nested.value.dir).toBe(join(cwd, 'real'));
      expect(nested.value.entries.map((e) => e.name)).toEqual(['deep']);
      const top = (await invoke('s1', '')) as { ok: true; value: { entries: { name: string }[] } };
      expect(top.value.entries.map((e) => e.name)).toEqual(['plain.txt', 'real', 'target']);
    });
  });

  it('a symlinked session cwd is resolved through realpath and its real children still list', async () => {
    await withLinks(
      async ({ cwd, invoke }) => {
        for (const dir of ['', '.', 'real', join(cwd, 'real')]) {
          const r = (await invoke('s1', dir)) as { ok: boolean; value?: { root: string } };
          expect(r.ok).toBe(true);
          expect(r.value?.root).toBe(cwd);
        }
        const link = (await invoke('s1', 'inlink')) as Refusal;
        expect(link.error?.code).toBe('symlink');
      },
      { linkedCwd: true },
    );
  });
});

describe('registerFilesListIpc when the real cwd is a filesystem root', () => {
  it('lists the root for dir "" and "." rather than refusing it as a symlink', async () => {
    const { invoke } = harness({
      resolveCwd: async () => '/',
      readDir: async (dir) => (dir === '/' ? [dirent('etc', 'dir')] : []),
    });
    for (const dir of ['', '.']) {
      const r = (await invoke('s1', dir)) as { ok: boolean; value?: { entries: unknown[] } };
      expect(r.ok).toBe(true);
      expect(r.value?.entries).toEqual([{ name: 'etc', kind: 'dir' }]);
    }
  });
});
