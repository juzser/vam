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

**Explicitly out of v1** (see §6, Phase 2 — and §7, phase 2a, for the two
items it shipped):

- `node_modules`/`.env` copy or symlink on create.
- Sparse checkouts, SSH/remote worktrees.
- ~~Detecting or adopting a worktree the operator made by hand
  (`git worktree add` outside vam).~~ **Shipped, §7.**
- ~~Dirty / ahead-behind badges in the sidebar.~~ **Shipped, §7.**
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
  prunableReason: string | null; // phase 2a
  detached: boolean;             // phase 2a — branch is a short sha BECAUSE of this
};

// phase 2a — a SEPARATE round trip, `CHANNELS.worktreeStatus`, §7
type WorktreeStatus = {
  worktreeId: string;
  dirty: boolean;
  ahead: number | null;   // null: no upstream (includes every detached HEAD)
  behind: number | null;
};

type CreateWorktreeInput = { projectId: string; name: string; baseRef?: string };
type RemoveWorktreeInput = {
  projectId: string;   // required -- see §5 rule 6
  worktreeId: string;
  force?: boolean;
  confirmName?: string;
};
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

**The duplicate this creates is closed, not merely disclosed.** The v1
report this doc originally shipped against flagged that a worktree's own
`Project` would ALSO draw a normal top-level sidebar section — the same
`projectId` match above, used the other direction: `SessionList.tsx`'s
`useWorktreeParents` hook asks every visible project's `worktrees.list()`
and builds the reverse map (child id → parent id); a project found in that
map, whose parent is itself still visible, does not get its own top-level
section — its sessions are only reachable by nesting under the parent's
"Worktrees" row (`WorktreesSection.tsx`, via the SAME `onPick` handler a
top-level row's click already used). "Whose parent is itself still
visible" is deliberate: hiding the parent must never make the child's
sessions unreachable, so a hidden parent un-suppresses its children rather
than hiding them twice. The suppression only ever applies under
`Group by: Project` — `Status`/`None` grouping has no "Worktrees" row to
nest under at all.

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
6. **`remove()` is confined to a KNOWN project's own worktrees.** Revised
   after a fresh review found the original version of this rule ("`remove()`
   needs no `projectId` at all") was itself the hole: `worktreeId` alone (an
   absolute path) let a compromised renderer derive a repo root from
   *whatever* directory's own `.git` file it was handed, with no check that
   vam managed that repo at all — `remove --force` on any linked worktree of
   any git repository on disk, known to vam or not. `RemoveWorktreeInput`
   now carries a **required** `projectId`, checked against
   `knownProjectIds()` and resolved through `resolveProjectDirectory` —
   exactly rules 1–2 above, applied to `remove()` too. The candidate
   `worktreeId` must then pass the **same `authorize()`** call `create()`
   makes, against *that* project's own `<repoRoot>-worktrees/` root — proven
   necessary, not merely plausible: disabling this check while developing
   the fix let a real `git worktree remove` run on a worktree living outside
   the confined root (`test/main/worktrees/worktrees.integration.test.ts`'s
   "confinement (S2)" suite has the falsification in its header). A second,
   independent check reads the candidate's own `.git` → `commondir` chain
   and refuses unless it names the *same* repo root as the resolved
   project — belt-and-suspenders against a directory that merely sits
   inside the confined root without being a linked worktree of it at all.
   Only once both agree does `removeWorktree` ask git whether this path is
   one of that repo's *registered* linked worktrees at all (`git worktree
   list`, matched by realpath) — three independent, overlapping proofs
   before anything is deleted. `git worktree remove` still runs with `cwd`
   set to the resolved repo root, which is never the directory being
   deleted.
7. **`baseRef` cannot be mistaken for a git flag.** A typed base ref of
   `-f`, `--detach`, or `--upload-pack=x` is indistinguishable from the
   flag of the same name to `git worktree add`'s own argv parser —
   reproduced against a real git binary while fixing this (`-f` silently
   force-created the worktree, no error at all). `createWorktree` validates
   `baseRef` first with `git rev-parse --verify --quiet --end-of-options
   <baseRef>^{commit}` (the `--end-of-options` flag is what stops `rev-
   parse` itself from reading a leading `-` as one of *its own* flags,
   closing the identical hole one layer up), then — belt-and-suspenders,
   not a substitute — passes it to `git worktree add` after a literal `--`,
   confirmed against real git to still resolve the ref correctly.
   `test/main/worktrees/worktrees.integration.test.ts`'s "baseRef injection
   (S3)" suite falsifies both layers together: with `validateBaseRef`
   skipped and `--` removed, `-f` stops being refused and a worktree is
   force-created instead.

## 6. Phase 2 (named, not built)

- ~~Detection + adoption of a worktree made outside vam~~ — **shipped, §7
  (phase 2a)**.
- ~~Dirty / ahead-behind badges on each worktree row~~ — **shipped, §7
  (phase 2a)**.
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

## 7. Phase 2a — shipped

**Adoption.** `listWorktrees` needed no change at all: `git worktree list
--porcelain` was always unconditional, so a worktree a CLI, Orca, or
`claude --worktree` made was already IN the answer §3.1 describes — v1's own
gap was narrower than §6 first named it. The actual gap was `removeWorktree`:
its confinement (§5 rule 6) required the candidate to sit inside
`<repoRoot>-worktrees/`, which a worktree made outside vam never does. That
location check is now GONE from `removeWorktree` — the other two proofs rule
6 already made (the candidate's own `.git` → `commondir` chain resolves to
the SAME repo root the resolved project names, AND a fresh `git worktree
list` still registers it) turn out to fully carry the security invariant on
their own, proven by falsification: disabling the location check alone still
leaves every attack shape in `worktrees.integration.test.ts`'s "confinement
(S2)" suite refused. `createWorktree` is UNCHANGED — vam still only ever
*creates* inside `<repoRoot>-worktrees/`; only *removing* a worktree it did
not create had to stop caring where that worktree lives.

An adopted worktree that is itself a Claude Code agent worktree
(`.claude/worktrees/agent-*`, `main/sources/agent-worktree.ts`) is filtered
from the sidebar row the same way an agent-worktree SESSION already is —
`SessionFilters.hideAgentWorktrees`, the operator's own existing toggle,
threaded down as `WorktreesSection`'s own `hideAgentWorktrees` prop rather
than growing a second, independent one. The two pure predicates that
recognise one (`hasAgentWorktreeSegment`, `isAgentWorktreeBranch`) moved to
`shared/agent-worktree.ts` so the renderer can apply the SAME rule to a
worktree row without pulling `node:fs/promises` into the web bundle;
`main/sources/agent-worktree.ts` re-exports them unchanged.

`WorktreeInfo` grew two fields: `detached` (a `HEAD` that names no branch —
`branch` was already a short sha in this case, but nothing said WHY) and
`prunableReason` (parity with `lockReason`). `locked`/`prunable`/`detached`
are all marked in the sidebar row; a locked worktree's delete control is not
merely refused after a click, it is not drawn at all — `removeWorktree`
refuses one unconditionally regardless, so offering the control was never
honest.

**Dirty / ahead-behind badges.** A NEW round trip, `CHANNELS.worktreeStatus`
/ `getWorktreeStatuses` (`main/worktrees/status.ts`), deliberately NOT folded
into `list()`'s own answer — a dirty check and an ahead/behind count are each
their own `git` spawn PER worktree, and running both for every worktree of
every project on every poll would multiply this feature's process count by
however many worktrees a workspace has, whether or not anyone is looking.
Every candidate id is proven with the SAME two checks `removeWorktree` now
uses (commondir chain + live registration) before either `git` call ever
runs — one code path, reused, not a second place this proof could drift.

`git status --porcelain=v1 -z` runs WITH untracked files (measured against
this repository: 26ms including them vs. 16ms with `--untracked-files=no`,
both far under any cadence this polls at) — an untracked file left in a
worktree is not "clean" to an operator asking "did I leave something here".
`git rev-list --left-right --count @{u}...HEAD` answers `<behind>\t<ahead>`;
failing outright (no upstream, or a detached `HEAD`, which cannot have one)
reads as `null`/`null`, the same "cannot say" `WorktreeInfo.branch: null`
already means.

The renderer's own `useWorktreeStatuses` hook is the performance gate:
`mapWithConcurrencyLimit` (reused from `claude-code/concurrency-limit.ts`,
never reimplemented) bounds how many `git status`/`git rev-list` pairs run
at once; `useVisibilityInterval`'s `hidden: 'pause'` mode stops polling
outright once the window is hidden; the poll cadence (20s) is an order of
magnitude slower than `useSourceModel`'s own base poll (10s) because this
data is advisory, never correctness-critical; and the hook is only ever
MOUNTED for a project whose Worktrees section already has rows to draw
(`WorktreesSection`'s own "hidden when there are none" rule, unchanged) — a
project with none never polls at all.

A dirty dot reuses `--color-diff-file` (a changed file's own colour in the
diff renderer) rather than a new token; ahead/behind reuse
`--color-diff-add`/`-del` (green for commits ready to push, red for commits
not yet pulled) — the app's own existing hues, not three new ones.

## 8. Phase 2b — shipped

**The operator's own report**, opening the blacksmith project (the maestro
repo): a lot of worktrees that are not vam's, or are locked (`.wt/...`,
`.claude/worktrees/agent-*`, locked ones, "and others"), with no way to hide
or fold them. Phase 2a's adoption work made every such worktree a full row;
this phase adds the filter and the tree the operator actually asked for.

**`WorktreeInfo.external`**, a THIRD purely path-based field alongside
`detached`/`prunable`: `true` when a worktree's OWN directory does not sit
inside vam's `<repoRoot>-worktrees/` root (`worktreesRootFor`) — a worktree a
CLI, Orca, or `claude --worktree` made, never vam's own "+". Computed once in
`listWorktrees` by comparing a realpath'd `dirname` against a realpath'd
worktrees root (falling back to the raw root when it does not exist yet, the
same tolerance `safeRealpath`'s other callers already show); `createWorktree`
always answers `false`, since its one call site never writes anywhere else.
Not security-relevant — the confinement `removeWorktree` proves is unchanged
(§7); this field only ever decides what a ROW looks like.

**`SessionFilters.hideExternalWorktrees`** (a SEVENTH toggle,
`domain/session-filter.ts`), `hide`-shaped like its six neighbours and
default `true` (hidden) — but the ONLY row in the filter popover whose own
LABEL and switch read the other way round ("Show external worktrees"), the
operator's own words for it. Independent of `hideAgentWorktrees`: an agent
worktree the operator reveals via that toggle is still, separately, external,
and both gates must open before it draws as a plain row rather than a nested
one. `worktree-visibility.ts` (colocated with the feature, never folded into
`session-filter.ts`, which knows only `Session`) holds the one shared
predicate, `isExternalOrLockedWorktree` — "not vam's, OR locked", the
operator's own two examples ORed exactly as given — used BOTH to decide what
is hidden by default AND what belongs in the tree once shown; the two
questions have the same answer everywhere in this feature.

**The tree itself.** `WorktreesSection` now partitions its (already
agent-worktree-filtered) rows into a plain list and an external/locked one.
The plain list draws exactly as before; the external/locked one, when the
toggle is off, draws as its own group — a collapsible header ("External
worktrees N"), then every one of ITS rows nested one step in, dimmer and
smaller (`text-meta`/`text-ink-faint` in place of `text-control`/
`text-ink-dim`), behind a dashed left border (`border-l border-dashed
border-line`) as the tree guide. Every row — plain or nested — draws through
the SAME `renderRow` function (a `compact` flag is the only difference): the
delete button, "Start a session here", every marker, every nested session
keep their full reach regardless of which list called it, and every control
is a real `<button>`, native `Tab` order, with no separate keyboard wiring
needed. Orca's own worktree tree was read as a reference for this shape
(never copied); no single component there matched closely enough to be worth
citing by name.

**The collapse toggle** persists per project, directly in `localStorage`
(`worktree-tree-collapse.ts`), NOT folded into the big `Prefs` blob
`prefs.ts` owns — the identical trade-off `prefs/foreign-hidden-note.ts`
already made for its own per-viewer number, and consistent with
`WorktreesSection`'s own stated self-containment principle (§ this file's
own header on that component). Keyed by the bare project id (already
globally unique, unlike `Prefs.collapsedProjects`'s two-level `source → [id]`
shape), wrapped in try/catch exactly like `foreign-hidden-note.ts`; expanded
(absent) is the default the first time a project's own tree is ever shown.

**The quiet count.** `WorktreesSection` draws its own "N hidden" note next to
the "Worktrees" heading's count, in the SAME quiet style
`SessionList.tsx`'s own "· N hidden" filter rows already use — never
`font-mono`, so it cannot collide with the heading's own count span, the
FIRST `.font-mono` element under `data-worktrees-section` a pre-existing test
already reads by that selector. Absent, not a "0 hidden": present only while
the default filter is actually holding something back. The popover's own new
row carries no count of its own — the worktree rows it holds back live
per-project, inside each project's own `WorktreesSection`, never in the flat
session list the popover's other six rows already count against.

**The badge poll skips both.** `useWorktreeStatuses`'s own `worktreeIds`
input is now `plainWorktrees` plus the external/locked ones ONLY when their
group is both shown (the filter is off) AND expanded (not collapsed) —
neither a filtered-out row nor a folded-shut one ever costs a `git status`/
`git rev-list` spawn, extending §7's own performance gate rather than
replacing it.

Falsified by hand throughout: the default-hide rule (`worktree-visibility
.test.ts`, and end to end in `worktrees-shots.mjs` against a real built
bundle), the `locked` half of `isExternalOrLockedWorktree` (a vam-made,
locked worktree stops being hidden), the poll exclusion (a hidden or
collapsed worktree starts costing a `git` spawn), and the collapse
persistence (a click that only updates in-memory state, never
`localStorage`, survives every assertion except the one round-trip test
built to catch exactly that).
