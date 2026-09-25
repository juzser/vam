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

  **Answered 2026-09-21: yes.** See §Stage 3 below. The lock files being
  stale was the right observation and the wrong conclusion — the *file* is
  not the signal, the *held* lock is.
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

### Stage 3 — liveness — **built, 2026-09-21**

The experiment ran. codex-cli 0.153.2, macOS 25.6.0, Node 22.23.1, driving one
throwaway thread on a private `-L` tmux socket in a scratch directory:

- a live Codex holds an **exclusive `flock`** on
  `~/.codex/thread-writer-locks/<uuid>.lock`. A non-blocking open that asks for
  a lock fails with errno 35, `EWOULDBLOCK`.
- measured for **both** holders: the ChatGPT desktop app's `codex app-server`,
  and a `codex` **CLI** TUI started by hand. They lock identically, so one
  probe answers for both.
- the lock is taken **before** the thread has a row in `threads`. A just
  started session is live and invisible to the store.
- a clean `/quit` **deletes** the lock file. `kill -9` **leaves it behind**,
  and it then probes free. So the presence of a lock file is not the signal;
  the held lock is — which is exactly what made the earlier sighting of stale
  files look like a dead end.
- `codex resume <uuid>` replayed the thread's turns and took the **same**
  uuid's lock, so a reopened thread is the same thread.

Thread count before the probe: 789. After `codex delete --force`: 789.

**Two traps, both of which produce a confident wrong answer**, recorded in
`src/main/sources/codex/liveness.ts`:

1. `fs.constants.O_SHLOCK` and `O_EXLOCK` are **`undefined`** on Node 22 /
   darwin, so `O_RDONLY | O_NONBLOCK | constants.O_SHLOCK` is `4` — an
   ordinary read that always succeeds. A probe built that way reports "nothing
   is live" on a machine with a live Codex on it. It was written that way here
   first and only a controlled `flock` holder falsified it.
2. macOS `lsof` shows the lock file as merely **open** (`22u`), with no lock
   character, for a held lock and an unheld one alike. It cannot tell them
   apart and is not an alternative.

**What Stage 3 changed.** The seven-day recency window is gone: it was never a
window, it was a stand-in for liveness. Measured against the operator's own
store it drew 12 rows of which **1** was live, under **8** project headings,
with the live row sorted **third** (`recency_at_ms DESC` is the only order the
store offers), **6 of 12** sharing a title and **3 of 12** naming a directory
that no longer exists. A row is drawn now because a Codex holds its lock; the
ended ones are kept behind the sidebar's own filter toggle, off by default.

**Status.** `idle` for a live thread is now `SessionStatus`'s own definition
("alive, ... simply between turns") rather than Stage 1's least-wrong neutral,
and `done` for a thread with no writer is that union's "a job that ENDED".
What the lock does **not** say is whether a live thread is mid-turn or waiting
on the operator, so `running` and `waiting` are still not guessed.

**Where the probe cannot run** — CI is `ubuntu-latest`, and Linux has no
`O_SHLOCK` — every row is `unknown`, which is a first-class answer and never
`ended`. There the source draws the list it drew before Stage 3 and says so in
its label.

### Stage 4 — `app-server --listen`, when it stops being experimental.

**Not Cursor.**

## The experiments that must run before Stage 1 is built

1. **Does the queue reach a session that is NOT on screen?** Proven above for a
   session with a live TUI in a tmux pane. Not proven for a thread whose Codex
   has exited — does the message sit until the thread is resumed, and is that
   what vam wants to promise? A prompt that is silently delivered to nobody is
   the one failure this source must not have, because `deliverPrompt: true` is
   a claim the composer makes to the operator.
2. **Can liveness be read at all?** ~~Probe `thread-writer-locks/<uuid>.lock`
   with a non-blocking `flock` against a Codex that is running and one that is
   not.~~ **Run, 2026-09-21. Yes** — see §Stage 3 for what it measured, and
   for the two traps that make a probe answer confidently and wrongly.

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
