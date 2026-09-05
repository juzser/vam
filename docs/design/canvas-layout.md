# VAM — canvas layout & interaction spec

VAM = **VIM Agent Management**. This version was locked down from the
2026-08-27 interview session.
Constraint number one: **keyboard-driven control, mouse kept to a minimum.**

## 1. Where vam sits

A separate app, **not a fork of orca**. Orca (MIT, 19,146 files, `packages: []`
— not a modularized monorepo) already has a second client, `mobile/`, that
talks to the backend over RPC; vam is a third client on that same path.

```
vam (web · Vite + React + ReactFlow)
 ├─ adapter black-smith → http://127.0.0.1:4680/api/*   (already exists, both read and write)
 └─ adapter orca        → http://127.0.0.1:6768 RPC     (orchestration.* · terminal.*)
```

Web first, Electron later ⇒ **the data-access layer must be separated from
components from the very first commit**, or wrapping it in Electron later will
mean rewriting the UI.

### 1.1 Stack deviation — recorded with justification (required)

black-smith's `docs/standards/stack.md` mandates **Vue 3 + Vite**,
**`@vue-flow/core`**, and **HDS**, and allows deviation *only with a written
justification*. Vam deviates on two points. Operator decision, 2026-08-27:

| point | standard | vam | reason |
|---|---|---|---|
| framework | Vue 3 | **React 19** | vam's UI references orca directly, and orca is a React app. Same framework means patterns carry straight over; a different framework means everything referenced has to be translated by hand. |
| canvas | `@vue-flow/core` | **ReactFlow** | A consequence of the row above. Same rendering paradigm, just a different port. Orca **does not** use any canvas library — vam brings this part on its own, so there is nothing to inherit from orca here. |
| styling | HDS + Tailwind v4 | **Tailwind v4 + shadcn/radix, no HDS** | Same reason: taken straight from orca. |

What is lost, stated plainly so nobody later mistakes it for an oversight: the
HDS tokens and the 57 `.vue` files in `black-smith/ui/src` **cannot** be
reused, including the CSS already written for the `.vue-flow__` class. Vam is
the first repo in the family to deviate from the standard stack.

What is gained: orca (MIT) gives vam a real, running reference for exactly the
hardest parts — see §4.1.

### 1.2 Stack, as locked

> **Fixed 2026-08-28.** This section used to be an INTENDED LIST copied from
> orca's `package.json` on 2026-08-27, but written as though it had already
> been installed. Four items were never installed — `shadcn`, `radix-ui`,
> `class-variance-authority`, `sonner` — and one real item went unmentioned. A
> different session read this section, trusted it, and nearly wrote "React +
> ReactFlow + shadcn/radix" into black-smith's registry as vam's official
> justification. Below is what `package.json` actually declares, checked
> against it on 2026-08-28.

Actually installed:

- **React 19 + Vite** · **Tailwind CSS v4** — no HDS, its own tokens
  (`src/styles.css`, read from the ADE mockup; see `docs/ade-redesign.md`)
- **`@xyflow/react`** for the canvas — the only part with no counterpart in orca
- **`cmdk`** for the command palette (`Ctrl-K` in §4) — orca uses this exact
  library in `QuickOpen.tsx` and `WorktreeJumpPalette.tsx`
- **`zustand`** for state · **`lucide-react`** for icons
- **`clsx`** + **`tailwind-merge`** for classes
- **`emoji-picker-react`** for the icon grid (§4, lazy chunk 307kB)
- **Vitest** for unit tests (kept as is, matches the standard)

Taken from orca's lead but **not** taken: `shadcn`, `radix-ui`,
`class-variance-authority`, `sonner`. vam does not yet need any pre-built
component layer — every component is hand-written on its own tokens.

## 2. A shared model for two sources

Not invented — both sides already treat "a decision waiting on a person" as
first-class:

| shared concept | orca | black-smith |
|---|---|---|
| project | `worktree-catalog`, `repo`, `folder-workspace` | `tasks` + worktree |
| session | `orchestration.runList` / `runShow` | `sessions`, `epics` |
| running agent (`●`) | `orchestration.workerList`, `agent-status-*` | `agents`, `dispatches` |
| **decision** | `orchestration.gateList` / `gateResolve` | `waivers`, `gate-outcome`, plan sign-off |

