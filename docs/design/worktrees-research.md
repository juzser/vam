# vam worktree research brief

Operator ask: "vam should have a worktree function like Orca." Orca source:
`/Users/ser/scatola/jobs/opensources/orca` (never adapt code — study only).
vam integration branch: `origin/smith/vam/0.2-tab-shell`.

## 1. Orca's feature map (with citations)

**Model.** Orca's whole product is worktree-centric: "Run Codex, ClaudeCode,
OpenCode or Pi side-by-side — each in its own worktree" (`README.md:17-19`).
"Parallel Worktrees: Fan one prompt across five agents, each in its own
isolated git worktree" (`README.md:46-53`). One agent session = one worktree,
always — there is no many-sessions-per-worktree or worktree-with-no-session
mode in the marketed model.

**Create** (`src/main/git/worktree.ts:952-1072` `addWorktree`):
`git worktree add --no-track -b <branch> <path> [<baseRef>]`, base ref
resolved via `resolveWorktreeAddBaseRef` (`shared/worktree/base-ref.ts`,
not read in depth — handles remote-tracking vs local-branch bases). After
create it best-effort sets `push.autoSetupRemote=true` locally (line
1045-1067) and writes `branch.<branch>.base` config for lineage (line
360-385, `persistWorktreeCreationBase`). `addSparseWorktree`
(line 1074-1141) supports directory-scoped checkouts and rolls back
(deletes the worktree + branch) on any failure during sparse setup.

**Path/branch naming** (`src/main/ipc/worktrees.ts:25-51` `sanitizeWorktreeName`,
`worktree-branch-name.ts:1-62`): user-typed name is slug-sanitized (Unicode
letters/numbers kept, everything else collapsed to `-`, `..` collapsed to
stop ref-format exploits). Branch name = `<prefix>/<sanitized>` where prefix
is configurable strategy (`git-username`, custom, or none) —
`computeValidatedBranchName`, falls back silently to no-prefix if
`git-username` resolves garbage. Location: `computeWorktreePath`
(`worktrees.ts:101-131`) = `<workspaceRoot>/[repoName/]<sanitizedName>`;
`workspaceRoot` is a global setting (`workspaceDir`) or a **per-repo override**
(`repo.worktreeBasePath`, `getEffectiveWorktreeBasePath` line 225-239), with
an optional `nestWorkspaces` toggle that nests under `<repoName>/`. Default is
a sibling location outside the repo, not a hidden folder inside it. WSL gets
a special mirrored path under `~/orca/workspaces` (line 91-160) so worktrees
stay on the same filesystem as the repo.

**Setup/materialization** (`src/main/ipc/worktree-symlinks.ts:1-406`): three
modes. `share` — `orca.yaml` `worktree.sharedDirectories` (this repo's own
`orca.yaml:1-4` only configures a `setup` script, not sharedDirectories, so no
example present) always symlinks (junction on Windows) so e.g. `node_modules`
serves every worktree from one install. `link` — user-configured shared
paths, symlink when possible, APFS clone-copy fallback. `copy` —
`.worktreeinclude`-resolved paths (e.g. `.env`) are always a real copy (APFS
clone-on-write when available) so edits never leak back to the primary
checkout; a per-materialization byte/inode budget can refuse an oversized
entry rather than silently partial-copy it (`worktree-include-copy-budget.ts`,
not read in depth). `hooks/register-worktree-hook-runner-handler.ts:1-28`
exposes `hooks:createIssueCommandRunner` — a configurable "run this command"
script (e.g. install) run against the new worktree, invoked from a
higher-level create/issue flow (not traced further; out of budget).

**Listing** (`worktree-logic.ts:519-582` `parseWorktreeList`,
`worktree.ts` — wait, both same file — `listWorktrees`/`listWorktreesStrict`,
lines 787-848): wraps `git worktree list --porcelain -z` (falls back to
non-`-z` for old git), parses `worktree/HEAD/branch/bare/sparse/locked
[reason]/prunable [reason]` blocks. `prunable` (git ≥2.31) or a manual
existence probe (line 662-699, older git) flags a worktree whose directory
vanished. Ahead/behind vs the local base branch is tracked separately via
`rev-list --left-right --count` (`evaluateLocalBaseRefRefreshability`, line
215-333) to offer a "your base branch drifted, refresh?" suggestion —
distinct from the worktree's own status. Concurrent scans for the same repo
are deduped and generation-fenced (line 736-810) so a mutation invalidates
in-flight listings rather than returning stale data.

**Detection of externally-created worktrees**
(`worktrees/listing/register-detected-worktree-handlers.ts:1-135`,
`worktrees:listDetected` IPC): a separate provider-based scan (local git,
SSH) that returns `authoritative: true/false` + `source` (e.g.
`metadata-fallback`) — i.e. Orca always re-derives from `git worktree list
--porcelain` rather than trusting only its own stored metadata, so a worktree
made outside the app appears. **Adoption**: `worktrees:adoptProvisionedRoot`
IPC (`worktrees/create/register-worktree-create-handlers.ts:100-115`,
truncated) takes an already-existing checkout and folds it into Orca's
registered-worktree metadata store rather than re-running `git worktree add`.

