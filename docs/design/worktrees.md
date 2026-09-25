# vam worktrees — v1 design

Operator ask: "vam should have a worktree function like Orca." Research brief:
`docs/design/worktrees-research.md` (Orca's own feature map, studied, never
copied — `/Users/ser/scatola/jobs/opensources/orca`). This document is the
MVP that actually shipped, with the decisions the brief left open now made.

## 1. Scope

**In v1:**

- List, create and remove a git worktree of a project vam already has a live
  session in.
- "Start a session here" on a freshly created worktree, reusing
  `createSessionInDirectory` unchanged.
- A sidebar sub-list under each project, a create form, a delete action with
  a typed-name confirmation for a dirty tree.
- A `/New worktree…` command palette action.

**Explicitly out of v1** (see §6, Phase 2):

- `node_modules`/`.env` copy or symlink on create.
- Sparse checkouts, SSH/remote worktrees.
- Detecting or adopting a worktree the operator made by hand
  (`git worktree add` outside vam).
- Dirty / ahead-behind badges in the sidebar.
- Branch auto-delete as anything other than the safe `git branch -d` this
  feature already runs after a successful `remove()`.
- Exposing worktree creation or removal over the remote (phone) API.

## 2. Operator decisions (final, as given)

1. **Location.** A sibling of the repository: `<repoParent>/<repoName>-
   worktrees/<name>`. Never a hidden folder inside the repo, so `.gitignore`
   and every file-watcher in this app never has to special-case it.
2. **Branch naming.** The operator's typed name, sanitised into a valid git
   ref — no prefix (`vam/<name>`, `<username>/<name>`, etc. were all
   considered and rejected; vam has no existing branch-naming convention to
   match).
3. **Setup.** Nothing. No `node_modules`, no `.env` copy, in v1 — see the
   `vam-adding-a-dep-to-shared-vam-tree` lesson on how fragile a shared
   `node_modules` already is in this very repository; a "share node_modules
   across worktrees" feature needs its own careful design, not a default
   this one silently turns on.
4. **Delete.** Safe. `git worktree remove` (non-force) first; refused on a
   dirty tree until the operator retypes the worktree's own name, at which
   point `--force` runs. `git branch -d` (never `-D`) afterwards — an
   unmerged branch is kept, and the UI is told so (`preservedBranch`). A
   `git worktree lock`ed tree is **never** removed, forced or not.
5. **Sidebar placement.** Worktrees are child rows under the repo's existing
   project section, not separate top-level projects (§4 explains why this
   is a UI-layer grouping, not a change to what a "project" is).
6. **Explicit action.** Creating a worktree is its own action (a "+" on the
   Worktrees sub-list, or the palette). Starting a new session never
   defaults to "start it in a new worktree" the way Orca's parallel-agents
   mode does.

## 3. Data model

### 3.1 What main computes (`src/shared/worktree.ts`)

```ts
type WorktreeInfo = {
  worktreeId: string;      // realpath of the worktree's own directory
  path: string;             // == worktreeId
  branch: string | null;    // HEAD's branch name, a short sha if detached, or null
  projectId: string;        // projectIdOf(worktreeId) — see §4
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
};

type CreateWorktreeInput = { projectId: string; name: string; baseRef?: string };
type RemoveWorktreeInput = { worktreeId: string; force?: boolean; confirmName?: string };
type RemoveWorktreeOutcome = { preservedBranch: boolean };
```

Nothing is persisted. A worktree's existence is derived, live, from
`git worktree list --porcelain -z` every time `list()` is asked — the same
"a project is a grouping of live sessions on their cwd" philosophy
`sources/claude-code/project-id.ts` already states for `Project` itself.
There is no `WorktreeRecord` store, no prefs bucket, nothing that can drift
from what git itself reports.

### 3.2 Main-process service (`src/main/worktrees/`)

| File | Responsibility |
|---|---|
| `name.ts` | `sanitizeWorktreeName` — pure slug plausibility filter. |
| `porcelain.ts` | Parses `git worktree list --porcelain[-z]` into records. |
| `git-run.ts` | The one `execFile('git', argv, …)` wrapper — argv array, no shell. |
| `resolve-directory.ts` | `projectId -> directory`, live-agent-then-pane. |
| `worktrees.ts` | `listWorktrees` / `createWorktree` / `removeWorktree`. |
| `ipc.ts` | `registerWorktreesIpc` — validation + the `IpcResult` envelope. |

Every function in `worktrees.ts` resolves to `SourceError | T`, never
throws — the same result/`SourceError` union style
`createSessionInDirectory` already uses.

## 4. The identity decision: a worktree is its OWN project, not the parent's

`Project.id` is `projectIdOf(cwd)` — a one-way digest of a directory
(`sources/claude-code/project-id.ts`). A worktree is a **different
directory**, so a session started in it digests to a **different id**. Two
routes were considered for what a worktree's session should be tagged with:

- **Same id as the parent repo.** Rejected. `create-session.ts`'s own
  `paneProjectDirectory` refuses (returns `null`, "ambiguous") a project id
  that more than one live pane's cwd disagrees about — exactly the state two
  worktrees sharing the parent's id would create the moment both have a
  live session. Forcing shared identity would not merely mislabel the
  worktree's row; it would make "start a second session in this project"
  stop working for the **parent repo itself** the moment a worktree of it is
  also live. This is not a UI nicety being traded away, it is a functional
  regression on the existing project, so it was never a real option.
