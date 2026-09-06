# VAM — canvas layout & interaction spec

VAM = **VIM Agent Management**. This version was locked down from the
2026-08-27 interview session.
Constraint number one: **keyboard-driven control, mouse kept to a minimum.**

## 1. Where vam sits

A separate, independent app — not a fork of orca, and not a client of orca's
backend. Orca was read during design as prior art for being CLI-agnostic and
keyboard-first, and its keybinding vocabulary shaped the naming in
`src/renderer/keyboard/chords.ts` (§4.1) — that is the whole of what it
contributes. vam implements its own session model, its own adapters and its
own remote control end to end; nothing in vam calls orca's backend or ships
any of its code.

```
vam (web · Vite + React + ReactFlow)
 └─ adapter factory → http://127.0.0.1:4680/api/*   (read and write)
```

Web first, Electron later ⇒ **the data-access layer must be separated from
components from the very first commit**, or wrapping it in Electron later will
mean rewriting the UI.

### 1.1 Stack

**React 19 + Vite**, **`@xyflow/react`** (ReactFlow) for the canvas, and
**Tailwind CSS v4** with vam's own tokens (`src/styles.css`) — no pre-built
component library. Chosen for a canvas-heavy, keyboard-first UI on their own
merits: ReactFlow is a maintained node/edge renderer with pan, zoom and a
minimap already built in, and Tailwind's utility classes keep hand-written
components fast to iterate on without a design-system dependency.

Other libraries in `package.json`: **`cmdk`** for the command palette (§4,
`Mod-k`), **`zustand`** for state, **`lucide-react`** for icons, **`clsx`** +
**`tailwind-merge`** for composing class names, and **`emoji-picker-react`**
for the icon grid (a lazy chunk, ~307kB). No `shadcn`, `radix-ui`,
`class-variance-authority` or similar component layer — every component here
is hand-written on vam's own tokens.

## 2. A shared model, read for comparison

Not invented — the idea that a session can reach a point where it is
genuinely waiting on a person, not just running, is not unique to vam. Two
other systems were read for how they name it, purely as a comparison; neither
is a dependency, and only the `factory` row describes something vam actually
talks to:

