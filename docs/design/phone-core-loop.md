# vam phone core loop — audit + inline-question spec

Grounding: `factory/specs/projects.yml` — vam's `ui.design_system` is `ade`
(not HDS). Spec docs, current first: `docs/ade-redesign.md`,
`docs/design/canvas-layout.md`. Both were consulted; neither yet documents
the phone shell in a way that resolved this brief, so this document also
reads the ONLY other ground the project makes available for the phone: the
component source itself, which — unusually for this codebase — already
carries its own extensive design rationale in comments (`PhoneShell.tsx`,
`DetailPanel.tsx`'s `QuestionCard`, `styles.css`'s phone rules). Every token
and class named below is one of those already in `styles.css` / the Tailwind
scale vam ships (`--text-meta/control/body/heading`, `--vam-out-font-size`,
`bg-panel/pane/ground/card`, `border-line`, `text-ink/ink-dim/ink-faint`,
`bg-running/waiting/done/failed/idle`, `.vam-tap`, `44px` touch floor). No
new pattern is proposed anywhere in this spec; every departure from what
ships today is called out as a DEVIATION with its reason.

Checkout audited: `/Users/ser/scatola/jobs/projects/.wt/vam/phone-research`
(detached at `origin/smith/vam/0.2-tab-shell`), read-only, web build
(`vite build --config vite.web.config.ts`) served on :5431, `?demo=1`
fixture, Playwright at 390×844 (`deviceScaleFactor: 3`, `isMobile`,
`hasTouch`). Screenshots and raw geometry dumps saved under this same
scratch directory: `phone-question-card-light.png`,
`phone-response-noquestion-light.png`, `phone-response-typing-light.png`,
`phone-controls-list-{light,dark}-now.png`, `phone-prompt-{light,dark}-now.png`.

## 1. AUDIT — the current flow, measured

### Session list → open session

The list screen (`data-phone-shell="list"`) is a single header (48px,
`sourceReadout` only) over `SessionList` in `phone` mode, over a footer that
costs 0px when there is nothing to say. Each row is `min-h-[56px]`, shows a
status mark + title on line 1 and a **meta line** (`data-row-meta`) on line
2: status word (`needs you` for `waiting`, not just a dot — this already
satisfies WCAG 1.4.1 with a text channel, not colour alone), age, agent/
branch, truncating branch first. This is already close to "who needs me
first, what happened last" — the KEEP list below explains why it stays
almost as-is. Sort order is `orderedInProject`'s urgency-first rule (not
audited byte-for-byte here; out of scope — it is a selector, not phone
chrome).

### Session screen chrome (keyboard down, no open question)

Measured on `crosscheck-2` (a session with no open question),
390×844, light theme:

| band | y0–y1 | height | % of 844 |
|---|---|---|---|
| app bar (`header`) | 0–48 | 48px | 5.7% |
| session tab strip (only when ≥2 sessions in the project) | 48–93 | 45px | 5.3% |
| **transcript (out)** | 93–699 | **606px** | **71.8%** |
| composer bar | 699–844 | 145px | 17.2% |

So with no question open, the out already gets ~72% of the screen — this
part of the phone shell (`PhoneShell.tsx`'s header comment records the same
history: 107px of chrome already cut from an earlier pass). **The composer
itself is the second-biggest band on this screen at 145px**: a 3-line
placeholder-sized textarea plus a control row of 5 icons (attach / emoji-ish
"chat" glyph / a **`model` picker as a full pill with the word `model`
in it** / mic / a "notes" icon that is actually filled/active) — see
`phone-response-noquestion-light.png`. That row alone, with its 44px hit
targets, single-handedly explains a large share of the 145px.

Focusing the composer (`data-phone-keyboard="open"`, `.vam-phone-typing`)
removes only the 45px session-tab strip; the composer itself barely moves
(145→139px, rounding). **This measurement cannot see the OS soft keyboard**
— headless Chromium has none, and Playwright's `viewport`/`isMobile` do not
simulate it. vam relies on `100dvh` for the shell to sit above a real
keyboard on supporting mobile Safari/Chrome; this spec treats "how much
further the out shrinks under a real keyboard" as **unverified** and flags
the acceptance criteria for it as needing a real-device check, not a
headless one.