- **A derived child id (what shipped).** `projectIdOf(worktreeId)` — the
  exact digest `spawnSessionIn` already stamps on any session started in
  that directory, worktree or not. No new code path, no special case in
  `create-session.ts`, no risk of colliding with the parent.

The consequence: a worktree's sessions form their **own** `Project` in
`CanvasModel.projects`, with the worktree's own name
(`basename(worktreeId)`) as `Project.name`. The **sidebar** is what nests it
under the parent visually — a presentation-layer grouping, not a change to
what a `Project` means. `list(projectId)` on the parent hands back each
`WorktreeInfo.projectId`; the renderer's selector matches a `Project` row
against a `WorktreeInfo` by that id, the same way it would match any other
row it already has, and draws the match as a child rather than a sibling.
Phase 2's dirty/ahead-behind badges and adopted-worktree detection both
build on this same `projectId`, unchanged.

This also answers the "does this break #486/#490" question directly: a
worktree's session is created through the unmodified
`createSessionInDirectory` (`cwd` = the worktree's path), which already
derives its own project id from that cwd exactly as it does for any other
directory the operator opens as a new project. Nothing about the pane-only
fallback or project grouping changes; a worktree is, deliberately, "just
another cwd" to every part of the app except the sidebar's own layout.

## 5. IPC surface and security rules

Three desktop-only channels (`vam:worktree:list|create|remove`), **not**
members of `PreloadSourceApi` — `remote/server.ts`'s route table carries no
path to any of the three, so a paired phone cannot create or remove a
worktree in v1 (it can still see and use the sessions a worktree already
has, exactly like any other project — nothing about *using* a worktree's
session is worktree-specific).

Security rules, and where each is enforced:

1. **`projectId` must be a known project.** `knownProjectIds()` re-reads
   `source.load()` over the same `DESKTOP_SOURCES` list
   `remote/server.ts`'s own `confineToProjectSet` confines the
   `create-session-in` remote route to. Checked first, in both `list()` and
   `create()`, before any filesystem or git call.
2. **The directory is never taken from the renderer.** `Project` carries no
   `cwd` (deliberate, `renderer/domain/model.ts`), so the only honest route
   from an id to a path is `resolveProjectDirectory` — a **live** agent or
   pane vam already watches. A `projectId` naming nothing live resolves to
   `null` and is refused, never guessed at.
3. **The computed path is proven inside `<repoName>-worktrees/`.**
   `files/authorize.ts`'s `authorize()` is reused whole (not reimplemented):
   both sides realpath'd, a leaf that does not exist yet tolerated (the
   worktree about to be created), a symlink escape refused. Falsified
   directly in `test/main/worktrees/confine.test.ts` (a symlink inside the
   root pointing outside it; a naive `startsWith` check is shown passing
   where `authorize()` correctly refuses).
4. **The branch name passes two gates.** `sanitizeWorktreeName` (this
   feature's own plausibility filter — Unicode letters/numbers kept, `..`
   removed wherever it ends up, `HEAD` reserved) **then**
   `git check-ref-format --branch` (git's own, authoritative check). Neither
   is trusted alone; a bug in the first can only make it too strict, never
   too permissive.
5. **Removal never forces silently.** A **locked** worktree is refused
   unconditionally — `force` does not override it. A **dirty** worktree is
   refused until `confirmName` equals the worktree's own directory name
   exactly; a boolean confirmation was rejected as "not proof anyone read
   what they were about to discard." Branch deletion is always
   `git branch -d`, never `-D`; a refusal is reported as
   `preservedBranch: true`, never silently discarded.
6. **`remove()` needs no `projectId` at all.** The parent repository root is
   derived purely from the worktree's own `.git` file
   (`gitdir:` → `commondir` → the shared `.git` directory's parent — the
   same layout git itself relies on), which also means `git worktree remove`
   always runs with `cwd` set to a directory that is **not** the one being
   deleted.

## 6. Phase 2 (named, not built)

- Detection + adoption of a worktree made outside vam
  (`git worktree list --porcelain`'s own listing already surfaces one; the
  gap is only that vam does not yet offer to fold it into the sidebar under
  a nicer name).
- Dirty / ahead-behind badges on each worktree row.
- `.env` / config copy-on-create (an `.worktreeinclude`-style convention is
  worth reusing conceptually — never Orca's code).
- A configurable shared `node_modules` symlink — **treat with real
  caution**, this repo's own shared tree is already fragile
  (`vam-adding-a-dep-to-shared-vam-tree` lesson).
- Branch auto-delete beyond the safe `-d` this feature already runs.
- Exposing worktree creation/removal over the remote (phone) API — a
  worktree is a checkout on the desktop's own disk; whether a paired device
  should ever be allowed to create one is an operator decision this feature
  does not make by omission.
- SSH/remote worktrees, sparse checkouts, Windows junction fallback (vam's
  toolchain is macOS/Linux-targeted today; unverified whether it should stay
  that way).
