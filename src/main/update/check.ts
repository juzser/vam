/**
 * The one outbound request this feature makes: a plain unauthenticated GET
 * for the latest release of the public repository this app belongs to.
 *
 * It is the least the question needs. No token, no query string, no cookie,
 * no body; the only headers are the two GitHub's API asks for, and neither
 * carries anything about this machine beyond the product name. Nothing about
 * the operator's sessions, projects, paths or host is assembled anywhere here,
 * because nothing is assembled at all -- the URL is a constant, and a test
 * asserts it has no `?` in it.
 *
 * vam DOWNLOADS NOTHING AND INSTALLS NOTHING. What comes back is a version and
 * a URL, handed to the operator the way `src/renderer/errors/report.ts` hands
 * over a prefilled issue link rather than posting it. Auto-install would also
 * be a lie on this codebase: `electron-builder.config.cjs` targets `dir` on
 * every platform, so there is no signed artifact for Squirrel to swallow.
 *
 * `checkForUpdate` never throws. Every failure is a value.
 */

import { compareVersions, parseVersion, type UpdateStatus } from '../../shared/update.js';

/** The public repository. A constant: no interpolation, no caller input. */
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/juzser/vam/releases/latest';

export type UpdateFetcher = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  readonly status: number;
  readonly ok: boolean;
  json(): Promise<unknown>;
}>;

export type UpdateCheckDeps = {
  readonly fetch: UpdateFetcher;
};

export const DEFAULT_UPDATE_DEPS: UpdateCheckDeps = {
  fetch: (url, init) => globalThis.fetch(url, init),
};

/** Only the three fields the decision uses; anything else is ignored. */
type LatestRelease = {
  readonly tag_name: string;
  readonly html_url: string;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
};

function asRelease(body: unknown): LatestRelease | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.tag_name !== 'string' || typeof record.html_url !== 'string') return null;
  return {
    tag_name: record.tag_name,
    html_url: record.html_url,
    draft: record.draft === true,
    prerelease: record.prerelease === true,
  };
}

export async function checkForUpdate(
  currentVersion: string,
  deps: UpdateCheckDeps = DEFAULT_UPDATE_DEPS,
): Promise<UpdateStatus> {
  let response: Awaited<ReturnType<UpdateFetcher>>;
  try {
    response = await deps.fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        // GitHub's API rejects a request with no User-Agent. It names the
        // product and nothing else -- no version, no platform, no machine.
        'User-Agent': 'vam',
      },
    });
  } catch {
    return { kind: 'unknown', reason: 'network' };
  }

  // A repository with no releases -- which is `juzser/vam` today -- answers
  // 404 here. That is the normal quiet answer, not a failed request.
  if (response.status === 404) return { kind: 'none' };
  // 403 is how GitHub rate-limits an unauthenticated caller; 429 is the newer
  // secondary limit. Kept apart from 'network' so an operator seeing it
  // repeatedly can tell it is GitHub, not their connection.
  if (response.status === 403 || response.status === 429) {
    return { kind: 'unknown', reason: 'rate-limited' };
  }
  if (!response.ok) return { kind: 'unknown', reason: 'network' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'unknown', reason: 'malformed' };
  }
  const release = asRelease(body);
  if (release === null) return { kind: 'unknown', reason: 'malformed' };

  if (release.draft === true || release.prerelease === true) return { kind: 'up-to-date' };

  const latest = parseVersion(release.tag_name);
  const current = parseVersion(currentVersion);
  // Either side unparseable -- a prerelease tag GitHub did not flag, or a
  // dev build whose version is not a version -- means nothing can be shown to
  // be newer, so nothing is offered.
  if (latest === null || current === null) return { kind: 'up-to-date' };
  if (compareVersions(latest, current) <= 0) return { kind: 'up-to-date' };

  return {
    kind: 'available',
    version: `${latest.major}.${latest.minor}.${latest.patch}`,
    url: release.html_url,
  };
}
