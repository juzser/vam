/**
 * The worktrees feature's shared vocabulary: what main answers with, what the
 * preload forwards untouched, and what the renderer draws.
 *
 * NO `node:*` IMPORT, EVER, IN THIS FILE. It is typechecked under
 * `tsconfig.web.json` as well as `tsconfig.node.json` -- `src/main/files/
 * types.ts`'s own header names the same trap: a runtime import here (or a
 * type that can only be expressed with one) drags a `node` type into a
 * typecheck that carries none.
 */

/**
 * One LINKED worktree of a project vam already knows about -- never the
 * project's own primary checkout, which `worktrees.ts`'s `list()` filters out
 * before this ever reaches the bridge (the sidebar already has a row for
 * that one).
 */
export type WorktreeInfo = {
  /**
   * The worktree's own directory, canonicalised (`fs.realpath`) by main
   * before this is minted. Doubles as the stable id `remove()` addresses --
   * a worktree has no other identity vam mints, and a REAL path is one a
   * symlink cannot be used to misdirect a later removal onto a different
   * directory than the one this list actually reported.
   */
  readonly worktreeId: string;
  /** Identical to `worktreeId` today. Its own field so a caller reads "the
   *  path" without having to know the two coincide, and so a future reader
   *  the two ever needed to differ for -- neither is expected to -- would not
   *  have to widen this type from underneath every caller that already reads
   *  `worktreeId`. */
  readonly path: string;
  /**
   * `HEAD`'s branch name, a short sha for a DETACHED `HEAD`, or `null` when
   * neither could be read -- the exact vocabulary `repo-branch.ts` already
   * uses for a session's own branch, kept identical on purpose: the sidebar
   * renders a worktree's branch beside a session's with the same glyph and
   * the same "cannot say" reading for `null`.
   */
  readonly branch: string | null;
  /**
   * `projectIdOf(worktreeId)` -- the SAME digest a session started in this
   * directory would be tagged with (`create-session.ts`'s own
   * `spawnSessionIn`). The sidebar never re-derives this hash itself (it has
   * no access to the digest function, which lives in main); it matches a
   * `Project` row against a worktree row by comparing this field to
   * `Project.id`.
   */
  readonly projectId: string;
  readonly locked: boolean;
  /** The reason recorded on a `git worktree lock`, or `null` for none / an
   *  unlocked worktree. */
  readonly lockReason: string | null;
  /** `true` when git itself reports the worktree's directory is gone from
   *  disk -- a worktree made and then removed by hand outside vam. */
  readonly prunable: boolean;
  /** The reason `git worktree list --porcelain` gave for `prunable`, or
   *  `null` for a non-prunable worktree -- the same `lockReason` shape,
   *  kept for the identical reason: a row that can say WHY says more than
   *  one that only says THAT. */
  readonly prunableReason: string | null;
  /**
   * `true` for a `HEAD` that names no branch -- `branch` is still a short
   * sha in this case (`friendlyBranch`'s own fallback), never `null`, so a
   * row cannot tell "detached at this commit" from "a branch literally
   * named like a short sha" without this field. Phase 2a's own addition:
   * v1 folded both readings into one string because nothing yet needed to
   * tell them apart.
   */
  readonly detached: boolean;
  /**
   * `true` when this worktree does NOT live inside vam's own
   * `<repoRoot>-worktrees/` root (`worktrees.ts`'s own `worktreesRootFor`) --
   * a worktree a CLI, Orca, or `claude --worktree` made, never one vam's own
   * "+" button did. Purely path-based, exactly like `detached` and
   * `prunable` above: it says WHERE the worktree sits, not who clicked what,
   * so a worktree placed by hand inside vam's own root reads the same as one
   * vam actually made, and the reverse holds too.
   *
   * PHASE 2B'S OWN ADDITION (`docs/design/worktrees.md`'s "Show external
   * worktrees" filter): the UI's default-hidden, nested-tree treatment for a
   * worktree the operator is unlikely to want mixed in with their own.
   */
  readonly external: boolean;
};

