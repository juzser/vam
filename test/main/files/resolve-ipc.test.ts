/**
 * `src/main/files/resolve-ipc.ts`: turning `src/foo/bar.ts:42`, written by an
 * agent into its own answer, into an absolute path the Files tab may open --
 * or into a refusal the operator can read.
 *
 * CONTAINMENT IS THE CLAIM, AND IT IS DECIDED HERE. The renderer parses the
 * same reference (`src/shared/file-ref.ts`) so it can draw a control at all,
 * and that parse says nothing about safety: the reference is resolved against
 * the session's OWN working directory, canonicalised through the real
 * filesystem, and compared -- never prefix-matched -- in main. Every test
 * below calls main's handler directly, with no renderer in the room.
 *
 * REAL DIRECTORIES, REAL SYMLINKS, REAL `fs.realpath` -- the bottom half of
 * `authorize.test.ts`'s own bargain, and here it is the whole file rather than
 * a section of it, because two of the three claims (a link that leaves the
 * root, a leaf that does not exist) are claims ABOUT a disk and an identity
 * `realpathFn` would answer both of them wrong.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerFilesResolveIpc } from '../../../src/main/files/resolve-ipc.js';
import type { FileRefTarget } from '../../../src/main/files/types.js';
import { CHANNELS, type IpcResult } from '../../../src/main/ipc/channels.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

let scratch: string;
let root: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'vam-resolve-'));
  root = join(scratch, 'atlas');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export const a = 1\n');
  writeFileSync(join(root, '.env'), 'PORT=8787\n');
  // A SIBLING WHOSE NAME BEGINS WITH THE ROOT'S. `/a/bc` starts with `/a/b`,
  // so a containment check built on `startsWith` admits this directory.
  mkdirSync(join(scratch, 'atlas-notes'), { recursive: true });
  writeFileSync(join(scratch, 'atlas-notes', 'secrets.txt'), 'nope\n');
  writeFileSync(join(scratch, 'outside.txt'), 'nope\n');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function harness(cwd: string | null = root) {
  const handlers = new Map<string, Handler>();
  registerFilesResolveIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    async () => cwd,
    realpath,
  );
  const handler = handlers.get(CHANNELS.filesResolve);
  if (handler === undefined) throw new Error('the resolve channel was never registered');
  return (...args: unknown[]) => handler({}, ...args) as Promise<IpcResult<FileRefTarget>>;
}

/**
 * The refusal's CODE, or `null` when the call was allowed.
 *
 * Every refusal test below goes through this rather than asking whether
 * `ok` is false, because the two refusals this channel can give are not
 * interchangeable: a mutation that deleted the containment check left an
 * escaping path being refused as `not-found`, which is the right answer to
 * the wrong question and kept a weaker assertion green.
 */
const codeOf = async (pending: Promise<IpcResult<FileRefTarget>>): Promise<string | null> => {
  const result = await pending;
  return result.ok ? null : result.error.code;
};

