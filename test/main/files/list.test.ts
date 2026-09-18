/**
 * `listFiles`: the walk behind `CHANNELS.filesList` (`../list-ipc.ts`).
 *
 * Pure logic, tested against an IN-MEMORY directory tree -- no real disk, the
 * same split `ipc.test.ts` already draws between the containment logic
 * (`authorize.test.ts`, real symlinks on a real disk) and the refusal
 * vocabulary (fakeable). This file's job is: `node_modules` and `.git` are
 * walked OVER, every other dotfile and dotdirectory stays visible, symlinks
 * are neither listed nor followed, and the walk stops at its own cap rather
 * than running away on a pathological tree.
 */

import { describe, expect, it } from 'vitest';
import {
  type DirentLike,
  LIST_LIMIT,
  listFiles,
  type ReadDir,
} from '../../../src/main/files/list.js';

type Tree = Record<string, readonly Entry[]>;
type Entry = { readonly name: string; readonly kind: 'file' | 'dir' | 'symlink' };

const dirent = (entry: Entry): DirentLike => ({
  name: entry.name,
  isDirectory: () => entry.kind === 'dir',
  isFile: () => entry.kind === 'file',
});

/** A fake `readdir(path, {withFileTypes: true})`, keyed by absolute path. */
function fakeFs(tree: Tree): ReadDir {
  return async (path: string) => {
    const entries = tree[path];
    if (entries === undefined) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return entries.map(dirent);
  };
}

describe('listFiles', () => {
  it('lists regular files under the root, as absolute paths', async () => {
    const readDir = fakeFs({
      '/root': [
        { name: 'a.txt', kind: 'file' },
        { name: 'b.txt', kind: 'file' },
      ],
    });
    const result = await listFiles('/root', readDir);
    expect(result).toEqual({
      root: '/root',
      files: ['/root/a.txt', '/root/b.txt'],
      truncated: false,
    });
  });

  it('recurses into real subdirectories', async () => {
    const readDir = fakeFs({
      '/root': [{ name: 'src', kind: 'dir' }],
      '/root/src': [{ name: 'index.ts', kind: 'file' }],
    });
    const result = await listFiles('/root', readDir);
    expect(result.files).toEqual(['/root/src/index.ts']);
  });

  it('walks OVER node_modules and .git -- never lists what is inside either', async () => {
    const readDir = fakeFs({
      '/root': [
        { name: 'node_modules', kind: 'dir' },
        { name: '.git', kind: 'dir' },
        { name: 'index.ts', kind: 'file' },
      ],
      '/root/node_modules': [{ name: 'left-pad.js', kind: 'file' }],
      '/root/.git': [{ name: 'HEAD', kind: 'file' }],
    });
    const result = await listFiles('/root', readDir);
    expect(result.files).toEqual(['/root/index.ts']);
  });

  /**
   * orca's own quick-open filter keeps user-authored dotdirs visible for the
   * same reason vam must: `.env` is the file the operator named this feature
   * for, and a dotdirectory holding project config (`.github/`, `.vscode/`)
   * is exactly where a person opens a file from. Only `.git` is named --
   * never a blanket dotfile exemption.
   */
  it('keeps every OTHER dotfile and dotdirectory visible', async () => {
    const readDir = fakeFs({
      '/root': [
        { name: '.env', kind: 'file' },
        { name: '.github', kind: 'dir' },
      ],
      '/root/.github': [{ name: 'workflow.yml', kind: 'file' }],
    });
    const result = await listFiles('/root', readDir);
    expect(result.files).toEqual(['/root/.env', '/root/.github/workflow.yml']);
  });

  /**
   * A `Dirent` from a real `readdir` reports neither `isDirectory()` nor
   * `isFile()` for a symlink -- it is LSTAT-shaped, never follows the link.
   * Neither listing it nor recursing into it is the containment this walk
   * inherits from `authorize.ts` rather than reinventing: a symlink inside a
   * session's directory that points outside it must not leak a name (or
   * content, one channel over) from outside the sandbox.
   */
  it('neither lists nor recurses into a symlink -- it is invisible to this walk', async () => {
    const readDir = fakeFs({
      '/root': [
        { name: 'escape', kind: 'symlink' },
        { name: 'real.txt', kind: 'file' },
      ],
    });
    const result = await listFiles('/root', readDir);
    expect(result.files).toEqual(['/root/real.txt']);
  });

  it('sorts entries by name for a stable, predictable order', async () => {
    const readDir = fakeFs({
      '/root': [
        { name: 'zeta.txt', kind: 'file' },
        { name: 'alpha.txt', kind: 'file' },
        { name: 'mid', kind: 'dir' },
      ],
      '/root/mid': [{ name: 'beta.txt', kind: 'file' }],
    });
    const result = await listFiles('/root', readDir);
    expect(result.files).toEqual(['/root/alpha.txt', '/root/mid/beta.txt', '/root/zeta.txt']);
  });

  it('skips a subdirectory it cannot read rather than failing the whole walk', async () => {
    const readDir = fakeFs({
      '/root': [
        { name: 'locked', kind: 'dir' },
        { name: 'ok.txt', kind: 'file' },
      ],
      // '/root/locked' deliberately absent from the tree -- fakeFs throws ENOENT for it.
    });
    const result = await listFiles('/root', readDir);
    expect(result.files).toEqual(['/root/ok.txt']);
  });

  it('stops at the limit and reports truncated, rather than walking a pathological tree forever', async () => {
    const entries: Entry[] = Array.from({ length: 10 }, (_, i) => ({
      name: `f${i}.txt`,
      kind: 'file' as const,
    }));
    const readDir = fakeFs({ '/root': entries });
    const result = await listFiles('/root', readDir, 3);
    expect(result.files).toEqual(['/root/f0.txt', '/root/f1.txt', '/root/f2.txt']);
    expect(result.truncated).toBe(true);
  });

  it('the default limit is a real, positive cap', () => {
    expect(LIST_LIMIT).toBeGreaterThan(0);
  });
});