/**
 * One worktree's live git status -- fetched SEPARATELY from `WorktreeInfo`
 * (a second round trip, `CHANNELS.worktreeStatus`), and only for the rows a
 * caller actually asked about. Phase 2a's own addition, named in
 * `docs/design/worktrees.md`'s phase-2 list: "dirty / ahead-behind badges".
 *
 * NOT PART OF `list()`'s OWN ANSWER, DELIBERATELY: `listWorktrees` is a
 * single, cheap `git worktree list --porcelain` call; a dirty check and an
 * ahead/behind count are each their OWN `git` spawn PER WORKTREE, and eagerly
 * running both for every worktree of every project on every `list()` call
 * would multiply this feature's process count by the number of worktrees a
 * workspace has, on every poll, whether or not a human is looking at any of
 * them. `useWorktreeStatuses.ts` is the renderer's own gate on when this is
 * worth asking for at all.
 */
export type WorktreeStatus = {
  readonly worktreeId: string;
  /** `true` when `git status --porcelain=v1 -z` (run WITH untracked files;
   *  `worktrees/status.ts`'s own header records the measurement that found
   *  the plainer, untracked-including form fast enough not to need
   *  `--untracked-files=no`) answers anything at all. */
  readonly dirty: boolean;
  /** Commits on `HEAD` not yet on the upstream branch -- `null` when the
   *  worktree has no upstream configured (including every DETACHED `HEAD`,
   *  which cannot have one), the same "cannot say" reading `branch: null`
   *  already gives `WorktreeInfo`. */
  readonly ahead: number | null;
  /** Commits on the upstream branch not yet on `HEAD`. `null` under the
   *  exact same condition as `ahead` -- the two are read from the same
   *  `git rev-list --left-right --count` call and share its one failure
   *  mode. */
  readonly behind: number | null;
};

export type WorktreeStatusInput = {
  readonly projectId: string;
  readonly worktreeIds: readonly string[];
};

export type CreateWorktreeInput = {
  readonly projectId: string;
  /** As the operator typed it. Sanitised into a branch/directory name on
   *  main's side -- see `worktrees/name.ts` -- never trusted as either. */
  readonly name: string;
  /** Omitted (or empty) means "the repository's current `HEAD`", which is
   *  also what a bare `git worktree add -b <branch> <path>` does on its own
   *  when no base is given -- this input simply chooses not to pass one. */
  readonly baseRef?: string;
};

export type RemoveWorktreeInput = {
  readonly worktreeId: string;
  /**
   * REQUIRED, not optional -- the same known-project confinement `list()`
   * and `create()` already enforce. Without this, `worktreeId` alone would
   * let a compromised renderer name ANY linked worktree of ANY git
   * repository on disk and have main derive its own repo root from that
   * directory's `.git` file; main refuses unless this project id is one
   * `knownProjectIds()` reports AND the worktree's own `.git` -> `commondir`
   * chain resolves to THAT project's repo root AND git itself still lists
   * it as one of that repo's registered worktrees (`worktrees.ts`'s security
   * rule 6). Phase 2a dropped the EARLIER, stricter version of this rule --
   * confining `worktreeId` to living inside `<repoRoot>-worktrees/` -- on
   * purpose: that additional check was what stood between vam and adopting
   * a worktree made outside it (`docs/design/worktrees.md`'s phase-2 list),
   * and the two checks that remain already prove the same thing the
   * location check did, without caring where on disk the worktree sits.
   */
  readonly projectId: string;
  /** The confirmed kill-anyway route for a DIRTY worktree -- same bargain as
   *  `closeSession`'s own `force`. Ignored for a clean worktree, which never
   *  needed it. */
  readonly force?: boolean;
  /**
   * The operator's own retyped worktree NAME, required by main to actually
   * accept `force` on a dirty tree -- a checkbox-shaped "yes" is not proof
   * anyone read what they were about to discard, and this repo's own
   * operator decision for this feature says so explicitly. Compared against
   * the worktree's directory name (`basename(path)`), case-sensitively.
   */
  readonly confirmName?: string;
};

export type RemoveWorktreeOutcome = {
  /** `true` when the branch survives the removal because `git branch -d`
   *  (never `-D`) refused an unmerged branch -- the safe-delete default this
   *  feature's operator decision requires. The worktree itself is always
   *  gone by the time this resolves; only the branch's fate varies. */
  readonly preservedBranch: boolean;
};
