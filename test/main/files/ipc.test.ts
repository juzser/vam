/**
 * `registerFilesIpc`: the file-editor tab's read and write channels.
 *
 * The filesystem is an IN-MEMORY fake here -- `authorize.test.ts` already
 * falsifies the containment logic against a real disk with real symlinks, so
 * this file's job is the REFUSAL VOCABULARY and the CONFLICT GUARD, which
 * need no real disk to prove: every outcome is driven by what `stat`/
 * `readFile`/`writeFile`/`rename` are told to answer.
 */

import { describe, expect, it } from 'vitest';
import type { RealpathFn } from '../../../src/main/files/authorize.js';
import { READ_CEILING_BYTES, signatureOf } from '../../../src/main/files/content.js';
import {
  type FilesystemLike,
  registerFilesIpc,
  type StatLike,
} from '../../../src/main/files/ipc.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

type Entry = { content: Uint8Array; mtimeMs: number; mode: number; isDir?: boolean };

/** A minimal in-memory filesystem, keyed by path exactly as `FilesystemLike` asks. */
function memoryFs(initial: Record<string, Entry> = {}): FilesystemLike & {
  readonly files: Map<string, Entry>;
  readonly writeFileCalls: string[];
} {
  const files = new Map(Object.entries(initial));
  const writeFileCalls: string[] = [];
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    files,
    writeFileCalls,
    async stat(path): Promise<StatLike> {
      const entry = files.get(path);
      if (entry === undefined) throw enoent();
      return {
        size: entry.content.byteLength,
        mtimeMs: entry.mtimeMs,
        mode: entry.mode,
        isDirectory: () => entry.isDir === true,
      };
    },
    async readFile(path) {
      const entry = files.get(path);
      if (entry === undefined) throw enoent();
      return entry.content;
    },
    async writeFile(path, content, options) {
      writeFileCalls.push(path);
      files.set(path, { content, mtimeMs: Date.now(), mode: options.mode });
    },
    async rename(from, to) {
      const entry = files.get(from);
      if (entry === undefined) throw enoent();
      files.delete(from);
      files.set(to, entry);
    },
  };
}

const text = (s: string) => new TextEncoder().encode(s);
const identity: RealpathFn = async (path) => path;

/**
 * Decodes an in-memory entry's bytes back to a string for comparison.
 * `writeFile` stores a Node `Buffer` (what `Buffer.from` in `ipc.ts`
 * produces) while `text()` above builds a plain `Uint8Array`; the two are
 * byte-for-byte identical but not `toEqual`-identical as objects, so every
 * content assertion below compares DECODED TEXT rather than raw bytes.
 */
const contentOf = (entry: Entry | undefined): string | undefined =>
  entry === undefined ? undefined : new TextDecoder().decode(entry.content);

function harness(input: {
  roots?: readonly string[];
  fs?: ReturnType<typeof memoryFs>;
  realpathFn?: RealpathFn;
}) {
  const handlers = new Map<string, Handler>();
  const fs = input.fs ?? memoryFs();
  registerFilesIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    async () => input.roots ?? ['/work/session'],
    input.realpathFn ?? identity,
    fs,
  );
  const read = handlers.get(CHANNELS.filesRead);
  const write = handlers.get(CHANNELS.filesWrite);
  if (read === undefined || write === undefined) throw new Error('channels not registered');
  return { read, write, fs };
}

