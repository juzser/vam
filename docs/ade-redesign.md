# ADE session-canvas redesign — state of play

Source of truth: the Claude Design project **ADE App UI Mockups**, file
`ADE Session Canvas.dc.html` — two artboards, `1a` dark and `1b` light, the same
screen in both. Read 2026-08-28. (The project URL is deliberately not recorded
here: this repo is public and the id identifies a private workspace. Ask the
operator for the link; the name above is enough to find it with access.)

`support.js` in that project is the generated dc-runtime (the canvas player),
not design content; nothing here derives from it.

The mockup is for **ADE**, a different product with a different vocabulary
(worktrees, Claude Code / Codex per session, per-step durations, approvals, PRs,
a daily token and spend cap). vam draws black-smith. Where the two agree, this
implements the mockup exactly. Where black-smith cannot answer, the slot is
DRAWN and says it has nothing — `—`, or a `data-placeholder` element with a
`title` naming the gap. Nothing invents a number.

## Done

- **Tokens** (`src/styles.css`). Both artboards read off as value pairs. The
  greys are no longer one tint at three alphas — see the file header for why
  that scheme cannot express this design's warm light borders. `@theme inline` +
  `:root` (dark) / `html.light` is the whole switch.
- **Theme toggle** — stored in prefs (`theme`), applied to `<html>` by an effect
  in `Canvas`, survives a reload. Verified both directions and across reload.
- **Sidebar** — workspace line, `New session`, search box, project captions with
  a per-project add affordance, session cards with dot / title / agent badge /
  status phrase / step count / age / progress bar, footer with settings and the
  theme toggle.
- **Canvas top bar** — `Canvas`, the live/demo source badge, the
  All / Running / Needs you / Done pill row (a real second filter, stacked on
  `/`), auto-layout state, zoom −/%/+, fit, notification bell with a count.
- **Session card and step card** — the mockup's shapes, including the amber
  halo on a step that has stopped for you.
- **Right panel** — header with dot / title / meta / step id / jump, `STEP n/N`
  ribbon, the four tabs, `IN` / `PROGRESS` / `OUT` rules, the proposed-command
  blocks, the composer with its chips.
- **Status bar** — session tally by state, project count, mode indicator kept.
- **Minimap** — 168×96 plate, bottom right.
- **UI language** — English throughout, per the operator's decision. 286 tests
  re-pointed and green.
- **Canvas grid layout** (`src/canvas/layout.ts`, `src/canvas/grid.ts`) — a flat,
  project-blind 2-column grid of 580×290 cells (`orderedForCanvas`, urgency
  first). Each cell holds the session card at the left, vertically centred,
  and up to three step cards stacked vertically to its right. An SVG fan
  (trunk, spine, branches) connects the session card to its step slots and
  carries an `N steps` pill. Project frames are gone from the canvas —
  projects live only in the sidebar — and every node position is absolute;
  nothing names a parent.

## Placeholders — drawn, inert, and why

| Slot | Where | Needs |
|---|---|---|
| `+` per project | sidebar caption | a create-session route; today it is `smith event append session-start` |
| agent badge (`CC`/`CX`) | sidebar row | provider per SESSION; black-smith reports it per dispatch |
| worktree line | session card | black-smith does not report a worktree per session |
| tokens / spend | session card footer | per-session cost; `/api/overview` has `tokensByEpic` only |
| per-step duration | step card, right | black-smith times a session, not a step |
| step verbs (`READ`/`EDIT`/`RUN`) | step card | an event KIND on the timeline entry. `stepKind()` derives only what is knowable (ask / run / done) rather than guessing from label text |
| `PRs` / `Terminal` / `Agents` tabs | right panel | a PR index, a terminal attach, a per-session agent roster |
| attach, model picker | composer | the prompt route takes `(sessionId, text)`; the model is the factory's choice |
| `/diff` `/tests` `/handoff` | composer | a command route in black-smith |
| daily token / spend cap | status bar | wire `budgetUsedPct` + `tokensByEpic` through the adapter — the data EXISTS, only the adapter is missing. Cheapest real win on this list |

## Not started

Nothing on this document's original list remains; see the corrections below for
the two items that were answered by removal rather than by work.

## Corrections to this document's own predictions

- **The `ReviewQueue` restyle is not pending, it is moot.** This document
  listed it under "Not started", describing a component that "works and sits
  where the mockup's amber `APPROVAL REQUIRED` box sits". It had already
  stopped sitting anywhere: the governance queue was removed from the detail
  pane at the operator's request, and nothing rendered `ReviewQueue` in either
  build. What survived was worse than dead code — the action list still held
  two keyboard stops per finding and two per lesson, so `j`/`k` walked rows
  with nothing on screen and `Enter` POSTed a waiver or a lesson transition the
  operator could not see himself making. The component, its hook, its queue
  selectors and those actions are gone.

- **The demo fixture is no longer Vietnamese.** This document listed it under
  "Not started"; it was translated along with the last user-visible strings
  when the repo's language switch was completed, so that item is gone rather
  than merely stale. The fixture is what every README screenshot shows, which
  is what finally forced it.

- **`nav-nodes.ts` and `spatial-nav.ts` needed no rewrite.** This document
  predicted the topology rewrite would touch `src/canvas/nav-nodes.ts` and
  `src/keyboard/spatial-nav.ts`. It did not: the spatial navigation rule
  walks node geometry, not a project hierarchy, so it was layout-independent
  by construction and the new grid dropped straight in.
- **`src/domain/model.ts` needed no new field.** The topology is computed
  entirely from existing session and decision data; nothing in the domain
  model changed to support it.
- **The step count is a pill, not the drawn count.** `visibleDecisions` caps
  what a session's cell draws at `VISIBLE_DECISION_COUNT` (3): a session with
  three or more decisions always draws exactly three step cards and zero
  placeholders. Only a session with **fewer** than three decisions draws
  dashed "no step yet" placeholders, to fill out to three slots. The fan's
  `N steps` pill reports `session.decisions.length` — the session's real
  total — which is a different number from the drawn count as soon as a
  session passes three decisions.

## Known bug, unrelated to this work

`i` then `Escape` leaves focus inside the prompt input while the mode returns to
NORMAL, so the next keystroke goes nowhere: the window listener ignores keys
from an input, and the input is `readOnly` outside compose mode. `Tab` escapes;
`Escape`, `Enter` and `i` do not. Cause is in `DetailPanel` — the box is always
mounted, so unlike the filter, rename, palette and icon picker (which unmount
and drop focus with them) nothing blurs it. One-line fix; the test for it needs
a real focus route, which `press()` — dispatching straight at `window` — does
not have.
