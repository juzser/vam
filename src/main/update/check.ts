/**
 * The outbound requests an update check makes: an unauthenticated GET for the
 * latest release of the public repository this app belongs to, and -- only
 * when that release is newer and this install can be updated -- one GET for the
 * per-platform manifest fragment the release carries.
 *
 * No token, no query string, no cookie, no body; the only headers are the two
 * GitHub's API asks for, and neither carries anything about this machine
 * beyond the product name. The URL is a constant and a test asserts it has no
 * `?` in it.
 *
 * The fragment names files; it never supplies a URL. Each name is resolved
 * against the release's own `assets[]`, and every URL used must pass
 * `isAllowedDownloadUrl`. A release whose fragment or referenced asset is not
 * uploaded yet (or whose asset size disagrees with the fragment) is
 * `incomplete`: quiet, retried at the next check.
 *
 * `checkForUpdate` never throws. Every failure is a value.
 */

import { compareVersions, parseVersion } from '../../shared/update.js';
import {
  fragmentName,
  type InstallKind,
  isAllowedDownloadUrl,
  parseManifest,
  selectAsset,
  type UpdateArch,
  type UpdateFileKind,
  type UpdatePlatform,
} from '../../shared/update-manifest.js';
import { type FollowFn, fetchFollowing, readAll, UpdateHttpError } from './http.js';

/** The public repository. A constant: no interpolation, no caller input. */
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/juzser/vam/releases/latest';

/**
 * HOW LONG A CHECK MAY GO UNANSWERED before it is reported as its own network
 * fact rather than left open. A rejection or a status code both SETTLE the
 * request already; what this bounds is a connection that neither refuses nor
 * answers (a captive portal, a firewall that drops packets, a dead VPN
 * tunnel), which would otherwise leave the UI reading "checking..." forever.
 * Ten seconds, the figure this codebase uses for a GitHub round trip elsewhere
 * (`integrations/github-status.ts`, `sources/claude-code/pull-requests.ts`).
 */
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

export type UpdateFetcher = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  readonly status: number;
  readonly ok: boolean;
  json(): Promise<unknown>;
}>;

export type UpdateCheckDeps = {
  readonly fetch: UpdateFetcher;
  /** Downloads the manifest fragment; redirect-safe and capped. Injectable for tests. */
  readonly follow?: FollowFn;
  /** Overridable only for tests; production always gets `UPDATE_CHECK_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
};

export const DEFAULT_UPDATE_DEPS: UpdateCheckDeps = {
  fetch: (url, init) => globalThis.fetch(url, init),
};

/** What this build is, as far as choosing a download goes. */
export type CheckTarget = {
  readonly platform: UpdatePlatform;
  readonly arch: UpdateArch;
  readonly installKind: InstallKind;
};

export type UpdateAsset = {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  /** Base64 SHA-512. */
  readonly sha512: string;
  readonly kind: UpdateFileKind;
};

export type CheckResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'incomplete' }
  | {
      readonly kind: 'available';
      readonly version: string;
      readonly notesUrl: string;
      /** `null` when this install cannot be updated in place (`unsupported`). */
      readonly asset: UpdateAsset | null;
    }
  | { readonly kind: 'error'; readonly code: 'network' | 'rate-limited' | 'malformed' };

/** A manifest fragment is a few hundred bytes; anything near this is not one. */
const MAX_FRAGMENT_BYTES = 256 * 1024;

type ReleaseAsset = { readonly name: string; readonly url: string; readonly size: number };

type LatestRelease = {
  readonly tag_name: string;
  readonly html_url: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly assets: readonly ReleaseAsset[];
};

function asRelease(body: unknown): LatestRelease | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.tag_name !== 'string' || typeof record.html_url !== 'string') return null;
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(record.assets)) {
    for (const entry of record.assets as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue;
      const a = entry as Record<string, unknown>;
      if (
        typeof a.name === 'string' &&
        typeof a.browser_download_url === 'string' &&
        typeof a.size === 'number'
      ) {
        assets.push({ name: a.name, url: a.browser_download_url, size: a.size });
      }
    }
  }
  return {
    tag_name: record.tag_name,
    html_url: record.html_url,
    draft: record.draft === true,
    prerelease: record.prerelease === true,
    assets,
  };
}

