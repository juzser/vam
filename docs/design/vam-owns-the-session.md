# vam owns the session

> The operator, once the sidebar still had more rows than live work in it:
> "Otherwise, it should only show the sessions that vam creates. The mechanism
> will change almost completely. When you trigger a new session, the Response
> view needs a provider picker and a Start session button — or the user can
> switch to the terminal view and start a session by typing `claude`, `codex`,
> and so on."

This is the design for that. It is written after measuring what vam already
does, because most of the ownership machinery turns out to exist: the change is
which way it points.

## The change, in one sentence

**Today the sources list and tmux pairs. After this, tmux lists and the sources
enrich.**

Today `load()` asks each source for every session it can see — Claude Code's
live process list, every unarchived Codex thread — and then, for each row, asks
tmux "is one of my panes running this?". The pairing is an ornament on a row
that already exists.

After this, the spine of the list is `listVamSessions()`: the tmux sessions
whose name carries vam's own prefix. Each one is then enriched by whichever
source can read what is running inside it. A session vam did not start is not a
row that failed a test; it is not on the spine at all.

### Why the inversion is forced, and not a preference

The smaller change — keep the current spine and filter it by `vamControlled` —
satisfies the first sentence of the ask and makes the second one impossible.

The operator wants to open a new session and *then* choose a provider, or go to
the Terminal view and type the command by hand. Both mean a period where the
pane exists and no agent is running in it. Neither source can report such a
session: Claude Code's rows come from its live process list and Codex's from
its thread store, and an empty shell appears in neither. A filter over source
rows can only ever hide rows; it cannot invent the one row this feature is
about.

So the row has to come from the thing that actually exists at that moment,
which is the tmux session. Once that is true, "only sessions vam created" is
not a filter at all — `listVamSessions` has been filtered by prefix since the
day it was written.

## What already exists (measured, not assumed)

- **The prefix.** `VAM_SESSION_PREFIX = 'vam-'`; `vamSessionName(label)` yields
  `vam-<slug≤24>-<6 chars base36>`; `isVamSession` is a bare `startsWith`.
  (`sources/tmux/argv.ts`)
- **Two user options, written once at creation.** `@vam-project`, the cwd
  digest, and `@vam-pid`, the pane pid tmux printed from
  `new-session -P -F '#{pane_pid}'`. There is no `show-option` anywhere: both
  come back in one shot from `list-sessions -F`. (`argv.ts`, `spawn.ts`)
- **Three pairing tiers**, shared by `paneForRow` and `targetSession`: the pane
  Claude Code published in `~/.claude/sessions/<pid>.json`; an `@vam-pid`
  match; and, failing both, a single `@vam-project`-tagged session for a
  project with a single live row in it, minus any pane another row has already
  claimed.
- **`vamControlled` already answers the question for Claude Code.** It is
  `paneForRow(...) !== null`, computed per row on every load.
- **Ownership already survives vam exiting**, because it is tmux server state
  rather than vam's memory — the argument `reopening-a-session.md` makes, and
  this design keeps.
- **`CAN_CHOOSE_PROVIDER = PROVIDERS.length > 1`.** The settings picker and the
  composer picker were not deleted when the table had one row, they were made
  conditional on this. A second row brings both back with no edit at either
  call site, and two tests already mock the module to prove it.

## What does not exist (measured; this is the part to build)

- **No native session id is ever recorded on the tmux session.** The only
  `new-session` caller writes exactly two options and nothing else. The resume
  path is the telling one: it holds the session id in its hand
  (`claudeResumeCommand(row.sessionId)`) and still records only the project
  digest.
- **No persistent vam store.** The two JSON files under `userData` are
  `remote-devices.json` and `remote-writes.json`; renderer prefs are
  `localStorage`, unreachable from main. There is nowhere to keep an ownership
  record — and, per the section below, there does not need to be.
- **Codex reports `vamControlled: false` unconditionally**, including for a
  thread vam itself resumed into a `vam-` tmux session. So Codex rows are
  invisible to any ownership filter today.
- **Codex has no creation path.** `createSession: false`, with the refusal
  naming this stage. `resumeSession: true` already calls `createVamSession`.
- **There is no state for a pane with no agent in it.** `SessionStatus` is
  `running | waiting | idle | done | failed`, and none of those is "nothing has
  been started here yet".

## The design

### 1. Ownership stays on the tmux session

No new store. The record of what vam owns is the tmux session itself, because
tmux server state outlives the app and a file would have to be reconciled with
it on every load — two records of one fact, which is one record and one bug.