**Removal / lifecycle**
(`worktree.ts:1163-1360` `removeWorktree`,
`worktrees/removal/execute-worktree-removal.ts:1-120`): preflights a lock
(`assertWorktreeUnlockedForRemoval` — a `git worktree lock`'d tree is never
force-removed silently), does a "clean?" preflight before treating removal as
safe, defers the actual multi-GB recursive delete by renaming the checkout
into a trash dir first and pruning git's registration synchronously (line
1241-1310, `tryRemoveWorktreeWithDeferredDirectoryDeletion` — so `remove`
returns fast even for a huge tree). Branch deletion after worktree removal
uses `git branch -d` (safe, refuses unmerged) by default, escalating to `-D`
only for failed-creation rollback; an unmerged/unpublished branch is
**preserved**, never silently discarded (line 1312-1359,
`deleteBranchAfterWorktreeRemoval` returns `preservedBranch`). A submodule
that refuses non-force removal is re-probed clean and then force-removed
specifically for that case (line 1207-1219). Archive hooks exist
(`removal/worktree-archive-hook.ts`, not read) for a remote/SSH variant.

**Diff/PR/merge**: not traced in this budget (found `worktree-diff-stamp.ts`,
`worktree-push-target-setup/-cleanup.ts` — push-target management for
opening a PR from a worktree branch — and GitHub/Linear panel integration per
README, but did not read the PR-open or merge-back code path).

**Edge cases found in file names alone** (not all read): WSL path translation
throughout (`worktree.ts` imports `parseWslPath`/`translateWslOutputPaths`
pervasively), Windows long-path args, locked worktrees
(`assertWorktreeUnlockedForRemoval`), submodule refusal
(`isSubmoduleWorktreeRemovalRefusal`), non-git directories (treated as a
plain "folder repo" — `isFolderRepo(repo)` branches skip all git worktree
logic entirely, `execute-worktree-removal.ts:37-39`), a repo path that
vanished mid-scan (`ENOENT` handling, `worktree.ts:715-733`), branch already
checked out elsewhere (surfaced via `worktree list --porcelain`'s `branch`
field and the "owner worktree" logic in `evaluateLocalBaseRefRefreshability`).

**UI**: `docs/STYLEGUIDE.md:7,43-46` — the whole app is styled around "the
worktree sidebar and its children" as a first-class chrome family
(`--sidebar-*` tokens); worktrees are the primary sidebar list, not a
sub-item. Not traced further (renderer sidebar component itself, out of
budget).

## 2. Proposed vam MVP scope

vam today: one tmux session = one pane = one agent, grouped by cwd +
`@vam-project` (`create-session.ts` header, `src/main/sources/claude-code/
create-session.ts:1-236`); no notion of "many working copies of one repo."

**MVP** (smallest slice that is genuinely "a worktree function"):
1. `vam worktree create <projectId> <name> [--base <ref>]` main-process
   service wrapping `git worktree add --no-track -b <branch> <path>
   [<base>]`, path = sibling dir `<repoParent>/<repoName>-worktrees/<name>`
   (simplest safe default; avoid an in-repo hidden folder so `.gitignore`
   and file-watchers never have to special-case it).
2. One session per worktree, created the same way `createSessionInDirectory`
   already works today (spawn a shell in that cwd, `@vam-project` tag =
   the **same** digest as the parent repo, or a derived child id — decision
   needed, see §6).
3. Sidebar: worktrees list as **child rows under the repo's existing project
   section**, not new top-level projects — matches vam's "project = cwd
   digest" model least disruptively and keeps `Group by: Project` coherent.
