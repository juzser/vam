/**
 * The image-attach picker's main-process half.
 *
 * Every dependency -- the dialog, the cwd lookup, the byte read -- is a
 * parameter, exactly as `registerDialogIpc`'s tests exercise it without
 * electron. The two refusals this exists for (outside the session's own
 * directory, or content that is not really an image) must land BEFORE the
 * draft the operator is composing ever changes, so each is asserted as a
 * refused `IpcResult`, never a thrown error a caller could shrug off.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AttachImageDialogLike,
  isInsideDirectory,
  looksLikeImage,
  registerAttachImageIpc,
} from '../../../src/main/dialog/attach-image.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const GIF_HEADER = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_HEADER = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const TEXT_HEADER = new Uint8Array(Buffer.from('not an image at all'));

function harness(input: {
  dialog: AttachImageDialogLike;
  resolveCwd: (sessionId: string) => Promise<string | null>;
  readHeader?: (path: string) => Promise<Uint8Array>;
  // Identity by default -- the fictional paths most of these tests use
  // (`/work/session/pic.png`) do not exist on the real disk this process
  // runs on, so a real `fs.realpath` would refuse every one of them with
  // ENOENT. The symlink-escape tests below override this with the real
  // `node:fs/promises` implementation against a real temp directory.
  realpathFn?: (path: string) => Promise<string>;
}) {
  const handlers = new Map<string, Handler>();
  registerAttachImageIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    input.dialog,
    input.resolveCwd,
    input.readHeader ?? (async () => PNG_HEADER),
    input.realpathFn ?? (async (path) => path),
  );
  const handler = handlers.get(CHANNELS.pickImageAttachment);
  if (handler === undefined) throw new Error('pickImageAttachment was never registered');
  return handler;
}

describe('looksLikeImage', () => {
  it('recognises png, jpeg, gif and webp headers', () => {
    expect(looksLikeImage(PNG_HEADER)).toBe(true);
    expect(looksLikeImage(JPEG_HEADER)).toBe(true);
    expect(looksLikeImage(GIF_HEADER)).toBe(true);
    expect(looksLikeImage(WEBP_HEADER)).toBe(true);
  });

  it('refuses a text file, whatever its extension claims', () => {
    expect(looksLikeImage(TEXT_HEADER)).toBe(false);
  });
});

describe('isInsideDirectory', () => {
  it('accepts a file under the directory', () => {
    expect(isInsideDirectory('/work/session', '/work/session/pic.png')).toBe(true);
  });

  it('refuses a file outside the directory', () => {
    expect(isInsideDirectory('/work/session', '/work/outside/pic.png')).toBe(false);
  });

  it('refuses the directory itself, which is not a file', () => {
    expect(isInsideDirectory('/work/session', '/work/session')).toBe(false);
  });
});

describe('registerAttachImageIpc', () => {
  it('answers the resolved path for a valid image inside the session directory', async () => {
    const handler = harness({
      dialog: {
        showOpenDialog: async (options) => {
          expect(options.defaultPath).toBe('/work/session');
          return { canceled: false, filePaths: ['/work/session/pic.png'] };
        },
      },
      resolveCwd: async () => '/work/session',
    });
    expect(await handler(null, 'row-1')).toEqual({ ok: true, value: '/work/session/pic.png' });
  });

  it('answers null, not an error, when the dialog is cancelled', async () => {
    const handler = harness({
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      resolveCwd: async () => '/work/session',
    });
    expect(await handler(null, 'row-1')).toEqual({ ok: true, value: null });
  });

  it('refuses a session id nothing live answers to', async () => {
    const handler = harness({
      dialog: {
        showOpenDialog: async () => {
          throw new Error('should never be reached');
        },
      },
      resolveCwd: async () => null,
    });
    const result = await handler(null, 'gone');
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-session' } });
  });

  it('refuses a path outside the session directory, without reading its bytes', async () => {
    let readCalled = false;
    const handler = harness({
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: ['/etc/passwd'] }),
      },
      resolveCwd: async () => '/work/session',
      readHeader: async () => {
        readCalled = true;
        return PNG_HEADER;
      },
    });
    const result = await handler(null, 'row-1');
    expect(result).toMatchObject({ ok: false, error: { code: 'outside-directory' } });
    expect(readCalled).toBe(false);
  });

  it('refuses a file whose content is not an image', async () => {
    const handler = harness({
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: ['/work/session/note.png'] }),
      },
      resolveCwd: async () => '/work/session',
      readHeader: async () => TEXT_HEADER,
    });
    const result = await handler(null, 'row-1');
    expect(result).toMatchObject({ ok: false, error: { code: 'not-an-image' } });
  });

  it('refuses a malformed session id before touching the dialog', async () => {
    const handler = harness({
      dialog: {
        showOpenDialog: async () => {
          throw new Error('should never be reached');
        },
      },
      resolveCwd: async () => '/work/session',
    });
    const result = await handler(null);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-payload' } });
  });
});

/**
 * SECURITY REVIEW FINDING (S1): a real symlink inside the session's own
 * directory that points outside it defeats `isInsideDirectory` on its own --
 * that function is pure string arithmetic over `path.resolve`/`path.relative`
 * and never touches the filesystem, so the syntactic, in-directory path of
 * the LINK passes while the bytes actually read come from wherever it points.
 * These tests use a REAL temp directory, a REAL file outside it and a REAL
 * symlink inside pointing out -- `harness`'s default identity `realpathFn`
 * would not catch this (it never resolves anything), so every test below
 * passes the real `node:fs/promises` `realpath` through the same seam
 * production wires it through in `main/index.ts`.
 */
