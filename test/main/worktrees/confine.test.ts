/**
 * The EXACT confinement call `createWorktree` makes before it ever spawns
 * git -- `files/authorize.ts`'s own `authorize()`, reused whole rather than
 * reimplemented (see `worktrees.ts`'s header). These tests exist because
 * `sanitizeWorktreeName` already makes a traversal attempt through the
 * NORMAL path (a typed `../../etc`) impossible -- the slug it returns can
 * never contain a `/` -- so the only way to prove the confinement layer
 * itself still holds is to call it directly with the adversarial inputs a
 * broken sanitiser, a future refactor, or a crafted symlink could produce:
 * `..`, a symlink that escapes the root, and an absolute path. Falsifying
 * this guard once (mutate the containment check, watch a symlink escape get
 * authorised) is what proves it is doing anything at all.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authorize } from '../../../src/main/files/authorize.js';

const made: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vam-wt-confine-')));
  made.push(dir);
  return dir;
}

afterEach(() => {
  while (made.length > 0) {
    rmSync(made.pop() as string, { recursive: true, force: true });
  }
});

const realpathFn = (p: string) => realpath(p);

describe('worktree path confinement (authorize, as worktrees.ts calls it)', () => {
  it('authorises a fresh leaf directly inside the worktrees root', async () => {
    const root = tempDir();
    const target = join(root, 'feat');

    const result = await authorize(target, [root], realpathFn);

    expect(result).toMatchObject({ authorized: true, existed: false });
  });

  it('refuses a `..` escape even though it does not exist yet', async () => {
    const parent = tempDir();
    const root = join(parent, 'repo-worktrees');
    mkdirSync(root);
    const traversal = join(root, '..', '..', 'etc', 'passwd');

    const result = await authorize(traversal, [root], realpathFn);

    expect(result).toEqual({ authorized: false });
  });

  it('refuses a SYMLINK inside the root that resolves outside it', async () => {
    const parent = tempDir();
    const root = join(parent, 'repo-worktrees');
    mkdirSync(root);
    const outside = join(parent, 'outside');
    mkdirSync(outside);
    const link = join(root, 'escape-link');
    symlinkSync(outside, link);
    // The candidate a caller would authorize is a path INSIDE the link --
    // the exact shape `attach-image.ts`'s own header measured against a real
    // disk: a link whose OWN name sits inside the root, whose TARGET does
    // not.
    const candidate = join(link, 'new-worktree');

    const result = await authorize(candidate, [root], realpathFn);

    expect(result).toEqual({ authorized: false });
  });

  it('refuses an absolute-looking candidate outside every root', async () => {
    const root = tempDir();
    const elsewhere = tempDir();

    const result = await authorize(join(elsewhere, 'name'), [root], realpathFn);

    expect(result).toEqual({ authorized: false });
  });

  it('FALSIFIED: a containment check that only compares string prefixes is fooled by the same symlink', async () => {
    const parent = tempDir();
    const root = join(parent, 'repo-worktrees');
    mkdirSync(root);
    const outside = join(parent, 'outside');
    mkdirSync(outside);
    const link = join(root, 'escape-link');
    symlinkSync(outside, link);
    const candidate = join(link, 'new-worktree');

    // A naive `candidate.startsWith(root)` check -- the bug this test proves
    // `authorize()` does NOT have -- passes here, because the STRING
    // `candidate` really does start with the string `root`. Only resolving
    // through the real filesystem (what `authorize()` does) catches it.
    expect(candidate.startsWith(root)).toBe(true);

    const result = await authorize(candidate, [root], realpathFn);
    expect(result).toEqual({ authorized: false });
  });
});
