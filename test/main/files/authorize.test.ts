/**
 * Path authorisation for the file-editor tab: `src/main/files/authorize.ts`.
 *
 * Every fictional-path test below uses an IDENTITY `realpathFn` (a path
 * resolves to itself) -- exactly `attach-image.test.ts`'s own reasoning for
 * why: `/work/session/pic.png` does not exist on the real disk this process
 * runs on, so a real `fs.realpath` would refuse it with ENOENT before the
 * containment logic this module owns ever ran. The symlink-escape tests at
 * the bottom are the ones that need a REAL disk, and use the real
 * `node:fs/promises` `realpath` against a real temp directory, the same way
 * `attach-image.test.ts` does.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authorize, type RealpathFn } from '../../../src/main/files/authorize.js';

const identity: RealpathFn = async (path) => path;

describe('authorize -- fictional paths, identity realpath', () => {
  it('authorises a path inside a live root', async () => {
    const result = await authorize('/work/session/.env', ['/work/session'], identity);
    expect(result).toEqual({
      authorized: true,
      realPath: '/work/session/.env',
      existed: true,
    });
  });

  it('refuses a path outside every root', async () => {
    const result = await authorize('/etc/passwd', ['/work/session'], identity);
    expect(result).toEqual({ authorized: false });
  });

  it('refuses a relative path -- only main resolves an absolute one', async () => {
    const result = await authorize('session/.env', ['/work/session'], identity);
    expect(result).toEqual({ authorized: false });
  });

  it('refuses a path carrying a NUL byte', async () => {
    const result = await authorize('/work/session/\0evil', ['/work/session'], identity);
    expect(result).toEqual({ authorized: false });
  });

  it('refuses the root directory itself -- there is nothing to open at that path', async () => {
    const result = await authorize('/work/session', ['/work/session'], identity);
    expect(result).toEqual({ authorized: false });
  });

  it('checks every root, not only the first', async () => {
    const roots = ['/work/one', '/work/two'];
    expect(await authorize('/work/two/.env', roots, identity)).toMatchObject({
      authorized: true,
    });
  });

  it('a root that fails to resolve authorises nothing, but does not block the others', async () => {
    const realpathFn: RealpathFn = async (path) => {
      if (path === '/work/gone') throw new Error('ENOENT');
      return path;
    };
    const roots = ['/work/gone', '/work/live'];
    expect(await authorize('/work/live/.env', roots, realpathFn)).toMatchObject({
      authorized: true,
    });
    expect(await authorize('/work/gone/.env', roots, realpathFn)).toEqual({ authorized: false });
  });
});

/**
 * THE MISSING LEAF: a path that does not exist yet must still authorise --
 * an operator creating `.env` for the first time -- but only by walking up to
 * an ancestor that DOES exist and resolving THAT through `realpathFn`, never
 * by skipping resolution altogether. These tests use a realpath stub that
 * throws for anything not in a fixed set of "existing" paths, so the walk's
 * shape is asserted without a real disk.
 */
describe('authorize -- a leaf that does not exist yet', () => {
  const EXISTS = new Set(['/work/session', '/work/session/sub']);
  const realpathFn: RealpathFn = async (path) => {
    if (EXISTS.has(path)) return path;
    throw new Error('ENOENT');
  };

  it('authorises a new file directly inside an existing, authorised directory', async () => {
    const result = await authorize('/work/session/.env', ['/work/session'], realpathFn);
    expect(result).toEqual({
      authorized: true,
      realPath: '/work/session/.env',
      existed: false,
    });
  });

  it('walks up through more than one missing segment', async () => {
    const result = await authorize(
      '/work/session/new/deep/file.txt',
      ['/work/session'],
      realpathFn,
    );
    expect(result).toEqual({
      authorized: true,
      realPath: '/work/session/new/deep/file.txt',
      existed: false,
    });
  });

  it('reconstructs onto the RESOLVED ancestor, not the requested one', async () => {
    // `/work/session/sub` resolves to itself here, but in the symlink suite
    // below an ancestor can resolve somewhere else entirely -- this proves
    // the missing tail is joined onto whatever `realpathFn` said, not onto
    // the string the caller passed in.
    const resolving: RealpathFn = async (path) => {
      if (path === '/work/session/sub/new.txt') throw new Error('ENOENT'); // the leaf: missing
      if (path === '/work/session/sub') return '/real/elsewhere'; // the ancestor: resolves elsewhere
      if (path === '/real/elsewhere') return '/real/elsewhere'; // the root itself, canonicalised
      throw new Error('ENOENT');
    };
    const result = await authorize('/work/session/sub/new.txt', ['/real/elsewhere'], resolving);
    expect(result).toEqual({
      authorized: true,
      realPath: '/real/elsewhere/new.txt',
      existed: false,
    });
  });

  it('refuses a new file whose nearest existing ancestor is outside every root', async () => {
    // `/work/session` exists and resolves, but it is not a live root -- so a
    // new file inside it must not be authorised just because SOME ancestor
    // resolved.
    const result = await authorize(
      '/work/session/new-secret.txt',
      ['/work/other-session'],
      realpathFn,
    );
    expect(result).toEqual({ authorized: false });
  });

  it('refuses when no ancestor at all resolves', async () => {
    const neverResolves: RealpathFn = async () => {
      throw new Error('ENOENT');
    };
    const result = await authorize('/nowhere/at/all.txt', ['/work/session'], neverResolves);
    expect(result).toEqual({ authorized: false });
  });
});