describe('filesRead', () => {
  it('refuses a path outside every root without probing the disk', async () => {
    const { read, fs } = harness({ roots: ['/work/session'] });
    const result = await read(null, '/etc/passwd');
    expect(result).toMatchObject({ ok: false, error: { code: 'not-authorized' } });
    expect(fs.files.size).toBe(0);
  });

  it('refuses a malformed argument before touching authorisation', async () => {
    const { read } = harness({});
    expect(await read(null)).toMatchObject({ ok: false, error: { code: 'invalid-payload' } });
    expect(await read(null, 42)).toMatchObject({ ok: false, error: { code: 'invalid-payload' } });
  });

  it('answers not-found for an authorised path with nothing on disk', async () => {
    const { read } = harness({ roots: ['/work/session'] });
    const result = await read(null, '/work/session/missing.env');
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('answers is-a-directory for an authorised path that is a directory', async () => {
    const fs = memoryFs({
      '/work/session/sub': { content: text(''), mtimeMs: 1, mode: 0o755, isDir: true },
    });
    const { read } = harness({ roots: ['/work/session'], fs });
    const result = await read(null, '/work/session/sub');
    expect(result).toMatchObject({ ok: false, error: { code: 'is-a-directory' } });
  });

  it('answers too-large without ever reading the file', async () => {
    const fs = memoryFs();
    // Faked via a stat entry reporting a size over the ceiling -- no 50 MiB
    // buffer is actually allocated for this test.
    fs.files.set('/work/session/huge.bin', {
      content: text('irrelevant'),
      mtimeMs: 1,
      mode: 0o644,
    });
    const originalStat = fs.stat.bind(fs);
    fs.stat = async (path) => {
      const stat = await originalStat(path);
      return path === '/work/session/huge.bin' ? { ...stat, size: READ_CEILING_BYTES + 1 } : stat;
    };
    const { read } = harness({ roots: ['/work/session'], fs });
    const result = await read(null, '/work/session/huge.bin');
    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } });
  });

  it('reads a text file whole, with its signature', async () => {
    const bytes = text('DATABASE_URL=postgres://x\n');
    const fs = memoryFs({ '/work/session/.env': { content: bytes, mtimeMs: 1234, mode: 0o600 } });
    const { read } = harness({ roots: ['/work/session'], fs });
    const result = (await read(null, '/work/session/.env')) as {
      ok: true;
      value: { content: string; isBinary: boolean; signature: unknown };
    };
    expect(result.ok).toBe(true);
    expect(result.value.content).toBe('DATABASE_URL=postgres://x\n');
    expect(result.value.isBinary).toBe(false);
    expect(result.value.signature).toEqual(signatureOf(bytes, 1234));
  });

  it('answers content:"" and isBinary:true for a file that sniffs binary, never a garbled decode', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
    const fs = memoryFs({ '/work/session/pic.png': { content: bytes, mtimeMs: 1, mode: 0o644 } });
    const { read } = harness({ roots: ['/work/session'], fs });
    const result = (await read(null, '/work/session/pic.png')) as {
      ok: true;
      value: { content: string; isBinary: boolean };
    };
    expect(result.value.isBinary).toBe(true);
    expect(result.value.content).toBe('');
  });

  it('does not leak existence: an outside path answers the same CODE whether or not it exists', async () => {
    // The message legitimately echoes the caller's OWN input path back --
    // that is not new information, the caller already typed it. What must
    // not differ is whether the OUTCOME reveals anything more: both get the
    // identical `not-authorized` refusal, never a distinct "not found
    // outside a root" vs. "found outside a root" code.
    const fs = memoryFs({ '/etc/passwd': { content: text('root:x'), mtimeMs: 1, mode: 0o644 } });
    // A realpathFn that genuinely distinguishes "exists" from "does not" --
    // with the harness's default identity resolver neither path would ever
    // fail to resolve, which would prove nothing about this property.
    const realpathFn: RealpathFn = async (path) => {
      if (path === '/etc/passwd' || path === '/work/session') return path;
      throw new Error('ENOENT');
    };
    const { read } = harness({ roots: ['/work/session'], fs, realpathFn });
    const exists = (await read(null, '/etc/passwd')) as { ok: false; error: { code: string } };
    const missing = (await read(null, '/etc/nowhere')) as { ok: false; error: { code: string } };
    expect(exists.error.code).toBe('not-authorized');
    expect(missing.error.code).toBe('not-authorized');
    expect(exists.error.code).toBe(missing.error.code);
  });
});

describe('filesWrite -- creating a new file', () => {
  it('creates a file when nothing is there and baseSignature is null', async () => {
    const { write, fs } = harness({ roots: ['/work/session'] });
    const result = (await write(null, '/work/session/.env', 'X=1\n', null)) as {
      ok: true;
      value: { signature: { size: number } };
    };
    expect(result.ok).toBe(true);
    expect(contentOf(fs.files.get('/work/session/.env'))).toBe('X=1\n');
    expect(result.value.signature.size).toBe(4);
  });

  it('writes atomically: a temp file is written and renamed, never the target written directly', async () => {
    const { write, fs } = harness({ roots: ['/work/session'] });
    await write(null, '/work/session/.env', 'X=1\n', null);
    expect(fs.writeFileCalls).toHaveLength(1);
    expect(fs.writeFileCalls[0]).not.toBe('/work/session/.env');
    expect(fs.writeFileCalls[0]).toMatch(/\.vam-write-.*\.tmp$/);
  });

  it('a new file this channel creates gets mode 0o600', async () => {
    const { write, fs } = harness({ roots: ['/work/session'] });
    await write(null, '/work/session/.env', 'X=1\n', null);
    expect((fs.files.get('/work/session/.env')?.mode ?? 0) & 0o777).toBe(0o600);
  });

  it('refuses "create new" when the file actually already exists -- never silently overwrites', async () => {
    const fs = memoryFs({
      '/work/session/.env': { content: text('X=1'), mtimeMs: 1, mode: 0o600 },
    });
    const { write } = harness({ roots: ['/work/session'], fs });
    const result = await write(null, '/work/session/.env', 'X=2', null);
    expect(result).toMatchObject({ ok: false, error: { code: 'changed-on-disk' } });
    expect(contentOf(fs.files.get('/work/session/.env'))).toBe('X=1');
  });
});

