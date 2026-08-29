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
the browser as an `error` event, and once the process is back, the browser's
own reconnect should surface `open` then `hello` — with `readyState` never
observed as 2 (CLOSED) — and the canvas should then show, with no reload, the
session that changed while the server was down.

## What this cannot show

`kill()` closes the TCP socket cleanly — the EASY case for a proxy to
propagate. It says nothing about a half-open connection on a machine
where the proxy behaves differently, nor about `vite preview` (a second,
separate proxy block in `vite.config.ts`), nor about a production host with
no proxy at all.

## What it actually found (2026-08-29, see `acg1-transcript.json`)

Steps (a) and (b) passed on every run: `open`, then `hello`, then `change`
(naming the session) all arrived within their windows. Step (c) did not: after
the server was killed, no `error` event reached the browser's `EventSource`
within the spec's 10-second window — on two separate runs. A manual probe
(`curl -N` through the same vite proxy, same kill) shows why: the client
connection is never closed at all, on either side. **This is the silent-stall
case this file used to only warn about** — the vite dev proxy is not
propagating the upstream's TCP close to the client. See
`acg1-transcript.json` for both runs' event tuples. Do not tune the test to
force it green; a transcript that honestly records the drop did not reach the
browser is the valuable result here.

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

```bash
# 1. Start black-smith against a THROWAWAY state dir — never the real state/.
STATE_DIR=$(mktemp -d)
node /path/to/black-smith/factory/orchestrator/dist/cli.js ui serve \
  --port 4680 --state-dir "$STATE_DIR" --db "$STATE_DIR/e2e.db" &

# 2. Point the spec at that same server and state dir.
export SMITH_CLI_ENTRY=/path/to/black-smith/factory/orchestrator/dist/cli.js
export SMITH_E2E_STATE_DIR="$STATE_DIR"
export SMITH_E2E_PORT=4680

# 3. Run it (this also starts and stops vam's own vite dev server for you).
npm run test:e2e
```

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