/**
 * THE UNIFORM REFUSAL: `authorized: false` carries no detail, and the same
 * shape whether the path exists, is a permissions wall, or simply is not
 * inside a root -- `authorize.ts`'s own header explains why. This is the one
 * property a caller (`ipc.ts`) leans on to avoid becoming an existence
 * oracle for paths outside every session.
 */
describe('authorize -- the refusal leaks nothing', () => {
  it('an existing-but-outside path and a nonexistent-and-outside path answer identically', async () => {
    const realpathFn: RealpathFn = async (path) => {
      if (path === '/etc/passwd') return path; // "exists"
      throw new Error('ENOENT'); // "does not exist" (or a permission wall)
    };
    const existsOutside = await authorize('/etc/passwd', ['/work/session'], realpathFn);
    const missingOutside = await authorize('/etc/nowhere', ['/work/session'], realpathFn);
    expect(existsOutside).toEqual({ authorized: false });
    expect(missingOutside).toEqual({ authorized: false });
    expect(existsOutside).toEqual(missingOutside);
  });
});

/**
 * SECURITY FALSIFICATION (real disk, real symlinks) -- mirrors
 * `attach-image.test.ts`'s own symlink suite, generalised from one session
 * cwd to a root SET and to the missing-leaf case that module never had to
 * face.
 */
describe('authorize -- real symlinks on a real disk', () => {
  let root: string;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  it('refuses an existing symlink inside the root that points outside it', async () => {
    root = await realpath(mkdtempSync(join(tmpdir(), 'vam-files-authorize-')));
    const inside = join(root, 'session');
    const outside = join(root, 'secret');
    mkdirSync(inside);
    mkdirSync(outside);
    const outsideFile = join(outside, 'creds.txt');
    writeFileSync(outsideFile, 'shh');
    const link = join(inside, 'alias.txt');
    symlinkSync(outsideFile, link);

    // Falsification: on a version of `authorize` that skips the post-realpath
    // re-check (compares `link`'s own syntactic path to `inside` instead of
    // where it resolves), this would authorise -- `link` sits inside `inside`
    // as a string. The real, resolved target does not.
    const result = await authorize(link, [inside], (path) => realpath(path));
    expect(result).toEqual({ authorized: false });
  });

  it('a symlink pointing back inside the root still authorises, to its real target', async () => {
    root = await realpath(mkdtempSync(join(tmpdir(), 'vam-files-authorize-')));
    const inside = join(root, 'session');
    mkdirSync(inside);
    const real = join(inside, 'real.env');
    const link = join(inside, 'alias.env');
    writeFileSync(real, 'X=1');
    symlinkSync(real, link);

    const result = await authorize(link, [inside], (path) => realpath(path));
    expect(result).toEqual({ authorized: true, realPath: real, existed: true });
  });

  it('refuses a NEW file behind a symlinked ancestor directory that escapes the root', async () => {
    // The missing-leaf case `attach-image.ts` never had to face: the file
    // itself does not exist yet, but an INTERMEDIATE directory is a real
    // symlink pointing outside the root. Falsification: on a version of
    // `authorize` that skips the ancestor walk entirely (refuses every
    // nonexistent path outright), this test would still pass for the wrong
    // reason -- `new file inside a root, walked to resolution` below is what
    // proves the walk actually authorises the legitimate case, and this one
    // proves it does not authorise the escaping one.
    root = await realpath(mkdtempSync(join(tmpdir(), 'vam-files-authorize-')));
    const inside = join(root, 'session');
    const outside = join(root, 'secret');
    mkdirSync(inside);
    mkdirSync(outside);
    const linkedDir = join(inside, 'escape');
    symlinkSync(outside, linkedDir);

    const result = await authorize(join(linkedDir, 'new-file.txt'), [inside], (path) =>
      realpath(path),
    );
    expect(result).toEqual({ authorized: false });
  });

  it('authorises a genuinely new file inside the root, walked to resolution', async () => {
    root = await realpath(mkdtempSync(join(tmpdir(), 'vam-files-authorize-')));
    const inside = join(root, 'session');
    mkdirSync(inside);
    const newFile = join(inside, 'new.env');

    const result = await authorize(newFile, [inside], (path) => realpath(path));
    expect(result).toEqual({ authorized: true, realPath: newFile, existed: false });
  });
});
