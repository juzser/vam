# Workspace options: orca's panel, read against vam's own data

The operator, with a screenshot of orca's "Workspace options" popover
(`docs/design/ref/orca-workspace-options.png`): "Change the filter UI into
this form, like orca, and see whether there is anything to learn from its
filter features."

This is that reading — every row in orca's panel, mapped onto what vam's
sidebar (`SessionList.tsx`), its domain model (`domain/model.ts`,
`domain/selectors.ts`) and its prefs store (`prefs/prefs.ts`) can actually
answer today, what it would cost to answer, and what shipped in this pass
versus what is a follow-up. The rule that decided each verdict: implement the
ones that map onto data vam already has and cost a bounded, provably-safe
change; name the rest, with the missing fact or the missing design decision
that blocks them, rather than build a hollow control.

## Show → Projects: "All projects" ›

**Not applicable, and arguably already solved differently.** Orca's row
scopes the WHOLE panel to a subset of projects. vam already has a per-project
"Show/Hide" action (each project's own `…` menu, `onHideProject` — the popover
already carries the restore strip and the "Hidden projects" list for exactly
this). A second, consolidated multi-select drill-in duplicating that
mechanism is a real feature, not a cheap one (a new selection UI, a new pref
shape, and a decision about how it composes with the existing per-project
hide) — follow-up, not this pass.

## Group by: None / Status / PR / Project

