/**
 * What "a newer vam exists" means, and the only place that decides it.
 *
 * Renderer-safe: no `electron`, no `node:` import. The request itself lives in
 * `src/main/update/check.ts` -- the renderer's CSP is `connect-src 'self'`, so
 * github.com is not reachable from the page by design.
 *
 * The comparison is a function with a table behind it rather than an inline
 * `>` because string ordering is wrong here in a way that stays invisible for
 * a year: '0.10.0' < '0.9.0' as text, and the app would simply never mention
 * the release that mattered.
 */

/** A release version. Prereleases are not representable here, on purpose. */
export type Version = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

/**
 * `v0.1.0` and `0.1.0` are the same version; a GitHub tag conventionally
 * carries the prefix and `package.json` never does.
 *
 * Anything that is not exactly three numbers is `null`, and that includes
 * every prerelease (`1.0.0-rc.1`) and every build tag (`1.0.0+sha`). That is
 * the mechanism by which a prerelease is never offered as an upgrade: it does
 * not parse, so it can never compare greater. A caller that cannot parse a
 * side of the comparison has nothing to offer, which is a quiet answer and
 * not a failure.
 */
export function parseVersion(raw: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Negative when `a` is older, 0 when equal, positive when `a` is newer. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Main's whole answer. Four facts, deliberately not collapsed into one shrug:
 *
 * - `none` -- the repository has published no release. This is what
 *   `juzser/vam` answers TODAY, and it is a normal, quiet state: nothing to
 *   show, nothing wrong.
 * - `up-to-date` -- there is a release and it is not an upgrade (equal, older,
 *   a draft, a prerelease, or a version this build cannot compare).
 * - `available` -- genuinely newer. Carries the URL and nothing else; vam
 *   downloads nothing, exactly as `src/renderer/errors/report.ts` posts
 *   nothing.
 * - `unknown` -- the question could not be answered. The reason is kept
 *   because "no network", "GitHub is rate-limiting this IP" and "the body was
 *   not a release" are different things an operator may want to tell apart.
 *
 * NONE of these is an error the operator must act on, and no surface may draw
 * any of them as an error banner.
 */
export type UpdateUnknownReason = 'network' | 'rate-limited' | 'malformed';

export type UpdateStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'available'; readonly version: string; readonly url: string }
  | { readonly kind: 'unknown'; readonly reason: UpdateUnknownReason };
