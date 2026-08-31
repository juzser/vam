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
