/**
 * Download one release asset into the updates directory and prove it is the
 * file the manifest described, or leave nothing behind.
 *
 * The bytes stream into `<name>.partial` (0o600) while a SHA-512 is computed on
 * the way through. Only after the size AND digest match the manifest is the
 * partial renamed to `<name>`; any other outcome deletes it and throws a typed
 * `DownloadError`. The cap handed to the HTTP layer is the manifest's own
 * `size`, so a server cannot make this write more than was promised.
 *
 * What the digest buys: it protects the bytes in transit and at rest between
 * the release and the installer. It does NOT protect against a compromised
 * GitHub account, which could publish a fragment and asset together.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type FollowFn, fetchFollowing, UpdateHttpError } from './http.js';

export type DownloadErrorCode = 'network' | 'checksum' | 'too-large';

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;
  constructor(code: DownloadErrorCode, message: string) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

export type DownloadableAsset = {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  /** Base64 SHA-512. */
  readonly sha512: string;
};

export type DownloadOptions = {
  readonly asset: DownloadableAsset;
  readonly dir: string;
  readonly signal?: AbortSignal;
  /** Whole-percent progress, at most once per percent, monotonic, ending at 100. */
  readonly onProgress?: (percent: number) => void;
  readonly follow?: FollowFn;
};

/** `<userData>/updates`. */
export function updatesDir(userData: string): string {
  return join(userData, 'updates');
}

const KEEP = new Set(['install.log']);

/** Remove everything staged or downloaded, except the installer's log. Never throws. */
export async function cleanUpdatesDir(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => !KEEP.has(entry))
      .map((entry) => rm(join(dir, entry), { recursive: true, force: true }).catch(() => {})),
  );
}

/** Does `path` exist with exactly the asset's size and digest? */
export async function isVerified(path: string, asset: DownloadableAsset): Promise<boolean> {
  try {
    if ((await stat(path)).size !== asset.size) return false;
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('base64') === asset.sha512;
  } catch {
    return false;
  }
}

function safeName(name: string): boolean {
  return name !== '' && !/[\\/]/.test(name) && !name.includes('..');
}

export async function downloadAsset(options: DownloadOptions): Promise<string> {
  const { asset, dir } = options;
  if (!safeName(asset.name)) throw new DownloadError('network', 'unsafe asset name');
  const follow = options.follow ?? fetchFollowing;

  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const finalPath = join(dir, asset.name);
  const partialPath = `${finalPath}.partial`;

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const response = await follow(asset.url, {
      maxBytes: asset.size,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    handle = await open(partialPath, 'w', 0o600);
    const hash = createHash('sha512');
    let received = 0;
    let lastPercent = -1;
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      hash.update(chunk);
      await handle.write(chunk);
      const percent = Math.min(100, Math.floor((received / asset.size) * 100));
      if (percent > lastPercent) {
        lastPercent = percent;
        options.onProgress?.(percent);
      }
    }
    await handle.close();
    handle = undefined;

    if (received !== asset.size) {
      throw new DownloadError('checksum', 'downloaded size does not match the release');
    }
    if (hash.digest('base64') !== asset.sha512) {
      throw new DownloadError('checksum', 'downloaded file does not match its checksum');
    }
    await rename(partialPath, finalPath);
    return finalPath;
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(partialPath, { force: true }).catch(() => {});
    if (error instanceof DownloadError) throw error;
    if (error instanceof UpdateHttpError) throw new DownloadError(error.code, error.message);
    throw new DownloadError('network', 'could not save the download');
  }
}