describe('resolving a path:line reference against the session it was written in', () => {
  it('resolves a relative reference to the real file, carrying the line', async () => {
    const invoke = harness();
    const result = await invoke('s1', 'src/index.ts:12');
    expect(result).toEqual({
      ok: true,
      value: { path: await realpath(join(root, 'src', 'index.ts')), line: 12 },
    });
  });

  it('resolves an absolute reference that is already inside the root', async () => {
    const invoke = harness();
    const result = await invoke('s1', `${join(root, '.env')}:1`);
    expect(result).toMatchObject({ ok: true, value: { line: 1 } });
  });

  /**
   * THE `../../etc/passwd` CASE, which is the reason this channel exists
   * rather than the renderer joining two strings.
   */
  it('refuses a reference that climbs out of the project', async () => {
    const invoke = harness();
    const result = await invoke('s1', '../outside.txt:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-authorized');
  });

  it('refuses ../../etc/passwd whatever the depth', async () => {
    const invoke = harness();
    // THE CODE, NOT JUST THE REFUSAL. Asserting only `ok === false` here was
    // not enough, and a mutation proved it: with the containment check taken
    // out, an escaping path is refused as `not-found` (a refused
    // `Authorization` carries no `existed` field at all), so a test that only
    // asked whether it was refused went on passing while the check it exists
    // for was gone.
    expect(await codeOf(invoke('s1', '../../etc/passwd:1'))).toBe('not-authorized');
    expect(await codeOf(invoke('s1', '/etc/passwd:1'))).toBe('not-authorized');
  });

  /**
   * A PREFIX IS NOT CONTAINMENT. `atlas-notes` begins with `atlas`, so a
   * `startsWith` check on the root string admits it -- and it is a different
   * directory.
   */
  it('refuses a sibling directory whose name merely begins with the root', async () => {
    const invoke = harness();
    expect(await codeOf(invoke('s1', '../atlas-notes/secrets.txt:1'))).toBe('not-authorized');
    expect(await codeOf(invoke('s1', `${join(scratch, 'atlas-notes', 'secrets.txt')}:1`))).toBe(
      'not-authorized',
    );
  });

  /**
   * THE ONE STRING ARITHMETIC CANNOT CATCH. A link INSIDE the root pointing
   * OUTSIDE it resolves, syntactically, to a path inside the root --
   * `attach-image.ts`'s measured finding, and the reason both sides go
   * through `realpath` before they are compared.
   */
  it('refuses a symlink inside the project that points out of it', async () => {
    symlinkSync(join(scratch, 'outside.txt'), join(root, 'escape.txt'));
    const invoke = harness();
    const result = await invoke('s1', 'escape.txt:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-authorized');
  });

  it('refuses a symlinked DIRECTORY inside the project that points out of it', async () => {
    mkdirSync(join(scratch, 'elsewhere'));
    writeFileSync(join(scratch, 'elsewhere', 'notes.md'), 'nope\n');
    symlinkSync(join(scratch, 'elsewhere'), join(root, 'linked'));
    const invoke = harness();
    expect(await codeOf(invoke('s1', 'linked/notes.md:2'))).toBe('not-authorized');
  });

  /**
   * A ROOT THAT IS ITSELF A SYMLINK still authorises its own contents: both
   * sides are canonicalised, so the comparison is between two real paths.
   */
  it('resolves inside a root that is itself reached through a symlink', async () => {
    const alias = join(scratch, 'alias');
    symlinkSync(root, alias);
    const invoke = harness(alias);
    const result = await invoke('s1', 'src/index.ts:3');
    expect(result).toMatchObject({
      ok: true,
      value: { path: await realpath(join(root, 'src', 'index.ts')), line: 3 },
    });
  });

  /**
   * A REFERENCE TO A FILE THAT IS NOT THERE SAYS SO. `authorize` deliberately
   * admits a missing leaf -- that is how the Files tab creates a new file --
   * so this channel is the one that has to draw the line: an agent citing a
   * path it deleted, renamed or imagined must not open an empty editor that
   * looks like the file.
   */
  it('says a reference that names no file on disk is not there', async () => {
    const invoke = harness();
    const result = await invoke('s1', 'src/ghost.ts:4');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
    expect(result.error.message).toContain('src/ghost.ts');
  });

  it('refuses a reference with no session behind it', async () => {
    const invoke = harness(null);
    const result = await invoke('s1', 'src/index.ts:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-session');
  });

  it('refuses text that is not a reference at all, and the wrong arity', async () => {
    const invoke = harness();
    for (const args of [
      [],
      ['s1'],
      ['s1', 'src/index.ts'],
      ['s1', 'https://example.test/src/index.ts:1'],
      ['s1', 42],
      ['', 'src/index.ts:1'],
      ['s1', 'src/index.ts:1', 'extra'],
    ]) {
      expect((await invoke(...args)).ok, JSON.stringify(args)).toBe(false);
    }
  });

  it('refuses a reference carrying a NUL byte', async () => {
    const invoke = harness();
    expect((await invoke('s1', 'src/\0index.ts:1')).ok).toBe(false);
  });
});