What changes is that the record gains a third option when vam learns the native
identity:

- **`@vam-session`** — the Claude Code session id or the Codex thread uuid of
  whatever vam started in this pane. Absent until known.

### 2. Guess once, then write it down

vam cannot know the native id at spawn time: `claude` mints its session id
after tmux returns, and `codex` mints its thread uuid the same way. That is why
`@vam-pid` exists at all.

So the binding is discovered, and the rule is that it is discovered **once**:

1. On **resume**, the id is already known — write `@vam-session` immediately,
   for free, in the same command run that writes the other two.
2. On a **fresh start**, watch the source's store for an entry whose cwd
   matches this pane's, first seen after this pane was created, **minus every
   id another vam pane has already claimed**. On a unique match, write
   `@vam-session` and never guess again.
3. A guess that is not unique writes nothing and leaves the pane bound by
   project and pid alone, which is where it is today. Ambiguity is a state, not
   an excuse to pick.

Step 2's subtraction is the load-bearing clause. Two panes opened in one
directory within seconds otherwise steal each other's thread, and the failure
is silent and permanent — a pane wired to somebody else's conversation. The
existing `claimedPanes` set is the same idea pointing the other way and is the
model to copy.

### 3. A pane with no agent is a session

`SessionStatus` gains one member for the state the current five cannot express.
A row in it:

- has a Terminal view that works, because the pane is real;
- has a Response view whose empty state is the provider picker and the Start
  session button;
- carries no transcript, because there is nothing to read yet.

This is the row the operator's second sentence is about, and it exists the
instant the pane does.

**DECIDED: a pane whose agent exited KEEPS ITS ROW**, until the operator closes
the session. This was the first Open question and the operator has answered it.
The row does not disappear the way a Claude Code row does today, because the
thing the row stands for has not gone: the pane is still vam's, the Terminal
view still works and still shows what the agent left on screen, and typing
`claude` into that pane starts the next conversation in the same place — same
directory, same row, no second session created to get it. A row that vanished
on exit would take a live pane off the list and leave the operator to find it
in tmux.

### 4. The toggle is what #431 already built

Sessions vam did not start are not deleted from vam's knowledge. They move
behind the filter toggle that shipped in #431, default off. That is the honest
place for them, because of a constraint written into `create-session.ts` and
worth repeating here:

> The session vam creates is vam's. The operator's existing sessions are
> children of their own login shell and cannot be adopted — no process may take
> over another's controlling TTY.

vam can **read** a session it did not start. For a TTY-bound provider —
Claude Code, where the only way in is the controlling terminal a login shell
already owns — it can never type into one either: a toggle that reveals such
rows for reading is the whole of what vam can offer, and an "adopt" button
would be a control that cannot act.

