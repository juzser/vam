# Reopening a session that has ended

Status: **partly built, 2026-09-21**. Written 2026-09-18 against vam at
`32dcb768`, Claude Code 2.1.276. Every claim below that is a fact about this
machine was measured; the one that was not is marked as the experiment that
has to run first.

> ## What was built, and the one thing this spec got wrong
>
> **§3 Reopen is built, for both sources.** `resumeSession` is a capability of
> its own on the port — not part of `createSession`, because Codex is the case
> that separates them: vam cannot *start* a Codex thread (that is Stage 2 of
> `a-second-source.md`) and it can *return* to one. `codex resume <uuid>` and
> `claude --resume <sessionId>`, both through the existing `createVamSession`
> spawn, both tagged, and no fork on either.
>
> Its rules held, and one of them turned out to be **weaker than it needed to
> be**. "Never offered for a session that is live" is not enough: a row is not
> a session id, and `agents.ts` documents the measured state where one session
> id is listed twice with two pids. A *finished* row can sit beside a *running*
> one on the same conversation, and reopening the finished row would still put
> a second process on it. The enforced rule is therefore that nothing is live
> on that **session id**. `claude-code-resume.test.ts` is mostly about that
> difference.
>
> **§2 went the other way, and the reason is mechanical rather than a matter of
> taste.** This spec proposed the command palette and called it "the cheaper
> answer and probably the right one". It is not, *here*, because `Canvas.tsx`
> hands `CommandPalette` the entries array the sidebar filter has **already
> narrowed** — so a third palette group for ended sessions would be empty in
> exactly the state it exists to serve, unless it bypassed the filter, and two
> controls disagreeing about one set is worse than either alone.
>
> What was built instead is the operator's own proposal: a third row in the
> sidebar's filter popover, **Hide ended sessions**, on by default and carrying
> the count of what it holds back. Because the palette is downstream of that
> one array, the toggle serves both surfaces from one line of filtering — the
> palette shows ended sessions exactly when the sidebar does. That is this
> spec's "one line of that component and no new surface at all", arrived at
> from the other end.
>
> **§1 is NOT built.** There is still no index of ended Claude Code sessions —
> a transcript whose process is gone has no row, so there is nothing to reopen
> from. What Claude Code *can* reopen today is a row that is still in the agent
> list and has finished: a background agent that ended. Codex has no such gap,
> because `threads` is itself the index this section asks for.
>
> **§The experiment (account switching) has not been run.** §4 remains
> unproven, and nothing was built on it.

## The operator's question

> Is vam's resume and context-passing mechanism complete? When vam is closed or
> updated and reopened, sessions must resume. And is there a way to preserve
> context when a session is reopened, or when switching from one Claude account
> to another?

## What already works, and why it needs nothing

**Closing vam, updating it and reopening does not lose a session, and there is
nothing to "resume" because nothing was ever suspended.**

- vam's record of which sessions are its own lives **on the tmux session**, as
  the user options `@vam-project` and `@vam-pid`, read back by
  `listSessionsArgv()` with `list-sessions -F`. That is tmux server state, not
  vam's memory, so it survives the app exiting.
- `killSessionArgv` has exactly one caller in the whole tree:
  `sources/claude-code/stop.ts`, the explicit Close action. Neither
  `app.on('before-quit')` nor `window-all-closed` reaches it.

So the agent keeps running in tmux while vam is not, and a fresh vam
re-discovers it by tag. What does end a session is anything that kills the tmux
**server** — a reboot, `tmux kill-server` — or the agent process exiting on its
own.

## The gap

**A row is a process.** The session list is built from the CLI's own live
process list (`agents.ts`, backed by `~/.claude/sessions/<pid>.json`, which
exists only while the process does). When the process is gone the row is gone,
and vam has no history: there is no surface on which a finished session could
be seen, let alone reopened.

Meanwhile the conversation is still on disk. Measured:

- transcripts live at `~/.claude/projects/<slug>/<sessionId>.jsonl`;
- **vam already indexes them.** `indexTranscripts(root)` in `source.ts` walks
  every slug directory and returns `Map<sessionId, path>`;
- `<slug>` is a lossy flattening of the working directory — both `/` and `.`
  become `-`, so `/Users/ser/p/black-smith/.claude/worktrees/x` and a directory
  literally named `black-smith--claude-worktrees-x` produce the same string.
  `source.ts` already records the rule that follows: **the slug is never
  parsed.** This spec keeps that rule.
- the transcript's own lines carry `cwd`, `gitBranch`, `sessionId`,
  `timestamp`, and the head carries `customTitle` / `agentName`. So everything
  a row needs is inside the file, and the slug never has to be reversed.

And vam starts sessions with `claude` and nothing else —
`PROVIDERS = [{ id: 'claude-code', command: ['claude'] }]` — so it has no way
to ask for an existing conversation back.

