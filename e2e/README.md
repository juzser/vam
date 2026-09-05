# AC-G1 — SSE drop, through vam's own vite proxy

This harness is not part of vam's own gates. `vitest.config.ts`, `tsconfig*.json`
and `biome.json` all deliberately exclude `e2e/`, so nothing here is run
automatically, and nothing here will ever tell a future change that this spec
has rotted. **The first thing to re-run after any change to the canvas, the
SSE wire contract (`src/adapter/stream.ts`), or the vite proxy
(`vite.config.ts`) is this spec, by hand.**

## What this can show

On this machine, through vam's OWN `vite` dev proxy (never black-smith's port
directly — cross-origin `EventSource` from vam's origin to black-smith's port
delivers zero events), a black-smith process that is killed should surface at
the browser as an `error` event, and — **if the process is back before the
browser's single retry, roughly 3s after the drop** — the browser's own
reconnect should surface `open` then `hello` with `readyState` never observed
as 2 (CLOSED), and the canvas should then show, with no reload, the session
that changed while the server was down.

If the server is still down at that retry, this is not what happens: vite
answers a dead upstream with `HTTP/1.1 502 Bad Gateway`,
`Content-Type: text/plain`, which the HTML specification makes a fatal
`EventSource` error, so `readyState` becomes 2 (CLOSED) and no further
attempt is made. See "What this cannot show" below for what that means for
outages longer than one retry.

## What this cannot show

`kill()` closes the TCP socket cleanly — the EASY case for a proxy to
propagate. It says nothing about a half-open connection on a machine where the
proxy behaves differently, nor about a production host with no proxy at all.

This spec itself only ever drives the **dev** server. `vite.config.ts`
declares its `/api` proxy once, as a single `proxy` object that both
`server.proxy` and `preview.proxy` reference, so `vite preview` shares the
same `configure` hook and therefore the same fix — and that path is no
longer merely claimed shared, it is now exercised: `e2e/sse-drop-reconnect.pw.ts`,
below, serves through `vite preview` on this same proxy and its committed
transcript records the page's `EventSource` seeing `error` at `readyState` 0
after vite is killed, propagated through the preview proxy exactly as this
spec's own drop propagates through the dev one. A future edit that split
that shared `proxy` object into two literals could still drop the hook from
one of them with nothing in this repo to catch it: `e2e/` is excluded from
every gate, and neither spec's own run would notice a regression in the
other's path.

It also does not show recovery from a **long** outage. See the note below: on
this machine the browser retried once, roughly 3s after the drop, and a run
where the server was never restarted ended with `readyState` 2 (CLOSED) and no
further attempt. The green run's server is back within that window.

## What it actually found (2026-08-29, see `acg1-transcript.json`)

**The whole path, including the reconnect half, now passes.** The committed
transcript is the one the harness wrote, after step (d), and holds seven
tuples in order: `open`, `hello`, `change` (naming session A), `error`
(`readyState` 0), then a post-restart `open`, `hello` and a `change` carrying
session B — the session appended while the server was down. No tuple has
`readyState` 2.

The post-restart `open` and `hello` are matched only against tuples recorded
**after** a watermark taken the moment the `error` arrived
(`waitForTuple(..., fromIndex)`), because `window.__sseEvents` accumulates for
the life of the page: an unwindowed search is satisfied by the `open`/`hello`
from page load and measures nothing. That windowing was verified by
falsification — with the restart removed, the spec fails at
`fromIndex 4` after 30s, having recorded a second `error` with `readyState` 2;
the same code searching from index 0 passes that scenario instantly.

So what the reconnect half now demonstrates, concretely: the browser's own
`EventSource` — through vam's dev proxy, with no reload and no app code
touched — reopened after the drop, received a fresh `hello`, and the canvas
refetched, showing a session that only ever existed in the log while the
socket was down. That is AC-10 measured against a real server rather than a
mock.

**Observed, not asserted, and worth knowing:** the reconnect happened ~3s
after the drop, not at the 10000ms the `hello` frame advertises as `floorMs`,
and in the no-restart falsification run the client gave up after that single
retry (`readyState` 2). Whether an outage longer than one retry interval
recovers at all is untested and is not something this spec currently claims.

