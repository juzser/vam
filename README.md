# vam — VIM Agent Management

A keyboard-first canvas over black-smith: one screen that lays out every
running agent session as a node, colours it by whether it needs you, and lets
you navigate and act on it with vim-style keys instead of a mouse.

![vam canvas, dark theme](docs/images/canvas-dark.png)

## What this is

Black-smith runs a factory of agents (coders, reviewers, verifiers) across
many sessions at once. Its own state lives in an event log; vam is a separate
web client that reads that log and draws it as a canvas — one node per
session, grouped by project, coloured `running` / `waiting` / `done` / `failed`.
The state that earns the canvas its keep is `waiting`: a session that has
finished its turn and is waiting on a person. vam's job is to make that
session impossible to miss, and to let you get from "something needs me" to
looking at it and answering it in as few keystrokes as possible.

vam does not run agents and does not orchestrate anything. It is a read/write
window onto a black-smith factory that must already be running somewhere.

## Screenshots

![Command palette open](docs/images/palette.png)

`Mod-k` opens a command palette (`cmdk`) with a jump list of every session,
grouped into "needs you" and "all sessions".

![vam canvas, light theme](docs/images/canvas-light.png)

The same canvas in light theme, toggled from the sidebar footer.

The canvas itself (dark screenshot above) has: a left sidebar of sessions
grouped by project with a search box; status filter chips (All / Running /
Needs you / Done) with live counts; the node canvas with auto-layout, zoom
controls and a minimap; a right detail panel with Response / PRs / Terminal /
Agents tabs, a step progress bar and a prompt composer; a bottom status line
showing the current vim-style mode (`NORMAL`), the focused session, and
session counts.

## Quick start

Requires Node >=22.

### Demo mode — no backend needed

```bash
pnpm run dev
# open http://127.0.0.1:5273/?demo=1
```

Demo mode renders a fixed fixture (`src/fixtures/demo.ts`). It needs no
running black-smith. Every write is refused before it reaches any server, and
the canvas shows a banner saying so — this mode is for looking, not for
recording anything.

### Live mode — against a running black-smith

```bash
smith ui serve   # from your black-smith checkout; defaults to :4680
pnpm run dev
# open http://127.0.0.1:5273/
```

Live mode is the default (no `?demo=1`). The dev server proxies `/api/*` to
black-smith's `ui/server`. If black-smith isn't reachable, live mode shows
nothing and says why — it never falls back to fake data.

## Keyboard reference

Bindings are defined in `src/keyboard/chords.ts`. `hjkl` move the focused
node on the canvas the way they always do.

| Key | Action |
|---|---|
| `h` `j` `k` `l` | Move focus left / down / up / right |
| `i` | Put the caret in the prompt box, aimed at the focused session |
| `I` | Move keyboard control into the right-hand action pane |
| `H` | Move keyboard control back to the session list |
| `r` | Rename the focused session |
| `s` | Pick the focused session's icon |
| `x` | Close the focused session |
| `o` | Start a new session |
| `,` | Open settings |
| `f` | Jump (open the jump list) |
| `G` | Jump to the last session |
| `/` | Search |
| `n` / `N` | Next / previous search match |
| `Enter` | Open the focused session |
| `Mod-k` | Open the command palette |
| `Escape` | Cancel whatever is half-typed |

Chord prefixes — press the first key, then the second:

| Chord | Action |
|---|---|
| `gg` | Jump to the first session |
| `gt` | Next project |
| `gT` | Previous project |
| `yy` | Copy (the focused session's reference) |

`Mod` means Ctrl or Cmd, whichever your platform uses.

## How live mode connects

vam's own dev server (Vite) proxies every request to `/api/*` on its own
origin to black-smith's `ui/server`, which defaults to
`http://127.0.0.1:4680`. This is deliberate, not incidental: `ui/server`
sends no CORS headers, so a direct cross-origin request from the browser
would need black-smith to open itself up. Proxying instead keeps black-smith
exactly as closed as it already is.

Two environment variables control the target, and they are not
interchangeable:

- `VAM_SMITH_URL` — read by `vite.config.ts` when the dev/preview server
  starts. Points the proxy at a black-smith running somewhere other than
  `127.0.0.1:4680`.
- `VITE_SMITH_URL` — a build-time override baked into the client bundle,
  for the case where vam itself is served from behind something that
  already fronts a factory (so no proxy is needed at all).

vam **reads** `/api/stream` (an SSE feed), `/api/overview`, `/api/timeline`,
`/api/kanban`, `/api/tasks/:id`, and `/api/lessons`.

vam **writes** to `/api/prompt`, `/api/waivers/apply-batch`, and
`/api/lessons/:id/:to`.

The prompt box is labelled "Write a prompt — it is recorded, not sent", and
on success the status line says the prompt was recorded into the session's
log. This is not a UI shortcoming: black-smith has no channel into a running
agent session, so `/api/prompt` records what you typed into the event log for
the agent to pick up on its own next step. vam cannot make an idle agent act
on your prompt any faster than the agent already checks its log.

## Orca

The package description mentions orca as a design reference, and
`src/keyboard/chords.ts` and `src/domain/model.ts` borrow vocabulary from it
(its keybinding conventions, its treatment of a "decision waiting for a
person" as first-class). There is no working orca
integration in this codebase today: `SourceId` in `src/domain/model.ts`
already has an `'orca'` case, but the adapter that would populate it
(`src/adapter/to-canvas.ts`) only ever sets `source: 'black-smith'` — the
comment there says plainly that "orca is a second adapter's job." Until that
adapter exists, vam talks to black-smith only.

## Development

```bash
pnpm run dev             # start the dev server on :5273
pnpm run build           # production build
pnpm run preview         # serve the production build on :5274
pnpm run typecheck       # tsc --noEmit
pnpm run typecheck:test  # typecheck the test sources
pnpm run lint            # biome check .
pnpm run test            # vitest run
pnpm run test:coverage   # vitest run --coverage
pnpm run test:e2e        # Playwright, from e2e/
```

Tests use Vitest; run a single file directly with
`node_modules/.bin/vitest run <path>` if you don't want the whole suite.

## Project status

Early: `package.json` is still at `0.0.0` and marked `private`. There is
currently no `LICENSE` file in this repository, so treat the code as
all-rights-reserved until one is added.