## 3. Layout

ReactFlow canvas. **Nested groups**: project is the parent node, session is
the child. **No arrows** between sessions — the canvas is a control panel, not
a diagram. Design scale: **3–5 repos × 1–3 sessions**.

```
┌─ VAM ─────────────────────────────────────────────────────── ⣾ 4 agents ─┐
│                                                                           │
│  ╔═ black-smith ═══════════════════════════╗  ╔═ vam ═════════════════╗   │
│  ║ ┌─ D-257 · epic-2 ─────────── ●3 ─┐     ║  ║ ┌─ epic-1 ──── ●1 ─┐  ║   │
│  ║ │ ⣾ coder · round 2 · sonnet · 4m │     ║  ║ │ ⣾ planner · 1m   │  ║   │
│  ║ ├─────────────────────────────────┤     ║  ║ ├──────────────────┤  ║   │
│  ║ │ ▸ reviewer                      │     ║  ║ │ ▸ plan draft     │  ║   │
│  ║ │   in : diff 340 lines, 6 files  │     ║  ║ │   in : goal      │  ║   │
│  ║ │   out: 2 findings (1×S2)        │     ║  ║ │   out: 7 tasks   │  ║   │
│  ║ │ ▸ verifier                      │     ║  ║ │ ▸ spec-review    │  ║   │
│  ║ │   in : S2 "race in queue"       │     ║  ║ │   in : plan-v1   │  ║   │
│  ║ │   out: confirmed                │     ║  ║ │   out: 2×S2      │  ║   │
│  ║ │ ▸ gate                     ⏸    │     ║  ║ │ ▸ sign-off  ⏸    │  ║   │
│  ║ │   in : 1 S2 not fixed           │     ║  ║ │   in : plan-v2   │  ║   │
│  ║ │   out: — waiting on you —       │     ║  ║ │   out: — waiting —│  ║   │
│  ║ └─────────────────────────────────┘     ║  ║ └──────────────────┘  ║   │
│  ║ ┌─ D-263 ─────────────────── ●0 ─┐      ║  ╚═══════════════════════╝   │
│  ║ │ ✓ merged · 2h ago               │      ║                              │
│  ║ └─────────────────────────────────┘      ║                              │
│  ╚═════════════════════════════════════════╝                              │
├───────────────────────────────────────────────────────────────────────────┤
│ Select   black-smith/D-257   ⏸ 2 waiting on you   hjkl f / gt  yy  ^K     │
└───────────────────────────────────────────────────────────────────────────┘
```

### Session node

- **Header**: id · epic · `●N` agents running.
- **Activity line** (1 line, truncated, spinner when live). Source:
  black-smith's worker heartbeat (see §5).
- **Exactly the 3 most recent decisions**, each with its own `in:` / `out:`
  pair of lines. A step = **a decision point**, not every agent turn, not
  every phase.
- The agent's full, detailed progress **does not surface** — only `Enter`
  shows it.

### Ordering

Default auto-layout (priority: waiting-on-you → running → newest).

**Nodes are not moved by hand.** Dragging and the stored positions it wrote
were removed: a saved position freezes a node where it was left, and the
ordering above only means anything if it can still happen after the page is
open, which is the only time anyone is watching. The canvas sets
`nodesDraggable={false}` and every node is built with `draggable: false`.

**The icon is stored per user, for a reason of its own.** black-smith has no
route to store an icon, and that is not the answer — nobody asked it. An icon
is about how you like to look at the work, not a fact about the work; it
belongs to the browser, and §3 already said it: saved per user, **and does
not go into the event log**.

## 4. Keyboard

**Two named cursor modes** -- Select and Insert -- plus vim-style chords and a
command palette. The mode decides what `hjkl` and `Mod+<digit>` mean, and the
status bar names the one in force (`CursorMode` in
`src/renderer/keyboard/keysheet.ts`). Select is what this document once called
NORMAL; Insert is the resting state of the response pane.