4. Delete: `git worktree remove` (non-force; refuse with a message on dirty
   tree, matching Orca's "never silently discard" default), no branch
   auto-delete in MVP (leave that as an explicit follow-up decision — safer
   default).
5. No node_modules/env auto-copy, no sparse checkout, no SSH remote worktrees
   in MVP — name them as phase 2.

**Phase 2**: `.env`/config copy-on-create (Orca's `.worktreeinclude`
convention is worth reusing conceptually, never its code), a configurable
shared-directories symlink for `node_modules` (Orca's `share` mode — see
`vam-adding-a-dep-to-shared-vam-tree` lesson for how fragile a shared
`node_modules` already is in this codebase; treat with real caution),
dirty/ahead-behind badges in the sidebar, branch auto-delete on remove with
an unmerged-work guard, detection+adoption of worktrees the operator makes
via plain `git worktree add` outside vam (`git worktree list --porcelain`
parse, matching Orca's non-authoritative-until-scanned pattern), phone/remote
API exposure.

**Explicitly out of scope, don't build**: SSH/remote worktrees, submodule
special-casing, Windows junction fallback (vam is macOS/Linux only per the
repo's own toolchain, unverified — flag as open question), PR-open/merge-back
flow (vam already has a PRs view; a worktree's branch just needs to surface
there like any other session's branch does today, no new merge UI needed for
MVP), diff annotation.

## 3. Data model and IPC surface (sketch)

```
WorktreeRecord {
  worktreeId: string        // path-derived, like Orca's "repoId::path" (worktree-logic.ts:264-270)
  repoProjectId: string      // parent project's existing digest
  path: string
  branch: string
  baseRef?: string
  createdAt: number
}
```
Persisted in whatever store already holds project/session metadata (not
located in this budget — likely alongside `pane-row.ts`/prefs). IPC channels,
mirroring `channels.ts`'s existing shape: `worktree:list(projectId)`,
`worktree:create({projectId, name, baseRef})`, `worktree:remove({worktreeId,
force?})`. Each should return the same `SourceError | null` / result-union
shape `createSessionInDirectory` already uses so error handling stays
uniform.

## 4. UI sketch (words)

Sidebar: under a repo's project heading, an expandable "Worktrees" sub-list
(collapsed by default for repos with none) showing name, branch, and a dirty
dot; a "+" affordance opens a small form (name, base ref defaulting to the
project's current branch or a configured default). Each worktree row behaves
like a mini project section for its one session — reuses the existing pane
row / Terminal-view machinery unchanged, since a worktree IS just another cwd
to `createSessionInDirectory`. New-session flow: the existing "new project"
picker gains a "new worktree of <existing project>" mode alongside "new
directory."

## 5. Risks and security

- **Remote/phone API confinement is presently weaker than the brief assumes.**
  `isDirectory()` in `src/main/remote/server.ts:190-191` only checks the
  string is an absolute path with no NUL byte; `createSessionInDirectory`
  (`create-session.ts:214-236`) confines only via `whyNotARepository(cwd)` —
  i.e. today `/api/create-session-in` already accepts **any git repository
  path on disk**, not just known/registered projects. A worktree-create
  endpoint must not inherit that as sufficient: it needs its own check that
  `projectId` names a **known** project and the resulting worktree path is
  inside that project's (or a global) configured worktree root — Orca's
  `ensurePathWithinWorkspace` (`worktrees.ts:79-89`, traversal-safe
  `path.relative` check) is the pattern to reproduce (never copy) for this.
- **Shared node_modules symlink is a known fragile seam in this repo**
  (memory: adding a dep to vam's own shared tree requires a main-matching
  worktree + `--virtual-store-dir`) — treat any MVP+ "share node_modules
  across worktrees" feature as needing its own careful design, not a
  straight port of Orca's `share` mode.
- **Branch/worktree deletion must never silently drop unmerged commits** —
  Orca's `git branch -d` (not `-D`) default plus explicit `preservedBranch`
  reporting (`worktree.ts:1312-1359`) is the safety bar; vam's MVP should
  refuse (not auto-force) on a dirty tree, matching the non-force default.
- **tmux `@vam-project` identity**: whether a worktree's session tags itself
  with the parent's project id or a new child id changes how the sidebar
  groups it and how `paneProjectDirectory`-style reconciliation
  (`create-session.ts:156-213`) behaves for a second worktree of the same
  repo — this needs a decision (§6), not an assumption.

## 6. Decisions for the operator

1. **Default worktree location**: sibling directory outside the repo (Orca's
   default, e.g. `<repo>-worktrees/<name>` or a global `~/vam/worktrees/`
   root) vs. an in-repo hidden folder. Recommend sibling, matching Orca.
2. **Branch naming**: bare sanitized name vs. a prefix convention
   (`<username>/<name>`, configurable). Orca defaults to a configurable
   prefix; vam has no existing branch-naming convention to match against.
3. **Auto-install / symlink `node_modules` on create**: on by default, opt-in,
   or phase-2-only (recommended, given the shared-tree fragility noted above).
4. **Delete semantics**: does removing a worktree also offer to delete its
   branch (Orca: yes, safe-delete with preserved-branch fallback), and does a
   dirty worktree ever get force-removed from the UI, or only via a typed
   confirmation?
5. **New-session default**: does "new session in existing project" ever
   default to "new worktree" (Orca's parallel-agents pattern), or does a
   worktree stay an explicit, separately-invoked action for v1?

## Open questions

- Where vam persists project/session metadata today (needed to place
  `WorktreeRecord`) — not located within this budget.
- Whether vam's toolchain/CI targets Windows at all (affects whether
  junction-fallback symlink logic is ever needed).
- Orca's diff/PR-open/merge-back flow from a worktree — not traced; a
  follow-up research question if vam wants that phase.
- Exact persisted worktree-metadata shape and hook-runner mechanism in Orca
  (`hooks:createIssueCommandRunner`) — named but not read in depth.