describe('a symlink inside the session directory pointing outside it', () => {
  let root: string;
  let inside: string;
  let outside: string;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  it('is refused, not attached -- reproduced against the current containment check first', async () => {
    root = mkdtempSync(join(tmpdir(), 'vam-attach-image-'));
    inside = join(root, 'project');
    outside = join(root, 'secret');
    const outsideFile = join(outside, 'whatever.png');
    const link = join(inside, 'cute-cat.png');
    mkdirSync(inside);
    mkdirSync(outside);
    writeFileSync(outsideFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    symlinkSync(outsideFile, link);

    // Falsification, pasted in the task report: on the PRE-FIX code (no
    // `realpathFn` argument, containment checked on `cwd`/`picked` directly)
    // this same setup returns `true` -- the syntactic path of the link sits
    // inside `inside`, and the escape is invisible to `isInsideDirectory`
    // alone. This assertion is what closes it: the real, resolved target must
    // fail containment even though the link's own path does not.
    const realLinkTarget = await realpath(link);
    expect(isInsideDirectory(inside, link)).toBe(true); // the link's OWN path -- still inside, on purpose
    expect(isInsideDirectory(inside, realLinkTarget)).toBe(false); // where it actually points

    const handler = harness({
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [link] }) },
      resolveCwd: async () => inside,
      realpathFn: (path) => realpath(path),
    });
    const result = await handler(null, 'row-1');
    expect(result).toMatchObject({ ok: false, error: { code: 'outside-directory' } });
  });

  it('a symlink pointing back INSIDE the directory still attaches', async () => {
    // Resolved once up front: on macOS `/tmp` is itself a symlink to
    // `/private/tmp`, and comparing an un-resolved expectation against a
    // realpath'd result would fail on that alone, which is not the thing
    // this test exists to prove.
    root = await realpath(mkdtempSync(join(tmpdir(), 'vam-attach-image-')));
    inside = join(root, 'project');
    mkdirSync(inside);
    const real = join(inside, 'real.png');
    const link = join(inside, 'alias.png');
    writeFileSync(real, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    symlinkSync(real, link);

    const handler = harness({
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [link] }) },
      resolveCwd: async () => inside,
      realpathFn: (path) => realpath(path),
    });
    const result = await handler(null, 'row-1');
    expect(result).toEqual({ ok: true, value: real });
  });
});
