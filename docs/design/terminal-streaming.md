# Terminal streaming: a spike, then a shipped feature

**Status:** shipped behind a setting (`streamingTerminal`, Settings ->
Behaviour, default OFF), on branch `vam/terminal-stream` (cut from this
spike's own `vam/terminal-stream-spike`, in turn cut from
`origin/smith/vam/0.2-tab-shell`). The rest of this document below the
"After: the SHIPPED path" section is left intact as the spike's original
report; see that section and "Task breakdown" for what actually landed, item
by item, against what was proposed. The shipping code lives at
`src/main/terminal/stream/client.ts`, `src/main/terminal/stream-ipc.ts` and
`src/renderer/panels/terminal-stream/TerminalStreamTab.tsx` -- `panels/
TerminalTab.tsx` (the polling path) is untouched and stays the default.

## The operator's report

Translated: "Typing in the terminal still has some latency. Is there a way to
make it smooth like orca does, or in insert mode in the terminal view stream
directly, or find another mechanism." Two earlier rounds already cut `ECHO_MS`
to 33ms and made the echo read screen-only (`TerminalTab.tsx`'s own head
comments). This spike asks the question those rounds didn't: not "how much
smaller can a poll-and-redraw loop get" but "is there a real terminal emulator
underneath this fast enough, and is the remaining latency inherent to
*polling* rather than to the render cost."

## The two numbers that answer it

**Program output is the whole story.** A keystroke was already fast on the
current path (~3-15ms end to end, see below) -- the operator's report was
never really about typing echo. It was about everything ELSE a running agent
prints, which has no keystroke to ride `ECHO_MS`'s leading-edge throttle and
so waits out `REFRESH_MS` (250ms) on its own. That's the number streaming
actually fixes.

### Before: poll + `capture-pane` (the shipping path)

Measured against a real tmux 3.7b on a private socket, this machine, run
twice (the machine is shared and loaded; both runs are reported to show how
much that matters).

**Keystroke echo** (`e2e/terminal-typing-latency-shots.mjs`, steady 80ms
cadence, n=50, keydown → IPC send → `send-keys` → echo read → `capture-pane`
→ painted):

| pane | run | p50 | p95 |
|---|---|---|---|
| `sh` | 1 | 2.90ms | 15.10ms |
| `sh` | 2 | 2.90ms | 13.80ms |
| `claude` (fullscreen TUI) | 1 | 3.70ms | 86.00ms |
| `claude` (fullscreen TUI) | 2 | 3.70ms | 85.80ms |

The `claude` pane's p95 is almost entirely the **paint** stage (rendering a
~900-byte, 137×41, SGR-coloured screen into spans), not the read: `toPaint`
alone was ~80ms both runs. `terminal-ansi.ts`'s span-per-run parse and React's
reconciliation of ~40 rows is real cost on this path that a real emulator's
canvas renderer does not pay the same way (see the "after" table).

**Program output, nothing typed** (`spike/measure-output-latency.mjs`, a
`sleep`-paced `echo` loop n=30 and a `yes | head -n 2000` burst n=5, print →
paint, cross-process clock via `Date.now()`/`performance.timeOrigin`):

| test | run | p50 | p95 | max |
|---|---|---|---|---|
| echo loop (n=30) | 1 | 83.3ms | 115.4ms | 196.8ms |
| echo loop (n=30) | 2 | 86.3ms | 102.9ms | 190.5ms |
| burst settle | 1 | 240.2ms | 244.8ms | 244.8ms |
| burst settle | 2 | 240.2ms | 257.0ms | 257.0ms |

Both track `REFRESH_MS` (250ms) exactly as the code's own comments predict: a
lone `echo` lands at a random phase of the polling interval (mean ~half of
250ms), and a burst that finishes in milliseconds still has to wait for the
NEXT tick to be drawn at all.

A separate, independently-measured pass (cross-review, not this script) put
the keystroke chain's own per-character cost at ~8-20ms, "dominated by
`ECHO_MS`'s 33ms throttle for fast typing and a full 550-line re-parse
(5.7ms) per echo" -- consistent with the table above and worth citing because
it isolates the SAME two costs (the throttle, the re-parse) this doc's own
measurements land on from a different angle.

### After: control-mode streaming + xterm.js (the prototype)

Measured against the SAME real tmux 3.7b, same machine, run twice, this time
through a real `StreamClient` (`main/terminal/stream/client.ts`) attached
directly to the pane and a real vendored `xterm.js`
(`spike/measure-stream-prototype-latency.mjs`, `spike/stream-harness.html`).

| test | run | p50 | p95 | max |
|---|---|---|---|---|
| keydown → paint (typing, n=50, 80ms cadence) | 1 | 5.70ms | 16.60ms | 18.10ms |
| keydown → paint (typing, n=50, 80ms cadence) | 2 | 6.40ms | 17.70ms | 18.10ms |
| print → paint (echo loop, n=30) | 1 | 22.20ms | 30.70ms | 31.00ms |
| print → paint (echo loop, n=30) | 2 | 22.00ms | 33.70ms | 40.50ms |
| print → paint (burst, `yes \| head -n 2000`, n=5) | 1 | 41.80ms | 46.20ms | 46.20ms |
| print → paint (burst, `yes \| head -n 2000`, n=5) | 2 | 52.10ms | 185.30ms | 185.30ms |