describe('filesWrite -- overwriting an existing file', () => {
  it('succeeds when the base signature matches what is on disk', async () => {
    const bytes = text('X=1');
    const fs = memoryFs({ '/work/session/.env': { content: bytes, mtimeMs: 1000, mode: 0o600 } });
    const { write } = harness({ roots: ['/work/session'], fs });
    const base = signatureOf(bytes, 1000);
    const result = await write(null, '/work/session/.env', 'X=2', base);
    expect(result).toMatchObject({ ok: true });
    expect(contentOf(fs.files.get('/work/session/.env'))).toBe('X=2');
  });

  it("preserves the file's existing mode across an overwrite", async () => {
    const bytes = text('#!/bin/sh\necho hi\n');
    const fs = memoryFs({ '/work/session/run.sh': { content: bytes, mtimeMs: 1000, mode: 0o755 } });
    const { write } = harness({ roots: ['/work/session'], fs });
    const base = signatureOf(bytes, 1000);
    await write(null, '/work/session/run.sh', '#!/bin/sh\necho bye\n', base);
    expect((fs.files.get('/work/session/run.sh')?.mode ?? 0) & 0o777).toBe(0o755);
  });

  /**
   * FALSIFICATION TARGET: "let a stale signature through". If the conflict
   * guard compared only `size`/`mtimeMs` (or nothing at all), this write --
   * same size, same mtime, DIFFERENT bytes than the caller's baseline --
   * would be let through and silently destroy the concurrent change.
   */
  it('refuses a same-size, same-mtime write whose baseline no longer matches the real bytes', async () => {
    const onDisk = text('AAAA'); // an agent changed the file after the operator opened it
    const fs = memoryFs({ '/work/session/.env': { content: onDisk, mtimeMs: 1000, mode: 0o600 } });
    const { write } = harness({ roots: ['/work/session'], fs });
    const staleBase = signatureOf(text('ZZZZ'), 1000); // same size, same mtime, different bytes
    const result = await write(null, '/work/session/.env', 'operator edit', staleBase);
    expect(result).toMatchObject({ ok: false, error: { code: 'changed-on-disk' } });
    expect(contentOf(fs.files.get('/work/session/.env'))).toBe('AAAA');
  });

  it('refuses when the file was deleted since the baseline was taken', async () => {
    const fs = memoryFs();
    const { write } = harness({ roots: ['/work/session'], fs });
    const base = signatureOf(text('X=1'), 1000);
    const result = await write(null, '/work/session/.env', 'X=2', base);
    expect(result).toMatchObject({ ok: false, error: { code: 'changed-on-disk' } });
  });

  it('refuses a write whose target is a directory', async () => {
    const fs = memoryFs({
      '/work/session/sub': { content: text(''), mtimeMs: 1, mode: 0o755, isDir: true },
    });
    const { write } = harness({ roots: ['/work/session'], fs });
    const result = await write(null, '/work/session/sub', 'X=1', null);
    expect(result).toMatchObject({ ok: false, error: { code: 'is-a-directory' } });
  });

  it('refuses a write outside every root -- distinctly from a conflict', async () => {
    const { write } = harness({ roots: ['/work/session'] });
    const result = await write(null, '/etc/passwd', 'evil', null);
    expect(result).toMatchObject({ ok: false, error: { code: 'not-authorized' } });
  });

  it('changed-on-disk and not-authorized are never the same code', async () => {
    const fs = memoryFs({
      '/work/session/.env': { content: text('X=1'), mtimeMs: 1, mode: 0o600 },
    });
    const { write } = harness({ roots: ['/work/session'], fs });
    const conflict = await write(null, '/work/session/.env', 'X=2', null);
    const unauthorized = await write(null, '/etc/passwd', 'X=2', null);
    expect((conflict as { error: { code: string } }).error.code).toBe('changed-on-disk');
    expect((unauthorized as { error: { code: string } }).error.code).toBe('not-authorized');
    expect((conflict as { error: { code: string } }).error.code).not.toBe(
      (unauthorized as { error: { code: string } }).error.code,
    );
  });

  it('refuses when the file on disk already exceeds the ceiling, without reading it', async () => {
    const fs = memoryFs({
      '/work/session/huge.bin': { content: text('irrelevant'), mtimeMs: 1, mode: 0o644 },
    });
    const originalStat = fs.stat.bind(fs);
    fs.stat = async (path) => {
      const stat = await originalStat(path);
      return path === '/work/session/huge.bin' ? { ...stat, size: READ_CEILING_BYTES + 1 } : stat;
    };
    const { write } = harness({ roots: ['/work/session'], fs });
    const result = await write(null, '/work/session/huge.bin', 'X=1', null);
    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } });
  });

  it('refuses new content over the ceiling', async () => {
    const { write } = harness({ roots: ['/work/session'] });
    const tooBig = 'a'.repeat(READ_CEILING_BYTES + 1);
    const result = await write(null, '/work/session/huge.env', tooBig, null);
    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } });
  }, 20_000);
});

describe('filesWrite -- invalid arguments', () => {
  it('refuses a missing content argument', async () => {
    const { write } = harness({});
    const result = await write(null, '/work/session/.env');
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-payload' } });
  });

  it('refuses a baseSignature that is neither null nor a signature shape', async () => {
    const { write } = harness({});
    const result = await write(null, '/work/session/.env', 'X=1', 'not-a-signature');
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-payload' } });
  });
});
