/**
 * Turns whatever the operator typed into "New worktree…" into a slug that is
 * both a valid directory-name component and a plausible git branch name --
 * the SAME string is used for both (`worktrees.ts`'s own decision, recorded
 * in `docs/design/worktrees.md`: one identifier is easier to read on a
 * sidebar row than a directory and a branch that quietly disagree).
 *
 * THIS IS THE FIRST OF TWO GATES, NOT THE ONLY ONE. It is a plausibility
 * filter, pure and dependency-free, so it can be unit tested without a
 * process. `worktrees.ts` hands its result to `git check-ref-format
 * --branch` before ever using it -- the authoritative check, run by git
 * itself -- so a bug in the regex below can make this function too STRICT
 * (a legal name refused) but never too permissive in a way that reaches disk
 * unchecked.
 *
 * WHAT IS KEPT: Unicode letters and numbers (`\p{L}`/`\p{N}` -- a name typed
 * in the operator's own language is not "invalid characters"), `.`, `_` and
 * `-`. Everything else -- whitespace, `/`, `\`, shell metacharacters, emoji
 * -- collapses to a single `-` per RUN, never one `-` per character, so
 * "My Feature!!" becomes `My-Feature` rather than `My-Feature--`.
 *
 * `..` IS REMOVED WHEREVER IT ENDS UP, not merely refused at the top level.
 * Git forbids two consecutive dots in a ref component for its own reasons,
 * and this string is later joined onto a directory with `path.join` — even
 * though a bare slug can never itself contain a path separator (the run
 * above already ate every one), a `..` component sitting alone between two
 * separators a future caller adds would still mean something, so it never
 * survives this function. The removal loops rather than running once,
 * because a single pass over `"a...b"` (three dots) can leave one `..` pair
 * unresolved depending on where the regex engine's non-overlapping match
 * happened to land.
 */

/** The longest slug this function will hand back. Git has no hard ref-name
 *  limit, but the filesystem does, and nothing about a worktree name needs
 *  to run anywhere near it. */
const MAX_LENGTH = 100;

/** Reserved, case-insensitively: `HEAD` is git's own name for "the current
 *  commit", not a branch, and `-b HEAD` fails in a way that is confusing to
 *  read back as a refusal about THIS feature rather than about git. */
const RESERVED = new Set(['head']);

const DISALLOWED_RUN = /[^\p{L}\p{N}._-]+/gu;
const REPEATED_HYPHEN = /-{2,}/g;
const EDGE_TRIM = /^[-.]+|[-.]+$/g;

/**
 * `null` means "nothing usable survived" -- an empty string, one made of
 * nothing but separators, or the reserved name `HEAD` in any case. The
 * caller refuses the whole request on `null`; this function never invents a
 * fallback name, which would silently start the operator's worktree on a
 * name they did not type.
 */
export function sanitizeWorktreeName(raw: string): string | null {
  let slug = raw.replace(DISALLOWED_RUN, '-');
  while (slug.includes('..')) {
    slug = slug.replace(/\.\./g, '-');
  }
  slug = slug.replace(REPEATED_HYPHEN, '-').replace(EDGE_TRIM, '');
  if (slug.length > MAX_LENGTH) {
    slug = slug.slice(0, MAX_LENGTH).replace(EDGE_TRIM, '');
  }
  if (slug === '' || RESERVED.has(slug.toLowerCase())) {
    return null;
  }
  return slug;
}
