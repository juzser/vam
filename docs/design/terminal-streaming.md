# Terminal streaming: a spike, then a shipped feature, then the default

**Status:** the DEFAULT Terminal tab now (`streamingTerminal`, Settings ->
Behaviour, default ON), on branch `vam/stream-default` (cut from `origin/
smith/vam/0.2-tab-shell` at `a78f867e`, which already carried the shipped
beta this doc's earlier sections describe). See "Flipping the default", at
the end of this document, for the performance measurement, the fallback and
the migration that made the flip -- everything ABOVE that section is left
intact as it was written for the beta and is now history, not current
status. The shipping code lives at `src/main/terminal/stream/client.ts`,
`src/main/terminal/stream-ipc.ts`, `src/renderer/panels/terminal-stream/
TerminalStreamTab.tsx` and, new in this task, `src/renderer/panels/terminal-
stream/TerminalAutoTab.tsx` (the live pick-and-fallback) -- `panels/
TerminalTab.tsx` (the polling path) is untouched in its own rendering logic
and is now the explicit opt-out AND the automatic fallback, never the
default.

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

**`backgroundOpacity` under 1 -- CLOSED, a follow-up to the gap this section
used to name.** `terminalSchemeStyle()` composites the scheme's background
with the operator's opacity slider (`prefs/terminal-scheme.ts`) as a
translucent `rgba()`, painted on `TerminalTab.tsx`'s pane directly.
`TerminalStreamTab.tsx` paints its OWN frame (`[data-terminal-stream]`'s
`style`) with that exact same composite, AND `mapScheme` now passes xterm's
`ITheme.background` the SAME `withAlpha(...)` composite (exported from
`terminal-scheme.ts`) rather than the opaque hex it used to drop
`backgroundOpacity` from -- xterm's DOM renderer (no `@xterm/addon-canvas`/
`@xterm/addon-webgl` installed here) honours the alpha channel in an ordinary
CSS `background-color`, so passing the composited value is the whole fix.
`allowTransparency: true` is set per xterm's own documented prerequisite for
a non-opaque background, though FALSIFIED against this actual build to be a
no-op for the DOM renderer specifically (grepping the compiled
`@xterm/xterm/lib/xterm.js` finds exactly one occurrence of the option, the
default-options declaration, never read elsewhere) -- kept anyway as the
documented contract, at zero measured cost. `terminal-stream-frame-shots.mjs`
now measures the PAINTED pixel (a real screenshot, decoded back through the
page's own compositor, never `getComputedStyle`) at opacity 1 and 0.6, in
both themes, against `TerminalTab.tsx`'s own; both match within a small
(≤5-per-channel) tolerance measured against a genuine, reproducible
Chromium compositing-layer rounding in light theme's near-white ground
(absent in dark), not against a logic defect -- see that guard's own header
for the falsification and the measurement.

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

## 15. The latency guards, now in the automatic checks

The operator's own ask (translated): "the terminal latency/resource
measurement scripts are not in the automatic checks -- fix it." Until this
task both `e2e/terminal-stream-latency-shots.mjs` and
`e2e/terminal-typing-latency-shots.mjs` ran only by hand; the latter was
already registered in `e2e/run-web-guards.mjs`'s `GUARDS` list from an
earlier task but had no retry hardening, and the former asserted nothing
past "eventually seen" -- no p95 bound at all.

### Inventory

Every `e2e/*.mjs` script with "latency" or "perf" in scope, and what each
actually measures:

| script | measures | needs real tmux | wall-clock assertions before this task | now |
|---|---|---|---|---|
| `terminal-typing-latency-shots.mjs` | the POLL path's keystroke chain (`terminal.read`/`terminal.send`), two panes (`sh`, real `claude` fullscreen) | yes | one p95 bound (pane A only; pane B checked but shared A's bound) | per-pane bounds, retry-once-alone on both |
| `terminal-stream-latency-shots.mjs` | the SHIPPED `StreamClient` (control-mode streaming), one throwaway xterm.js harness | yes | none -- only "n of N eventually painted" | three p95 bounds, a write-call batching bound, two structural client-count checks, retry-once-alone on the three p95 checks |
| `terminal-stream-frame-shots.mjs` | visual/CSS parity between the two Terminal tabs | no (stubbed) | n/a -- not a latency script | unchanged, out of this task's scope |
| `terminal-stream-glitch-shots.mjs` | streaming-mode rendering correctness (width, seed line-endings) | yes | n/a -- not a latency script | unchanged, out of this task's scope, and still not registered in `GUARDS` (a correctness guard, not this task's brief) |

