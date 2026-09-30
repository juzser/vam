/**
 * What "a newer vam exists" means, and the only place that decides it.
 *
 * Renderer-safe: no `electron`, no `node:` import. The requests themselves live
 * in `src/main/update/` -- the renderer's CSP is `connect-src 'self'`, so
 * github.com is not reachable from the page by design.
 *
 * The comparison is a function with a table behind it rather than an inline
 * `>` because string ordering is wrong here in a way that stays invisible for
 * a year: '0.10.0' < '0.9.0' as text, and the app would simply never mention
 * the release that mattered.
 */

/**
 * THE VERSION THIS BUILD IS, as the renderer can read it.
 *
 * A CONSTANT, AND DUPLICATED FROM `package.json` ON PURPOSE, with
 * `test/update/version.test.ts` failing the moment the two disagree. The
 * renderer has two builds: the Electron shell, where `app.getVersion()` is one
 * process away, and a plain page served to the paired phone, where there is no
 * bridge to ask across and no main process to ask. A Vite `define` would need
 * adding to three configs plus vitest, and forgetting one prints `undefined`
 * at the operator; importing `package.json` drags a dependency list into a
 * bundle to read one string.
 *
 * `package.json` is what electron-builder stamps into the app, so the pinned
 * constant IS the app's version rather than a second opinion about it.
 */
export const VERSION = '0.1.0';

/**
 * A semver 2.0.0 version. `pre` is the dot-separated prerelease list (empty for
 * a release), numeric identifiers held as numbers so precedence can tell them
 * from alphanumeric ones. Build metadata is parsed and dropped: it never
 * affects precedence.
 */
export type Version = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: ReadonlyArray<string | number>;
};

const NUMERIC = '0|[1-9]\\d*';
const PRE_ID = `(?:${NUMERIC}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const VERSION_RE = new RegExp(
  `^v?(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})` +
    `(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?` +
    `(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

/**
 * `v0.1.0` and `0.1.0` are the same version; a GitHub tag conventionally
 * carries the prefix and `package.json` never does.
 *
 * Anything that is not a semver version is `null`. A caller that cannot parse
 * a side of the comparison has nothing to offer, which is a quiet answer and
 * not a failure.
 */
export function parseVersion(raw: string): Version | null {
  const match = VERSION_RE.exec(raw.trim());
  if (match === null) return null;
  const pre = (match[4] ?? '')
    .split('.')
    .filter((id) => id !== '')
    .map((id) => (/^\d+$/.test(id) ? Number(id) : id));
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre,
  };
}

function comparePreId(a: string | number, b: string | number): number {
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNum !== bNum) return aNum ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Negative when `a` is older, 0 when equal, positive when `a` is newer. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  // A release outranks any prerelease of the same triple.
  if (a.pre.length === 0 || b.pre.length === 0) {
    if (a.pre.length === b.pre.length) return 0;
    return a.pre.length === 0 ? 1 : -1;
  }
  const shared = Math.min(a.pre.length, b.pre.length);
  for (let i = 0; i < shared; i += 1) {
    const c = comparePreId(a.pre[i] as string | number, b.pre[i] as string | number);
    if (c !== 0) return c;
  }
  if (a.pre.length === b.pre.length) return 0;
  return a.pre.length < b.pre.length ? -1 : 1;
}

/** Is `candidate` strictly newer than `current`? Either side unparseable -> false. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (a === null || b === null) return false;
  return compareVersions(a, b) > 0;
}

/**
 * The updater's whole visible state, one variant per thing the operator can be
 * looking at. `src/shared/update-state.ts` owns the legal transitions.
 *
 * `not-available.reason` distinguishes a normal "you are current" from the
 * quiet `incomplete` (a release whose assets are not all uploaded yet; retried
 * at the next check) and `none` (no release published at all).
 */
export type UpdateErrorCode =
  | 'network'
  | 'rate-limited'
  | 'malformed'
  | 'checksum'
  | 'too-large'
  | 'unsupported-install'
  | 'translocated'
  | 'read-only'
  | 'not-writable'
  | 'quit-cancelled'
  | 'install-failed';

export type UpdateNotAvailableReason = 'up-to-date' | 'incomplete' | 'none';

export type UpdateStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking'; readonly manual: boolean }
  | { readonly kind: 'available'; readonly version: string; readonly notesUrl: string }
  | {
      readonly kind: 'not-available';
      readonly manual: boolean;
      readonly reason?: UpdateNotAvailableReason;
    }
  | { readonly kind: 'downloading'; readonly version: string; readonly percent: number }
  | { readonly kind: 'installing'; readonly version: string }
  | { readonly kind: 'error'; readonly message: string; readonly code: UpdateErrorCode };

/**
 * The notify-only updater's answer, kept only so `check.ts`, `ipc.ts`, the
 * notice and the settings panel keep compiling until the tasks that replace
 * them land. Nothing new should use it.
 */
export type UpdateUnknownReason = 'network' | 'rate-limited' | 'malformed';

export type LegacyUpdateStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'available'; readonly version: string; readonly url: string }
  | { readonly kind: 'unknown'; readonly reason: UpdateUnknownReason };
