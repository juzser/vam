import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanUpdatesDir,
  DownloadError,
  downloadAsset,
  isVerified,
  updatesDir,
} from '../../src/main/update/download.js';
import { type FollowFn, UpdateHttpError } from '../../src/main/update/http.js';

const PAYLOAD = Buffer.from('hello update payload'.repeat(50));
const sha512 = (b: Buffer): string => createHash('sha512').update(b).digest('base64');
const URL_OK =
  'https://github.com/juzser/vam/releases/download/v1.0.0/vam-1.0.0-linux-x86_64.AppImage';

const asset = (over: Partial<{ size: number; sha512: string; name: string }> = {}) => ({
  name: 'vam-1.0.0-linux-x86_64.AppImage',
  url: URL_OK,
  size: PAYLOAD.length,
  sha512: sha512(PAYLOAD),
  ...over,
});

/** A follower that serves `data` in `chunk`-sized pieces. */
function serve(data: Buffer, chunk = 100): FollowFn {
  return vi.fn(async (_url, opts) => ({
    status: 200,
    body: (async function* () {
      let received = 0;
      for (let i = 0; i < data.length; i += chunk) {
        const piece = data.subarray(i, i + chunk);
        received += piece.length;
        opts.onProgress?.(received, data.length);
        yield new Uint8Array(piece);
      }
    })(),
  }));
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vam-dl-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('downloadAsset', () => {
  it('streams to <name>.partial, verifies, then renames to <name>', async () => {
    const target = join(dir, 'updates');
    const path = await downloadAsset({ asset: asset(), dir: target, follow: serve(PAYLOAD) });
    expect(path).toBe(join(target, 'vam-1.0.0-linux-x86_64.AppImage'));
    expect(await readFile(path)).toEqual(PAYLOAD);
    expect(readdirSync(target)).toEqual(['vam-1.0.0-linux-x86_64.AppImage']);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('caps the request at the manifest size and passes the signal along', async () => {
    const follow = serve(PAYLOAD);
    const controller = new AbortController();
    await downloadAsset({ asset: asset(), dir, follow, signal: controller.signal });
    expect(follow).toHaveBeenCalledWith(
      URL_OK,
      expect.objectContaining({ maxBytes: PAYLOAD.length, signal: controller.signal }),
    );
  });

  it('deletes the partial and throws checksum on a digest mismatch', async () => {
    const wrong = Buffer.from(PAYLOAD);
    wrong[0] = wrong[0] === 0x68 ? 0x69 : 0x68;
    await expect(
      downloadAsset({ asset: asset(), dir, follow: serve(wrong) }),
    ).rejects.toMatchObject({ name: 'DownloadError', code: 'checksum' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('throws checksum when fewer bytes arrive than the manifest promised', async () => {
    await expect(
      downloadAsset({ asset: asset(), dir, follow: serve(PAYLOAD.subarray(0, 100)) }),
    ).rejects.toMatchObject({ code: 'checksum' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('maps a too-large http error and cleans up', async () => {
    const follow: FollowFn = vi.fn(async () => {
      throw new UpdateHttpError('too-large', 'big');
    });
    await expect(downloadAsset({ asset: asset(), dir, follow })).rejects.toMatchObject({
      code: 'too-large',
    });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('maps a mid-stream failure to network and removes the partial', async () => {
    const follow: FollowFn = vi.fn(async () => ({
      status: 200,
      body: (async function* () {
        yield new Uint8Array(10);
        throw new UpdateHttpError('network', 'reset');
      })(),
    }));
    const err = await downloadAsset({ asset: asset(), dir, follow }).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect(err.code).toBe('network');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports progress at most once per whole percent, ending at 100', async () => {
    const onProgress = vi.fn();
    await downloadAsset({ asset: asset(), dir, follow: serve(PAYLOAD, 7), onProgress });
    const percents = onProgress.mock.calls.map((c) => c[0] as number);
    expect(new Set(percents).size).toBe(percents.length);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBe(100);
    expect(percents.length).toBeLessThanOrEqual(101);
    expect(percents.every((p) => p >= 0 && p <= 100)).toBe(true);
  });

  it('refuses an asset name that could leave the directory', async () => {
    for (const name of ['../evil', 'a/b', 'a\\b', '']) {
      await expect(
        downloadAsset({ asset: asset({ name }), dir, follow: serve(PAYLOAD) }),
      ).rejects.toMatchObject({ code: 'network' });
    }
  });
});

describe('isVerified', () => {
  it('is true only for a file with the exact size and digest', async () => {
    const path = join(dir, 'a.bin');
    writeFileSync(path, PAYLOAD);
    expect(await isVerified(path, asset())).toBe(true);
    expect(await isVerified(path, asset({ sha512: sha512(Buffer.from('other')) }))).toBe(false);
    expect(await isVerified(path, asset({ size: PAYLOAD.length + 1 }))).toBe(false);
    expect(await isVerified(join(dir, 'missing'), asset())).toBe(false);
  });
});

describe('updatesDir / cleanUpdatesDir', () => {
  it('lives under userData/updates', () => {
    expect(updatesDir('/u')).toBe(join('/u', 'updates'));
  });

  it('removes staged files and partials but keeps install.log; missing dir is fine', async () => {
    await expect(cleanUpdatesDir(join(dir, 'nope'))).resolves.toBeUndefined();
    const u = join(dir, 'updates');
    mkdirSync(join(u, 'staging-1.0.0'), { recursive: true });
    writeFileSync(join(u, 'staging-1.0.0', 'f'), 'x');
    writeFileSync(join(u, 'vam.zip'), 'x');
    writeFileSync(join(u, 'vam.zip.partial'), 'x');
    writeFileSync(join(u, 'install.log'), 'log');
    await cleanUpdatesDir(u);
    expect(readdirSync(u)).toEqual(['install.log']);
    expect(existsSync(join(u, 'install.log'))).toBe(true);
  });
});