**Codex is the exception, and it is not a loophole in this rule so much as a
different transport.** `codex/source.ts`'s `recordPrompt` delivers through
`codex queue --thread <uuid> --message <text>` (`queueMessage`, designed in
#424/#429) — a message queued at the CLI's own store rather than typed at a
terminal, so it reaches a thread regardless of who started the process
running it. `closeSession` stays `false` there for the ORIGINAL reason
(vam did not start the process, so there is nothing of vam's to stop) — that
half of the rule is untouched. What changes is only the "never type into
one" half, and only for this one provider's one write route.

### 5. Closing, which is three things and not one

The operator asked how closing works under this model. Three different acts are
called "close" today, and the mistake available here is one button that means
all three.

**Close the tab** closes the SESSION, not merely the view. This is the
opposite of what this section said until #412, the operator's own bug
report: "the close button on the tab doesn't seem to work." It did not,
because a tab's `×` only ever refused (A11.1's liveness guard, true for
every tab that could be clicked, so the refusal was the whole of its
behaviour) — never the harmless view-only close this paragraph used to
describe. A22 routed it onto the same `closeSession` the sidebar row's `×`,
the `x` chord and the tab's context menu already used, which is what makes
"close the tab" and "close the session" the same act today: there is no
tab-only close left to distinguish it from.

**End the agent, keep the pane** is new, and the model gives it away: the agent
exits, the pane survives, and the row falls back to the state of §3 with the
provider picker on it. It is the common case — finished with this conversation,
same directory, next one — and today it can only be had by closing the session
and creating another.

That is also what an agent exiting on its own does, decided in §3: the row
stays. This act and that accident land in the same place deliberately — the
operator should not have to remember which of the two produced the row in front
of them, and "the pane is vam's until vam is told to close it" is the whole
rule. Only **Close the session** below takes a row off the live list.

**Close the session** kills the vam tmux session. The row leaves the live list.

**None of the three deletes the conversation**, and that is what ties this
design to the one before it. The transcript and the thread are on disk and are
not touched; a closed session moves behind the history toggle, and #431's
reopen brings it back as a new pane vam owns. Close and Reopen are inverses,
and the toggle is where a closed session waits. `stop.ts` already quotes the
CLI making the same promise: "Stop a background session. Its conversation is
kept; resume it later."

**This gets smaller, not bigger.** `stop.ts` today carries four routes:
`claude stop` for a background session, the tmux route for a pane it can prove
is its own, a REFUSAL for an interactive row whose ownership it cannot prove,
and a confirmed `force` that signals the raw pid — the last because, in its own
words, "the nearest thing to it is closing their own window out from under
them". Once every row in the default list is provably vam's, the refusal and
the force stop being paths the operator meets. And the toggle's rows get **no
Close control at all**: vam can read a session it did not start and can never
type into one, so a close button there is a control that cannot do what it
offers.

**Gentle before forceful — now measured, not implemented.** Killing the tmux
session cuts the agent off at whatever it was doing, which may be a partial
write into an append-only transcript, and any such truncation would be
permanent — nothing rewrites a line in a file that is only ever appended to,
and every later reader inherits it. This section used to say the risk was
"NOT measured"; it has been now, without ever sending a paid prompt to a real
`claude` or `codex` process, and the answer is **kill truncates: only when a
kill lands while a write is literally in flight for the line the session is
currently streaming — no truncation was found anywhere it could actually be
looked for.**

- **The real corpus, scanned read-only:** 0 of 1,690 `~/.claude/projects/**/*.jsonl`
  files on this machine end in anything but a complete, valid JSON line with
  its trailing newline. 0 of 882 `~/.codex/sessions/**` rollout files do
  either. vam's own long-running usage-stats tracker (`stats-cache.json`)
  corroborates it from a different angle: across the 2,556 transcript files it
  has ever read, `malformedLines` — incremented per COMPLETE line that fails
  to parse — has never once fired. That tracker is not itself a test of THIS
  question, though: `line-stream.ts`'s own header states that a trailing line
  with no newline is "never consumed" by design, on the same assumption every
  other reader in this tree already makes about a live, append-only file — so
  it structurally cannot see the one shape this section is about.
- **The write itself, read out of the installed Claude Code CLI (v2.1.283,
  a compiled bundle, `strings`- and offset-readable):** each transcript line
  is appended as ONE buffered write — `` s = S(n) + '\n' `` built before a
  single `appendFileSync`/`open(O_APPEND) + write` call, never the JSON body
  and its trailing newline as two separate writes. A kill can therefore only
  ever land BETWEEN two complete lines (the file ends cleanly, exactly the
  1,690/882 above) or DURING the one write in flight (that one line loses
  bytes and/or its newline) — never split a line's body from its own
  newline as two independent operations.
- **The idle-session experiment, run on a private `tmux -L` socket, no prompt
  ever typed:** starting `claude` and leaving it at its own composer with
  zero messages sent creates NO transcript file at all — Claude Code creates
  the file lazily, on the first turn. Killing that session (`kill-session`)
  confirmed it: no file appeared before the kill, and none appeared after it
  either. The specific case "kill a session nobody has typed anything into"
  therefore has no file to truncate, on this version, full stop — which is
  also why this experiment could not exercise the one in-flight-write race
  the two points above bound rather than rule out: doing that for real
  requires a streaming turn, which requires the paid prompt this measurement
  was not allowed to send.

**Not implemented in this PR.** The narrow, real risk that remains — a kill
landing mid-write on the line currently streaming — is what a graceful exit
(Ctrl-C, then `/exit`, then a timeout, then kill) would close off entirely.
Proposed as a follow-up rather than built here, so the operator can decide
whether the cost (every close waits out the timeout on a session that is NOT
mid-write, which is the common case above) is worth closing a race this
measurement bounds but cannot make theoretically impossible.

**Confirm only when the agent is mid-turn, on every device — shipped.** The
operator's own words: "ask for confirmation before closing a session ONLY
while the agent is running, on every device." `closeSession` in `Canvas.tsx`
is the one place every close route (the tab's `×`, the sidebar row's `×`, the
`x` chord, the tab's context menu, and the phone app bar's `×` — all five,
desktop and phone alike) already called before this existed, so gating THERE
rather than in each caller is what makes the rule impossible to route around.
`running` is the only status that asks: `waiting` has already finished its
turn and put the ball back with the operator (this file's own definition of
the status, in `domain/model.ts`) — nothing in flight is lost by closing it,
so it closes exactly like idle/done/terminal, with no question, on every
device including the phone, which used to ask unconditionally and no longer
does. The dialog itself (`ConfirmCloseSession`, shared by both devices now)
is keyboard-friendly: Enter confirms, Escape cancels, and focus starts on
Cancel so a reflex Return is never the thing to fear.

## Traps this design must not walk into

Each of these has already cost something once.

- **An unreadable tmux listing must not empty the sidebar.** `listVamSessions`
  answers `unavailable` with `listing-unreadable` when a non-UTF-8 `LC_CTYPE`
  makes tmux rewrite its separators — which is the state of every GUI-launched
  vam before `env/utf8-ctype.ts` repairs it. Once the spine *is* that listing,
  a failure there is an empty app rather than a degraded one. The fallback is
  to show everything, with the reason on screen; it is never to show nothing.
- **Absent is not false.** `vamControlled` is omitted, not set to `false`, when
  tmux is unavailable. A filter reading absence as "not vam's" hides every row
  on a machine with no tmux server.
- **An unset tmux option reads back as `''`**, which is why an empty project id
  is refused everywhere rather than matched. `@vam-session` inherits that rule.
- **`set-option` rejects the `=` exact-target prefix** every other tmux verb
  requires — measured: `no such session: =vam-x`, exit 1. The new write obeys
  the same exception.
- **A Claude Code row is keyed `<sessionId>#<pid>`** because one session id can
  have two live processes, and keying by the id alone collapses two rows into
  one — the bug that once made Close kill the wrong tmux session. `@vam-session`
  holds the bare session id and is therefore a pairing *hint*, never a row key.
- **Codex's store cannot be opened `mode=ro` once the WAL is checkpointed
  away** (`unable to open database file (14)`); `immutable=1` gated on an empty
  WAL sidecar is the complement, and `connectionPlan` already does this.
- **A new-thread watch must not read a recency as a start time.** A Codex row
  carries `recency_at_ms`, which moves every time the thread is touched. "First
  seen after this pane was created" is a fact about vam's own observation, not
  a field in the store.

## Stages

### Stage 1 — the list inverts

- `listVamSessions()` becomes the spine; sources enrich by pairing.
- The new `SessionStatus` member, and a row for a vam pane with no agent.
- Codex rows get a real `vamControlled`, and the resume path writes
  `@vam-session` while it has the id.
- Sessions found outside vam move behind the existing filter toggle, default
  off.
- Tmux unavailable degrades to "show everything, say why", never to empty.

Done when: a sidebar with one live session and eleven finished Codex threads
shows one row; the toggle shows twelve; killing tmux shows twelve and a reason;
and a `tmux new-session -s vam-x` with a bare shell in it appears as a row.

### Stage 2 — starting a session

- `PROVIDERS` gains a `codex` row, which flips `CAN_CHOOSE_PROVIDER` and
  returns both withdrawn pickers untouched.
- A new session spawns a **shell**, not the provider's command, so the Terminal
  view is usable from the first frame and typing `claude` by hand is a
  first-class path rather than a workaround.
- The Response view's empty state carries the provider picker and Start
  session; Start types the provider's command into the pane it already owns.
- Fresh-start discovery writes `@vam-session` per §2.
- Codex's `createSession` becomes `true`.

Done when: new session opens a usable shell; Start session in the Response view
runs the chosen provider in it; typing `codex` by hand in the Terminal view
produces the same bound row as the button does; and two sessions started in one
directory five seconds apart bind to their own threads and not to each other's.

## What this makes smaller

- **Codex liveness by writer-lock** (`liveness.ts`) stops being how vam knows
  its own sessions are alive — it knows, because it owns the pane. The probe
  stays for the toggle's view, where the sessions are somebody else's and the
  lock is the only evidence there is.
- **`ENDED_ROW_LIMIT`**, the cap of twelve finished Codex threads, is a cap on
  the toggle's list rather than on the default one.
- **`Session.ended`** keeps its single producer and its meaning; for an owned
  session, the pane's absence is the stronger signal and arrives first.

## Open

- Whether `@vam-session` should also be written for Claude Code fresh starts.
  Its published pane file already binds `sessionId` to a tmux target, so the
  write buys nothing there today; it is one line if a future Claude Code stops
  publishing.