Both latency scripts are now registered in `run-web-guards.mjs`'s `GUARDS`
list, which the `web-guards` CI job (`.github/workflows/ci.yml`) already
runs via `pnpm run test:e2e:web` -- that job already installs tmux
(`sudo apt-get install -y tmux`, originally for `terminal-echo-scroll-
shots.mjs`) before the guards run, so no new CI infrastructure was needed,
only the registration and the hardening below. Both guards degrade to a
loud, exit-0 SKIP when tmux is absent (unchanged, pre-existing behaviour);
`terminal-typing-latency-shots.mjs`'s pane B additionally SKIPS (pane A
still gates) when `claude` is not on `PATH`, which is always true on the CI
runner -- pane B has never run in CI and does not today.

### Why a wall-clock threshold needed care here specifically

Two standing lessons this repo already carries make a naive `p95 < X`
threshold a flake generator: `starvation-stretches-11ms-to-5022ms` (how far
scheduling noise alone can stretch a wall-clock number) and a measured
constant differing between this machine and a CI Linux runner. Both guards
now follow the same three-part discipline: (b) a GENEROUS absolute ceiling,
calibrated from real runs with headroom rather than asserted back from the
measured number; (c) asserted only after warm-up (the app/harness is
already interacted with before a test's own timing window starts) and with
enough samples (n=50/30/20/5 depending on the test, matching each
measurement's own natural cadence); and a RETRY-ONCE-ALONE policy: if a p95
misses its bound on the first pass, the SAME measurement is taken fresh
once more before the guard fails for real. Both guards already run truly
ALONE by construction -- `run-web-guards.mjs` runs its `GUARDS` list
serially, one Chromium at a time (its own header: "a flaky guard is the one
the next person disables"), and each script owns a private tmux socket
nothing else touches -- so the retry adds a genuinely fresh sample, not a
re-read of numbers a one-off blip already produced. Deterministic
assertions (matched counts, spawn counts, byte bounds, the write-call
batching count, the control-client counts) get no retry: retrying those
would only hide a real defect.

### `terminal-stream-latency-shots.mjs` -- calibration

Three wall-clock bounds (criterion (b), no in-run poll-path baseline to
ratio against -- this script measures the streaming path alone, via its own
throwaway harness, in a different process than the poll-path script),
calibrated over 11 full runs on a shared MacBook that got visibly busier
partway through:

| test | worst p95 observed (11 runs + 2 earlier "shipped path" runs already on record above) | bound set | headroom |
|---|---|---|---|
| typing (keydown→paint, n=50) | 18.40ms | 150ms | ~8x |
| echo (print→paint, one at a time, n=30) | 92.70ms | 350ms | ~3.8x |
| burst (print→paint, `yes \| head -n 2000`, n=5) | 189.60ms | 700ms | ~3.7x |

Plus one STRUCTURAL (non-wall-clock) bound: `term.write()` calls per burst
loop (5 runs of ~2001 lines each, ~10,005 lines total) stayed in the low
hundreds across 10 measured runs -- 235 / 238 / 281 / 286 / 297 / 311 / 313
/ 395 / 403 / 590 -- because tmux's own control-mode framer coalesces
multiple pty reads into one `%output` notification rather than one per
line. Set at 1200, ~2x the worst of those ten and still ~8x below the raw
line count -- generous enough for the same load variance the p95 bounds
carry retry-once-alone for, while still catching a real regression (writing
once per line would land in the thousands).

Two STRUCTURAL client-count checks, both deterministic: exactly one
control-mode client is attached to the streamed session for the life of the
guard's own connection, and zero remain once it disposes -- the "one client
per open view, zero once it closes" invariant this doc's own Risks section
(above) already names for a real Terminal-stream tab.

### `terminal-typing-latency-shots.mjs` -- pane B's own bound

Pane A (plain `sh`) kept its existing 120ms bound (`PAINT_P95_BOUND_MS`,
already carrying solid headroom -- every calibration run in this task
landed p95 10-17ms). Pane B (a real `claude`, fullscreen TUI) got a NEW,
separate bound: it pays real, inherent paint cost this doc's own "Before"
table already names (rendering a ~900-byte, 137x41, SGR-coloured screen),
and sharing pane A's 120ms bound turned out to be exactly the "known to be
load-flaky" case this task was asked to check. Measured: five clean runs
landed p95 90.10-93.50ms; a full-gate run later in this same task, on a
machine visibly busier (this repo's `node_modules` is a tree SHARED across
every worktree on this machine, and another session's `pnpm install`
landed mid-run), pushed it to 171.20ms, then 174.00ms on the immediate
retry -- a SUSTAINED elevation a single retry cannot absorb, exactly as
retry-once-alone is supposed to behave (it does not mask a persistent
condition, only a one-off blip). `PANE_B_PAINT_P95_BOUND_MS` is set at
300ms, ~1.7x the worst observed. Pane B never runs in CI (no `claude` CLI
on the runner's `PATH`), so this bound only protects a by-hand local run
with `claude` installed from crying wolf on a machine this doc already
calls "shared and loaded"; it has no bearing on what gates a PR.

### Falsification

**The three p95 checks (`terminal-stream-latency-shots.mjs`) and both p95
checks (`terminal-typing-latency-shots.mjs`).** An `artificialPaintDelayMs`
query param / `VAM_E2E_ARTIFICIAL_PAINT_DELAY_MS` env var (default 0 on
every real run) delays each recorded paint by a fixed amount after the real
render. Injected at 300-350ms: every p95 check in both files went red, on
BOTH the first attempt and the retry (the injected delay is deterministic,
so the retry correctly still fails rather than masking it) -- pane A
228-285ms → retry 305-366ms (bound 120ms), pane B 393-444ms → retry
391-449ms (bound 300ms), stream typing/echo/burst all 330-1062ms (bounds
150/350/700ms). Removed after (the env var reverts to unset; nothing in
the shipped code path changed). One bug this falsification pass found and
fixed along the way, in BOTH files: matching a paint to a keystroke/marker
by `array.find(p => p.t >= threshold)` from the start of the array every
time let one early, delayed paint satisfy SEVERAL keystrokes' thresholds at
once (each looking "faster" than the last), understating a genuine, uniform
injected delay rather than reporting it -- fixed with a monotonically
advancing cursor (`terminal-typing-latency-shots.mjs`'s `stageTable`) and by
reading paint TEXT synchronously at render time rather than inside the
delayed commit (`terminal-stream-latency-harness.html`, the same root
cause: a late read observing a buffer a LATER write had already mutated).

**The "exactly one control client" structural check
(`terminal-stream-latency-shots.mjs`).** `VAM_E2E_INJECT_EXTRA_CONTROL_CLIENT=1`
spawns a second real `tmux -C attach-session` against the same target right
after the guard's own client connects (kept alive with a never-ending stdin
pipe -- a real control-mode client exits the instant it sees EOF on stdin,
found by hand while building this lever). With it set: `FAIL exactly one
control-mode client is attached to the streamed session -- 2 client(s)
attached`, while every other check in the file stayed green, including
"zero clients once disposed" (the injected extra client is torn down
alongside the real one). Removed after (the env var reverts to unset).

### The one-line hook for the streaming resource guard

`e2e/terminal-stream-resource-shots.mjs` (CPU, memory, client count, tmux
pause-after backpressure -- branch `vam/stream-default`, not yet landed)
measures the same shipped `StreamClient` the same way this task's own
`terminal-stream-latency-shots.mjs` does: a private tmux socket, its own
throwaway harness. Once it lands, add it to `run-web-guards.mjs`'s `GUARDS`
array as the entry right after `'terminal-stream-latency-shots'` (the very
last two entries in the list) -- see that file's own comment at that spot,
which already names the exact line to add. No new CI job, no new tmux
install: it belongs in the same "runs last, alone, after every other guard's
Chromium has closed" slot for the same reason.

### Gate

`biome check .`, all four `tsc` steps, `vitest run`, `electron-vite build
&& vitest run --config vitest.app.config.ts`, `vite build --config
vite.web.config.ts`, `node scripts/check-bundle-externals.mjs`, the full
58-guard `run-web-guards.mjs` (`VAM_E2E_CHECK_ORPHANS=1`) and
`playwright test --config=e2e/playwright.phone.config.ts` (59 tests) all
passed on this branch. One `run-web-guards.mjs` run mid-task failed two
unrelated guards (`settings-panels-shots.mjs`, then both latency guards on
a separate run) while this task's own concurrent local commands (builds,
`vitest run --config vitest.app.config.ts`) and another session's `pnpm
install` against the shared `node_modules` tree were competing for the same
machine at the same moment -- re-run alone, all 58 passed
(`rerun-suite-isolated-before-triaging.md`, `parallel-suite-runs-fake-mass-
failures.md`, both standing lessons this finding matches exactly).

## Flipping the default

The operator's own decision (translated): "OK, make streaming the default,
but be careful about the performance." "OK" to retiring the capture-pane
renderer as the shipping path, keeping it as the explicit opt-out and the
fallback for tmux < 3.2.

### Performance, measured before the flip, on this branch's own base

Every number below is against `a78f867e` (this branch's cut point, `#478`
streaming + `#484` frame parity + `#488` paste/width/glitch fixes), the same
code this task flips the default on, on this machine, real tmux 3.7b on a
private socket. The latency table already in this document ("After: the
SHIPPED path", above) is the keystroke/output-latency baseline and was not
re-measured for this task -- it is current (same base commit) and its own
conclusion (program output roughly an order of magnitude faster streaming
than polling; typing stays fast either way) is unchanged. What follows is
new: CPU, memory and the client-count invariant, none of which the beta's
own measurement pass covered.

**Idle CPU**, `e2e/terminal-stream-resource-shots.mjs`, this SCRIPT's own
`process.cpuUsage()` (the same process shape `capture-pane` spawns run
inside of and `StreamClient` runs inside of, in `main`), 3 seconds:

| path | mechanism | CPU |
|---|---|---|
| poll (`TerminalTab.tsx`) | 12 `capture-pane` spawns at `REFRESH_MS` (250ms) | 24.5-34.9ms |
| stream (`TerminalStreamTab.tsx`) | one open `tmux -C` connection, nothing printed | 2.5-3.3ms |

Streaming is idle-cheaper by roughly an order of magnitude -- an open pipe
that never wakes up costs less than any interval that spawns a process, at
any interval. Not a surprise, but not previously measured either.

**Heavy-output CPU**, same script, `yes | head -c 5000000` (a real 5MB-class
unthrottled flood) into the pane:

| path | CPU | wall | what it read |
|---|---|---|---|
| poll | 85-119ms | 3s (12 ticks, same as idle) | 12 CURRENT-SCREEN snapshots -- `capture-pane` does not see the bytes in between, so the flood's SIZE never reaches this cost at all |
| stream | 985-990ms | 2.5s (until the flood drains) | every `%output` chunk, decoded (115k+ chunks, 7.5MB) |

**This is the real trade-off the operator's "be careful" asked to see
disclosed, not smoothed over.** The poll path's cost is CONSTANT and small
regardless of output volume, because it only ever reads a snapshot; the
stream path's cost is PROPORTIONAL to output volume, because it forwards and
decodes every byte the pane prints. Against an extreme, sustained,
unthrottled flood (`yes` with no pipe of its own to slow it down -- not a
realistic coding-agent workload, which prints at process/tool speed, not
disk-to-pipe speed) streaming spends roughly 1 second of CPU across a
2.5-second flood on THIS machine. It is bounded (stops the instant the flood
does, never accumulates) and self-limiting (nothing here can run away
indefinitely the way an unbounded buffer could), but it is real and higher
than the poll path pays for the identical flood, and an operator watching a
very chatty build log stream by should expect to see it. Not fixed, because
there is no fix that keeps streaming's whole value (every byte, promptly)
without paying for every byte -- this is disclosed as the cost of the
feature, not hidden as free.

**`%pause`/`%continue`, checked against a REAL tmux for the first time.**
The original spike's own Risks section left this an open question:
"whether tmux enforces this by default or only when a client opts in was not
verified against tmux's own source." Measured here with a raw control-mode
child (`spawnRealControlChild`, bypassing `StreamClient`'s own filtering) and
a consumer that spins 20ms per chunk -- roughly a real DOM render's own order
of magnitude, chosen so a genuinely slow renderer is what this simulates,
not merely a slow test -- against the same 5MB flood: tmux 3.7b on this
machine, with this pane's default configuration, **never sent `%pause` at
all**, reading 19.5MB of raw control-mode bytes over 6 seconds with no sign
of being asked to slow down. **`StreamClient#handlePauseOrContinue`
(`main/terminal/stream/client.ts`) is real, correct code (falsified against
a fake child in `test/sources/tmux-stream-client.test.ts`) that this
measurement could not get a REAL tmux to ever exercise** -- either the
threshold is configured differently than this default, or this tmux version
does not enforce control-mode backpressure without an explicit opt-in this
codebase does not set. This is disclosed as an OPEN RISK, matching the
original spike's own honesty policy, now with a measurement behind it rather
than an unverified guess: the actual backstop against a slow renderer
falling behind a fast producer is xterm.js's own internal write queue
(coalesces, does not drop) and Electron's own IPC queuing, neither of which
this task added or verified has a ceiling. Real coding-agent output (a tool's
own print rate) is far slower than an unthrottled `yes`, which is why this is
named as a disclosed risk for an extreme case rather than blocked on.

**Renderer memory, scrollback**, same script, a real `@xterm/xterm` in a real
Chromium (`--enable-precise-memory-info`, `performance.memory`), heap growth
after filling the buffer:

| scrollback | lines written | heap growth |
|---|---|---|
| 5000 (the shipped cap, `TerminalStreamTab.tsx`) | 5,000 (fills it exactly) | 6.34 MB |
| 5000 | 15,000 (3x the cap) | 6.36 MB -- unchanged, because the cap is DOING its job: the oldest 10,000 lines were evicted, not retained |
| 100,000 (an effectively uncapped comparison) | the SAME 15,000 | 33.87 MB -- more than 5x the capped run's growth, for the identical input |

**5000 is justified, not merely asserted**: capping it is what keeps memory
proportional to the cap rather than to however long a session has been open,
demonstrated by the flat line between "exactly at the cap" and "3x past it"
against the SAME field's uncapped growth for the SAME input. 5000 lines at
this machine's measured ~1.3KB/line (6.34MB / 5000) is a reasonable ceiling
for a terminal scrollback -- an order of magnitude more than a typical
80x24-200 screen's worth of history, small against typical available memory,
and already the shipped value (`TerminalStreamTab.tsx`'s `scrollback: 5000`
predates this task; this section justifies keeping it, not a change).

**Renderer CPU (an approximation, named as one)**, CDP `Performance.
getMetrics()` `TaskDuration` over a session attached to the SAME harness
page, before/after one `term.write()` call carrying 5,000 lines (a burst,
not 5,000 separate writes): **21-22ms of TaskDuration for the WHOLE burst**,
one synchronous call. This is `process.cpuUsage()`'s renderer-process
equivalent, approximated because the renderer runs in Chromium's own process
tree, not this script's; it stands in for "how much main-thread time did
that cost" without claiming the precision a same-process measurement would
have. Bundled together into one write rather than 5,000 xterm.js already
batches the input on its own (a single `term.write()` call queues the whole
string through its internal parser in one pass) -- this measurement is what
that claim rests on: a caller handing xterm one big string, or 5,000 small
`%output`-sized ones arriving over the SAME macrotask window, both resolve
through the SAME internal write buffer, and neither blocks per-chunk on a
render (xterm's own render is RAF-scheduled, decoupled from the parse).

### UPDATE: pause-after, renderer backpressure, and the flood re-measured

The paragraph above (**"%pause/%continue, checked against a REAL tmux for
the first time"**) is now WRONG about the root cause, kept rather than
rewritten so the record shows what was actually measured at the time: a raw
connection genuinely never received `%pause`, but not because this tmux
does not enforce control-mode backpressure -- because tmux (`refresh-client`,
tmux(1) CONTROL MODE) only ever sends `%pause` to a control client that
explicitly opts in with `refresh-client -f pause-after=<N>`. Without it, a
client is NEVER paused, no matter how far behind it falls -- confirmed with
the SAME raw-connection, 20ms-per-chunk-consumer setup the original
paragraph used, now kept as the negative half of `test/main/terminal/stream/
stream-client-pause-after.test.ts`'s own falsification (a real-tmux test
that fails if `StreamClient` ever stops sending the flag).

**The fix.** `StreamClient#connect`/`#reconnect` (`main/terminal/stream/
client.ts`) now send `refresh-client -f pause-after=1` as their first
command, before `list-panes`/`capture-pane`. `1` second -- the low end of
the operator's own suggested 1-2s range -- bounds the worst-case backlog a
stalled drain could build to one second's worth of output before tmux
itself stops pumping the pty to this client, while staying well above an
ordinary IPC round trip, so a normal burst (a fast `ls`, a prompt redraw)
never spuriously pauses. Also measured, and NOT something the original spike
or this task's own brief anticipated: tmux never resumes a paused pane on
its own -- an explicit `refresh-client -A "<pane>:continue"` is required, its
`pane:state` argument MUST be quoted (unquoted is a parse error in tmux's
own command grammar), and the `%continue` it produces arrives INSIDE that
command's own `%begin`/`%end` reply block rather than as a bare notification
line. `#continueAfterPause` sends that resume immediately on every `%pause`
for this client's own pane (this client is never intentionally the slow
party -- see `PAUSE_AFTER_SECONDS`'s own comment), and the reseed that
follows is driven off that command's own reply landing, not off spotting a
bare `%continue` line (kept as a defensive fallback, but measured to never
be the actual path). `test/sources/tmux-stream-client.test.ts`'s new
`describe('pause-after (real-tmux measured fix)')` pins the fake-child argv
and ordering; `stream-client-pause-after.test.ts` proves it end to end
against a real tmux, with the falsification described above.

**Renderer-side backpressure, independently.** The pause-after fix bounds
how far MAIN can fall behind tmux; it says nothing about xterm.js itself
falling behind MAIN, which forwards every decoded chunk over IPC
immediately regardless of whether the renderer has finished parsing the
previous one. `TerminalStreamTab.tsx` now tracks bytes handed to
`term.write(data, callback)` but not yet PARSED (the callback's own
contract) in `pendingBytes`. Above a 2MB high-water mark, further chunks are
DROPPED (never reach `term.write()` at all) rather than asking main to pause
the stream over a new IPC round trip -- simpler, and it bounds renderer
memory unconditionally, since `pendingBytes` can only fall once dropping
starts. Below a 512KB low-water mark (a wide hysteresis gap, so draining
right at the edge does not flap) the screen is PROVABLY stale -- real output
was silently dropped -- so resuming reconnects the stream
(`teardownStream()` then `connect()`), the exact pair this component already
runs for a hidden pane becoming visible again, reseeding it correctly rather
than inventing a second resync primitive. `TerminalStreamTab.test.tsx`'s own
`describe('renderer-side backpressure…')` drives this with a controllable
fake `term.write()` callback and pins: an ordinary small chunk never trips
it, a chunk that crosses the high-water mark is written but every chunk
after it is dropped until draining, and the hysteresis gap is real (draining
only PART of the backlog does not yet trigger the reconnect).

**The 5MB flood, re-measured with both fixes live**,
`e2e/terminal-stream-resource-shots.mjs`, real tmux, a real `StreamClient`
(now sending `pause-after`), a real xterm.js running the SAME high/low-water
-mark logic as the shipped component (mirrored into the measurement
harness, the same way every other renderer measurement in that script
mirrors the shipped component rather than importing it):

| metric | value |
|---|---|
| renderer `TaskDuration` (CDP, the whole flood) | 2238.0ms |
| peak JS heap during the flood | 25.67 MB |
| time-to-quiet (flood issued -> last chunk forwarded to the renderer) | 5142ms |
| chunks dropped by the high-water mark | 0 |
| live screen shows the flood's own trailing marker, BEFORE any reseed | true |
| screen shows the marker AFTER a reseed from a fresh `capture-pane` | true |

**Zero chunks dropped is a real result, not a gap in the measurement**: on
this machine, over a local loopback IPC hop, xterm's own DOM renderer parsed
faster than `StreamClient` could decode and forward -- `pendingBytes` never
sustained above the 2MB mark for this flood. The drop-and-reseed path is a
genuine safety net for a slower device, a heavier DOM (more panes open, a
busier renderer process) or a larger flood than this one, not something
THIS measurement exercised -- that correctness property (dropping actually
stops writes, and the reconnect actually heals a screen that dropped data)
is what `TerminalStreamTab.test.tsx`'s deterministic fake-callback tests
prove instead, the same "measured where real tmux can show it, unit-tested
where the shape needs to be forced" split this whole document already uses
for `%pause` itself. The AFTER-reseed check being unconditionally `true`
here is the property that actually matters end to end: whatever gets
dropped, the very next reconnect a real client performs restores a correct
screen, exactly like a `%pause`-triggered reseed already does one layer
down.

**One control client per visible terminal, and zero after leaving the
view** -- the other half of "be careful about performance", proven against a
real tmux rather than read off the source: `test/main/terminal/stream/
stream-client-count.test.ts` opens a `StreamClient` (real `tmux -C attach-
session` child) against a real private-socket tmux, counts `list-clients`
(1), disposes it and polls `list-clients` back to 0, then repeats the
dispose-before-open sequence `TerminalStreamTab.tsx`'s own visibility/
session-switch effect actually uses and asserts the count is NEVER 2 at any
point in between. Falsified: a temporary variant of the same test that opens
two clients without disposing the first read `list-clients` as 2, proving
the counter is a real measurement and not a stub that would pass regardless.
This is the mechanism half of the requirement; `TerminalStreamTab.tsx`'s own
`document.visibilitychange` handling (`teardownStream()` on hide, a fresh
`connect()` on show, unit-tested in `TerminalStreamTab.test.tsx`'s "closes
the stream when the window is hidden…" case, unchanged by this task) is what
actually drives that sequence from the UI, so exactly one client exists per
OPEN, VISIBLE Terminal-stream view in the real app, and none once the tab or
window is hidden, the session is switched, or the view is left.

**Phone and web build, re-confirmed rather than re-derived.** `src/main/
remote/server.ts`'s `UNSERVED.terminal` entry and `test/main/remote/
server.test.ts`'s matching assertion are both still present on this base;
no `e2e/*.spec.ts` (the phone Playwright suite) references the Terminal
surface at all. The flip changes nothing here: there is no `window.api` in
the web/phone bundle either way, so `TerminalAutoTab`'s pick between the two
renderers never reaches a working pane there regardless of the setting's
now-ON default -- the SAME "desktop only" text (`NOT_AVAILABLE_TEXT`) both
renderers already drew for this case, unchanged.

### The flip

`DEFAULT_STREAMING_TERMINAL` (`prefs/streaming-terminal.ts`) is now `true`.
`TerminalAutoTab.tsx` is the one place `DetailPanel.tsx` now calls for the
Terminal tab -- it reads the live pref (as `DetailPanel.tsx` used to) and
additionally owns the runtime fallback below; `DetailPanel.tsx`'s own diff
for this task is the ternary it used to hold collapsing into one component
call, since that file is a 9,000+ line surface several other epics are
editing concurrently.

### Existing users who were storing the OLD default: migrated, not respected

**Decision: migrate.** `readStreamingTerminal` (`prefs/streaming-terminal.
ts`) has always been TOTAL -- `raw === true`, nothing else -- and
`writePrefs` (`prefs.ts`) has always persisted the WHOLE `Prefs` object on
every save, not a diff. Put together, this means an operator who NEVER
opened Settings at all was still storing `streamingTerminal: false` (the
OLD default) the moment any OTHER preference changed, indistinguishable in
the stored payload from an operator who opened Settings and chose off on
purpose -- there is no third state and never was one. Respecting "whatever
is stored" would have meant the flip took effect for precisely the
population with NO prefs.json at all (a fresh install), and left every
existing operator silently on the polling path forever, which is not what
"make streaming the default" asked for.

The fix is a one-time ratchet, `streamingTerminalMigrated` (`Prefs`,
`prefs.ts`): a payload that does not yet carry `streamingTerminalMigrated:
true` has its `streamingTerminal` forced to the new default (`true`)
REGARDLESS of what was stored, and the flag is set so every LATER load
respects whatever the operator has chosen since -- including turning it back
off, which sticks from that point on. This is the same shape
`migrateSourceKey` already uses elsewhere in this file for a one-time
reshuffle, applied to a boolean instead of a keyed bucket. Tested
(`test/prefs/prefs.streaming-terminal.test.ts`): a payload predating the
field, a payload with the OLD stored `false` and no migration flag, the SAME
payload re-read after migration (proving it is consumed, not re-applied),
and an explicit `false` recorded AFTER migration (proving a real later
opt-out is respected, never bumped back on).

### The fallback

`stream-ipc.ts`'s `tmux -V` gate (`meetsMinimumTmuxVersion`, major.minor >=
3.2, already shipped in the beta) got a more permissive parser for this
task: the original regex required `tmux ` immediately before the digits,
which read a plain release (`tmux 3.2`) and a lettered point release (`tmux
3.2a`) correctly but refused two REAL `-V` shapes outright -- tmux's own
development-branch naming (`tmux next-3.4`) and OpenBSD's long-standing habit
of tagging its bundled tmux with the OS release rather than upstream's
version (`tmux openbsd-7.4`). Both now parse to a `major.minor` pair (3.4 and
7.4 respectively) rather than failing closed on a real operator's real
tmux for a build tag this codebase never asked about. `parseTmuxVersion`/
`meetsMinimumTmuxVersion` are exported and directly unit-tested
(`test/main/terminal/tmux-version-parse.test.ts`) for the first time --
previously only reachable through the IPC handler's own integration test.

**What "unsupported-tmux" DOES now, which it did not before this task**:
`TerminalStreamTab.tsx` gained an `onFallback` prop
(`StreamFallbackReason = 'unsupported-tmux' | 'max-attempts' |
'session-gone'`), fired -- once, alongside its own existing refusal/down
text, never instead of it -- when `terminalStreamOpen` refuses specifically
`unsupported-tmux`, or when `StreamClient`'s own `onDown` reports `gave-up`
(both `'max-attempts'`, its bounded reconnect retries exhausted, and
`'session-gone'`, folded in for the same reason: a frozen pane with no
explanation is worse than a fallback that says plainly why). Every OTHER
refusal (`bad-request`, `unavailable`, `unresolved-session`) is about THIS
request, not this operator's tmux, and does not fall back -- falling back
would not help (the classic renderer resolves the same session the same
way) and would hide a real refusal behind a renderer swap.

**`TerminalAutoTab.tsx`** (new) is what actually acts on the callback: it
owns the live `streamingTerminal` pref read AND a small `fallback` state,
reset on every project/row change (a tmux that could not stream says
nothing about the NEXT session an operator opens). While `fallback` is set,
`TerminalTab.tsx` draws instead, carrying a new `notice` prop -- a one-line
sentence (`data-terminal-fallback-notice`, e.g. "vam switched to the classic
terminal: this tmux is older than streaming needs.") drawn ABOVE the pane in
every one of `TerminalTab.tsx`'s existing return branches (pending, refused,
unavailable, mispaired, gone/ambiguous, and the ordinary screen), computed
once and shared, so the notice is visible even when the SAME tmux that
failed the version gate also cannot answer a `capture-pane` read. Unit
tested end to end: `unsupported-tmux` and both `gave-up` reasons each drop
`TerminalAutoTab` to the classic tab with the matching notice text
(`TerminalAutoTab.test.tsx`), and a session switch after a fallback gives
the NEW session a fresh attempt at streaming rather than carrying the old
one's verdict forward.

`TerminalTab.tsx` itself is now documented as the fallback/opt-out path, not
the primary one -- its own header was never framed around "the default" (it
describes what it draws, which is unchanged), but `prefs.ts`'s field
comment and this file's own status line, which DID call it "shipping" and
the beta's own "the polling path... stays the default", are updated to say
so plainly.

### Guards

- **The default is streaming**, asserted three ways: `DEFAULT_STREAMING_
  TERMINAL === true` (`test/prefs/prefs.streaming-terminal.test.ts`), a fresh
  `readPrefs` on an empty/predating payload resolving `streamingTerminal:
  true` (same file), and a real browser against the real web build
  (`e2e/terminal-streaming-settings-shots.mjs`, `aria-checked === 'true'` on
  the Settings row with nothing overridden).
- **One control client per visible terminal, zero after leaving the view**:
  `test/main/terminal/stream/stream-client-count.test.ts`, covered in the
  performance section above.
- **The version-parse fix**: `test/main/terminal/tmux-version-parse.test.ts`,
  the four real `-V` shapes named above plus the existing below-floor and
  unparsable cases.
- **The fallback path**: `TerminalStreamTab.test.tsx` (the `onFallback`
  callback fires for `unsupported-tmux` and both `gave-up` reasons, never for
  a mere `reconnecting` event, and never for the other three refusal
  reasons) and `TerminalAutoTab.test.tsx` (the callback actually drops the
  rendered tab and carries the right notice, and a session switch resets
  it).
- **Web guards updated for the new default**, not merely left to fail: every
  `e2e/*.mjs` guard whose subject is the CLASSIC `[data-terminal-pane]`
  renderer specifically (chrome/width measurement, scheme/colour settings,
  echo/scroll, IME, Insert-mode focus, scrollback, typing-latency, the
  terminal-only and start-screen smoke checks) now seeds `streamingTerminal:
  false` explicitly in its own `localStorage` payload -- each was silently
  relying on the OLD default before this task, since none of their stub
  `window.api` objects carry a `terminalStream` member at all.
  `terminal-streaming-settings-shots.mjs`'s own default-value check flipped
  from asserting `aria-checked === 'false'` to `'true'`. The two guards that
  already drove `streamingTerminal` explicitly either way
  (`terminal-stream-frame-shots.mjs`, `terminal-stream-glitch-shots.mjs`)
  needed no change.
- **A new resource-measurement script**, `e2e/terminal-stream-resource-
  shots.mjs` (informational, run by hand, not wired into `run-web-guards.
  mjs`'s automated list -- the same convention `terminal-stream-latency-
  shots.mjs` already follows) -- everything in the performance section above
  is reproducible by running it.

### Settings label

`settings.behaviour.streamingTerminal.label` dropped its `(beta)` suffix
(`"streaming terminal"`); the hint text is unchanged
(`"a live xterm.js pane instead of periodic capture"`) -- a longer
description naming the automatic fallback was drafted and then trimmed back
to the original wording, because `test/settings/copy-budget.test.tsx` caps
the whole Behaviour panel's prose at 210 words and the longer version pushed
it to 217; the fallback itself is still disclosed, just at the point it
actually happens (`TerminalAutoTab`'s notice), not pre-emptively in a
settings hint few operators read before they need it.
