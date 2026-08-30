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

It also only ever drives the **dev** server. `vite.config.ts` declares its
`/api` proxy once, as a single `proxy` object that both `server.proxy` and
`preview.proxy` reference, so `vite preview` shares the same `configure` hook
and therefore the same fix — but no run here has exercised preview, so
"shares the fixed code path" is the claim, not "tested". A future edit that
split that shared object into two literals could drop the hook from one of
them and nothing in this repo would catch it: `e2e/` is excluded from every
gate, and this spec only ever loads the dev server.

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

# 3. Run it (this also starts and stops vam's own vite dev server for you).
npm run test:e2e
```

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