| shared concept | orca (read for comparison only) | factory (implemented) |
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
│  ╔═ factory ═══════════════════════════════╗  ╔═ vam ═════════════════╗   │
│  ║ ┌─ task-1 · epic-2 ─────────── ●3 ─┐    ║  ║ ┌─ epic-1 ──── ●1 ─┐  ║   │
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
│  ║ ┌─ task-2 ─────────────────── ●0 ─┐     ║  ╚═══════════════════════╝   │
│  ║ │ ✓ merged · 2h ago               │      ║                              │
│  ║ └─────────────────────────────────┘      ║                              │
│  ╚═════════════════════════════════════════╝                              │
├───────────────────────────────────────────────────────────────────────────┤
│ Select   factory/task-1   ⏸ 2 waiting on you   hjkl f / gt  yy  ^K        │
└───────────────────────────────────────────────────────────────────────────┘
```

### Session node

- **Header**: id · epic · `●N` agents running.
- **Activity line** (1 line, truncated, spinner when live). Source: a
  per-worker heartbeat event on the factory's side (see §5.1 for the
  measured SSE path this rides on).
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

**The icon is stored per user, for a reason of its own.** The factory has no
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

### 4.1 Orca, read as a keyboard-vocabulary reference

**Orca has no vim mode** — searching all of its `src/renderer` turns up no
such file — so vam's vim-chord grammar (`src/renderer/keyboard/chords.ts`) is
original: there was nothing to copy. What orca's own keybinding layer
(`src/shared/keybindings.ts`, `app-shell/use-global-keybindings.ts`) supplied
was vocabulary for problems any keyboard-first UI eventually hits — a
registry keyed by action id rather than scattered `onKeyDown` handlers,
conflict detection between bindings, a double-tap concept (`gg`/`yy`'s
shape), gating a binding by which layer is focused, and arbitrating who gets
a keystroke when a terminal is present. vam's own implementation of each of
those (`resolveChord`, `bindingConflict`, `PREFIXES`, the mode read in
`Canvas.tsx`) is independent code, written for vam's own data shapes; reading
orca only fixed the names for problems vam had to solve anyway.

Two things have no orca counterpart at all because orca does not have them:
the vim chord set, and geometry-based `hjkl` navigation. Both are pure logic,
not dependent on any data source, so they could be built and tested well
ahead of the factory-side work §5.1 covers.

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

The factory **deliberately** returns commands as structured data instead of
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

## 5. Scope

The end goal is **full control** (approve gates, create/stop sessions, spawn
agents, send prompts). The factory requires every write to carry a
`--session/--plan-version/--causal-parent` envelope and refuses it if
missing, so a bad write into the event log corrupts the factory's memory —
it is not a UI bug, and the write path is staged carefully rather than
wired up all at once.

**Epic 1 stopped at: canvas read-only, one factory source.** Nothing was
written yet, so nothing could be corrupted yet, and the layout got looked at
with real eyes before it was wired to the write path.

### 5.1 Epic 2 — write path wired up

Reads **do not** wait on SSE. `GET /api/overview` was already returning
`runningSessions[]` before SSE landed, so the adapter can build real rows
right away; SSE only changes how the data *arrives* (poll → push), not
whether there is data at all.

SSE landed as two files, not one: `src/adapter/stream.ts` (reads
`hello`/`change` frames, no React dependency) and `src/adapter/useCanvas.ts`
(wires that stream into the React lifecycle: calls `load()` on mount, on
`hello`, and on a valid `change`). Split into two because the frame reader
has no React dependency, so it could be tested and land ahead of
`useCanvas.ts` changing to use it.

**Three things measured at the browser layer, end to end through vam's own
vite dev proxy against a real factory server:**

1. The server does not send a `retry:` field; the browser's default
   reconnect mechanism handles it on its own, measured at a **constant
   3.00s**, no backoff (measured intervals 3010 / 3004 / 3004 ms).
2. A server dying mid-stream is not one behaviour but three, depending on
   where the death is observed:
   - **Connected straight to the factory, no proxy in between (this is
     PRODUCTION, unaffected):** the server dying is a TCP error, and the
     HTML spec does NOT treat a TCP error as fatal; `EventSource` retries
     indefinitely on its own, measured at a constant 3.00s, no backoff.
   - **Through vam's vite dev proxy, server comes back before the first
     retry (~3s):** a real recovery, witnessed end to end (`open` then
     `hello` at the same moment, `change` right after) and recorded in the
     committed transcript `e2e/acg1-transcript.json`.
   - **Through the vite dev proxy, the server is still dead at that exact
     retry:** vite answers `GET /api/stream` with `HTTP/1.1 502 Bad
     Gateway`, `Content-Type: text/plain`. The HTML spec treats a non-200,
     non-`text/event-stream` response as fatal, so `readyState` moves to 2
     (CLOSED) and no further retry happens. **`readyState` 2 CAN happen** —
     measured directly: `{"event":"error","readyState":0,"tMs":696}` then
     `{"event":"error","readyState":2,"tMs":3704}`.

   The source of that "give up" is the vite dev proxy sitting between the
   browser and the server, not vam's client: `src/adapter/stream.ts` is
   correct as written.
3. `heartbeatMs` and `floorMs` — carried in the `hello` frame — are **not
   observable** from the browser: keep-alive is an SSE comment, and
   `EventSource` never exposes comments to JS in any form. What's more,
   `floorMs` (10000) is **smaller** than `heartbeatMs` (15000), so the two
   numbers cannot be combined into a meaningful threshold. **Forbidden: do
   not build a liveness timeout, watchdog, or staleness check on either of
   these two numbers.**

`AC-G1` — end-to-end verification through a real server — is discharged: it
ran for real, end to end, through vam's actual vite dev proxy, and the
committed transcript `e2e/acg1-transcript.json` is the evidence — `open` /
`hello`, one `change`, then `error` when the server was killed, then
`open`/`hello` again and a `change` once the server came back, plus one
final canvas read. All three measurements above were taken through that
real path, not on a branch awaiting re-measurement.

A write **requires** a read before it: `resolveContext` demands a real
`sessionId` and chains `causalParent` from that log's last event on its own.
Without a real session, every POST comes back 400.

Three writes are wired up, and only three:

| action | route | note |
|---|---|---|
| prompt | `POST /api/prompt` (new) | **recorded, not sent** — see below |
| waiver S3/S4 | `POST /api/waivers/apply-batch` | by fingerprint, a reason is required |
| lesson candidate | `POST /api/lessons/:id/approve\|reject` | never sets `acceptDuplicate` on its own |

**A prompt is recorded, not sent.** The factory has no channel into a
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
