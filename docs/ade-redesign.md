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
- **Canvas topology** (`src/canvas/layout.ts`, `src/canvas/grid.ts`) — a flat,
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

1. **`ReviewQueue` restyle.** It works and sits where the mockup's amber
   `APPROVAL REQUIRED` box sits, but it still wears the old visual language.
2. **Demo fixture prose** (`src/fixtures/demo.ts`) is still Vietnamese. It is
   sample CONTENT rather than chrome, so it did not block the language switch,
   but it reads oddly under an English UI.

## Known bug, unrelated to this work

`i` then `Escape` leaves focus inside the prompt input while the mode returns to
NORMAL, so the next keystroke goes nowhere: the window listener ignores keys
from an input, and the input is `readOnly` outside compose mode. `Tab` escapes;
`Escape`, `Enter` and `i` do not. Cause is in `DetailPanel` — the box is always
mounted, so unlike the filter, rename, palette and icon picker (which unmount
and drop focus with them) nothing blurs it. One-line fix; the test for it needs
a real focus route, which `press()` — dispatching straight at `window` — does
not have.