**`Project` — already vam's only behaviour, kept as the default.** The
sidebar has always grouped by project (optionally further by the operator's
own folders, vam's `Group`). Nothing changed for an operator who never
touches the new control.

**`Status` — implemented.** vam's `SessionStatus` already carries everything
orca's four words need: `waiting` → "Needs you", `running` → "Running",
`idle`/`unstarted`/`terminal` → "Sleeping" (three statuses that share one
neutral colour and one "nothing to do right now" reading — see
`SessionStatus`'s own header in `model.ts`), `done`/`failed` → "Done". Cost:
one pure bucketing function (`selectors.ts`'s `statusBucketOf`/
`applyViewOrder`) plus a rendering branch in `SessionList.tsx` that swaps the
interactive project heading (rename, icon picker, collapse, remove — all of
which assume a SINGLE project underneath) for a plain, non-interactive
status heading, since a bucket can hold many projects at once. Hidden-project
filtering moved from per-section to per-entry to stay correct once a section
is no longer project-homogeneous.

**`None` — implemented.** A flat run of rows, no heading at all. Same cost
class as `Status` (a bucketing branch, this time trivial: one section, every
entry).

**`PR` — not offered; the control shows it disabled.** vam's `Session`
already carries `pullRequests: PullRequestList`, so the DATA exists — but the
shape does not resolve to a single bucket key the way status does. A session
can have zero, one or several open pull requests, on possibly different base
branches; `PullRequestList` is itself a three-state union (`ok` with a list,
or `unavailable` with a reason vam could not ask). Orca's own single "PR"
bucket implies a policy nobody has decided yet: does a session with two PRs
appear once or twice? Does "no PR" get its own bucket, or fold into
"Sleeping"-style silence? vam already has a dedicated PRs view
(`DetailPanel`'s PRs tab) that answers a related but different question
("what pull requests exist"), and grouping the SESSION list by PR risks
duplicating that surface with a half-decided rule. Follow-up, pending an
operator decision on the bucketing policy — not a data gap.

## Sort by: Agent Activity ›

**Implemented, with two of orca's options standing in for it: `Name`, and
now `Created`.** vam's `Session` carries `age: string | null` — but it is a
PRE-FORMATTED display string ("2m", "6h", "3d"), produced by the adapter for
right-aligned display, not a raw timestamp. Sorting by it as a string would
sort "2m" before "3d" before "6h" (lexicographic, not chronological) — worse
than not offering the option at all. `activity: string | null` is a
one-line description ("Editing 3 files"), not orderable at all. So "Agent
Activity" itself (recency-based sort) is still not cheap: it needs a raw,
comparable LAST-ACTIVITY timestamp no source carries yet, which is a
source-adapter change across `claude-code`/`codex`, not a domain-layer one.

`orderedSessions`' own order, "needs-you first", is still offered
(`sortBy: 'needs-you'`) — waiting sessions float up, then running, then
sleeping, then done, with projects ranked by their own most-urgent session.
It shipped first and is no longer the default: the operator's own report was
that it makes the sidebar "jump around" as a session's status changes mid-
session, which is a real cost `Name` and `Created` do not have.

**`Created` IS THE NEW DEFAULT, and it needed a fact `Sort by` did not have
before: `Session.createdAt`.** Unlike a last-activity timestamp, a creation
time turned out to be cheap once measured per source: `claude-code` reads a
transcript's own file BIRTHTIME — free off the same `stat()` the age read
already pays for, never the file's first line (`transcript.ts`'s own header:
a transcript is read as a bounded TAIL and deliberately never opens the
head of a file that can run to 157 MB) — falling back to the process's own
start time before a transcript exists, and to tmux's `session_created` for a
pane with no transcript at all. `codex` reads the instant Codex itself
embeds in a rollout's own file name (`rollout-<iso>-<uuid>.jsonl`), never
`recency_at_ms` (`docs/design/vam-owns-the-session.md`'s own trap: a
recency moves every poll and is not a start time). Sorted oldest-first — a
session list reads top to bottom like a log, and the newest arrival taking
the TOP would itself be a row that keeps moving everything below it, the
same complaint under a different name — and tied, when two sessions read
identically, by id, deterministically.

Existing installs move onto `Created` too, once, through a `sortByMigrated`
ratchet (`prefs.ts`) shaped exactly like the streaming-terminal default's
own migration (PR 495): a stored `needs-you` cannot be told apart from the
OLD default simply never having been touched, so it moves once; a stored
`Name` is unambiguous evidence of a real choice (the old default was never
`Name`) and survives untouched even before the ratchet marks itself
consumed.

`Name` is `Session.title`, sorted alphabetically within whatever grouping is
active — unchanged from when it first shipped.

**Why Sort by never reorders projects or buckets, only what is inside one.**
Orca draws "Sort by" and "Project order" as two separate controls. vam offers
only the first: `sortBy` reorders sessions WITHIN whatever `groupBy` already
bucketed (a project's own contiguous run, a status bucket, or the one flat
list under `None`) — it never decides which project or bucket comes first.
That is what keeps `gt`/`gT` ("jump to the next project") coherent under
`Group by: Project` regardless of `sortBy`, and it is also simply the honest
scope: there is no "Project order" control to feed a project-level sort with.

## Project order: Manual ›

**Not applicable.** vam's project order has never been anything but derived
— `orderedSessions`' own rank, most-urgent-session-first, recomputed every
poll. There is no stored order to expose as "Manual", and inventing one (a
new persisted array of project ids, a drag-reorder UI, a decision about what
happens when a project disappears and reappears) is a real feature, not a
cheap read of data vam already has. Follow-up.

## Card layout: Detailed ›

**Not applicable.** vam's sidebar row has exactly one layout; there is no
second, denser row to switch to, and there is no design brief yet for what
one would drop. Follow-up, and one that needs a UI spec before code, not a
prefs field.

## Show properties: 8 ›

**Not applicable.** vam's row does not have a configurable field list — what
it shows (title, branch, age, status, PR/branch meta) is fixed by the
component, not data-driven per field. Making it configurable is a real,
separate feature (a schema for "properties", a picker, a default set) with
no cheap subset.

## Filters

Every one of orca's filter rows is a toggle over data vam either already
tracks or does not track at all. The ones it tracks are cheap; the ones it
does not are named below with the missing fact.

### Hide sleeping (+ "Except default branch")

**`Hide sleeping` — implemented as `hideIdle`.** Orca's "sleeping" is exactly
vam's `idle` status: alive, attached, simply between turns
(`SessionStatus`'s own header). New toggle, `SessionFilters.hideIdle`,
**OFF by default** — unlike orca, which ships it on. Every new preference in
this file follows one rule: a fresh toggle must change nothing for an
operator who has not touched it, so the shipped default cannot silently hide
rows nobody asked to hide. One click turns it on.

**"Except default branch" — not applicable, and not merely deferred.** This
sub-toggle needs vam to know a PROJECT's default branch (main/master/trunk),
which nothing in `model.ts` carries — `Session.branch` is the session's OWN
current branch, not the repository's default. Guessing ("main" or "master"
by name) is exactly the kind of inference this codebase's own philosophy
argues against (`isEnded`/`isForeign`'s shared rule: only a POSITIVELY
MEASURED fact may hide a row) — a repo whose default branch is `develop` or
`trunk` would silently mis-hide. Needs a new source fact (`git symbolic-ref
refs/remotes/origin/HEAD`, or the equivalent read at session-discovery time)
before this can exist at all — follow-up, and it is also the SAME blocking
fact the next row needs.

### Hide default branch

**Not applicable — same missing fact as above.** `Session.branch` says WHICH
branch a session is on; nothing says which branch is the project's default,
so "is this session on the default branch" cannot be answered today. Once a
source adds that fact, this toggle and "Except default branch" both become
cheap (both are just `session.branch === project.defaultBranch`).

### Hide automation-created

**Already shipped, under a different name: `hideAgentStarted`.** vam's own
`Session.origin.startedBy === 'agent'` — a denylist of known factory roles
(`session-filter.ts`'s `AGENT_ACTORS`) — is exactly orca's "automation-
created". On by default already; nothing to add.

### Hide CLI-created

**Already shipped, closest existing match: `hideForeign` ("vam did not start
it").** Not a perfect match — orca's own row is about a session STARTED
FROM a CLI rather than a GUI, and vam's `hideForeign` is about a session vam
itself did not start (a broader claim: "not vam's tmux pane", not "started
by typing a command"). The two overlap heavily in practice — a session
someone opened by hand in their own terminal is both "CLI-created" in
orca's sense and "not vam's" in vam's — and vam has no narrower fact to
split the two further. Already on by default (`vam-owns-the-session.md`'s
own design). Not renamed to match orca's wording: vam's own phrase describes
what vam actually measured (ownership), not the mechanism (a CLI) — renaming
it to match orca's word would claim a narrower fact than vam has.

### Hide detached HEAD

**Not applicable.** vam does not read whether a working directory's HEAD is
attached to a branch at all — `Session.branch` is `null` when the source
"cannot say", not when the repo is specifically in a detached-HEAD state; the
two are indistinguishable in today's data. Needs a new source fact (a
`git symbolic-ref -q HEAD` check, or equivalent) — follow-up.

## What shipped

- **Group by:** `Project` (default, unchanged), `Status` (new), `None` (new).
  `PR` shown disabled in the segmented control, matching orca's own four-pill
  shape, with no functionality behind it yet.
- **Sort by:** `Created` (new, and now the DEFAULT for every install —
  existing ones migrate onto it once, through `sortByMigrated`), `Needs you
  first` (today's original order, still offered), `Name`. All three apply
  within whatever `Group by` already bucketed, never across buckets or
  projects. `Session.createdAt` is the new source fact behind `Created`,
  read per source without an extra IO cost (`claude-code`: transcript
  birthtime off the existing `stat()`, or tmux `session_created` with no
  transcript yet; `codex`: the instant embedded in the rollout's own file
  name).
- **Filters:** the four original rows (`hideAgentStarted`, `onlyPrompted`,
  `hideEnded`, `hideForeign`) rebuilt as orca-shaped icon + label + switch
  rows (`role="switch"`, `aria-checked`), same pref keys, same defaults, same
  counts. `hideIdle` ("Hide sleeping") followed, OFF by default. A sixth row,
  `hideAgentWorktrees` ("Hide agent worktrees"), hides a Claude Code agent's
  own throwaway `.claude/worktrees/agent-<id>` checkout (`isolation:
  "worktree"`, unrelated to vam's own worktree feature, PR 496) — ON by
  default, `hideForeign`'s own shape rather than `hideIdle`'s (see
  `session-filter.ts`), and the one rule in this popover that stands down for
  a `waiting` session: it is vam's own session, and one asking the operator
  something must stay reachable regardless of the toggle.
- **Heading size:** the sidebar's project/group titles move one further
  pixel down (14px → 13px, still semibold), a separate, unrelated operator
  ask folded into the same pass; see `type-scale.test.ts`'s own `EXCEPTIONS`
  entry for the full arithmetic.

## Follow-ups, in the order they would likely get picked up

1. **Group by: PR** — needs an operator decision on the bucketing policy for
   a session with zero, one or several open pull requests before it can be
   coded at all.
2. **A `defaultBranch` source fact** — unlocks BOTH "Hide default branch" and
   "Except default branch" at once; the cheapest single follow-up on this
   list, since both toggles become a one-line predicate once the fact exists.
3. **A raw, comparable LAST-ACTIVITY timestamp** — unlocks a genuine "Agent
   Activity" sort; `Created` shipped separately, off a creation timestamp
   rather than a last-activity one.
4. **A `detachedHead` source fact** — unlocks "Hide detached HEAD".
5. **Show → Projects, Project order, Card layout, Show properties** — each
   is a real, separate feature (a new selection UI, a persisted manual order,
   a second row layout, a configurable field list) with its own design brief
   still to write, not a cheap read of data vam already has.
