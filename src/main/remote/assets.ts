/**
 * The built page, served from the same server that serves the API.
 *
 * IT IS NOT A SECOND DOOR. This is reached only after the request's identity
 * has been verified and the route table has come up empty -- so an asset is
 * exactly as reachable as `/api/load` and no more. A separate static server,
 * or a branch taken before verification, would be a way around Access for
 * anyone who could reach the port.
 *
 * The one thing it must get right on its own is the root: a URL path is
 * attacker-shaped, and `resolve` plus a prefix check is what keeps
 * `/../../.ssh/id_rsa` from becoming a file this process happily opens.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

/** Only what a vite build emits. An unknown extension is served as bytes. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * The file a URL path names, or `null` when it names nothing this server may
 * serve. Decoding happens here because `%2e%2e` is `..` to a filesystem and
 * not to a URL parser; a decode that fails is a refusal, never a guess.
 */
export function assetPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const base = resolve(root);
  const target = resolve(base, `.${decoded === '/' ? '/index.html' : decoded}`);
  return target === base || target.startsWith(`${base}${sep}`) ? target : null;
}

/**
 * Writes the file if there is one, and answers whether it did -- so the caller
 * can fall through to its own JSON 404 rather than this module inventing one
 * in a different vocabulary.
 */
export async function serveAsset(
  root: string,
  pathname: string,
  response: ServerResponse,
): Promise<boolean> {
  const target = assetPath(root, pathname);
  if (target === null) {
    return false;
  }
  const info = await stat(target).catch(() => null);
  if (info === null || !info.isFile()) {
    return false;
  }
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
    // The page is behind an identity check; a cache that answered it without
    // one would be the hole this module exists not to open.
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(response);
  return true;
}