/**
 * The one destination a click on "Release notes" may open.
 *
 * `shell.openExternal` honours `file:` and every scheme the OS has a handler
 * for. An `html_url` from the network is a navigate-anywhere capability if
 * trusted, so it is checked to be what it claims to be: an https release page
 * on GitHub. Anything else is refused, not narrowed.
 */
function releaseUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  if (parsed.protocol !== 'https:') return null;
  if (host !== 'github.com' && !host.endsWith('.github.com')) return null;
  return parsed.href;
}

export async function checkForUpdate(
  currentVersion: string,
  target: CheckTarget,
  deps: UpdateCheckDeps = DEFAULT_UPDATE_DEPS,
): Promise<CheckResult> {
  const timeoutMs = deps.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;
  let response: Awaited<ReturnType<UpdateFetcher>>;
  try {
    response = await deps.fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        // GitHub's API rejects a request with no User-Agent. It names the
        // product and nothing else -- no version, no platform, no machine.
        'User-Agent': 'vam',
      },
      // Bounded, so a connection that neither refuses nor answers cannot
      // leave the UI reading "checking..." forever. The abort surfaces as a
      // rejection like any other network failure.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { kind: 'error', code: 'network' };
  }

  // A repository with no releases answers 404: the normal quiet answer.
  if (response.status === 404) return { kind: 'none' };
  // 403 is how GitHub rate-limits an unauthenticated caller; 429 the newer
  // secondary limit. Kept apart from 'network' so it can be told from a bad
  // connection.
  if (response.status === 403 || response.status === 429) {
    return { kind: 'error', code: 'rate-limited' };
  }
  if (!response.ok) return { kind: 'error', code: 'network' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'error', code: 'malformed' };
  }
  const release = asRelease(body);
  if (release === null) return { kind: 'error', code: 'malformed' };

  if (release.draft || release.prerelease) return { kind: 'up-to-date' };

  const latest = parseVersion(release.tag_name);
  const current = parseVersion(currentVersion);
  // Either side unparseable means nothing can be shown to be newer.
  if (latest === null || current === null) return { kind: 'up-to-date' };
  // An unflagged prerelease tag is still never offered.
  if (latest.pre.length > 0) return { kind: 'up-to-date' };
  if (compareVersions(latest, current) <= 0) return { kind: 'up-to-date' };

  const notesUrl = releaseUrl(release.html_url);
  if (notesUrl === null) return { kind: 'error', code: 'malformed' };
  const version = `${latest.major}.${latest.minor}.${latest.patch}`;

  // An install that cannot be updated in place needs no download plan; the
  // controller explains why. No second request is made for it.
  if (target.installKind === 'unsupported') {
    return { kind: 'available', version, notesUrl, asset: null };
  }

  const fragmentAsset = release.assets.find((a) => a.name === fragmentName(target.platform));
  if (fragmentAsset === undefined) return { kind: 'incomplete' };
  if (!isAllowedDownloadUrl(fragmentAsset.url)) return { kind: 'error', code: 'malformed' };

  let fragmentJson: unknown;
  try {
    const follow = deps.follow ?? fetchFollowing;
    const result = await follow(fragmentAsset.url, {
      maxBytes: MAX_FRAGMENT_BYTES,
      signal: AbortSignal.timeout(timeoutMs),
    });
    fragmentJson = JSON.parse(new TextDecoder().decode(await readAll(result.body)));
  } catch (error) {
    if (error instanceof UpdateHttpError) {
      if (error.status === 404) return { kind: 'incomplete' };
      if (error.code === 'too-large') return { kind: 'error', code: 'malformed' };
      return { kind: 'error', code: 'network' };
    }
    if (error instanceof SyntaxError) return { kind: 'error', code: 'malformed' };
    return { kind: 'error', code: 'network' };
  }

  const manifest = parseManifest(fragmentJson, { version, platform: target.platform });
  if ('error' in manifest) return { kind: 'error', code: 'malformed' };

  const file = selectAsset(manifest, target);
  if (file === null) return { kind: 'incomplete' };
  const attached = release.assets.find((a) => a.name === file.name);
  if (attached === undefined || attached.size !== file.size) return { kind: 'incomplete' };
  if (!isAllowedDownloadUrl(attached.url)) return { kind: 'error', code: 'malformed' };

  return {
    kind: 'available',
    version,
    notesUrl,
    asset: {
      name: file.name,
      url: attached.url,
      size: file.size,
      sha512: file.sha512,
      kind: file.kind,
    },
  };
}
