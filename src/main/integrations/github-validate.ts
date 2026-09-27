/**
 * THE ONE GATE EVERY GITHUB OWNER/REPO NAME CROSSES before it reaches `gh`
 * argv, for the Integrations section (Settings -> Integrations -> GitHub).
 *
 * `pr-actions.ts`'s `checkBranchName` is the template this follows, and the
 * reason is the same one written there: `execFile` protects against a SHELL,
 * it protects against nothing whatsoever about a callee that treats its
 * argument as a flag or a path. A search box and a repo picker are both fed by
 * the renderer -- the least trusted process in this app -- so an owner login
 * typed there is validated here, in main, before it is ever placed in an argv
 * array, never sanitised on the renderer's side alone.
 *
 * ALLOWLISTED, NOT SANITISED: a SMALL allowlist of what a login or a repo name
 * actually IS, rather than a list of characters somebody remembered to forbid.
 * `-x`, `--repo=`, `../../etc` and a trailing newline are all refused by the
 * SHAPE, not by a blocklist that would have to name each one.
 */

export type Checked<T> = { readonly ok: true } & T;
export type Refused = { readonly ok: false; readonly reason: string };

/**
 * GitHub's own rule for a login (a user or an organisation): 1-39 characters,
 * alphanumeric and hyphens, and a hyphen may not lead or trail. Checked here
 * as documented in GitHub's own signup validation rather than reverse-engineered
 * from examples, because the ALTERNATIVE -- an owner that starts with `-` --
 * is exactly the shape `gh repo list <owner>` would otherwise read as a flag.
 */
const OWNER_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** GitHub repository names: 1-100 characters, no leading hyphen (the same
 *  flag-injection concern `OWNER_SHAPE` guards), no `..` (a git ref rule, and
 *  the same path-traversal concern `checkBranchName` guards for a branch). */
const NAME_SHAPE = /^[A-Za-z0-9_.](?:[A-Za-z0-9._-]{0,98})?$/;

/** The longest owner login GitHub has ever issued. */
export const MAX_OWNER_LENGTH = 39;

/** The longest repository name GitHub accepts. */
export const MAX_NAME_LENGTH = 100;

/**
 * A single GitHub login -- a user or an organisation -- validated on main's
 * side of the boundary. Used for `gh repo list <owner>`'s one positional
 * argument, which is why a value starting with `-` must be refused: it is
 * exactly what would let a search box send `gh` a flag it never expected,
 * `--` end-of-options marker or not.
 */
export function checkOwnerName(raw: unknown): Checked<{ owner: string }> | Refused {
  if (typeof raw !== 'string' || raw === '') {
    return { ok: false, reason: 'vam was given no GitHub owner to look up.' };
  }
  if (raw.length > MAX_OWNER_LENGTH) {
    return {
      ok: false,
      reason: `that is ${raw.length} characters; a GitHub login is never more than ${MAX_OWNER_LENGTH}.`,
    };
  }
  if (!OWNER_SHAPE.test(raw)) {
    return { ok: false, reason: `"${raw.slice(0, 60)}" is not a GitHub login vam will look up.` };
  }
  return { ok: true, owner: raw };
}

/**
 * A whole `owner/name`, validated on main's side.
 *
 * Used two ways: as the value handed to `gh`'s `--repo=owner/name` flag
 * elsewhere in this app's PR features are NEVER reached this way (see
 * `pull-requests.ts`'s own header for why `--repo` stays out of that file);
 * here it is the shape a repo the operator explicitly PICKED is checked
 * against before vam compares it to a checkout's own remote, or shows it on
 * screen. `..` is refused for the identical reason `checkBranchName` refuses
 * it in a branch: it is a git-ref rule, not merely a filesystem one.
 */
export function checkRepoFullName(raw: unknown): Checked<{ repo: string }> | Refused {
  if (typeof raw !== 'string' || raw === '') {
    return { ok: false, reason: 'vam was given no repository name.' };
  }
  const slash = raw.indexOf('/');
  const lastSlash = raw.lastIndexOf('/');
  if (slash === -1 || slash !== lastSlash) {
    return {
      ok: false,
      reason: `"${raw.slice(0, 60)}" is not an owner/name vam recognises -- it needs exactly one slash.`,
    };
  }
  const owner = raw.slice(0, slash);
  const name = raw.slice(slash + 1);
  if (!OWNER_SHAPE.test(owner)) {
    return { ok: false, reason: `"${owner.slice(0, 60)}" is not a GitHub owner vam will act on.` };
  }
  if (name.length > MAX_NAME_LENGTH || !NAME_SHAPE.test(name) || name.includes('..')) {
    return {
      ok: false,
      reason: `"${name.slice(0, 60)}" is not a repository name vam will act on.`,
    };
  }
  return { ok: true, repo: `${owner}/${name}` };
}