**This spec's pass depends on the `configure` hook in `vite.config.ts`**
(vam `followup-52085d00`), which ends the client response when the upstream
`proxyRes` closes or errors. Original finding, kept for context: before that
fix, steps (a) and (b) passed but step (c) did not — after the server was
killed, no `error` reached the browser within 10s, on two separate runs, and a
manual `curl -N` probe through the same proxy showed the client connection was
never closed on either side. That was the silent-stall case this file used to
only warn about. If the hook is reverted, this spec is expected to fail at
step (c) again for that reason.

## The cost this adds

A pinned Playwright harness fetched at run time (`npx @playwright/test@1.62.1`)
and a headless Chromium download — near-zero on a machine with
`~/Library/Caches/ms-playwright` already populated, ~100MB on a fresh clone.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `SMITH_CLI_ENTRY` | Absolute path to black-smith's built CLI, e.g. `factory/orchestrator/dist/cli.js`. |
| `SMITH_E2E_STATE_DIR` | A **throwaway** directory the test may create, write events into, and delete. Never black-smith's real `state/` — a live orchestrator session writes there, and this test kills a server mid-run. |
| `SMITH_E2E_PORT` | The port black-smith's server binds and vam's vite proxy forwards to (matches `vite.config.ts`'s `VAM_SMITH_URL` default, `4680`, unless you set `VAM_SMITH_URL` too). |

## Install

Playwright and a browser must be present. From the vam repo root:

```bash
npx @playwright/test@1.62.1 install --with-deps chromium   # first time only
```

## Run

**Nothing may already be listening on `SMITH_E2E_PORT`.** The spec starts,
kills and restarts black-smith itself; a server you started by hand survives
the spec's `kill()`, so the drop never reaches the browser and the run fails
at step (c) for a reason that has nothing to do with vam. Check with
`lsof -ti tcp:4680` first.

```bash
# 1. A THROWAWAY state dir — never black-smith's real state/, since a live
#    orchestrator session writes there and this test kills a server mid-run.
STATE_DIR=$(mktemp -d)

# 2. Point the spec at it. The spec spawns black-smith on this port itself.
export SMITH_CLI_ENTRY=/path/to/black-smith/factory/orchestrator/dist/cli.js
export SMITH_E2E_STATE_DIR="$STATE_DIR"
export SMITH_E2E_PORT=4680

# 3. Playwright is NOT a vam dependency and vam's node_modules is a symlink to
#    one tree shared by every worktree on this machine, so install it LOCALLY,
#    beside the spec. Copy it from an existing npx cache if you have one;
#    never install into the shared tree, which would break every other vam
#    checkout.
#    e2e/node_modules needs no ignore rule of its own: the committed
#    .gitignore's first line, `node_modules/`, already covers it at any
#    depth, so the --untracked-files=all dirty stamp does not fire on it and
#    a fresh clone needs nothing extra. (Check it with
#    `git check-ignore -v e2e/node_modules`, and note the trailing slash
#    matters: `node_modules/` matches DIRECTORIES, so the rule only resolves
#    once the directory actually exists -- run the check after copying it in,
#    not before, or you will be told a different rule matched.)
#    cp -R "$(npm root -g)/../_npx/*/node_modules" e2e/node_modules   # or npm i --prefix e2e @playwright/test@1.62.1

# 4. Run it (this also starts and stops vam's own vite dev server for you).
e2e/node_modules/.bin/playwright test --config=e2e/playwright.config.ts
```

**Use that command, not `npm run test:e2e`.** The `test:e2e` script shells out
to `npx`, and in this layout npx's own install and the config's bare
`import '@playwright/test'` resolve to two different places, so the run dies
before it starts with `ERR_MODULE_NOT_FOUND: Cannot find package
'@playwright/test'`. The committed transcript's `runnerCommand` field records
the local-binary form for the same reason: a transcript that names a command
which cannot reproduce it is exactly the defect this epic spent a plan version
correcting on the `vamSha` field.

`npm run test:e2e` shells out to `npx`. With an npm 6 `npx` on `PATH` the
runner and the spec's `import '@playwright/test'` can resolve to two different
installs and Playwright aborts with "did not expect test() to be called here";
run under Node 22+ with its own npm (`nvm use 22`).

The test itself drives step (b) — a real server-side write, not a poke at
vam — via:

```bash
node "$SMITH_CLI_ENTRY" event append '<json event>' --state-dir "$SMITH_E2E_STATE_DIR"
```

where `<json event>` has the shape `{session_id, actor, event_type,
plan_version, causal_parent, payload}`. See `sse-drop.spec.ts` for the exact
payloads used for the pre-existing session (step a/b) and the session created
while the server is down (step d).

## Cleanup

The test kills its own server processes with `SIGKILL` at the end of the run
and on failure paths. Remove the throwaway `$STATE_DIR` yourself once done —
it is never touched automatically. `e2e/test-results/` and
`e2e/playwright-report/` (Playwright's own run artifacts) are gitignored;
delete them freely.

---

# AC-10 (client) — reconnect after a transport flap, black-smith alive

`e2e/sse-drop-reconnect.pw.ts`, its own config
(`e2e/playwright.reconnect.config.ts`). Added by
`factory/specs/active/vam-acg1-discriminating-ac10/epic.md`. **Neither this
test nor AC-G1 above subsumes the other** (epic.md section 4):

- **AC-G1** restarts black-smith. A fresh process's cold fingerprint cache
  manufactures a masking `change` on reconnect regardless of whether the
  client refetches on `hello`, so AC-G1 passes even with `onHello` deleted
  from `src/adapter/useCanvas.ts` (finding
  `f-vam-sse-canvas/integration-424bca70`). It measures AC-10's SERVER half
  — recovery across a real restart.
- **This test** keeps black-smith running and drops the TRANSPORT (vite)
  instead, against an already-warm fingerprint cache (measured against a
  real server before this epic was signed —
  `factory/specs/active/vam-acg1-discriminating-ac10/design-validation.txt`
  in the black-smith repo; a precondition, not this test's own result), so no
  masking `change` forms. The canvas can then only show the session written
  during the outage through `onHello`'s own refetch — deleting that line is
  expected to fail this test.

## What this does not measure (epic.md section 8)

It does **not** restart black-smith and does **not** cover AC-10's server
half at all — that is AC-G1's job. It does not test black-smith's cold-cache
rescan (real and correct, but the confound this test keeps off its path).
It does not prove `onHello` is *correct*, only that it is *necessary*.

## Production build, not the dev server — a real difference from AC-G1

This spec runs `vite build` once, then serves through `vite preview`
(port 5274), not `vite` dev. `vite`'s own HMR client reconnects its
websocket independently of the app's `EventSource` and, on that reconnect,
forces a full `location.reload()` — which would discard this harness's
page-side instrumentation exactly when the test needs the canvas to persist
without reloading. `vite preview` has no dev client and no such reload.
`vite.config.ts`'s `preview` block already proxies `/api` through the same
`proxy` object `server` uses, on this same port — this test is the first run
to exercise that path. The build runs inside the spec itself (into the
gitignored `dist/`); no separate build step is required by hand.

## How "black-smith never died" is proved

A single `GET /api/health` 200, taken immediately before the final canvas
assertion, proves liveness **at that one instant and nothing more** — a
died-and-restarted process answers 200 just as happily, with a cold cache
that would silently void the run. The structural proof for the WHOLE run is
**stream A**: a second, genuinely real SSE client the harness opens directly
against black-smith's `/api/stream` (bypassing vite), via `fetch` with a
hand-rolled frame parser — no `EventSource` global, no auto-retry. Its own
job, beyond instrumenting the run, is to hold `listeners.size >= 1` so
`changeFeed.ts:143-169`'s watcher stays armed through the outage. Two checks,
both required: **exactly one `hello`** across the whole run (a restarted
black-smith cannot deliver the same connection twice), and stream A's **body
never ends, errors, or is re-opened** before the final assertion (the reader
does not auto-retry, so a death surfaces here, not as a second `hello`).

## Environment variables

Same three as AC-G1's harness above. `SMITH_E2E_PORT` must still match
`vite.config.ts`'s `VAM_SMITH_URL` default (`4680`) unless `VAM_SMITH_URL` is
also set — both the dev-server and preview-server proxies share the same
target resolution. The spec `test.skip`s, never false-passes, when any of
the three is unset.

## Run

**Nothing may already be listening on `SMITH_E2E_PORT` or on `5274`** (this
test's own preview port, distinct from AC-G1's 5273).

```bash
STATE_DIR=$(mktemp -d)
export SMITH_CLI_ENTRY=/path/to/black-smith/factory/orchestrator/dist/cli.js
export SMITH_E2E_STATE_DIR="$STATE_DIR"
export SMITH_E2E_PORT=4680

e2e/node_modules/.bin/playwright test --config=e2e/playwright.reconnect.config.ts
```

## Reproducing the committed transcript

`e2e/acg10-reconnect-transcript.json` carries the same stamp fields as
`e2e/acg1-transcript.json` (`runnerCommand`, `playwrightVersion`, `vamSha`,
`blackSmithSha` with the same `-dirty` suffix rule, `capturedAt`, `sessionA`,
`sessionB`, `tuples`, `canvas`), plus a `streamA` object with its own
recorded frames and `helloCount`. `runnerCommand` names this section's
config, not AC-G1's.

## Negative control

This spec's discriminating power (epic AC-3) was proved by running it once
with `onHello` deleted (red) and once restored (green); both runners'
verbatim output is committed in the black-smith repo at
`state/artifacts/vam-acg1-discriminating-ac10/task-2-falsification/falsification-onhello-removed.txt`
and `.../confirmation-onhello-restored.txt`, not in this repo (raw output
carries absolute machine paths).

## Cleanup

Same discipline as AC-G1: the spec kills its own vite and black-smith
children with `SIGKILL` in a `finally` on every path, including failure.
SIGKILL, not the default signal, because `vite preview`'s graceful shutdown
waits for the page's long-lived SSE connection to drain, which it never
does. Remove the throwaway `$STATE_DIR` yourself; `dist/`,
`e2e/test-results/` and `e2e/playwright-report/` are gitignored.

## Exposure shared with AC-G1

`vitest.config.ts`, `tsconfig*.json` and `biome.json` all exclude `e2e/` (see
above) — nothing in vam's own gates will tell a future change that this spec
rotted either. Re-run it by hand alongside AC-G1 after any change to the SSE
wire contract, the vite proxy, or `src/adapter/**`.

---

# The phone shell at 390px — what a content scan could not say

`e2e/phone-shell.pw.ts`, its own config (`e2e/playwright.phone.config.ts`,
port 5277). It exists because two properties of the phone shell (PR #191) are
asserted in the unit suite by reading `src/renderer/styles.css` as **bytes**:
`test/phone/touch-targets.test.tsx` and `test/phone/overlay-sheets.test.ts`.
Both headers say so themselves, and both name a Playwright pass at 390px as
the thing that would settle them. jsdom lays nothing out, so a scan can only
say the rules EXIST — never that a control is 44px, that a sheet's bottom edge
is where it should be, or that a selector matches anything at all.

## Run

Needs nothing but a free port 5277 — no black-smith, no state dir, no
environment variables. The fixture is the built page's own `?demo=1` mode, and
the config builds and serves it itself.

```bash
e2e/node_modules/.bin/playwright test --config=e2e/playwright.phone.config.ts
```

## What it found (2026-09-05, against `4c7188f`)

Four failures, all product findings, none of them a defect in this harness.

1. **The hover-only close control is still hit-testable, and still takes the
   row's tap.** `styles.css` carries
   `[data-phone-shell] [data-session-row] button[aria-label^='close '] { display: none }`
   and the unit scan asserts that text is present. The selector **matches
   nothing**: the close `x` is a SIBLING of `[data-session-row]`, not a
   descendant of it, so it stays `opacity: 0` with `pointer-events: auto` over
   the row's own top-right. A tap there is measured to leave the shell on the
   list and to put the close route's refusal on the status line — the exact S2
   #191 was written to remove, still live at real width behind a green test.

2. **17 of 23 controls on the list screen are under 44x44**, including
   `data-project-icon` at 15x15 and the row close buttons at 15x16.5. The
   `styles.css` rule enumerates seven controls, and the ones it names DO
   measure 44 (settings, the theme toggle, the step chips, the composer's
   record button, the phone app bar's back and close); everything the shell
   HOSTS rather than owns was never in the list. Issue #188 is open on this.

3. **6 of 17 on the session screen**: the three response tabs at 115.7x26,
   `data-progress-toggle` at 63.1x18.3, `data-attach` at 24x24 and
   `data-model-request` at 84x24.

4. **The icon picker cannot bring an emoji above an iOS keyboard.** See below.

Green in the same run: list -> session -> back; the session bar's close control
(visible, 44x44, clear of the back chevron); both reachable sheets
bottom-anchored, capped at 85dvh and scrolling within themselves; and the
sheet re-capping when the layout viewport shrinks.

## The keyboard, and the line this harness does not cross

A headless Chromium at 390x844 has no soft keyboard, and its `visualViewport`
is not the thing that breaks on iOS. Nothing here simulates one. The claim is
split in two instead:

- **The Android/Chrome case is reproduced exactly.** Those engines shrink the
  LAYOUT viewport when the keyboard opens and `dvh` tracks it; resizing the
  viewport is that same event. Measured: the sheet re-caps to 85% of the
  shrunk viewport and stays wholly inside it.
- **The iOS case is computed, not simulated.** On iOS the layout viewport does
  NOT shrink, so every box measured here sits at the coordinate it would
  occupy on the device; the keyboard merely covers the bottom of them. Whether
  the sheet's own scroller can lift its primary action into the band that is
  left is then a scroll, and a scroll is layout. Measured, with the picker's
  own search box focused (which is what raises the keyboard on a device): the
  icon picker sheet spans 411–844px, its ONLY scroller spans 581–831px, and
  after every scroll it allows the first emoji's bottom sits at 621px. A
  336px keyboard leaves the top 508px visible, so the picker's entire reason
  for existing is 113px under the fold with nothing left to scroll.

`IOS_KEYBOARD_CSS_PX` (336) is an estimate and is used as one — iPhone
portrait keyboards run roughly 291–380px depending on the accessory and
prediction rows. The assertion reports the margin it failed by, so a real
device figure can be substituted at the top of the file and the verdict
re-derived rather than re-argued. Any keyboard taller than 264px covers that
first emoji row.

## What it still cannot say

Two of the four `data-overlay-host` sheets could not be opened at 390px at
all in this fixture, and the suite says so in a `test.skip` with the reason
rather than asserting them from CSS a second time. `ErrorLogPanel`'s only
phone route is the `N failures` button, which `PhoneShell` draws when
`failureCount > 0`; demo mode records every refused write as a `refusal`, never
a `failure`, so the count is structurally 0. `ProjectPicker` opens from
`onAddToGroup`, which needs a group, which needs a source that accepts writes.
The shared sheet RULE is now measured on two real panels — a short one and one
with a fixed `h-[min(600px,80vh)]` of its own — but each unopened panel's own
inner layout is not.

Nor is any of this a device. It is one engine at one width with square pixels
and no rubber-band scrolling; Safari's own sheet behaviour, the accessory bar,
and `env(safe-area-inset-bottom)` (0 in this browser) are all outside it.

## Exposure shared with the specs above

`vitest.config.ts`, `tsconfig*.json` and `biome.json` exclude `e2e/`, so
nothing in vam's gates will tell a future change that this spec rotted either.
Re-run it by hand after any change to `styles.css`'s phone block,
`src/renderer/phone/**`, `SessionList`, `DetailPanel`, or any of the four
overlay hosts.

## Second pass (2026-09-05, against `985f96b`) — the search route and the last two sheets

### `vam-phone-uiux/spec.md` §5.3's premise is false, and that is the answer to it

§5.3 asks whether the phone's search route is survivable, on the reading that
the "Search sessions" control opens `data-filter-menu` — the one overlay family
the phone rules deliberately do not adapt. It does not. `onOpenFilter` is
`setFiltering(true)` (`Canvas.tsx`), and `SessionList.tsx:870`'s ternary swaps
the button for an **in-place `<input aria-label="filter sessions">`** in the
same row. Measured at 390x844 with a query typed: the box sits at **117–141px**,
is focused by the shell itself, and is 16px (no iOS zoom); the list region
starts at **210px**; the surviving result sits at **236–300px**. All of it is
inside the 508px an iOS keyboard leaves, and the list's own scroll region
begins above that band — which is exactly the property the icon picker lacks.
`[data-filter-menu]` is not in the DOM on this route at all.

So §5.1 (do not build a palette bottom sheet) is not blocked by §5.3, and the
"make the search control a real sheet" remedy is answering a problem the
measurement does not find.

### The filter popover, measured for its own sake

`data-filter-menu` (behind the funnel, `data-filter-toggle`) holds status and
mode toggles and **no text box**, so nothing in it raises a keyboard. At
390x844 it spans 193–433px, entirely inside the band, with its four status
buttons at 44px.

Its exposure is structural rather than iOS-specific and it is left red: it has
`max-height: none`, `overflow-y: visible` and no scroller, so its usable height
is fixed by where it is anchored. At 375x667 (iPhone SE portrait, still
shipping) with the viewport shrunk by a keyboard, its two mode toggles are
**off-screen at 383px and 422px in a 331px viewport, with nothing to scroll**.
The four sheet-ruled hosts get a cap and a scroller for exactly this case; this
popover is excluded from them by design.

### The two sheets the first pass could not reach

Both are now measured, without touching `src/`, by answering `/api/describe`
and `/api/load` from the test instead of using the demo fixture — `App.tsx`'s
browser path asks its own origin for those two routes. The stub is a
**transport, not a server**: it serves a descriptor and three sessions and
refuses every write in the port's own envelope, which is enough to draw both
sheets and enough to record a real failure (a refused write rejects in
`http-factory`'s `call` and `Canvas` puts it through `noteFailure`, which is
what `failureCount` counts). It settles layout and nothing else.

- **`ErrorLogPanel`** — reachable, and correct as a sheet: opened from the
  44x44 `N failures` button, spans 731–843px in an 844px viewport, capped at
  717.4px (85dvh), `overflow-y: auto`. Its own two controls are 47.7x22
  ("Clear") and 57.8x22.5 ("Report"), both under 44.
- **`ProjectPicker`** — correct as a sheet (727–844px, capped, `auto`), and
  **it has no phone route at all**. Its only opener, `data-add-to-group`, is
  19x19 and `opacity: 0` until its heading is hover-`revealed`; a coarse
  pointer cannot satisfy that, and no chord or other control reaches it. Same
  family as the row's close `x`, but without the second route — the sheet
  above was measured through a forced tap, which the suite says out loud so
  the geometry is not misread as evidence that the route works.

Six red of sixteen when this pass was written: the four from the first pass,
plus the filter popover's missing scroller and the project picker's missing
route. Then #197 landed — see below.

## Third pass (2026-09-05, against `2569a81`, i.e. after PR #197)

**All four of the first pass's findings are fixed and their tests are green.**
Re-measured against the fixed build, and the numbers in the two sections above
are now history — they describe `4c7188f`:

- Every interactive control on both phone screens now measures at least 44x44
  (19 controls on the list screen, 17 on the session screen, **0 undersized**).
  The list screen has four controls fewer than before because the row's close
  `x` is genuinely gone from the tree rather than merely invisible.
- The tap at the row's top-right opens the session.
- The icon picker now clears an iOS keyboard with room to spare: the sheet
  spans **127–844px** (a full 85dvh, where it used to be 411–844) and its
  scroller starts at **296px**, well above the 508px band, so an emoji can be
  brought up. It used to start at 581px, below the band, which is what made it
  unreachable.

**Two remain red, both found in the second pass and neither addressed by #197:**

1. `data-filter-menu` still has `max-height: none`, `overflow-y: visible` and
   no scroller (test: *the filter popover has no scroller…*).
2. `ProjectPicker` still has no phone route. #197 sized the opener — it now
   measures 44x44 instead of 19x19 — but it is **still `opacity: 0` until
   hover**, so a finger still cannot reveal it. A touch-target sweep is
   satisfied by that change and a hit test is not: this is the same pairing
   that made the row's close `x` survive a green content scan, in the other
   direction.

## Fourth pass (2026-09-05, against `be88c7d`) — on `main`, and green

**The suite is on `main` now.** Every pass above ran because someone dispatched
it by hand, off an unmerged branch, which means the guards that caught the
invisible close button, the 17 undersized controls and the icon picker under
an iOS keyboard were guarding nothing. Three defects, all real, none visible to
jsdom. That is the change this pass is mostly about.

Nothing in vam's gates runs it — `e2e/` is excluded from `vitest.config.ts`,
`tsconfig*.json` and `biome.json`, by design and unchanged — so "on main" means
reachable and green, not automatic. The re-run list at the end of the first
section still applies.

**17 of 17 pass.** Three things had moved under the suite since the third pass:

1. **The step rail and the body tab strip are gone** (#205). The navigation
   test asserted `[data-step-rail] [data-step-chip]`, which now matches
   nothing — and a selector matching nothing is the exact failure this file
   was written to catch, in `styles.css`'s row-close rule. Re-pointed at the
   chrome the session screen has now: the back chevron, `data-prompt-target`,
   and the view icons.
2. **The 44px sweep measures five app-bar buttons where it measured two**, from
   the same PR. Still 0 undersized on both screens.
3. **`ProjectPicker` has a phone route** (#202), so the second of the two
   findings left red by the third pass now passes on its own.

### The filter popover: fixed, and the test now asserts reach

The remaining red one. It kept `max-height: none` and `overflow-y: visible`
because it is an anchored popover deliberately excluded from the phone sheet
rules — turning it into a bottom sheet moves it away from the control it
belongs to, and that exclusion stands. What it lacked was a cap, and the cap
could not be a constant: CSS cannot say "as tall as the distance from here to
the bottom of the viewport" for an absolutely positioned box, and any number
that stood in for it would be tuned to one anchor position.

`SessionList`'s `useFilterPopoverCap` measures the popover's own top edge —
which is where its anchor put it — and caps it at the distance from there to
the viewport foot, re-measured on `resize` (window, never `visualViewport`,
which `styles.css` rules out for jitter). One constant survives, an 8px foot,
and it is a margin rather than a position.

The test changed shape with it, and the shape is the point: it asserts REACH,
not position. The popover must fit its viewport, and every control in it must
be on screen at some scroll offset of its own scroller — sampled at both
extremes, because a cap without a scroller would clip exactly the controls the
old layout pushed off the bottom, and a test that only looked at the top would
not have seen the difference. Falsified: reverting the cap reddens it with
`bottom 447 > viewport 331` at 375x667.

### One test added: the paint, which the sweeps cannot see

*every painted skin is smaller than the box that takes the tap.* The two 44px
sweeps measure the ELEMENT box, so they stay green through the complaint that
started this work — a `border-line` rectangle drawn AT 44 around a 13px glyph,
which is what made the phone's bordered controls the heaviest objects on the
screen. The rule is hit on the element, paint on a `[data-tap-skin]` child, so
this test caps the skin at 32x36 and, in the same breath, requires its owner
to still measure 44: the ceiling catches a border re-inflating onto the hit
box, and the paired floor stops anyone satisfying the ceiling by shrinking the
hit box instead.

Three skins on the list screen today. The count is asserted twice — as a floor
and inside the expression the assertion reads — because a filter over an empty
list is empty, and a guard written the obvious way passes loudest at the moment
the hook is renamed away. Falsified both ways: re-inflating the skin to 44
names all three controls; renaming the hook fails on the count.
