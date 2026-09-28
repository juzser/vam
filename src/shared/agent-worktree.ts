/**
 * A CLAUDE CODE AGENT WORKTREE, and vam's own rule for recognising one --
 * the PURE half, shared between main and renderer.
 *
 * NO `node:*` IMPORT, EVER, IN THIS FILE. Same rule `shared/worktree.ts`
 * states for itself: this module is typechecked under `tsconfig.web.json` as
 * well as `tsconfig.node.json`, and it is imported directly by the renderer
 * (`WorktreesSection.tsx`, to filter an adopted worktree row the same way an
 * agent-worktree SESSION is already filtered) as well as by
 * `main/sources/agent-worktree.ts`, which re-exports these two symbols
 * unchanged so every existing importer of that module keeps working. The
 * REALPATH-dependent half (`isAgentWorktreeCwd`) stays main-only -- a
 * renderer has no `fs.realpath` to call and must not gain one through this
 * file.
 *
 * See `main/sources/agent-worktree.ts`'s own header for the two-signal rule
 * itself (path segment, or branch prefix) and why either alone is enough.
 */

/** The one literal `hasAgentWorktreeSegment` matches on. Exported so a
 *  caller that already has a realpath in hand never has to import a second
 *  copy of the string. */
export const AGENT_WORKTREE_PATH_SEGMENT = '/.claude/worktrees/';

/** What `isAgentWorktreeBranch` matches on -- Claude Code's own naming for
 *  the branch an `isolation: "worktree"` subagent runs on. */
const AGENT_WORKTREE_BRANCH_PREFIX = 'worktree-agent-';

/**
 * What Claude Code itself names the DIRECTORY of one of its own agent
 * worktrees -- `agent-<id>`, confirmed against real worktree admin
 * directories on this machine (`.git/worktrees/agent-<hex>`, each on a
 * `worktree-agent-<hex>` branch). The SAME prefix `AGENT_WORKTREE_BRANCH_
 * PREFIX` uses for the branch signal, stated once here since the path
 * signal below only ever tests it against the one path segment right after
 * the container directory, never the whole tail.
 */
const AGENT_WORKTREE_DIR_PREFIX = 'agent-';

/**
 * Does this (already realpath'd, or raw when the caller has no realpath to
 * give) path carry a Claude Code agent worktree segment?
 *
 * S2, CROSS-PROVIDER REVIEW: this used to be `path.includes
 * (AGENT_WORKTREE_PATH_SEGMENT)` -- true for ANY path under `/.claude/
 * worktrees/`, not only one of Claude Code's own `agent-<id>` dirs. `docs/
 * design/workspace-options.md`'s own promise is narrower: only an agent
 * worktree is hidden. A worktree a PERSON makes in that same container
 * directory -- by hand, or with `claude --worktree <name>` -- carries no
 * `agent-` prefix on its own dir name and must stay visible; the old check
 * hid it anyway, with `hideAgentWorktrees` on by default and no way back.
 *
 * Only the FIRST path segment after the container is tested, and it must
 * START WITH `agent-` -- not merely appear somewhere in the tail. That is
 * also what keeps this from matching the CONTAINER directory itself
 * (`/repo/.claude/worktrees`, with nothing after it, or with a trailing
 * slash and nothing after that): the segment there is empty, which does not
 * start with anything, and that path names where Claude Code keeps its
 * worktrees, not a worktree -- never a row anything here would draw for.
 */
export function hasAgentWorktreeSegment(path: string): boolean {
  const index = path.indexOf(AGENT_WORKTREE_PATH_SEGMENT);
  if (index === -1) return false;
  const tail = path.slice(index + AGENT_WORKTREE_PATH_SEGMENT.length);
  const worktreeDirName = tail.split('/')[0] ?? '';
  return worktreeDirName.startsWith(AGENT_WORKTREE_DIR_PREFIX);
}

/** Does this branch name say "an isolated agent worktree", by Claude Code's
 *  own naming convention? `null` (branch unknown, or none) is false --
 *  absence is never evidence either way, the rule every optional fact in
 *  this source follows. */
export function isAgentWorktreeBranch(branch: string | null): boolean {
  // Not `branch?.startsWith(...)`: that widens the expression to `boolean |
  // undefined`, which this function's own `: boolean` return type refuses.
  // biome-ignore lint/complexity/useOptionalChain: see above.
  return branch !== null && branch.startsWith(AGENT_WORKTREE_BRANCH_PREFIX);
}