| key | action |
|---|---|
| `j` `k` (Select) | up and down the SESSION LIST, in the order the sidebar prints |
| `h` `l` (Select) | left and right across the canvas — **computed geometrically at press time** |
| `h j k l` (Insert) | the options of an open question; `h` alone returns to Select |
| `f` | shows a jump label on every node, type the label to land there |
| `/` `n` `N` | search by session/task name |
| `gt` `gT` | move to next / previous project |
| `gg` `G` | first / last node |
| `Enter` | opens detail (the agent's full process) |
| `yy` | **copies the command you need to run by hand to the clipboard** |
| `Ctrl-K` | command palette |
| `Esc` | closes the topmost layer |
| `I` | enters the **response pane** — Insert |
| `i` | opens the prompt for the session the cursor is on |
| `H` | leaves the response pane, back to the session list — Select |
| `o` `Mod-n` | starts a session — the vim gesture, and the chord every application spells "new" |
| `Mod-1` … `Mod-9` | a **position**, in whichever pane has the keyboard: a session in the sidebar, a tab in the response pane (`Mod-9` = the LAST session) |
| `1` … `9` (in an open question) | marks the option beside that number |

**Vertical is the LIST; horizontal is the canvas.** `j`/`k` walk the sidebar's
own order, so the cursor moves through the sessions in the order they are
printed rather than through whatever happens to be geometrically below.
`h`/`l` stay geometric, computed from real coordinates at press time and not
from a fixed index, because across a row there is no list to follow.

**The digit row means a position, in whatever the keyboard is pointed at.**
That is the rule; the table above is only today's reading of it. Two earlier
arrangements enumerated meanings instead — sessions on the bare row with tabs
under Shift, then the reverse — and both were wrong the same way: a digit that
means one fixed thing sends half an operator's presses to the pane they are
not looking at. `Cmd+2` now switches session when the cursor is in the sidebar
and shows the PRs tab when it is in the response pane, off `mode` in
`Canvas.tsx` — the same state the status-bar mode cell reads, deliberately not
a second notion of where focus is.

Consequences worth stating:

- **The focus indicator is load-bearing.** Until now the mode only changed what
  the arrow keys did. It now changes what `Cmd+1` does, so which pane holds
  the keyboard has to be visible without being hunted for.
- **A digit past the last DRAWN tab refuses out loud** (`only 3 tabs` where the
  source has no terminal to show) rather than falling through to the sidebar. Falling through would move a
  cursor in the pane the operator is not looking at, which is the defect the
  rule exists to remove; silence would leave them pressing it again.
- **Nothing is bound under Shift, and nothing can be.** macOS captures
  `Cmd+Shift+3`, `4` and `5` for its screenshot commands before any Electron
  window sees the keydown (`com.apple.symbolichotkeys`, entries 28-31 and 184,
  modifier mask `0x120000`). Both earlier arrangements had two dead bindings
  from the day they merged, and no test could have caught it: the OS never
  delivers the event a test synthesises.
- **The grammar stays pure.** `resolveChord` reports `{ kind: 'position',
  digit }` and nothing else; `Canvas` maps it. Passing the pane into the
  reducer would have worked too, and was rejected because it puts a React
  state in the signature of the one layer that is exhaustively testable
  without a DOM.

Both readings are still spelled from `event.code`, not from the character: on a
layout whose digit row is shifted (AZERTY) an unshifted `Cmd+1` arrives as `&`.
Reading the position is what keeps the family alive there, and it is not an
implementation detail to simplify away.

The generated key sheet names both meanings, one row PER MODE — `Select ·
session 2 in the sidebar` and `Insert · tab 2 in the response pane` — because a
sheet that said "session 2" alone would be wrong half the time, and one row
naming both hid that the two belong to two named modes.

The option digits are BARE, and safe by two rules rather than by luck. Scope:
they are handled by the question listbox itself, so they can only fire while
the keyboard is already in the options list (`i` puts it there), and the canvas
grammar binds no bare digit at all. And modifiers: under Cmd, Ctrl or Alt that
listener stands aside entirely, because a chord is neither text nor a pick and
belongs to the grammar. Scope alone was not enough — reading `event.key` on its
own made `Cmd+C` match the `c` binding and `Cmd+<digit>` mark an option on its
way to the chord layer, which matters more now that `Cmd+<digit>` is the
focus-sensitive family. Marking by number is still marking — vam
has no channel that could deliver an answer, and the card says so.

### 4.1 What orca gives the keyboard layer (read on 2026-08-27)

**Orca has no vim mode** — searching all of `src/renderer` turns up no such
file. So vam's vim-chord layer is new; there is nothing to copy from there.
What orca does give is the *scaffolding* around it, in
`src/shared/keybindings.ts` (2,432 lines) and
`app-shell/use-global-keybindings.ts`:

| what orca already has | what vam needs it for |
|---|---|
| `KeybindingDefinition` registry — action id ↔ binding | A single place to declare keys, instead of scattering `onKeyDown` across components |
| `KeybindingOverrides` + validate + diagnostics | Users can rebind keys without touching code |
| `findKeybindingConflicts` | `gt` and `g` cannot coexist unless something detects the conflict |
| `isDoubleTapBinding` | Exactly the mechanism `gg` / `yy` need |
| `keybindingIsActiveInContext` — `app` / `terminal` / `browser` | Gates by layer: with detail open, `j` must not fall through to the canvas |
| `TerminalShortcutPolicy` = `orca-first` \| `terminal-first` | The "who gets the keystroke" arbitration problem when a terminal is present — vam will hit the exact same thing in the detail layer |

Two things vam **does not** take from orca because orca does not have them:
the vim chord set, and geometry-based `hjkl` navigation. Both are pure logic,
not dependent on any data source, so they can be built and tested right
away — ahead of both black-smith epics in §5.

### 4.2 Action pane: one stop per button

**Not shipped, and kept as the argument rather than the description.** The
governance queue was removed: `buildActions()` returns one entry, the prompt,
and `I` enters a response pane with no verdict buttons in it. What follows is
the reasoning that would apply to a queue of destructive buttons, held here
for the day one exists.

The approval queue is where vam writes to the permanent record — a waiver
accepts a defect, an approved lesson gets spliced into every future dispatch.
So `j`/`k` stops at **each button**, not each row, and **the conservative
button comes first**: `fix` before `waive`, `reject` before `approve`. The
ring around whatever you are about to press *is* the answer to "what happens
if I press this" — no need to know which key is the "main" verdict.

Two options were rejected: (a) one stop per row with `y`/`n` for the two
verdicts — both letters already mean something in the grammar (`yy` copies,
`n` advances a match), and meaning-by-mode is exactly what §4 says vam does
not have; (b) one stop per row with `Enter` as the main verdict — that
requires the reader to know which verdict is "main" for a decision that
admits a defect into the record, and nothing on screen says which one that
is.

The remaining three details are all guards against a slip of the hand:

- `Enter` **inside the reason box** only ends typing, it never fires a
  verdict. The cursor stays on whichever button `j` last reached; firing from
  inside the text box would mean granting a waiver with the very last
  keystroke of writing its excuse.
- `Escape` inside the reason box hands the keyboard back to the pane. The
  window listener ignores keys typed inside an `INPUT` — that is what keeps
  the grammar from firing mid-typing — so any box that does not bind its own
  handler leaves the caret stuck inside it.
- Once answered, the cursor **goes back to the top of the list**. The row
  just answered disappears; keeping the same index would drop the cursor onto
  whatever just slid up into that slot — after waiving a finding, that would
  be the `approve` button of the next row.

### `yy` — doing away with mouse-copy entirely

black-smith **deliberately** returns commands as structured data instead of
running them itself (guardrails: only the operator creates a remote, pushes,
or sends anything out). A real example from `smith new vam`:

```json
"commands": {
  "ghRepoCreate": "gh repo create vam --private --source=… --remote=origin --push=false",
  "push":         "git -C … push -u origin setup"
}
```

So the command waiting for you to run is **a field**, not text buried in
prose that has to be dug out. `yy` copies that field. Vam **never runs it
itself** — the nod of approval is still yours.

## 5. Reverse dependency on black-smith

> **Fixed 2026-08-28.** Epic A below used to be listed as a **pending**
> dependency ("vam epic 1 should wait on them rather than build a polling
> layer just to throw it away") — true when this section was written, now
> false for epic A: it has landed via epic `vam-sse-canvas` (measured detail
> in §6.1 below). Epic B (worker heartbeat) has not changed — unchanged for
> that part.

One remaining piece of work (epic B) sits in black-smith, **not** in vam, and
vam epic 1 should wait on it rather than build a polling layer just to throw
it away — epic A has already landed, see the fix above:

- **epic A — SSE for `ui/server`**: **landed** (2026-08-28). `GET
  /api/stream` sends `hello`/`change` frames; vam reads them through
  `src/adapter/stream.ts` (framework-free, separated from React so it can be
  tested early — epic.md §5.2) and wires it into the canvas through
  `src/adapter/useCanvas.ts`. The 4-second poll has been dropped.
- **epic B — worker heartbeat**: black-smith deliberately forbids workers
  from returning prose (`{status, severity_counts, artifact_path}`) to keep
  the orchestrator's context from flooding. So today there is *no* "what the
  agent is doing" text. A heartbeat is a new event carrying one short
  description line — it touches return discipline, so it has to be its own
  black-smith epic, with a proper spec review.

```
black-smith epic A (SSE, landed)    ─┐
black-smith epic B (heartbeat)      ─┤→ vam epic 1: canvas read-only, one source
                                     ┘
```

## 6. Scope

The end goal is **full control** (approve gates, create/stop sessions, spawn
agents, send prompts). But writing into two systems with different
consistency models — black-smith requires every write to carry the
`--session/--plan-version/--causal-parent` envelope and refuses it if
missing; orca's `gateResolve` is an internal RPC with no stability guarantee.
A bad write into the event log corrupts the factory's memory, it is not a UI
bug.

**Epic 1 stops at: canvas read-only, one black-smith source.** Nothing is
written yet, so nothing can be corrupted yet, and the layout gets looked at
with real eyes before it is wired to the write path.

### 6.1 Epic 2 — write path wired up (2026-08-27)

Reads **do not** wait on SSE. `GET /api/overview` was already returning
`runningSessions[]` before this, so the adapter can build real rows right
away; §5 epic A only changes how the data *arrives* (poll → push), not
whether there is data at all.

> **Fixed 2026-08-28.** The next sentence here used to say "Today it's a 4s
> poll (`useCanvas`), and when SSE lands exactly one file changes" — true
> when written (2026-08-27), false now. SSE has landed (epic
> `vam-sse-canvas`, task-1 + task-2) and the 4-second poll has been dropped.
> **Two** files changed, not one: `src/adapter/stream.ts` (a new file —
> reads `hello`/`change` frames, no React dependency) and
> `src/adapter/useCanvas.ts` (wires that stream into the React lifecycle:
> calls `load()` on mount, on `hello`, and on a valid `change`). Reason for
> splitting into two, epic.md §5.2: the frame reader has no React dependency
> so it can be tested right away and land a wave ahead, instead of bundling
> it into one file that has to wait on `useCanvas.ts` changing before it is
> testable.

**Three things measured at the browser layer** (measured, epic.md §3.3):

1. The server does not send a `retry:` field; the browser's default
   reconnect mechanism handles it on its own, measured at a **constant
   3.00s**, no backoff (measured intervals 3010 / 3004 / 3004 ms).
2. **Fixed 2026-08-30.** This point used to say "A server dying mid-stream
   surfaces at the `EventSource` layer as `error` then `open`, `readyState`
   0 (CONNECTING), **never** 2 (CLOSED) — the browser recovers on its own,
   no client-side code needed" — true when only one path had been measured,
   false when stated as a general rule. Measured all three cases:
   - **Connected straight to black-smith, no proxy in between (this is
     PRODUCTION, unaffected):** the server dying is a TCP error, and the
     HTML spec does NOT treat a TCP error as fatal; `EventSource` retries
     indefinitely on its own, measured at a constant 3.00s, no backoff.
   - **Through vam's vite dev proxy, server comes back before the first
     retry (~3s):** a real recovery — this epic's committed transcript
     witnesses it (`open` then `hello` at the same moment, `change` right
     after).
   - **Through the vite dev proxy, the server is still dead at that exact
     retry:** vite answers `GET /api/stream` with `HTTP/1.1 502 Bad
     Gateway`, `Content-Type: text/plain`. The HTML spec treats a non-200,
     non-`text/event-stream` response as fatal, so `readyState` moves to 2
     (CLOSED) and no further retry happens. **`readyState` 2 CAN happen** —
     measured by this epic's own committed negative control
     (`state/artifacts/vam-sse-canvas/task-4-acg1-e2e/falsification-no-restart.txt`,
     `{"event":"error","readyState":0,"tMs":696}` then
     `{"event":"error","readyState":2,"tMs":3704}`).

   The source of that "give up" is the vite dev proxy sitting between the
   browser and the server, not vam's client: `src/adapter/stream.ts` is
   correct as written, and this epic raised no finding against that file.
3. `heartbeatMs` and `floorMs` — carried in the `hello` frame — are **not
   observable** from the browser: keep-alive is an SSE comment, and
   `EventSource` never exposes comments to JS in any form. What's more,
   `floorMs` (10000) is **smaller** than `heartbeatMs` (15000), so the two
   numbers cannot be combined into a meaningful threshold. **Forbidden: do
   not build a liveness timeout, watchdog, or staleness check on either of
   these two numbers** (finding `f-ui-server-sse/task-3-sse-handler-2fcd3eca`).

`AC-G1` — end-to-end verification through a real server — is still
**gated**: waiting on `GET /api/stream` landing on black-smith's `main`. The
three measurements above were taken by a vam session on a branch, not yet
re-measured on `main`.

> **Fixed 2026-08-30.** The paragraph directly above was true when written,
> false as of `161ffc7 feat(ui-server): GET /api/stream` landing on
> black-smith's `main`. `AC-G1` is **now discharged, no longer gated**: it
> ran for real, end-to-end, through vam's actual vite dev proxy, and this
> epic's committed transcript — `e2e/acg1-transcript.json` — is the
> evidence: `open`/`hello`, one `change`, then `error` when the server was
> killed, then `open`/`hello` again and a `change` once the server came
> back, plus one final canvas read. The three measurements in §3.3 are
> therefore no longer "measured on a branch, not yet re-measured": they were
> measured through the real path. Source:
> `f-vam-sse-canvas/integration-fc8c5787` (S2-major) and
> `f-vam-sse-canvas/integration-595388f1`. Full record: black-smith
> `factory/specs/active/vam-sse-canvas/epic.md`, AC-G1.

A write **requires** a read before it: `resolveContext` demands a real
`sessionId` and chains `causalParent` from that log's last event on its own.
Without a real session, every POST comes back 400.

Three writes are wired up, and only three:

| action | route | note |
|---|---|---|
| prompt | `POST /api/prompt` (new) | **recorded, not sent** — see below |
| waiver S3/S4 | `POST /api/waivers/apply-batch` | by fingerprint, a reason is required |
| lesson candidate | `POST /api/lessons/:id/approve\|reject` | never sets `acceptDuplicate` on its own |

**A prompt is recorded, not sent.** black-smith has no channel into a
running Claude Code session. What it has is `user_prompt` — saved verbatim so
that a later `dispatch_decision` can hook `parent_prompt_id` into it, and the
timeline reads out as "this happened because a person asked for it". The UI
has to say exactly that; a prompt box that looks like it sent something would
leave the user sitting there waiting for an answer nobody intends to give.

**What is still not wired up, because the factory has nothing for it:**
creating a session (done from the CLI: `smith event append session-start`),
renaming a session (the id is what the whole event log hooks onto), closing
a session, saving an icon. These spots report the actual reason rather than
saying "not wired up yet".

**CORS:** not opened. vam proxies `/api/*` through its own origin
(`vite.config.ts`); opening CORS on a server that accepts writes would widen
what any page in the browser could reach.
