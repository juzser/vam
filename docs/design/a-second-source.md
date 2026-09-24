# A second source: Codex

Status: **proposed**. Written 2026-09-19 against vam at `f2ee8aed`, codex-cli
**0.153.2**, on this machine. Every claim below that is a fact about Codex was
measured here; the two that were not are marked as the experiments that have to
run first.

## The operator's question

> Also build the connection with Codex CLI, Cursor, and so on — start building
> the integrations for other platforms.

## The short answer

**Codex is a first-class target. Cursor is not. Build one Codex source end to
end rather than a framework for sources in general.**

vam speaks to exactly one agent today: `PROVIDERS = [{ id: 'claude-code',
label: 'Claude Code', command: ['claude'] }]` (`src/shared/providers.ts`).

## What was measured

### Codex has a real channel into a running session

This is the finding the whole design rests on, and it was the one thing the
research could not settle without driving a live session. Driven here, on a
private tmux socket in a throwaway directory:

```
$ codex queue --thread 01a0b8d8-a56d-7493-9235-4837ad1a348c \
              --message 'reply with exactly: drained'
Queued message 01a0b8d9-798f-7ee3-886c-c4549ba9618e for thread 01a0b8d8-…

pane:  › reply with exactly: drained
       • drained

queued_items: (empty)
```

**No daemon was running.** `codex app-server daemon version` fails with
`failed to connect to …/app-server-control.sock`, and that socket directory did
not exist before or after. The live TUI polls `~/.codex/queue_1.sqlite` itself
and drains it.

**Why this matters more than it looks.** vam's Claude Code integration is
terminal-first *out of necessity*: Claude Code offers no channel into a running
session, so vam starts `claude` inside a tmux session it tags, types with
`send-keys`, and reads the screen with `capture-pane`. Every awkward thing in
that design — the pairing rule, the keystroke strip, reading a model off a
status line an operator can redefine — exists because there is no door. **Codex
has a door.** A Codex source can say `deliverPrompt: true` and mean it.

### What Codex keeps, and where

| what | where | shape |
| --- | --- | --- |
| sessions | `~/.codex/state_5.sqlite` (WAL) | `threads(id, rollout_path, cwd, title, model, model_provider, git_branch, git_sha, git_origin_url, archived, name, project_id, tokens_used, cli_version, preview, originator, …)` — 789 rows on this machine |
| the queue | `~/.codex/queue_1.sqlite` | `queued_items(id, thread_id, payload_json, queue_order, created_at_ms, updated_at_ms)`, with `queued_thread_revisions` bumped by triggers — a revision counter a session polls |
| transcripts | `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl` | append-only JSONL: `session_meta` → `event_msg` → `response_item` |
| history projection | `~/.codex/thread_history_1.sqlite` | the paginated read model |

**Identity is the bare thread UUID.** The same string is `threads.id`, the
rollout filename, the lock filename and the `--thread` argument. Contrast
Claude Code, where a row is keyed `<sessionId>#<pid>` because a session id alone
collapses two rows (`sources/claude-code/agents.ts:198`).

**The transcript shape is one vam already reads.** Append-only JSONL, newest
last, one JSON object per line — the same family as
`~/.claude/projects/<slug>/<sessionId>.jsonl`, and the same reader discipline
applies: read a bounded tail, scan backwards, and skip a line that will not
parse rather than failing the read.

### Three things that are not there

- **Liveness is not in the store.** `threads` has no `status` and no pid
  column. `~/.codex/thread-writer-locks/<uuid>.lock` files exist but were
  stale for threads long finished. Whether an `flock` probe answers "a Codex is
  writing this thread right now" is **unmeasured**, and §Experiments says so.
- **`codex agents` is useless to a program.** It is an alt-screen TUI with no
  `--json`.
- **`codex mcp-server` points the wrong way.** It makes Codex an MCP *server*
  for some other client to drive; vam is not that client, and it would not
  reach the operator's existing sessions.

`codex app-server --listen unix://|ws://` is the real protocol and is marked
`[experimental]`. It is Stage 4, not Stage 1.

### A trap found by hitting it

`sqlite3 "file:$HOME/.codex/state_5.sqlite?mode=ro"` **fails** —
`unable to open database file (14)` — once the WAL has been checkpointed away,
because a read-only connection cannot create the `-shm` segment WAL mode wants.
A plain read of the same file at the same moment returns 789.

So `mode=ro` is not the safety it looks like: it fails exactly when no writer is
around, which is the common case. The reader must handle that rather than
report "Codex is unavailable" to an operator whose Codex is fine.

### Cursor: no

Not installed on this machine, so this is documentation only and is marked
unmeasured. `cursor.com/docs/cli/headless` documents `agent -p` with
`--output-format text|json|stream-json`, `--force` and `CURSOR_API_KEY`. There
is **no session list, no resume, no daemon and no documented local store.**

A vam Cursor source could only start a process in a tmux pane and scrape it,
with no transcript to read back — strictly worse than Claude Code, which at
least has a transcript. **Defer Cursor until it publishes something local to
talk to.** Saying so is the finding; building it anyway would be the mistake.

## What already fits, and what blocks

**The types are already source-agnostic**, and that is not luck — the
capability model was built for this:

- `src/renderer/sources/port.ts:20` — twelve capabilities, each with a
  `declines` reason for the ones a source withdraws.
- `sources/claude-code/source.ts:542` — `deliverPrompt` versus `recordPrompt`
  is already the distinction between "reaches a running agent" and "filed in a
  log".
- `src/renderer/domain/model.ts:507,693` — `Session.source` / `Project.source`
  already exist.