### A pending question with options — the part the operator flagged

Measured on `factory-sse-1` (a session with an open `AskUserQuestion`
permission prompt), same viewport/theme:

| band | y0–y1 | height | % of 844 |
|---|---|---|---|
| app bar | 0–48 | 48px | 5.7% |
| session tab strip | 48–93 | 45px | 5.3% |
| **transcript (out)** | 93–519 | **426px** | **50.5%** |
| **question card** (`QuestionCard`, fixed block) | 531–844 | **313px** | **37.1%** |

This is the finding the operator's complaint predicts exactly: opening a
question **removes the composer entirely** (`composerHidden` withdraws it —
correct, there is nowhere to type until the question resolves) but replaces
it with a card that is *more than double the composer's height* (313 vs
145px) and that is drawn as its **own fixed block below the scrolling
transcript**, not inside it (`DetailPanel.tsx` L8794–8809: "the question the
session is asking, where the placeholder picker used to stand… draws
nothing here rather than an empty box" — i.e. it is a sibling flex child of
the scroller, not a message inside it). Content of that 313px, top to
bottom (`phone-question-card-light.png`): an amber-bordered card, "Do you
want to run this command?", 3 full-width option rows (`1 Yes`, `2 Yes, and
do not ask again for scripts/rebuild-index.sh`, `3 No, and tell the agent
what to do differently`), a dashed "Chat about this" row, and a
`text-meta` disclosure sentence ("vam cannot answer this for you — a pick
is only a mark…"). Each option row already **is** a `.vam-tap` full-width
button carrying its number (`data-question-number`) — this is the closest
thing today has to "an option, numbered, tappable" — the problem this spec
addresses is where it sits (its own fixed block, competing with the
transcript for vertical space) and how much it costs, not its per-row
shape.

With the card open, the **transcript above it shrinks to 426px**, and in the
`factory-sse-1` fixture that 426px shows: the operator's last two prompts,
a 4-line action summary (5 tool calls collapsed to one line each), and the
final 4-line answer — all of it fits, but only because this fixture's
answer is short. A longer answer (the common case: a multi-paragraph
analysis, a diff, a stack trace) would be substantially truncated above a
313px card that itself has 60–100px of unused padding/whitespace (the
disclosure sentence, the card's own top/bottom `py-3`, the gaps between
rows) — visible directly in the screenshot.

**Key numbers to carry forward: out today is 606px with nothing pending, 426px
with a question open; the question card alone costs 313px as a THIRD region,
not a continuation of the out.**

### Keystroke strip

`KEY_STRIP` (`phone && canSendKeys`, i.e. drawn ONLY when no question is
open — `canSendKeys = canCycleMode && (newestQuestion === null ||
!openQuestion)`) is a row of 7 chip buttons (`Esc`, up/down arrows, and
vam's real `PaneKey`s) sitting above the composer, each `h-[30px]`
paint / 44px hit, one (`Esc → agent`) an auto-width pill rather than a
square because the glyph text overflowed a 30px square (documented in the
component's own comment). It is a **separate control surface from the
question card**: the strip drives raw terminal keys for a session that has
no structured question open (arrow-key TUI menus, `y/n` prompts the
`AskUserQuestion` reader cannot parse); the card drives structured
`AskUserQuestion` calls. They are mutually exclusive by construction
(`canSendKeys` is false exactly when the card is open) and never compete
for space — that part of today's design is already correct and this spec
keeps it.

### Tap targets

Every control audited (`ViewIcons`, `SessionTabStrip`, `QuestionCard`'s
option buttons, `KEY_STRIP`, the composer's icon row) already wears
`.vam-tap`, which the phone stylesheet floors at 44×44 regardless of the
30×30 (or auto-width pill) it paints. No tap-target violation was found in
this audit — the existing 44px-hit/30px-paint split (documented at length
in `PhoneShell.tsx`) is sound and is reused rather than reinvented below.

### KEEP / SIMPLIFY / CUT — the core loop (pick session, read, reply, answer)

| control / feature | verdict | reason |
|---|---|---|
| Session list row (status + title + meta line) | **KEEP** | Already answers "who needs me, what happened, how urgent" in 56px; changing it is out of this brief's scope. |
| App bar (back, title, view icons, close) | **KEEP**, 48px | Already minimal (one row, icons not words); it is the floor of "which session, which view, close it". |
| Session tab strip (45px, ≥2 sessions/project) | **SIMPLIFY → collapse while typing (already does) AND collapse to a single small affordance when only Response view is relevant** — see §3. It is real navigation (switching sessions inside a project) the list screen also offers in more steps; keep it, but it must not compete with the out for space once a question is open (today it doesn't — it already hides on `typing`, but stays up over an OPEN QUESTION, which is exactly when the operator least wants 45px of chrome under the app bar and over a card that already needs more room than it has). |
| View icons (Response/Agents/etc.) | **KEEP** | Already icon-only, 44px hit, one row, no separate word strip — this is the compression the operator is asking for elsewhere in the app; nothing to cut. |
| Transcript / out | **KEEP, grow** | This is the surface the whole brief is about; §3 gives it back the space today's fixed question-card block takes. |
| **QuestionCard as a fixed block below the transcript** | **CUT the block; KEEP its content, moved inline** | This is the operator's explicit ask. The block's own padding + disclosure sentence + card border cost ~60–100px of the 313px for zero reading value once the option rows are inline message bubbles that inherit the transcript's own rhythm. |
| Question step tabs (`nav[aria-label="the questions this call asked"]`, for multi-question calls) | **SIMPLIFY** | Keep the *ability* to see "step 2 of 3", but as a one-line pill inside the inline question message, not a second horizontal-scrolling strip above it (today desktop-and-phone shared markup; the phone needs a narrower version — see §3). |
| Option preview panel (side-by-side / stacked, `activeOption.preview`) | **KEEP, collapsed by default on phone** | Genuinely useful (a diff or command preview before you commit), but at 390px it is exactly the kind of content that should NOT auto-expand under every option; disclose per-option on tap, not always-open. |
| "Chat about this" synthetic row | **KEEP** | Already the correct escape hatch to free text; stays as the last inline row. |
| Submit button + "N of M marked" progress line | **KEEP, but see composer §3** | Multi-select still needs an explicit commit step; the wording ("Enter submits") is desktop-flavoured and should read "tap Submit" on phone — copy nit, not a redesign. |
| Refusal / outcome / disclosure sentences (`data-question-refusal/outcome/note`) | **SIMPLIFY** | Keep the FACTS (nothing sent, sent-but-unconfirmed, wrong-question) — they are load-bearing per `answer.ts`'s own contract — but the sentence is currently ~2 lines of `text-meta` prose always shown; on phone show it once, folded, not repeated at full length per re-render. |
| Keystroke strip (`KEY_STRIP`, 7 chips) | **KEEP** | Already gated correctly, already off-screen whenever a question is open; not part of this brief's cut list. |
| Composer: text field | **KEEP** | Core to "reply". |
| Composer: attach (image) | **SIMPLIFY → collapse behind a single "+" affordance** | One binary decision (attach or not) does not need a permanently visible 44px icon competing with 4 others on a 390px row; fold it under a "+" that also reaches emoji/dictation, OR keep as-is if the coder finds fewer than 3 of the 5 composer icons are used in telemetry — **flagged as a decision for the planner**, not decided here (no usage data available to this pass). |
| Composer: model/mode picker pill | **CUT from the composer row on phone** | A full-width-adjacent pill spelling the word "model" is desktop-scoped decision-making (which model runs the NEXT turn) that competes for the one row the reply itself needs; move it into the session's overflow/settings, reachable but not resident. This is the single biggest, safest space return in the composer band. |
| Composer: mic (dictation) | **KEEP** | Typing on a phone keyboard is the worst part of "reply"; dictation directly serves it. |
| Composer: "notes" icon (rightmost, filled/active in the screenshot) | **SIMPLIFY** | Verify what it does before cutting — if it is a secondary, rarely-used affordance (plan/notes drafting) it belongs behind the same "+" as attach, not resident at 44px next to Send. |
| PRs / Terminal / Files views on phone | **Already CUT** (`visibleTabs`, operator instruction, prior pass) | Confirmed still cut in this checkout; nothing to change. |

## 2. RESEARCH — how Claude Code presents multi-choice / permission prompts on mobile, and what vam already knows about delivering an answer

**What could be verified from vam's own code and docs (primary, verifiable source in this offline pass):**

- `src/main/sources/claude-code/questions.ts` — vam's own reader for
  Claude Code's `AskUserQuestion` tool. It records: `question` (prose),
  optional `header` (short label), `multiSelect` (boolean, absent = single),
  and `options[]`, each `{label, description, preview}`. This is the
  **actual shape Claude Code itself presents** at the protocol level — vam
  is a faithful reader of it, not an inventor of a new shape, which is why
  this spec's inline redesign stays inside that shape rather than adding
  fields.
- `src/shared/answer.ts` (header comment, quoted above) records a *measured*
  fact from a real Claude Code CLI picker: **typing the option's literal
  text into the picker did not work** — "the picker has no text buffer; the
  'type something' row is a mode you select, not a field" — and a blind
  Return "committed whatever row the cursor happened to sit on" (a
  mismatched send: typed `Emerald`, transcript recorded `Crimson`). So the
  CLI's own on-screen picker (what a human sees over SSH/tmux, and — by
  extension — very likely what Claude Code's own mobile/remote surfaces
  drive underneath, since they are typically the same CLI running
  headless) is a **cursor-navigated list, not a text field**: arrow keys
  move a highlight, Return commits the highlighted row. This is corroborated
  by `readQuestion`'s own comment: "a pane draws a list, not a menu" and the
  option cap (`MAX_OPTIONS = 12`).
- vam's write path (`AnswerRequest`/`AnswerResult` in `answer.ts`) therefore
  does **not** send literal option text at all. It performs a **verified
  navigation**: for each step, it must first confirm the screen shows THIS
  question (`wrong-question` stop if not — measured: the same option label
  `Cobalt` appeared in two different questions in one real call, so
  question-text is the identity check, not the label), then match the
  target label against the rows the live screen actually shows
  (`unmatched` if absent — reordering happens), move the cursor there, send
  Return, and **read the screen back** to confirm before declaring `sent`
  (`unconfirmed` if the post-press screen disagrees). A multi-select
  question walks this once per marked label before the final commit; a
  single-select Return both answers AND advances to the next question in
  the same call, so a partially-completed multi-question Submit is
  reported as `committed: [...]` rather than all-or-nothing.
- **What this means for an inline design**: tapping an inline option row on
  phone must still end in exactly the keystroke sequence `answer.ts`
  already sends — cursor-move-to-row + Return + read-back — not a shortcut
  that types the label as text. The inline UI's job is only to **collect
  the same `AnswerRequest` shape** (`{steps: [{question, labels,
  multiSelect}]}`) that `QuestionCard`'s Submit already builds and hands to
  `onAnswer`; nothing about the wire protocol changes, only where the
  picking UI lives on screen. This is the one hard constraint on §3 below.

**What could not be verified in this pass:** I do not have WebSearch/
WebFetch tool access in this environment (not offered in this session), so
I could not retrieve Anthropic's own Claude Code mobile app screenshots,
changelog entries, or docs.anthropic.com pages describing how the official
mobile client renders `AskUserQuestion`/permission prompts, and I am not
asserting anything about that UI beyond what is stated plainly above as
inferred from vam's own measured CLI behaviour. **This is a gap**: the
operator's brief says "like Claude Code on mobile" as the reference; this
spec grounds the *mechanics* (list not text field, verified navigation) in
vam's own measured evidence, but the *visual* pattern below (full-width
numbered rows inline in a chat-style transcript, most-recent-message
position) is drawn from (a) vam's own existing `QuestionCard` option-row
markup, which already looks like a chat-app option row, and (b) the
general, widely-documented mobile-chat convention of rendering structured
choices as the last message bubble rather than a separate panel (the same
convention vam's own comment history already gestures at — "where the
placeholder picker used to stand"). **The planner should treat the specific
visual reference to Claude Code's mobile app as unconfirmed** and, if a
pixel-accurate match matters, get a screenshot from the operator (who has
the app) rather than have a future pass guess again without the tool.

## 3. SPEC

### 3.1 Session list

No change to row content or 56px height (KEEP, §1). Sort stays
`orderedInProject`. Out of scope for this pass beyond re-confirming it
already serves "pick the right session fast".

### 3.2 Session screen — chrome and the out

- App bar: unchanged, 48px (`header`, `h-12`).
- Session tab strip: **collapses whenever a question is open**, the same
  `!typing` condition it already uses for the keyboard, extended to
  `!typing && !openQuestion`. Component: `PhoneShell.tsx`'s
  `SessionTabStrip`, one new clause in its render guard. Saves 45px back to
  the out at exactly the moment the operator's brief is about.
- Out (`role` unchanged, still the single scrolling column
  `DetailPanel` already renders): **the question, when open, renders as the
  newest message INSIDE this scroller**, not as a sibling flex block below
  it. This is the structural change. Concretely: `QuestionCard`'s render
  site moves from `DetailPanel.tsx`'s fixed footer block (current
  L8794–8809) into the same turn-list the transcript already maps
  (wherever the desktop's own turn components — the user/assistant bubbles
  — are mapped, as the last item when `newestQuestion !== null`). Desktop
  is UNCHANGED (its own card stays a footer block below the scroller — this
  is a phone-only rendering change, gated the same way `phone &&` already
  gates `KEY_STRIP`); `QuestionCard`'s own internals (the listbox, `onKeys`,
  `NUMBERED_OPTIONS`, `AnswerRequest` construction, `onAnswer`) are REUSED,
  not rewritten — only the container it mounts in changes, from
  `flex-none` fixed footer to a flow child of the scroller with `sticky
  bottom-0` (see below) so it still reads as "the thing at the bottom
  demanding attention" without being pinned outside the scroll content.
- Measured target: with the tab strip gone (−45px) and the question moved
  inline (so it no longer reserves a separate 313px band — it becomes part
  of the same scroll content the transcript already is, costing only its
  own content height, typically 120–180px for a 2–4 option single question
  rather than a fixed 313px shell), the **out + inline question together
  should read as a single continuous scroll region of ≥650px at 390×844
  keyboard-down** (up from 426px measured today when a question is open) —
  see AC-3.
- Typography: reuse `--vam-out-font-size` exactly as today
  (`--vam-pane-size = max(text-body, out-font-size)`); nothing here
  proposes a new size scale. Long code blocks: unchanged, existing `Fenced`
  component and its `vam-no-scrollbar max-h-[40vh] overflow-auto` treatment
  (already used for the option preview panel) is the right, already-shipped
  pattern — reuse it for any code block inside an inline option's preview
  too, rather than inventing a second one.
- Jump-to-latest / jump-to-question: **DEVIATION, needs planner sign-off.**
  Nothing in vam's current phone chrome offers a "scroll to bottom" or
  "scroll to open question" affordance; the fixed-card layout made this
  moot (the question was always visible, pinned below the scroller). Moving
  it inline reintroduces the classic chat-app problem — a long transcript
  can scroll the question out of view. Recommend a small floating pill
  (`sticky bottom-2 self-end`, `.vam-tap`, 44px, a single chevron-down or
  "1 pending" badge) that appears only when the open question is scrolled
  out of the viewport, using `IntersectionObserver` on the inline question
  block. This is new: nothing in `styles.css` or the existing phone
  components does this today. Ground: same visual language as
  `ViewIcons`'/`SessionTabStrip`'s selection mark (a filled pill, `bg-card`
  border `border-line-strong`) — no new token, but a new BEHAVIOUR
  (auto-appearing scroll-jump control), hence flagged rather than folded
  silently into "KEEP".

### 3.3 Questions/options inline — exact behaviour

- Rendering: one inline block, styled as the newest transcript item, NOT a
  bordered "card" pulled out of flow — reuse the transcript's own turn
  spacing (`gap-1.5` between turns, no `border-running` box around the
  whole thing — that treatment currently exists because the card floats
  outside the scroller and needs a visible boundary; once it's a message in
  the flow, its own amber accent moves to a **left-edge 2px bar** in
  `bg-waiting`/`--vam-waiting`, matching the `waiting` status colour
  already used for "needs you" elsewhere (list row meta line, session tab
  strip's `!` badge) — this is the one new visual rule, and it is a reuse
  of an existing token (`--vam-waiting`) in a new position (a rule border
  instead of a badge), not a new colour.
- Header/question text: unchanged content and type scale
  (`text-meta` eyebrow header, `text-body` question text).
- Multi-question calls: the step nav (`nav[aria-label="the questions this
  call asked"]`) becomes a single-line pill row ABOVE the question text,
  same content (`header ?? index+1`, `✓` when answered, current step
  bordered) but capped to horizontal-scroll within the message's own width
  rather than the full transcript width, and the `step N of M` label moves
  to the pill row's trailing edge exactly as today — only the width
  constraint changes.
- Options: **exactly today's `QuestionCard` option buttons, unchanged
  markup** (`role="option"`, `NUMBERED_OPTIONS[index]`, label, optional
  description under the label, `data-picked`), full-width rows inside the
  message, `.vam-tap` 44px floor kept.
- Multi-select: unchanged — tap toggles `aria-selected`/`data-picked`,
  Submit row appears once ≥1 open step exists, "N of M marked" progress
  line, disabled while `sending`. No change to `answer.ts`'s
  `AnswerRequest` shape or to the Submit → `onAnswer` call.
- Preview: collapse-by-default, one line (`preview ↓` hint, unchanged copy)
  that expands the same `Fenced`-styled panel on tap, INSIDE the message
  block rather than beside it (drop the `sideBySide` `@min-[720px]:flex-row`
  variant on phone — it never fires below 720px container width anyway, so
  this is a no-op simplification, not a behaviour change).
- "Type something else" (today's "Chat about this" row): unchanged
  behaviour — taps `onChat`/`startChat`, which sets `chattingAbout` and
  un-hides the composer (`composerHidden` already reads `chattingAbout`).
  Composer reappears below the (now-inline) question, scrolled into view;
  the question block stays visible above it as the context for what is
  being typed.
- Confirm step for destructive/irreversible choices: **DEVIATION, needs
  planner sign-off.** `QuestionCard` today has no confirm-before-send step
  at all — Submit sends immediately. The operator's brief names two
  examples explicitly ("No, and tell the agent…" vs "Yes, don't ask
  again") that are NOT symmetric in risk: "Yes, don't ask again" changes a
  standing policy for the rest of the session (a Claude Code option label
  vam already reads verbatim, per `questions.ts` — vam does not classify
  option semantics today, it only reads and displays `label`/`description`
  as given). Proposal: no new confirm dialog (a second modal tap defeats
  the "fast reply" brief this whole spec serves) — instead, **the option
  row itself carries a visible risk marker** when its own label text
  matches a small, literal, case-insensitive keyword set already visible in
  Claude Code's own option vocabulary (`don't ask again`, `always allow`,
  `skip`, `bypass`) — a thin amber `text-meta` suffix on that ROW only
  ("won't ask again this session"), not a blocking dialog. This is a new
  heuristic (string matching on option labels) that does not exist in vam
  today anywhere; it is a text/colour treatment only, no new interaction,
  and it must ship as advisory decoration, never as a gate that could
  block an answer `answer.ts` would otherwise send — flagged for the
  planner because it is the one piece of this spec that reads intent into
  the agent's own words rather than displaying them verbatim, which is
  against this codebase's own stated discipline elsewhere (`answer.ts`:
  "nothing here reads mtime, status… the mistakes the placeholder picker
  was built on").
- Exact keystrokes per tap: **unchanged from today — this spec does not
  touch `answer.ts` or the write path at all.** A single-select tap →
  immediate mark (no send yet, per today's "a pick is only a mark until you
  press Submit"); Submit → `answerQuestion` walks each step: confirm screen
  shows `step.question`, arrow/cursor-move to the row whose on-screen text
  matches `step.labels[0]` (single-select) or, for multi-select, whichever
  keys the live CLI picker uses per label (unchanged, vam's existing
  implementation — this pass did not re-derive `answerQuestion`'s internals,
  only confirmed its documented contract in `answer.ts`), Return, read back,
  advance to next step or report `sent`/`unconfirmed`/`wrong-question` per
  step. "Chat about this" → no keystrokes at all, opens the composer for a
  free-text reply through the normal prompt-record path (unrelated to
  `answer.ts`).
- The separate question card and keystroke strip: **the fixed-block
  `QuestionCard` container is removed on phone only** (desktop keeps it,
  unchanged); **the keystroke strip (`KEY_STRIP`) is kept, unchanged,
  including its existing gate** (`phone && canSendKeys`, false exactly
  while a question is open) — it remains the edge-case affordance for
  sessions whose prompt is a raw TUI screen `questions.ts` cannot parse at
  all (no `AskUserQuestion` record exists for those), which is a real and
  distinct failure mode the inline redesign does not and should not try to
  absorb.

### 3.4 Composer

- Height: currently 145px (3 rows of internal padding + a 44px icon row);
  target ≤108px — drop the model-picker pill entirely from this row (§1,
  CUT) and collapse attach + the "notes" icon behind a single "+" pill
  pending the planner's usage-data decision (§1, SIMPLIFY) — leaves
  textarea + "+" + mic + Send, 4 controls instead of 6, same 44px floor.
- Send key: unchanged (whatever the composer already binds — this pass did
  not find a phone-specific Send-key override to audit; Return/tap-Send
  both already work per the existing composer, out of scope to change).
- Keyboard-up layout: unchanged mechanism (`100dvh`, no `visualViewport`
  listener, `isTyping` on focus/blur) — this spec does not propose a new
  keyboard-tracking approach, only that with the model pill and one icon
  gone, the composer's OWN height under a real keyboard is smaller, so more
  of the out's already-improved space (§3.2) survives keyboard-up too.
  **Unverified on a real device in this pass** (headless has no soft
  keyboard) — AC-4 below is a real-device check, not a CI one.
- Cut: model/mode picker (moves to settings/overflow, reachable not
  resident — §1). Attach/notes: SIMPLIFY behind "+", pending planner
  decision on which of the two (or both) actually gets used.

### 3.5 Everything else on phone

Unchanged from the current, already-shipped decisions this audit
reconfirmed: PRs/Terminal/Files stay cut from the phone's view-icon row
(`visibleTabs`, operator instruction, still true in this checkout);
Response/Agents remain reachable via the app-bar icon row. Nothing in this
brief reopens that scope.

### 3.6 Acceptance criteria (measurable)

1. **AC-1 (chrome, keyboard down, question open).** At 390×844, `?demo=1`,
   a session with an open `AskUserQuestion`: `header` height = 48px;
   `[data-phone-session-tabs]` is ABSENT from the DOM (not just hidden)
   while the question is open; the inline question block and the
   transcript are both children of the SAME scrollable container (assert:
   one element with `overflow-y: auto/scroll` contains both
   `[data-question-option]` and at least one prior turn's text).
2. **AC-2 (no separate fixed question band).** `[data-composer-bar]` and
   any inline-question wrapper must NOT both be present as `flex-none`
   siblings at the bottom of the shell while a question is open — assert
   there is exactly one `flex-none` element below the scroller when a
   question is open (the composer, hidden) and the question content has
   height `<= its own content`, not a fixed 313px regardless of content.
3. **AC-3 (space returned).** With AC-1's session, the scrollable region's
   `scrollHeight` minus its own top offset, measured from the app bar's
   bottom edge to the shell's bottom edge (minus whatever `flex-none`
   siblings remain, i.e. the hidden composer's reserved 0px), is
   **≥ 650px** of combined transcript+question flow, vs the 426px+313px=
   739px split-into-two-boxes total measured today (this AC is about it
   being ONE region an operator can read continuously, not merely about a
   raw pixel sum, since today's 739px was already numerically large but
   split across two competing boxes).
4. **AC-4 (real device, keyboard up)** — manual/real-device check, not
   headless: on an actual phone (iOS Safari or Android Chrome) over
   Tailscale Serve, focusing the composer with a question NOT open, at
   least the last 3 lines of the agent's most recent message remain
   visible above the keyboard-covered composer. (Today's equivalent is
   unmeasured in this pass — flag as a gap, see §1.)
5. **AC-5 (tap targets).** Every inline option row, the "+"-collapsed
   composer control, the scroll-to-question pill (if built), and the
   Submit button each have a `getBoundingClientRect()` ≥ 44×44, measured on
   the PAINTED element's own ancestor button (not the visual skin inside
   it) — same method `PhoneShell.tsx`'s existing guard already uses.
6. **AC-6 (keystrokes unchanged).** For a fixed fixture question (reuse
   `?demo=1`'s `factory-sse-1`), tapping option 2 then Submit produces the
   IDENTICAL `AnswerRequest` object (`{steps: [{question, labels: [...],
   multiSelect}]}`) that today's desktop `QuestionCard` would produce for
   the same tap sequence — assert by diffing the object passed to
   `onAnswer`, not by re-deriving `answer.ts`'s internals.
7. **AC-7 (composer height).** Composer bar height with no question open,
   keyboard down, ≤ 108px (from 145px today), and contains exactly 4
   controls (textarea, "+", mic, Send) rather than 6.
8. **AC-8 (light + dark, desktop + mobile screenshot contract).** Exactly
   4 screenshots for this feature's tester pass: phone question-inline,
   light and dark, 390px; phone composer (no question), light and dark,
   390px. (Desktop is unchanged by this spec — no desktop shot needed for
   this feature; if the coder's diff touches any desktop-shared file the
   reviewer/tester should re-confirm desktop is visually unchanged, but
   that is a regression check, not a new screenshot spec.)

### 3.7 Task breakdown (2–4 PR-sized steps)

1. **PR 1 — composer diet.** Remove the model/mode pill from the phone
   composer row (move its control into settings/overflow — a desktop-only
   composer keeps it unchanged); collapse attach + notes behind a single
   "+" affordance (or drop one entirely if the planner rules on usage data
   first). Ships AC-5, AC-7. No touch to `QuestionCard` or `answer.ts`.
   Independently valuable and independently revertible.
2. **PR 2 — collapse the session tab strip while a question is open.**
   One-line change to `SessionTabStrip`'s render guard in `PhoneShell.tsx`
   (`!typing` → `!typing && !openQuestion`). Ships part of AC-1. Trivial,
   low-risk, should land alone so a regression is easy to bisect.
3. **PR 3 — move `QuestionCard` inline on phone.** The structural change:
   render the existing `QuestionCard` (untouched internals) inside the
   transcript's own turn list instead of `DetailPanel`'s fixed footer
   block, gated `phone &&` so desktop is byte-identical; drop the always-
   visible bordered-card chrome for the phone variant in favour of the
   left-edge accent bar; cap the step-nav pill row to the message's own
   width. Ships AC-1, AC-2, AC-3, AC-6 (mechanically unchanged
   `AnswerRequest`, new mount point only). This is the PR that most needs
   the reviewer to diff `answer.ts`/`onAnswer` call sites and confirm
   nothing there changed.
4. **PR 4 — scroll-to-question affordance + destructive-option marker.**
   Both are additive, both are flagged DEVIATIONS above needing planner
   sign-off before this PR is written: (a) the `IntersectionObserver`-
   driven floating pill when the open inline question scrolls out of view;
   (b) the advisory `text-meta` risk suffix on options matching the
   literal keyword set. Ship together only if the planner approves both;
   otherwise split into 4a/4b so one can land without the other.