The CLI has the parts (2.1.276, from `--help`):

| flag | what it does |
| --- | --- |
| `-r, --resume [id]` | resume by session id, or open a picker |
| `-c, --continue` | continue the most recent conversation in this directory |
| `--fork-session` | resume into a NEW session id instead of reusing the original |

`--resume` on a session that is already running "starts a copy and says so".

## What to build

### 1. An index of ended sessions, per project

A main-process reader that, for a project vam already knows, answers: which
transcripts exist for this working directory, and which of them have no live
process.

- Built on the existing `indexTranscripts`, not beside it.
- The project is decided by the `cwd` **inside** the transcript, never by
  reversing the slug.
- "Ended" = a transcript whose `sessionId` is not in the live agent list. That
  is the same fact the list already computes; it is not a new source of truth.
- Cheap by construction: the head of a file for the title, the file's mtime for
  when, `readdir` for the rest. No transcript is read whole. `source.ts`'s own
  note about a 128 KiB tail window is the precedent for what reading one costs.

### 2. A place to see them

Ended sessions must not enter the live list. The whole premise of the sidebar
is that a row is something that may need you, and a finished conversation never
does.

Proposed: **per project, behind its own control** — the project heading gains a
count and a way to open a panel listing that project's ended sessions, newest
first, with title, branch, when it ended and how many turns. Closed by default.

Open question for review: whether this belongs in the command palette instead
(`Mod-k` already groups "needs you" and "all sessions"; a third group, "ended",
is one line of that component and no new surface at all). **The palette is the
cheaper answer and probably the right one.**

### 3. Reopen

One action: start a new vam-tagged tmux session in the transcript's own `cwd`,
running `claude --resume <sessionId>`, and tag it exactly as
`createSessionInProject` does today so the ordinary discovery path picks it up
on the next poll.

Rules this must hold:

- **Never offered for a session that is live.** `--resume` on a running session
  starts a *copy*, and two processes on one session id is a hazard this repo has
  already been bitten by: a row is keyed `<sessionId>#<pid>`, and
  `agents.ts`'s own comment warns that keying by session id alone collapses a
  row — which once made Close kill the wrong tmux session.
- **The cwd comes from the transcript**, and the reopen is refused if that
  directory no longer exists, naming the path. Same shape as
  `whyNotARepository`'s refusal today.
- **Reuse `spawnSessionIn`** rather than opening a second spawn path. The
  provider's command becomes `[...provider.command, '--resume', sessionId]`;
  `newSessionArgv` already refuses a command whose first word looks like an
  option, and `sessionId` is a UUID, so nothing new can reach tmux as a flag.
- **No `--fork-session`.** Reopening means continuing the same conversation;
  forking would silently create a second id for the same history, which is the
  collision above by another road. If forking is wanted later it is a separate,
  named action.

### 4. What it does for the account question

Nothing extra, if the experiment below says so. Transcripts are keyed by
directory and session id and live on this machine; a `/login` to another account
does not move or hide them, so reopening after a switch replays the same
conversation. Usage and limits are per account and do not carry over — that is
the only thing that changes.

## The experiment that must run before this is built

The transcript lines carry **`ownerAccountUuid`** and
`ownerOrganizationUuid`. So the claim "context survives an account switch" is
not yet proven: the CLI may refuse to resume a transcript owned by a different
account, or may resume it and rewrite the owner.

**Run it, do not assume it.** In a throwaway directory on a private tmux
socket: start `claude`, say something, exit; `/login` to the second account;
`claude --resume <id>` in the same directory; record whether it resumes, and
what `ownerAccountUuid` says on the lines written afterwards. If it refuses,
this spec's §4 becomes "vam says plainly that the conversation belongs to
another account", and the refusal's exact words go in the code.

## What this is not

- Not a history browser. One list per project, newest first, and a way back in.
- Not a re-render of an ended conversation inside vam. vam can already draw a
  transcript, but a reopened session is a *live* session and is drawn by the
  ordinary path; a read-only view of a dead one is a different feature.
- Not a change to how prompts are delivered. Prompts still go into the pane.
  `--resume` here starts a session; it is never used to send a message, which is
  the rule `deliver.ts`'s retirement note and `reply.ts` both hold.

## How it will be measured

- A unit reader over real transcript heads taken from this machine, not
  invented strings — including one with no `customTitle`, one whose `cwd` no
  longer exists, and one whose head is truncated.
- A **live-tmux** test in the shape of `tmux-history-live.test.ts`: vam's own
  argv, a real tmux over a private socket, a real `claude --resume`, and the
  session found afterwards by vam's own `listVamSessions`.
- A browser guard for the surface: the ended list draws, a live session is
  **not** in it, and the reopen control is absent for one that is.
- Every assertion falsified before it is trusted.