- `src/main/sources/fixture-source.ts:23` — a second source has already been
  written once, for tests. It is the precedent.

**The wiring does not fit. Main holds exactly one source**, in three places:
`src/main/index.ts:112`, `src/main/ipc/handlers.ts:160`,
`src/main/remote/server.ts:90`. That is the blocker, and Stage 0 is nothing but
turning that one into a list.

The rest is smaller and named:

| site | what it assumes | what it needs |
| --- | --- | --- |
| `src/shared/providers.ts` | `ProviderId` is a closed union of one | a second member |
| `provider-marks.tsx:75` | one glyph | a Codex glyph |
| `panels/model-command.ts:74` | the model control is `disabled` unless `terminal !== false && vamControlled === true`, and switching types `/model <x>` into a pane | Codex carries its model in `threads.model`; the control must read it from the source, not the screen |
| `DetailPanel.tsx:3939,5040`, `remove-project.ts:38` | `vamControlled` means both "vam started it" **and** "vam can reach it" | those are two different facts, and Codex is the case that separates them — vam did not start the thread and can still deliver to it |
| `main/terminal/*`, `session-pane.ts:115` | `targetSession` pairs a row to a tmux pane | nothing: it is correctly unreachable behind `terminal: false` |
| the PRs tab | a git branch | nothing: `threads.git_branch` supplies it |

`vamControlled` is the one that will bite. It is a single boolean standing for
two claims, and every Codex row would over-refuse until it is split.

## What to build

### Stage 0 — main holds a list of sources

No behaviour change, no new source. Just the three sites above. Ship it alone,
green, so that the Codex work is not also an architecture change.

### Stage 1 — a Codex source, read plus deliver

- **rows** from `state_5.sqlite` (`threads`), keyed by the bare thread UUID,
  project decided by `cwd`;
- **answers** from the rollout JSONL tail — bounded read, backwards scan,
  unparseable line skipped;
- **delivery** by `codex queue --thread <uuid> --message <text>`, which is
  `deliverPrompt: true` and is **proven** (above);
- **`terminal: false`**, with a decline that says why in the operator's words:
  vam did not start this session and has no pane into it, and the prompt is
  queued rather than typed;
- **no `/model` picker**, with the model *shown* from `threads.model` and a
  decline naming why it cannot be changed from here.

### Stage 2 — vam can start a Codex session

A `'codex'` row in `PROVIDERS` whose command is `codex`. Bare `codex` is the
TUI, so `tmux … codex` works exactly as `tmux … claude` does, and such a
session gets `terminal: true` and `vamControlled: true` back. This is the stage
that makes the two sources look alike again.

### Stage 3 — liveness

Only after the experiment in §Experiments says what liveness can be read from.

### Stage 4 — `app-server --listen`, when it stops being experimental.

**Not Cursor.**

## The experiments that must run before Stage 1 is built

1. **Does the queue reach a session that is NOT on screen?** Proven above for a
   session with a live TUI in a tmux pane. Not proven for a thread whose Codex
   has exited — does the message sit until the thread is resumed, and is that
   what vam wants to promise? A prompt that is silently delivered to nobody is
   the one failure this source must not have, because `deliverPrompt: true` is
   a claim the composer makes to the operator.
2. **Can liveness be read at all?** Probe `thread-writer-locks/<uuid>.lock` with
   a non-blocking `flock` against a Codex that is running and one that is not.
   If it cannot be read, Stage 1 draws every Codex row without a live mark and
   says so, rather than guessing.

## What this costs

- **The first source that delivers without a pane.** No Terminal tab, no
  keystroke strip, no `/model` picker for those rows. Every one of those is
  already withdrawable through `declines`, so the UI has the shape — but the
  operator will meet a session that looks different from the ones they know,
  and the declines are what explain it. They are not polish here; they are the
  feature.
- **"Sent" changes meaning.** For Claude Code, vam types into a pane and can say
  the keys went in. For Codex it enqueues, and what vam can honestly claim is
  *queued* — the same discipline `model-command.ts` already keeps about not
  claiming a model changed.
- **Latency is unmeasured.** The drain in the probe was observed within 30s; it
  was not timed, and a poll interval is not a guarantee.
- **The schema is private and version-suffixed.** `state_5`, `queue_1`,
  `thread_history_1`. A Codex update can rename any of them. Every read needs a
  version decline — "this Codex keeps its sessions somewhere vam does not know"
  — and not a crash, and not an empty list, which would read as "no sessions".

## How it will be measured

- A unit reader over **real** rows and **real** rollout lines taken from this
  machine, including a thread with no `git_branch`, one whose `cwd` no longer
  exists, and a rollout whose last line is truncated. This repo has been bitten
  by a write-time schema that 7% of the real corpus failed.
- A test that opens `state_5.sqlite` **with the WAL checkpointed away**, which
  is the case that breaks `mode=ro`.
- A live test in the shape of `tmux-history-live.test.ts`: a real `codex` on a
  private socket, a real `codex queue`, and the message observed arriving.
  Nothing in it may write to the operator's own `~/.codex` beyond the throwaway
  thread it creates and deletes.
- A browser guard for the surface: a Codex row draws, its Terminal tab is
  absent, its model is shown and not offered as a picker, and each absence
  carries the decline that explains it.
- Every assertion falsified before it is trusted.

## Disclosure

The probe that produced §What was measured created one throwaway Codex thread
in a scratch directory and spent two small turns on the operator's account. The
thread was deleted (`codex delete --force`) and the store is back to the 789
rows it had before. An update prompt (0.153.2 → 0.155.1) and a hook-trust
prompt both appeared and were both declined, because neither was the probe's to
accept. `~/.codex/auth.json` was never opened.