**Program output latency drops by roughly an order of magnitude** (echo loop
p50 83-86ms → 22ms; burst settle p50 240ms → 42-52ms), and stops being tied
to a quarter-second tick at all -- it is bounded by however fast tmux hands
`%output` to a connection that is already open, which this machine answers in
tens of milliseconds. Typing, which was already fast, stays fast (the p95
outlier on the second burst run -- 185ms against a first run of 46ms -- is
exactly the kind of scheduling noise the standing lesson on this machine
being shared and loaded predicts; it is reported rather than discarded).

**Keystrokes were never spawning anything either way** -- `control.ts`'s own
control-mode fast path already got the shipping keystroke chain to 0
spawns/key; streaming does not change that, it changes what happens to
PROGRAM OUTPUT, which the poll loop had no equivalent fast path for at all.

### After: the SHIPPED path (`StreamClient`, not the prototype)

Measured the same rigorous way as the prototype table above, but against the
REAL shipped code: `e2e/terminal-stream-latency-shots.mjs`, real tmux 3.7b on
a private socket (`vam-stream-e2e-latency`), the real `src/main/terminal/
stream/client.ts` bundled with esbuild (not reimplemented), a real `@xterm/
xterm` (this branch's actual dependency, not a vendored copy) loaded into a
`chromium.launch()` page via a throwaway static-HTTP harness
(`e2e/terminal-stream-latency-harness.html`). Run twice, same machine,
immediately alongside a fresh run of the shipping poll-path guard
(`e2e/terminal-typing-latency-shots.mjs`) for a same-session comparison —
this machine is shared and loaded, exactly the standing lesson the prototype
table above already names.

| test | run | p50 | p95 | max |
|---|---|---|---|---|
| keydown → paint (typing, n=50, 80ms cadence) | 1 | 9.20ms | 18.40ms | 26.40ms |
| keydown → paint (typing, n=50, 80ms cadence) | 2 | 8.50ms | 16.70ms | — |
| print → paint (echo loop, n=30) | 1 | 32.40ms | 58.90ms | 59.10ms |
| print → paint (echo loop, n=30) | 2 | 30.30ms | 72.70ms | — |
| print → paint (burst, `yes \| head -n 2000`, n=5) | 1 | 63.70ms | 79.00ms | 79.00ms |
| print → paint (burst, `yes \| head -n 2000`, n=5) | 2 | 86.30ms | 161.90ms | 161.90ms |

**Same-session poll-path comparison** (`e2e/terminal-typing-latency-shots.mjs`,
pane A `sh`, run 1, this same session): steady-typing keydown-to-painted
p50 5.00ms, p95 14.90ms — the shipped stream path's typing p50/p95 (9.2/18.4ms
and 8.5/16.7ms) read a few milliseconds SLOWER than the poll path's own
already-fast keystroke-echo chain. This is real and worth naming rather than
smoothing over: the poll path's `echo` read mode is a narrow, already-tuned
fast path (`ECHO_MS` throttling, screen-only capture, no reconciliation of
program output outside the keystroke's own echo), while the stream path pays
a full `xterm.js` render on every `%output` chunk plus `ControlFramer`'s
reply-flag filtering and a `StringDecoder` pass this connection did not need
to skip. The stream path's real win is PROGRAM OUTPUT, not the keystroke
echo — exactly what the prototype table above already found, and the shipped
numbers confirm it at the same order of magnitude: print-to-paint p50
30-32ms (echo) and 64-86ms (burst) vs. the poll path's documented `REFRESH_MS`-
bound ~83-86ms (echo) and ~240ms (burst) in the "Before" table.

**Shipped vs. prototype, same ballpark, some real difference.** The shipped
client's typing p50 (8.5-9.2ms) is close to the prototype's (5.7-6.4ms) but
consistently a couple of milliseconds higher — plausibly the extra
`event.reply` filtering and the real `ControlFramer.feedEvents()` path (the
prototype's own `StreamFramer` was a leaner, dedicated parser; the shipped
client extends the SAME framer `control.ts` uses for its command/reply
channel, see task-breakdown item 3 below) doing more branching per chunk.
The echo-loop numbers (shipped p50 30-32ms vs. prototype 22ms) and the burst
numbers (shipped p50 64-86ms vs. prototype 42-52ms) show a similar, modest
gap in the same direction. None of this changes the conclusion — the
shipped path is still roughly an order of magnitude faster than the poll
path for program output — but the exact prototype numbers should not be
quoted as the shipped feature's own performance; the table directly above
is.

## The chosen design, and why

**tmux control-mode streaming into a real terminal emulator (xterm.js),
NOT `node-pty` + `tmux attach`.** Both were in scope to consider (goal 3
below is the full written comparison); the deciding factor is `argv.ts`'s own
standing reason to use tmux at all: **no native module**. vam ships zero
native Electron modules today -- `argv.ts`'s header names this explicitly
("no `node-pty`, no `electron-rebuild`, no per-platform prebuilds") -- and
`electron-builder.config.cjs` targets four platform/arch combinations (macOS
dmg arm64+x64, Linux AppImage, Windows nsis) against Electron 44.1.1.
`node-pty` would need a native addon rebuilt against that exact Electron ABI
for every one of those targets, in CI, which is a real, ongoing build-system
cost this repo has never paid. Control-mode streaming pays no such cost: it
is one more `tmux -C` child process (`child_process.spawn`, already how
`control.ts` talks to tmux today) and two pure-JS npm packages
(`@xterm/xterm`, `@xterm/addon-fit`) with no native code of their own.

**A SECOND persistent connection per viewed pane, not one more verb on the
existing `ControlClient`.** `control.ts`'s client is deliberately attached to
a hidden, never-drawn `vamctl` housekeeping session and never asks for
`%output` -- its own header says so. Streaming needs a client attached to the
session the operator is ACTUALLY looking at, which is a different shape of
connection (it receives push notifications interleaved with command replies,
where `vamctl`'s connection only ever has one reply in flight). Keeping them
apart means the shipping client's "never asks for `%output`" invariant stays
true by construction rather than by discipline.

**Seed from a snapshot, then hand raw bytes to a real emulator.** Initial
screen: `capture-pane -p -e -J` (escape sequences intact) plus the pane id
from `list-panes`, written straight into xterm via `term.write()` -- xterm
parses the ANSI/SGR sequences itself, which is why `panels/terminal-ansi.ts`'s
span-per-run parser (a real, measured cost on the "before" path, see the
`claude` pane's `toPaint` number above) has nothing to do here. Every further
`%output` chunk goes to `term.write()` the same way, decoded from tmux's
octal-escape grammar (`protocol.ts`'s `decodeOutputPayload`, verified against
the operator's own brief: `\` escapes itself, any byte below 32 is `\ooo`).
Keys go out through xterm's own `onData`, hex-encoded over `send-keys -H`
(`client.ts`'s `write`) -- the exact encoding `control-protocol.ts` already
uses for text, chosen for the exact reason that file gives: tmux's
control-mode line grammar performs shell-like expansion even inside quotes,
and `-H` sidesteps parsing the operator's own bytes at all.

**Resize is `refresh-client -C`, never `resize-window`.** `resize-window`
(the shipping `resizeWindowArgv`) forces the WHOLE window to one size for
EVERY client looking at it, vam's own `poll`/`echo` reads included.
`refresh-client -C` changes only what the ISSUING control client reports,
which is the lever this task's own brief named as the safe one -- confirmed
by reading `control.ts`'s own note that `CONTROL_WINDOW_SIZE` is small and
"never drawn" precisely so its size can never leak onto anyone else's window.

## Three bugs a cross-review found doing this for real

None of these were visible from reading the code; all three needed a real
tmux (or a fake child reproducing its exact behaviour) to surface, and all
three are fixed in the prototype with failing-test-first coverage
(`test/sources/tmux-stream-client.test.ts`, `tmux-stream-protocol.test.ts`).

1. **`tmux -C` emits its own unsolicited, empty `%begin`/`%end` block on
   connect, before any reply to a command the client actually sent.** A queue
   that pairs blocks with pending commands by arrival order alone -- which is
   what `control.ts`'s SHIPPING `ControlClient` still does today -- lets that
   spurious block satisfy the first real command, which shifts every LATER
   reply onto the PREVIOUS command's answer, persistently, for the life of
   the connection. Reproduced: a `capture-pane` sent as, or after, the first
   command on a fresh connection returns ANOTHER session's screen, 20/20.
   **This is a live, unfixed bug in shipping code today, not something this
   spike introduced or is scoped to fix** -- see Risks below for why it needs
   its own task, separately and soon.
2. **A block closed on any line merely SHAPED like a close.** `%end `/`%error
   ` are not escaped the way `%output` payloads are, so a program printing a
   line that itself starts `%end ` (trivially, `echo '%end 1 2 3'`) truncated
   the reply early. Fixed by matching the closing line's exact
   `<time> <n> <flags>` header against its own `%begin`.
3. **Decoding each stdout chunk independently corrupts a multi-byte UTF-8
   character tmux happened to split across two pipe reads.** Fixed with
   `node:string_decoder`, which carries a partial trailing sequence across
   writes -- this matters more here than it does for `capture-pane` polling,
   because a continuous `%output` stream hits far more arbitrary chunk
   boundaries, and the operator's own reports are typed in Vietnamese.

A fourth, lower-severity fix: `%output` for the viewed pane that arrives
BEFORE `capture-pane`'s own reply describes activity already folded into the
seed (tmux orders one connection's commands and notifications consistently),
so it is dropped rather than drawn twice.

And one real-tmux-only bug that unit tests with a fake child could not have
caught at all: `list-panes -F #{pane_id}` sent UNQUOTED failed outright
against a real tmux ("`-F` expects an argument") -- a bare leading `#` is a
comment leader in tmux's control-mode grammar, the same reason
`control-protocol.ts`'s own `encodeSegment` quotes its two format strings
rather than sending either bare. This is the sharpest lesson of the spike:
**a fake-child unit test proves the STATE MACHINE; only a real tmux proves
the PROTOCOL.** Both are needed, and this repo's existing test shape
(`ControlChildProcess`/fake, mirrored here) makes the first cheap -- it does
not make the second optional.

## How existing features map

**Select mode vs Insert mode.** vam's own keyboard grammar (`Canvas.tsx`'s
`CursorMode`, `focusInsertStop`) routes the keyboard to a pane's own control
only in `insert` mode, by focusing whatever element carries the
`data-insert-stop`/`insertScopeMark` markers -- `TerminalTab.tsx` puts these
on its hidden input. `TerminalStreamTab.tsx`'s prototype does **not** wire
these yet (a task-breakdown item below): the fix is mechanical, putting the
same marks on xterm's own `term.textarea` (which is what `term.focus()`
focuses), so `i`/`I`/a click reach it exactly the way they reach today's
hidden input.

**Scrollback (Shift+PageUp/PageDown/Home/End, `#459`).** Today `SCROLL_CHORDS`
intercepts these four before they reach the pane and scrolls the DOM
container directly. xterm.js has NATIVE scrollback (`term.scrollLines`,
`scrollPages`, `scrollToTop`, `scrollToBottom`) with its own buffer, not a
CSS-scrolled `<pre>` -- the same four chords map onto those four methods
directly, checked in the same place (before the keystroke reaches xterm's own
handler), a smaller change than it sounds.

**Nav keys (arrows, bare Home/End/PageUp/PageDown → the program).** Today
these are re-encoded by hand (`argv.ts`'s `sendNavArgv`, `NAV_KEYS`) because
`capture-pane` text carries no live cursor for a browser to navigate.
xterm.js needs NONE of this: its own `onData` already emits the correct
escape sequences for every named key (respecting cursor-key mode, etc.) the
moment it is focused and receiving real `keydown` events, the same way any
other program attached to a real terminal gets them. This is a net
SIMPLIFICATION, not a port.

**Mouse wheel (`sendWheelArgv`, `MAX_WHEEL_TICKS`).** Same shape: xterm.js
has built-in mouse tracking/reporting once a program enables a mouse mode,
translating wheel and click events into the correct SGR sequences itself.
The custom encoding in `argv.ts` becomes unnecessary for the streaming path;
what it does NOT relieve this spike of is actually verifying parity (a
task-breakdown item, not a claim made here).

**IME composition (Vietnamese input, `TerminalTab.openkey.test.tsx`).** This
is the operator's own second report, and it is genuinely uncertain rather
than assumed either way. Today's hidden-input design exists BECAUSE the pane
draws a snapshot with no live cursor for the browser's IME to anchor to;
xterm's `term.textarea` is a real, continuously-focused text control with a
composition helper xterm manages itself, which should let native IME
composition work with none of `TerminalTab.tsx`'s custom
`isComposing`/OpenKey-specific handling. "Should" is doing real work in that
sentence -- this needs to be DRIVEN with the same CDP
`Input.imeSetComposition` technique `TerminalTab.tsx`'s own tests already use
before it is believed, and is the single highest-value item in the task
breakdown below given it is the operator's own second complaint.

**Paste.** A genuine, deliberate behaviour change to flag, not a gap to
close quietly. Today's pane REFUSES paste and drag-drop outright
(`TerminalTab.tsx`'s own `onInput` handler: `inputType: 'insertFromPaste'`
and `'insertFromDrop'` are both explicitly dropped, "this channel is bounded
precisely so that it cannot become one" (a keystroke)) -- read together with
that comment's own reasoning, this looks like a deliberate safety boundary
against a large, unreviewed block of text being delivered into a running
agent silently, not an accepted limitation of the snapshot approach.
xterm.js supports paste natively, including bracketed-paste marking so the
receiving program can tell a paste from typing. **Shipping streaming means
deciding this on purpose**: enable it (with bracketed paste, so `claude`
etc. can tell the difference) or suppress it deliberately in the new path
too, matching today's posture. This doc takes no position; it is listed here
so the decision is made rather than defaulted into.

**REVERSED.** The operator asked, in as many words, for paste in Insert mode
back: "paste in the terminal's Insert mode is currently refused -- fix it:
allow it." Both renderers now deliver it. `renderer/panels/terminal-paste.ts`'s
`preparePastedText` is the one sanitiser both share -- CRLF/LF collapsed to a
single CR, NUL stripped, an embedded bracketed-paste marker's ESC byte
dropped so pasted content cannot forge the END sentinel and have whatever
follows read as if typed (xterm.js's own default paste handling does not
guard against that, which is why this component owns the wrap rather than
letting xterm's default paste run: measured against the shipped `@xterm/xterm`
6.0.0 bundle, its `prepareTextForTerminal`/paste helper normalises newlines
and wraps in bracket codes but performs no such escaping of its own). This
streaming renderer decides whether to wrap in bracket codes itself, from
xterm's own `modes.bracketedPasteMode` -- the SAME fact tmux tracks per pane,
consulted here instead of there because there is no tmux verb on this write
path at all, only a raw write to the control-mode connection. The
capture-pane renderer (`TerminalTab.tsx`) instead hands the sanitised text to
`sendPasteArgv`, which delivers it through tmux's OWN paste buffer
(`set-buffer`/`paste-buffer -p -r -S -d`) so tmux itself -- not this bridge --
decides whether the pane's program gets bracket codes, exactly as it would
for any other paste into that pane.

**Phone / the remote server.** Checked directly (`remote/server.ts`'s own
`UNSERVED` map): the remote endpoint does not expose the Terminal surface AT
ALL today -- "read, send, answer and resize type into a running agent and
need their own rate limit and decision." There is no existing
`capture-pane`-over-HTTP path to compare against, and this spike's own Risks
section (a `%output` flood, no back-pressure handling) is a strong argument
for leaving that decision exactly where it is for now: streaming raw control-
mode output to a phone over the existing HTTP/SSE transport is a SEPARATE,
later decision needing its own security and rate-limit review, not something
this spike's numbers argue FOR doing.

## Comparison on paper: `node-pty` + `tmux attach` (orca's approach)

| | control-mode streaming (this spike) | `node-pty` + `tmux attach` |
|---|---|---|
| Native module | None. Zero native Electron modules today; stays that way. | `node-pty`, a native addon -- needs rebuilding against Electron 44.1.1's ABI for every `electron-builder` target (macOS arm64+x64, Linux, Windows): a real, ongoing CI cost this repo has never paid. |
| Process count | +1 `tmux -C` child per OPEN, VISIBLE view (same shape `control.ts` already uses for its one housekeeping client). | +1 real pty-spawned process per view (`tmux attach` running inside a locally-emulated pty) -- same order, different mechanism. |
| Interaction with the existing control client | None in protocol terms (`StreamFramer` is a wholly separate parser from `ControlFramer`); SAME window-size negotiation question as `resize-window`/`refresh-client -C` (see Risks). | Same window-size negotiation question -- `tmux attach` is a NORMAL tmux client and is sized by the pty's own dimensions exactly like any real terminal, no better or worse than this spike's design. |
| Scrollback / copy-mode | xterm's OWN scrollback, fed a curated stream (`%output` for the viewed pane only) -- tmux's own copy-mode, prefix key and status bar are NEVER exposed, because `%output` carries only the pane's content. | FULL native tmux, including copy-mode (`Ctrl+B [`), tmux's own status bar and prefix-key grammar -- more complete, but it is TMUX'S UI appearing inside vam's UI, likely colliding with vam's own chords (`Ctrl+B` vs. vam's own bindings) unless suppressed via tmux config (`status off`, rebind or disable the prefix). |
| Select mode / mouse / IME / paste | Same real xterm.js either way -- this axis does not distinguish the two designs. | Same real xterm.js, arguably with LESS custom code needed overall since there is no relay/decode layer at all (a real pty behaves exactly like a real terminal). |
| What it actually answers | The operator's report, precisely: program output streamed, typing already fast, no new UI surface. | Answers the same latency question and MORE (full tmux fidelity), at the cost of a native-module build pipeline and a second UI grammar (tmux's own) to reconcile with vam's. |

**Verdict, on paper:** `node-pty` is the more complete answer to "make it
feel like a real terminal" but is a materially bigger bet -- a native-module
build pipeline this repo has structurally avoided, and tmux's own prefix-key/
status-bar surface needs active suppression to avoid fighting vam's own
chrome. Control-mode streaming answers the operator's ACTUAL report (typing
was fine; output was slow) without either cost, at the price of a curated
relay this spike had to get right by hand (see the bugs above) rather than
getting for free from a real attached terminal.

## Risks

**A `%output` flood.** A program printing very fast (`yes` unthrottled, a
large build log) could hand `%output` notifications to the connection faster
than the renderer processes them. tmux has its OWN flow-control mechanism for
this (a pane can be PAUSED to a slow control client, resumed on request) --
this prototype does not implement it at all: `client.ts`'s header names
`%extended-output`/pause-after handling as an explicit, unimplemented gap.
Whether tmux enforces this by default or only when a client opts in was not
verified against tmux's own source for this spike (an open question, not a
claim); either way, shipping needs the pause/resume handshake and, per a
cross-review's own suggestion, a RESEED (fresh `capture-pane`) on resume
rather than assuming nothing was missed.

**Control-client lifetime per view.** Unlike `vamctl`'s one connection per
SERVER, this is one connection per OPEN VIEW. `TerminalStreamTab.tsx`'s
prototype tears its connection down on UNMOUNT (component cleanup) but does
**not** yet mirror `TerminalTab.tsx`'s `document.visibilitychange` discipline
-- a backgrounded-but-still-mounted tab should disconnect and reseed on
return, the same way the polling interval already stops and restarts, so a
window with several open sessions does not accumulate one live `tmux -C`
child per session regardless of which one is actually on screen.

**Multiple panes.** `client.ts`'s `#paneId` is resolved once from
`list-panes`' FIRST row. A vam session's window normally holds exactly one
pane (`argv.ts`'s own session model); an operator who manually splits one
would see only the first pane's output stream. Low probability, real gap --
needs either multiplexing by pane id or an explicit refusal/warning when
`list-panes` answers more than one row.

**Reconnect.** Zero reconnect logic in the prototype today -- a dead
connection stays dead, with no retry and no visible "reconnecting" state. The
shipping `ControlClient`'s `RECONNECT_BACKOFF_MS` dance is the shape to
follow, but NOT its exact behaviour: per the cross-review's second finding
(a timed-out command's fallback RE-RUNS it via `execFile`, delivering a
keystroke twice, measured `5a 5a` for one key), a streaming reconnect must
never blindly resubmit a `write()` -- there is nothing to resubmit safely,
since a fire-and-forget send has no "did it land" answer either way -- and
must always re-seed with a fresh `capture-pane` rather than trying to resume
mid-stream, since any gap's content is unknown.

**tmux versions.** Everything here was measured against tmux 3.7b. Control
mode's exact behaviour (the startup block, octal-escaping, `refresh-client
-C` semantics) was not cross-checked against older tmux releases for this
spike. Shipping should gate on a minimum verified version (`tmux -V` at
startup) with a fallback to the snapshot path below it, the same shape any
other environment-capability check in this codebase already takes.

**The shipping `ControlClient` bug (A1 above) is a live, separate, critical
finding.** It is NOT introduced by this spike and this spike does not fix
it -- `control.ts` is untouched. It needs its own task, on its own branch,
soon: the shape of the fix (discard the first unsolicited block on a fresh
connection) is proven correct here (`client.ts`'s own fix, `tmux-stream-
client.test.ts`) and should port directly.

**Window-size ownership is a real open question this spike surfaces rather
than resolves.** `refresh-client -C` changes what ONE control client reports;
tmux's own `window-size` option (`manual`/`latest`/`largest`/`smallest`) then
decides how that interacts with every OTHER client looking at the same
window -- including a phone view, if one is ever added, and including the
operator manually attaching for debugging. The recommendation surfaced during
review is to set `window-size manual` on vam's own sessions and own resizing
exclusively through whichever client is the operator's actual desktop view,
never letting a streaming attach implicitly renegotiate it -- this was not
implemented or measured against a real second client in this spike and needs
its own verification before shipping.

## Task breakdown, to ship behind a setting

Ordered; each was independently reviewable, and each is walked below against
what actually landed on `vam/terminal-stream`.

1. **A real dependency, not a vendored one.** DONE. `@xterm/xterm` and
   `@xterm/addon-fit` are ordinary `pnpm-lock.yaml` dependencies
   (`733deabc`); no `vendor/xterm/` exists on this branch, and the latency
   harness (above) loads `node_modules/@xterm/xterm/lib/xterm.mjs` directly
   rather than a vendored copy.
2. **Port the shipping `ControlClient` bug fix (A1) first, on its own.**
   DONE, and already landed at this branch's OWN BASE before this work
   started: `0eff751d fix(tmux): pair control-mode replies by tmux's own
   header; never re-send a keystroke (#473)` is the first commit on this
   branch's own log, i.e. it shipped as its own separate PR ahead of every
   streaming commit below it, exactly as this item asked.
3. **Electron IPC wiring for `StreamSource`.** DONE --
   `src/main/terminal/stream-ipc.ts`'s `registerTerminalStreamIpc`, channels
   `vam:terminal:stream:{open,close,write,data,seed,down}`
   (`src/main/ipc/channels.ts`), bridged through `src/preload/api.ts`'s
   `window.api.terminalStream`. **"One framer, not two," a stronger version
   of the original plan.** The spike's own comparison table (above) called
   the prototype's `StreamFramer` "a wholly separate parser from
   `ControlFramer`"; the shipped code does NOT do that -- `6f48718e
   feat(tmux): extend the shipping ControlFramer to surface %output -- one
   framer, not two` extends `control-protocol.ts`'s existing `ControlFramer`
   itself so `feedEvents()` now yields `output`/`other` events alongside its
   original `block` events, and `StreamClient` reuses that ONE parser rather
   than shipping a second one. This is a real design improvement over what
   this doc originally proposed, not merely what shipped instead of it.
4. **`TerminalStreamTab.tsx` gets `insertScopeMark`/`insertStopMark` on
   `term.textarea`.** DONE (`89b10b62`) -- marks the streaming pane as an
   insert scope/stop, wired the same way `TerminalTab.tsx`'s hidden input is.
5. **Scrollback chords** (`SCROLL_CHORDS`) mapped onto `term.scroll*`. DONE
   (`f3051ab1`) -- Shift+PageUp/PageDown/Home/End mapped onto xterm's own
   `scrollPages`/`scrollToTop`/`scrollToBottom`.
6. **Visibility-driven connect/disconnect**, mirroring `TerminalTab.tsx`'s
   `document.visibilitychange` handling. DONE (`45f75c0d`) -- closes the
   stream while hidden, reconnects and reseeds on return.
7. **IME composition, driven and measured.** DONE, with an important
   qualifier this doc should carry forward honestly rather than round up:
   `9fd34f26 test(terminal): verify IME composition works with zero custom
   code` proves xterm's own `CompositionHelper` handles a driven
   `compositionstart`/`compositionupdate`/`compositionend` sequence with NO
   custom handling in `TerminalStreamTab.tsx`, matching this doc's own
   prediction. But `test/panels/terminal-stream/TerminalStreamTab.ime.test.tsx`'s
   own header says plainly it runs "against happy-dom, is not a real OS input
   method" -- a real Vietnamese IME (the operator's own second report) was
   NOT independently driven against the shipped build for this task; the
   CDP-level technique `TerminalTab.openkey.test.tsx` uses for the polling
   path's own IME coverage is the same shape this file's test uses, which is
   the strongest evidence available short of a real OS-level IME session.
8. **Paste: a deliberate decision.** Decided as "suppress" in `7db34eab
   feat(terminal): refuse paste silently, matching TerminalTab.tsx's own
   posture` -- REVERSED since: the operator asked for paste in Insert mode
   back, in both renderers. See "REVERSED" above and `terminal-paste.ts`,
   `sendPasteArgv` (`sources/tmux/argv.ts`).
9. **`%pause`/`%extended-output` handling** with reseed-on-resume. DONE --
   `StreamClient`'s `#handlePauseOrContinue` sets `#paused` on `%pause` (drops
   `%output` while paused rather than trusting it is complete) and reseeds
   via a fresh `capture-pane` on `%continue`/`%unpause`, per the module's own
   header.
10. **Reconnect**, ported from `ControlClient`'s shape but never re-running a
    `write()`. DONE -- `StreamClient#handleDown`/`#reconnect` uses the same
    `RECONNECT_BACKOFF_MS` shape, wires a fresh `ControlFramer`/
    `StringDecoder` and always reseeds rather than attempting to resume
    mid-stream; `write()` stays fire-and-forget with nothing tracked past the
    moment it is sent, so nothing is ever resubmitted on reconnect, exactly
    the Risks section's own constraint.
11. **A `tmux -V` minimum-version gate**, falling back to the snapshot path
    below it. DONE -- `stream-ipc.ts` checks `tmux -V` before any stream
    opens and refuses with `unsupported-tmux` below the floor. The exact
    floor chosen, `major.minor >= 3.2`, is carried forward here in the same
    words the module's own header uses rather than rounded into a stronger
    claim: "a CONSERVATIVE GUESS at how far back control-mode's
    `%output`/`%pause` notifications are reliably supported -- it was NOT
    independently re-verified against tmux's own changelog for this task."
12. **A setting, defaulting OFF.** DONE -- `streamingTerminal`
    (`f500a00e`, `src/renderer/prefs/streaming-terminal.ts`), Settings ->
    Behaviour; `TerminalTab.tsx` (the polling path) is untouched and remains
    the default either way, per `d2839ab7`'s wiring of `DetailPanel` to lazy-
    load the streaming tab only behind this pref.
13. **Multi-pane handling.** NOT DONE -- unchanged from the spike's own gap.
    `StreamClient#connect` still resolves `list-panes`' FIRST row only
    (`const paneId = panes.split('\n').find((line) => line.length > 0)`); an
    operator who manually splits a vam-managed window would still see only
    the first pane's stream. Same low-probability shape as the spike named
    it: a vam session's window normally holds exactly one pane.

Mouse wheel and nav-key parity were correctly predicted as needing no new
code -- xterm.js's own `onData`/mouse-tracking handles both once (3)-(4)
landed; this was not re-verified with a dedicated e2e pass in this task
against a real mouse-aware program, and remains open the same way it was
when this doc was first written.

**Phone / the remote server, re-confirmed.** `src/main/remote/server.ts`'s
`UNSERVED.terminal` entry is still present and still says why ("the remote
endpoint does not expose the terminal surface..."), and
`test/main/remote/server.test.ts` still asserts `capabilities.terminal` is
forced `false` and `declines.terminal` carries a matching message over the
remote/web build -- so requirement 4 ("Phone: unchanged") holds for the
streaming path too: there is no `window.api` at all in the web/phone bundle,
so `TerminalStreamTab.tsx` never mounts a working pane there regardless of
the `streamingTerminal` setting's value.

## Frame parity, 14. Still not the default -- but must look the same when it is on

The operator's own decision (translated): "Keep tmux; turn streaming on by
default after testing -- but the terminal frame, when xterm is on, needs the
radius and must look the same as the tmux view when it's off." This item is
DONE: `TerminalStreamTab.tsx`'s frame/chrome/text/colours now match
`TerminalTab.tsx`'s byte-for-byte where the two renderers can agree at all,
falsified by `e2e/terminal-stream-frame-shots.mjs` in a real browser rather
than eyeballed -- `streamingTerminal` STAYS DEFAULT OFF; this is chrome
parity for the beta, not the flip itself, which the operator will test first.

**Measured, both columns, real Chromium, same fixture (a tmux-shaped
`RED`/`GRN`/`BLU` SGR line and a plain sentence), `getComputedStyle`/
`getBoundingClientRect` throughout -- never the source, per this repo's own
"assert the property, not its proxy" lesson:**

| property | OFF -- `TerminalTab.tsx` (`[data-terminal-pane]`) | ON -- `TerminalStreamTab.tsx` (`[data-terminal-stream]`) |
|---|---|---|
| border-radius | `9px` | `9px` |
| border | `1px` `rgb(68, 68, 68)` | `1px` `rgb(68, 68, 68)` |
| background-color | `rgb(30, 31, 41)` | `rgb(30, 31, 41)` |
| padding (T/R/B/L) | `8px 12px 8px 12px` | `8px 12px 8px 12px` |
| clips to the radius | n/a (`overflow: auto`, a `<pre>`, no square canvas under it) | `overflow: hidden` -- xterm's own square-cornered rows/cursor clipped to the frame |
| font-family | `"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace` | same, copied into `TERMINAL_FONT_FAMILY` (`prefs/terminal-font.ts`) -- xterm takes a literal string, never a class |
| font-size | `12.5px` (the operator's `terminalFontSize`) | `12.5px`, same store |
| rendered row height | `19.375px` (CSS `line-height: 1.55`, exact) | `19px` (xterm's own `lineHeight` option, corrected -- see below) |
| a red SGR sample | `rgb(252, 59, 68)` | `rgb(252, 59, 68)` -- both read `activeTerminalScheme()` |
| branch / session name | drawn on a one-row status rule under the pane | same rule, same order, same classes (`[data-terminal-stream-status]`) |
| cursor | steady block, never blinks (this file's own design: a poll cannot honestly animate liveness) | steady block, `cursorBlink: false` set to MATCH -- this pane really is live, but the operator's ask is that the two screens look the same |
| Insert/Select marks | `insertScopeMark`+`insertStopMark` on the pane, the hidden `<textarea>` forwarded to | `insertScopeMark` on the pane, `INSERT_STOP` on xterm's own `term.textarea` directly (already shipped, task-breakdown item 4) |

**The one real gap, named rather than hidden: `backgroundOpacity` under 1.**
`terminalSchemeStyle()` composites the scheme's background with the
operator's opacity slider (`prefs/terminal-scheme.ts`) as a translucent
`rgba()`, painted on `TerminalTab.tsx`'s pane directly. `TerminalStreamTab.tsx`
now paints its OWN frame (`[data-terminal-stream]`'s `style`) with that exact
same composite -- but xterm.js's `ITheme.background` is passed the OPAQUE hex
(`mapScheme` still drops `backgroundOpacity`), because xterm's DOM/canvas
renderer painting a truly translucent cell background was not attempted or
verified for this task. At the shipped default (`backgroundOpacity: 1`,
opaque) the two are pixel-identical, which is the row the comparison table
above measures and the case the operator will actually see; an operator who
has moved the slider off 1 would see the padding ring go translucent while
the text area under it stays opaque -- a real, narrow, follow-up gap.

**Why the row height needed a SEPARATE constant
(`TERMINAL_STREAM_LINE_HEIGHT`, not `TERMINAL_LINE_HEIGHT` again).** The two
renderers give the SAME NUMBER two different meanings. CSS's unitless
`line-height: 1.55` on `TerminalTab.tsx`'s `<pre>` is always exactly
`font-size * 1.55` -- 19.375px at 12.5px type, by spec, no exceptions.
xterm.js's `lineHeight` option is a multiplier over the FACE'S OWN MEASURED
GLYPH-BOX HEIGHT instead, which for Geist Mono is already taller than its
font-size; passing `1.55` straight through rendered a 23px row against that
same 19.375px target -- an 18.6% mismatch this guard caught before the
correction existed. `TERMINAL_STREAM_LINE_HEIGHT` (`prefs/terminal-font.ts`)
is `1.55 * (19.375 / 23) = 1.306`, ONE MEASURED CONSTANT in the same register
`TerminalTab.tsx`'s own `RULER_TEXT` comment already uses for a font metric,
not a formula derived from xterm's private `_core._renderService` (the
surface `@xterm/addon-fit` itself depends on, with its own "TODO: Remove
reliance on private API" -- this repo does not add a second dependency on
it). Both renderers scale linearly with font-size for one face, so the ratio
holds across `TERMINAL_FONT_SIZES` within this guard's own two-pixel
tolerance; it would need re-measuring only if the face itself changed.

**The tmux session name, which `TerminalStreamTab.tsx` could not draw at all
until this task.** `StreamOpenResult` (`main/terminal/stream-ipc.ts`) now
carries `name: match.name` alongside `seed` -- the SAME `targetSession`
pairing `terminal/ipc.ts`'s `read` channel resolves for `TerminalTab.tsx`'s
own `view.name`. Threaded through `preload/api.ts`'s `TerminalStreamApi.open`
type and drawn on the new status rule; `null` until the stream actually opens
(`TerminalTab.tsx`'s own `view` starts `null` for the identical
never-invent-an-identity reason).

**Screenshots**, dark and light, `docs/ui as outDir`, written by
`e2e/terminal-stream-frame-shots.mjs`: `docs/ui/terminal-streaming-off.png` /
`docs/ui/terminal-streaming-on.png` (dark, the pair the comparison table
above was measured against) and `docs/ui/terminal-streaming-off-light.png` /
`docs/ui/terminal-streaming-on-light.png`.

**Not attempted in this task.** A custom overlay scrollbar for xterm's own
scrollback (`TerminalTab.tsx`'s `OverlayScroll` thumb has no DOM element on
the streaming side to attach to -- xterm's native scrollbar is hidden via
`[data-terminal-stream] .xterm-viewport` in `styles.css` instead, so at least
no square-edged native bar cuts across the rounded frame); a pixel comparison
of the cursor's own colour against the scheme's `cursor` token (the block/
no-blink STYLE is measured, its colour is not, separately from the ANSI
colours already falsified above); and multi-pane handling (task-breakdown
item 13, still open, unrelated to frame parity).
