/**
 * The per-platform update fragment a release ships, and the rules for trusting
 * one. Renderer-safe: no `electron`, no `node:` import (no `Buffer` either --
 * the digest is checked by shape here and by value in main).
 *
 * The fragment names files; it never supplies a URL. The client resolves each
 * `name` against the release's own asset list, so a tampered fragment cannot
 * point a download anywhere else.
 */

import { parseVersion } from './update.js';

export const MANIFEST_SCHEMA = 1;

/** Hard ceiling on a downloaded update, whatever the fragment claims. */
export const MAX_UPDATE_BYTES = 600 * 1024 * 1024;

export type UpdatePlatform = 'darwin' | 'win32' | 'linux';
export type UpdateArch = 'arm64' | 'x64';
export type UpdateFileKind = 'mac-zip' | 'nsis' | 'appimage';
/** What this install can be updated as; `unsupported` matches no file. */
export type InstallKind = UpdateFileKind | 'unsupported';

export type ManifestFile = {
  readonly name: string;
  readonly arch: UpdateArch;
  readonly kind: UpdateFileKind;
  readonly size: number;
  /** Base64 of the SHA-512 digest: 88 characters. */
  readonly sha512: string;
};

export type Manifest = {
  readonly schema: 1;
  readonly version: string;
  readonly platform: UpdatePlatform;
  readonly files: readonly ManifestFile[];
};

const PLATFORMS: readonly string[] = ['darwin', 'win32', 'linux'];
const ARCHES: readonly string[] = ['arm64', 'x64'];
const KINDS: readonly string[] = ['mac-zip', 'nsis', 'appimage'];
// 64 bytes -> 86 base64 chars + '=='.
const SHA512_B64 = /^[A-Za-z0-9+/]{86}==$/;

/** The asset name a release carries the fragment under. */
export function fragmentName(platform: UpdatePlatform): string {
  return `vam-update-${platform}.json`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseFile(value: unknown): ManifestFile | null {
  const r = asRecord(value);
  if (r === null) return null;
  const { name, arch, kind, size, sha512 } = r;
  if (typeof name !== 'string' || name === '') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  if (typeof arch !== 'string' || !ARCHES.includes(arch)) return null;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_UPDATE_BYTES) {
    return null;
  }
  if (typeof sha512 !== 'string' || !SHA512_B64.test(sha512)) return null;
  return { name, arch: arch as UpdateArch, kind: kind as UpdateFileKind, size, sha512 };
}

/**
 * Validate a decoded fragment against the release it came from. `version` may
 * carry the tag's `v`. Every failure is a value.
 */
export function parseManifest(
  json: unknown,
  expected: { readonly version: string; readonly platform: UpdatePlatform },
): Manifest | { readonly error: string } {
  const r = asRecord(json);
  if (r === null) return { error: 'manifest is not an object' };
  if (r.schema !== MANIFEST_SCHEMA) return { error: 'unsupported manifest schema' };
  if (typeof r.platform !== 'string' || !PLATFORMS.includes(r.platform)) {
    return { error: 'unknown platform' };
  }
  if (r.platform !== expected.platform) return { error: 'platform mismatch' };
  const want = expected.version.replace(/^v/, '');
  if (typeof r.version !== 'string' || parseVersion(r.version) === null || r.version !== want) {
    return { error: 'version mismatch' };
  }
  if (!Array.isArray(r.files) || r.files.length === 0) return { error: 'no files' };
  const files: ManifestFile[] = [];
  for (const entry of r.files) {
    const file = parseFile(entry);
    if (file === null) return { error: 'invalid file entry' };
    files.push(file);
  }
  return { schema: MANIFEST_SCHEMA, version: r.version, platform: expected.platform, files };
}

/** The file this install should download, or null. Never crosses architectures. */
export function selectAsset(
  manifest: Manifest,
  target: {
    readonly platform: UpdatePlatform;
    readonly arch: UpdateArch;
    readonly installKind: InstallKind;
  },
): ManifestFile | null {
  if (manifest.platform !== target.platform) return null;
  if (target.installKind === 'unsupported') return null;
  return (
    manifest.files.find((f) => f.arch === target.arch && f.kind === target.installKind) ?? null
  );
}

const ALLOWED_HOSTS: readonly string[] = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
];

/**
 * May a download (or a redirect hop) go to this URL? https only, an exact
 * host from the GitHub set, no credentials, no non-default port. The host
 * allowlist already excludes IP literals; the explicit checks keep that true
 * if the list ever grows.
 */
export function isAllowedDownloadUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || /^[\d.]+$/.test(host)) return false;
  return ALLOWED_HOSTS.includes(host);
}
