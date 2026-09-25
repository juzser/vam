/**
 * The left sidebar: every session, grouped by project.
 *
 * FLAT, not a card (operator request, sidebar-flat): a project's heading is a
 * caption above its own rows, not a bordered box around them — orca's shape.
 * The grouping is still one pass over `entries`, which arrives project-major
 * from `orderedSessions`, building `[{ project, items }]` groups — no re-sort.
 * The heading is a plain `<div>` — not a control, not focusable, never a stop
 * for `j`. Grouping must not cost the one property this list has, which is
 * that `j` pressed N times lands N sessions further down no matter how many
 * project boundaries lie between, so `data-session-row` and
 * `data-project-heading` stay exactly where they were.
 *
 * The shape is the ADE mockup's: a workspace line, a search box, then project
 * headings with their rows beneath, with one loud "New session" strip at the
 * bottom — last, after the session rows, not first.
 *
 * Both PICKERS — the session's and the project's — live in `Canvas`, not
 * here. They are wider than this column, so `Canvas` floats them the way it
 * floats the command palette; the row only draws what came back.
 */

import {
  Archive,
  ArrowLeft,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Folder,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Smartphone,
  Sun,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Group, Project, SessionStatus } from '../domain/model.js';
import type {
  GroupBy,
  SessionEntry,
  SortBy,
  StatusBucket,
  ViewOptions,
} from '../domain/selectors.js';
import { STATUS_BUCKET_LABELS, statusBucketOf } from '../domain/selectors.js';
import type { SessionFilters, StatusFilter } from '../domain/session-filter.js';
import { DEFAULT_SESSION_FILTERS, STATUS_FILTERS } from '../domain/session-filter.js';
import type { KeyAction } from '../keyboard/chords.js';
import { InlineChord, ShortcutTip } from '../keyboard/ShortcutTip.js';
import { usePhoneViewport } from '../phone/viewport.js';
import {
  readAcknowledgedForeignHiddenCount,
  writeAcknowledgedForeignHiddenCount,
} from '../prefs/foreign-hidden-note.js';
import type { EffectiveTheme } from '../prefs/prefs.js';
import { markRegisterOf, SourceMark } from '../sources/provider-marks.js';
import { ConfirmRemoveProject } from './ConfirmRemoveProject.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';
import { GettingStarted } from './GettingStarted.js';
import { IconMark, parseIcon } from './icon-value.js';
import { Note } from './Note.js';
import { OverlayScroll } from './OverlayScroll.js';
import { type RemovalPlan, removalPlan } from './remove-project.js';
import { revealScrollTop } from './reveal-row.js';
// `MARK_LANE_PX` is no longer imported: the provider lane was derived from it
// while the two marks shared the title line, and on the meta line it is sized
// by its own neighbours instead (`PROVIDER_LANE_PX`). The comments below still
// reason about that constant, which is a reference and not a dependency.
import { StatusMark } from './status-mark.js';
import { UsagePopover } from './UsagePopover.js';

/**
 * What `pendingAction` holds while "new project" is running.
 *
 * `pendingAction` is otherwise a project id, and "new project" has no project
 * yet -- that is the whole point of it -- so it needs a value of its own to
 * put in the same field. The `/` is what makes it collision-proof rather than
 * merely unlikely: a project id is derived from a directory's last segment,
 * and a POSIX basename cannot contain one, so no real project can ever answer
 * to this and wear another control's spinner.
 */
export const NEW_PROJECT_PENDING = 'vam/new-project';

/** The actions the sidebar's controls stand for — actions, never keys, so
 *  every hint below reads the chord in force rather than a shipped default. */
const SETTINGS_ACTION: KeyAction = { kind: 'settings' };
const REMOTE_ACTION: KeyAction = { kind: 'remote' };
const SEARCH_ACTION: KeyAction = { kind: 'search' };
const FILTER_MENU_ACTION: KeyAction = { kind: 'filterMenu' };
const CLOSE_ACTION: KeyAction = { kind: 'close' };
const NEW_SESSION_ACTION: KeyAction = { kind: 'newSession' };

/** No jump is armed. A module-level constant rather than a `new Map()` in the
 *  destructuring default, for the reason `Canvas.tsx`'s `EMPTY_GROUPS` is one:
 *  a fresh reference per render is a prop that always looks changed. */
const NO_JUMP_LABELS: ReadonlyMap<string, string> = new Map();

/**
 * The status hue, for the surfaces that paint a BAND rather than a mark.
 *
 * One caller left: the focused row's cursor stripe, which is a 2px bar and has
 * no room to be a shape. The marks themselves moved to `status-mark.tsx` when
 * the dots became five distinct glyphs -- a colour is the channel that is
 * missing for somebody, and five circles differing only in hue is the reading
 * the operator called samey.
 */
const STATUS_DOT: Readonly<Record<SessionStatus, string>> = {
  running: 'bg-running',
  waiting: 'bg-waiting',
  idle: 'bg-idle',
  // The neutral `idle` shares: an empty pane is the absence of news too.
  unstarted: 'bg-idle',
  // A pane and a known conversation, at rest -- the same neutral hue; the
  // cursor stripe this band paints for is 2px and has no room for a shape,
  // which is what `status-mark.tsx`'s glyph is for.
  terminal: 'bg-idle',
  done: 'bg-done',
  failed: 'bg-failed',
};

/**
 * ONE INDENT UNIT FOR THE WHOLE TREE, in px.
 *
 * The sidebar draws three levels -- group, project, session -- and used to
 * indent them by two unrelated numbers written five hundred lines apart: a
 * grouped project stepped 8px in from its group, and that project's rows
 * stepped 6px in from it. A ladder whose rungs get CLOSER as it descends does
 * not read as a ladder, which is precisely the report this constant answers
 * ("the indent between project, group and session is not clear").
 *
 * So: one unit, and each level at a whole multiple of it.
 *
 *   group   0 -- the datum. Nothing is drawn above a group, so an indent here
 *                would be measured from the pane's edge and mean nothing.
 *   project 1 -- but ONLY inside a group. Depth is what a level is, and a
 *                project belonging to no group has no parent on screen to be
 *                indented from; spending width on a hierarchy that is not
 *                there is how the flat sidebar (every store that has never
 *                made a group) would pay for a feature it does not use.
 *   session 2 -- always one unit inside its own project, whatever depth that
 *                project sits at. This is the step the operator actually
 *                follows down the column, so it is the one that must never be
 *                the smaller of the two.
 *
 * TEN, because the row already carries ten of its own left padding
 * (`px-2.5`): the indent and the row's internal rhythm are then the same
 * number, and the focused row's slab and its cursor stripe land exactly on
 * the indent line rather than a pixel or two off it. Two units is 20px of a
 * 200px column at the sidebar's minimum width, which is the most a column
 * where the title and the branch already truncate can afford to give.
 *
 * SPENT AS AN INLINE `style`, never as a `pl-[10px]` class: Tailwind's scanner
 * reads source text, so a class assembled from a constant is one it never
 * generates -- the same trap `BRANCH_TAIL_MAX_CHARS` documents below.
 */
export const SIDEBAR_STEP = 10;

/**
 * How big a HEADING's glyph is — a project's and a group's, which are the only
 * icons the sidebar draws.
 *
 * Operator: "Icon ở sidebar cần lớn hơn." The number is not a preference, and
 * it is not new either: it is `MARK_LANE_PX`, the box every session's status
 * mark below is centred in, and taking it fixes an inversion that was already
 * written down as the opposite.
 *
 * WHAT WAS INVERTED. `status-mark.tsx` picks 14 for its lane and says why: it
 * is "one pixel under" the heading's slot, "so a session's mark reads as a
 * smaller relative of the heading's glyph rather than as its equal". That is a
 * claim about two BOXES, and it held. The GLYPHS inside them went the other
 * way -- the mark draws at 12 inside its 14, the heading drew at 11 inside its
 * 15 -- so on screen the level above was the smaller mark. The eye reads the
 * ink, not the box, which is why the sidebar looked the way the operator said
 * it looked while every number in it was the number somebody chose.
 *
 * A HEADING'S GLYPH WAS THEREFORE MADE THE LANE ITSELF, 14: as tall as the
 * whole box the mark below it is merely centred in, two pixels taller than
 * the mark's own ink rather than one shorter -- the relation the geometry had
 * claimed all along -- and at the time the largest step that changed nothing
 * else: the slot grew by one pixel to what was then the name's own line box
 * (16px, `text-meta`'s leading).
 *
 * THE SLOT IS THE NAME'S LINE BOX AGAIN. The name moved up to `text-heading`
 * (15px on a 20px line) and at first the slot stayed at 16, because the
 * emoji's ink filled it. The operator, reading the result: "the emoji in the
 * sidebar needs to be a bit bigger" -- a 12px picture beside a 15px name is
 * the picture reading as the smaller thing, which is the same inversion as
 * before at a new level. So the slot is `HEADING_SLOT_PX`, the line's own
 * 20px (`--text-heading--line-height`), the emoji takes the name's own size
 * (`text-heading`), and the glyph is the slot less four pixels of air -- a
 * lucide glyph's ink is its `size` or a little under, and four is what keeps
 * a full-height stroke off the slot's edge at every one of the eight tones.
 * The row does not move: the slot is exactly the name's line, and the row is
 * that line plus its bottom padding (the guard's `heading row` reads it).
 *
 * DERIVED, NEVER COPIED. The glyph reads the slot, and
 * `SessionList.icon.test.tsx` asserts the DOM carries this number and that it
 * stays ABOVE `MARK_LANE_PX` -- the level above is never the smaller mark --
 * so the two cannot drift into two answers about one relationship.
 *
 * IT SIZES ONE OF THE TWO KINDS OF ICON, and that is a fact about the pixels
 * rather than an omission. An emoji is text: `IconMark` hands this number to a
 * lucide glyph and ignores it for an emoji, which takes the slot's own type
 * class. The two kinds do not paint the same size at the same number --
 * measured on the composited pixels, a full-box emoji's ink runs three to four
 * pixels PAST its font-size (11px drew 14 tall, 12px drew 15) while a lucide
 * glyph's ink is its `size` or a little under (`Monitor` at 11 drew 9,
 * `Rocket` 11, `Rocket` at 14 drew 13). So the slot carries `text-heading`
 * (15px) beside this 16, which keeps the two kinds a few pixels apart with
 * the emoji the larger, by exactly the margin a picture has over a stroke.
 * Not every emoji is full-box -- a diagonal one like the hammer paints eight
 * or nine at any size, because that is the drawing -- and no font-size fixes
 * that without overflowing the rest. `e2e/sidebar-tree-shots.mjs` measures
 * both inks against the mark's and against the slot.
 */
export const HEADING_SLOT_PX = 20;
export const HEADING_GLYPH_PX = HEADING_SLOT_PX - 4;

/**
 * The lane the PROVIDER mark sits in, in px — which agent ran this session.
 *
 * IT LIVES ON THE META LINE NOW, not beside the status mark. The operator:
 * "in the sidebar, put the provider glyph before the branch name, under the
 * session name." That is a statement about what the two facts have to do with
 * each other — a branch and the agent that worked it are one sentence about
 * where this session's work came from, and the title line is for what the
 * session IS. It is also what buys the title back the 18px the pairing cost
 * it, at the 200px minimum where that was three characters of a name that was
 * already truncating.
 *
 * TEN, DOWN FROM TWELVE, and the number moved with the mark because a lane is
 * sized by its NEIGHBOURS and the neighbours changed. Twelve was chosen
 * against a 13px title and a 14px status lane, where the mark was the quieter
 * of a pair and had to stay so. On the meta line it leads a 10px `GitBranch`
 * and 11px mono text (`--text-meta`), and a 12px glyph in front of those does
 * the opposite of what twelve was for: the ornament would be the largest
 * thing on the line it is only introducing. Ten is the branch glyph's own
 * size, so the two marks that open the line are one height.
 *
 * THE LANE IS STILL DRAWN WHEN IT IS EMPTY, which is the one argument that
 * survives the move intact — restated because it is now about a different
 * column. A lane that collapses to its content moves the thing beside it, and
 * that thing is now every row's branch name rather than every row's title.
 *
 * IT IS NOT CONDITIONAL ON THE LIST HOLDING TWO SOURCES, which was the
 * obvious way to make an operator with one source pay nothing — and is the
 * shape of `CAN_CHOOSE_PROVIDER` in `shared/providers.ts`. It was rejected on
 * the one thing that argument does not cover: the sidebar FILTERS. A filter
 * that hid the last Codex row would take the mark off every Claude row with
 * it, so every branch name in the column would jump on a keystroke, and come
 * back on the next. A lane that is sometimes there is worse than a lane that
 * costs its width, which is the whole of `status-mark.tsx`'s "THE LANE IS
 * FIXED".
 */
export const PROVIDER_LANE_PX = 10;

/**
 * That lane, drawn — ONE component because two rows draw it.
 *
 * The phone's meta line and the desktop's are different elements with
 * different ink and different contents, and the mark opens both. Written
 * twice, the pair would drift: the likeliest edit here is a new hook or a
 * changed lane, and the file has enough depth of nesting that the second copy
 * is easy to miss. The hooks in particular are not decoration —
 * `data-row-source` and `data-source-mark` are what
 * `SessionList.provider-mark.test.tsx` and `e2e/provider-mark-shots.mjs` find
 * the element by, and the guard asserts the SAME attributes on both rows.
 *
 * `source` is the row's resolved source (`session.source ?? project.source`),
 * or `null` for a model that names neither — which is possible, both fields
 * are optional. That case draws the lane and nothing in it rather than
 * claiming a provider vam cannot name.
 *
 * NO INK OF ITS OWN, deliberately, unlike the version that rode the title
 * line and carried `text-ink-faint`. Here it leads a `GitBranch` of the same
 * size four pixels away, and two glyphs that size apart in two different
 * greys read as a mistake. Inheriting also puts its contrast under a
 * measurement that already exists: `e2e/sidebar-tree-shots.mjs` composites
 * the meta line's ink and its `opacity-[0.82]` by hand and holds the WORST
 * row above 4.5:1 — comfortably past the 3:1 WCAG 1.4.11 asks of a graphical
 * object — and the phone's line is `text-ink-dim` for the same reason.
 */
function ProviderLane({ source }: { readonly source: string | null }): ReactNode {
  return (
    <span
      data-row-source={source ?? ''}
      {...(source === null ? {} : { 'data-source-mark': markRegisterOf(source) })}
      aria-hidden="true"
      /* An inline style, not `w-[10px]`: Tailwind's scanner reads source text,
         so a class assembled from a constant is one it never generates and the
         lane would collapse -- the trap `StatusMark` and `BRANCH_TAIL_MAX_CHARS`
         both record. */
      style={{ width: PROVIDER_LANE_PX, height: PROVIDER_LANE_PX }}
      className="flex flex-none items-center justify-center"
    >
      {source !== null && <SourceMark source={source} lane={PROVIDER_LANE_PX} />}
    </span>
  );
}

/**
 * A branch name split so the END survives a narrow column.
 *
 * CSS `truncate` clips the tail, but the tail is the name: at the 200px
 * sidebar minimum, `smith/specs/vam-seam-plan` and
 * `smith/specs/vam-canvas-topology` both clip to `smith/specs/vam-...` —
 * identical, and cut exactly where they would have differed. So the leading
 * segments become the shrinkable part and the last segment is held at its
 * full width. A name with no slash is all tail; a trailing slash yields an
 * empty tail, which renders as nothing rather than as a crash.
 */
function splitBranch(branch: string): { head: string; tail: string } {
  const cut = branch.lastIndexOf('/');
  return cut === -1
    ? { head: '', tail: branch }
    : { head: branch.slice(0, cut + 1), tail: branch.slice(cut + 1) };
}

/**
 * How many characters `data-branch-tail` prefers to hold before offering an
 * ellipsis at a readable boundary — an AESTHETIC preference, not the thing
 * that keeps it off `data-session-age`.
 *
 * IT USED TO BE THE GUARANTEE, and measured wrong. The arithmetic below
 * budgeted `data-session-age` at 24px on the claim that `relativeTime`
 * (`src/renderer/adapter/relative-time.ts`) "never emits more than a number
 * and a letter" — false: its day branch is `` `${Math.floor(ago / DAY)}d` ``
 * with no upper bound, so a session whose source timestamp is old, or
 * simply wrong, prints `12345d` or wider, and its own parse-failure branch
 * returns the raw ISO string verbatim. A character count that assumes a
 * bounded age was already wrong before a single font metric entered into
 * it — and measured against the narrower, *realistic* four-character case
 * (`999d`, the widest a session actually days-old today prints) this
 * budget still ran 3.27px into the age at `SIDEBAR_MIN`, because `20ch` in
 * this font is not an even 120px. Two independent ways for a number typed
 * into a comment to be wrong, and both were: see `e2e/branch-overlap.spec.ts`
 * for the measurement.
 *
 * WHAT ACTUALLY STOPS THE OVERLAP NOW: `data-session-branch`'s own
 * `overflow-hidden`. That element is a flex child already sized correctly
 * by the row's own flex layout — `min-w-0` lets it shrink to exactly the
 * space `data-session-age` (flex-none) does not need, computed by the
 * browser from the age's REAL rendered width, at paint time, in whatever
 * font actually loaded. `data-branch-tail` inside it is `flex-none` and
 * happily renders past that box's edge; `overflow-hidden` on the parent is
 * what refuses to paint the part that would land on the age, at any width,
 * any age string, any font — no arithmetic to get wrong. `data-branch-head`
 * shrinks first (plain `truncate`, ordinary flex-shrink), so the tail is
 * only ever clipped by the hard bound after the head has already given up
 * everything it has, preserving `splitBranch`'s own priority: the
 * distinguishing final segment stays whole for as long as it possibly can.
 *
 * WHAT THIS CONSTANT STILL DOES: below it, the tail renders in full; past
 * it, `truncate` turns on and offers its OWN ellipsis at a chosen character
 * rather than wherever the hard clip happens to land — nicer to read on an
 * ordinary long branch, and free to be a little optimistic since a miss
 * costs nothing but a slightly-later "…" instead of a bare edge. Rounded
 * from the same 116px-ish budget as before (`SIDEBAR_MIN` minus the row's
 * chrome minus a REALISTIC, not a bulletproof, age estimate) — kept
 * approximate on purpose, because getting it exactly right no longer
 * matters.
 */
export const BRANCH_TAIL_MAX_CHARS = 20;

/**
 * How wide the filter popover opens, on a viewport with room for it.
 *
 * It replaces a fixed 212px, then a second draft clamped to `sidebar - 24` --
 * both cramped enough that a Filters row's own label truncated ("Hide a…",
 * "Hide s…"). Orca's own panel is not sized to its sidebar at all: it FLOATS
 * over the canvas, wider than the column that opened it. The operator's own
 * review of the first draft: "let it float wider than the sidebar like orca
 * (≈300–320px, still clamped to the viewport)".
 *
 * So this is a ceiling, and the floor is the WINDOW now, not the column: the
 * anchor moved from `right-0` (pinned to the sidebar's own right edge,
 * growing LEFT -- which is what clamped it to the sidebar in the first
 * place, on pain of hanging off the window's own left edge at a narrow
 * sidebar) to `left-3` inside `data-projects-header` (pinned near the
 * header's own left inset, growing RIGHT, into the canvas -- orca's own
 * direction, and the one direction a 320px popover can take from a column
 * that is sometimes narrower than that without ever going negative). The
 * drawn width is `min(this, viewportWidth - 24)`, a 12px gutter on each
 * side of the WINDOW rather than the sidebar -- see `FILTER_POPOVER_GUTTER`.
 *
 * 320 is the smallest step that reads every label in full at the demo
 * fixture's own longest row even before this pass shortened the labels
 * further (`Note`'s own strings now carry what "Hide sessions vam did not
 * start" used to say on the row itself); still comfortably inside a phone's
 * 390px minus the same 24px gutter (366).
 */
export const FILTER_POPOVER_WIDTH = 320;

/**
 * How long the restore strip stays on screen after a hide, in either
 * direction: a fresh hide, or the most recent restore that still leaves
 * something hidden. A15.3: "a permanent strip is a standing cost for a
 * momentary action" — 8 seconds is long enough to notice and act on the
 * receipt, short enough that it does not become furniture. Exported so the
 * test asserting the auto-dismiss can advance fake timers past the real
 * value rather than a guessed one.
 */
export const RESTORE_STRIP_VISIBLE_MS = 8_000;

/**
 * How long the "N sessions hidden — vam did not start them" note stays up
 * once it has appeared (or grown), before it hides itself — the operator's
 * own ask, so an on-by-default filter's own receipt does not become
 * furniture at the foot of every sidebar. Same order of magnitude as
 * `RESTORE_STRIP_VISIBLE_MS` and for the same reason: long enough to read
 * and act on (`Show`), short enough not to sit there forever. Exported so
 * the test asserting the auto-hide can advance fake timers past the real
 * value rather than a guessed one.
 *
 * PAUSED, NOT RESET, WHILE THE OPERATOR IS ON IT: hovering the note or
 * focusing something inside it (the `Show` link, the Dismiss button) stops
 * this clock rather than letting it fire out from under a still-reading
 * operator, and leaving resumes it for whatever was left — see the note's
 * own render site.
 */
export const FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS = 8_000;

/**
 * How long the note's own exit fade runs, once it is about to go (auto-hide
 * or Dismiss) — `OverlayScroll`'s own `opacity-0 transition-opacity
 * duration-150`, reused rather than invented, so leaving is a fade rather
 * than a snap and the footer never shows an empty gap where a still-mounted,
 * now-invisible note would otherwise hold space. Zero under
 * `prefersReducedMotion` below, which skips straight to the unmount.
 */
export const FOREIGN_HIDDEN_NOTE_FADE_MS = 150;

/**
 * Same fallback `phone/viewport.ts`'s own `usePhoneViewport` uses for the
 * same reason: `matchMedia` is absent in the `node` environment most of this
 * suite runs in, and "motion is fine" is the safe default for an environment
 * that never paints anything at all.
 */
function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * 12px on each side of the WINDOW, not the sidebar -- the popover floats
 * past its own column now (`FILTER_POPOVER_WIDTH`'s own header), so what it
 * must stay clear of is the browser viewport's edges, the same figure
 * `left-3` on `data-filter-menu` already spends on its own left inset.
 */
const FILTER_POPOVER_GUTTER = 24;

/**
 * The breathing space left below the popover's own bottom edge.
 *
 * The ONLY constant in the height cap, and deliberately: it is a margin, not a
 * position. Everything that says WHERE the popover is comes from measuring it
 * -- see `useFilterPopoverCap`.
 */
const FILTER_POPOVER_FOOT = 8;

/**
 * The worst-case iOS portrait keyboard, in CSS pixels, with its accessory
 * bar -- the same mid-figure `e2e/phone-shell.pw.ts`'s `IOS_KEYBOARD_CSS_PX`
 * uses to simulate one (iOS portrait keyboards measure roughly 291-380px
 * depending on the accessory and prediction rows).
 *
 * RESERVED ON PHONE UNLESS A REAL RESIZE HAS ALREADY SHRUNK THE VIEWPORT
 * SINCE THIS POPOVER OPENED -- never gated on detecting a keyboard directly,
 * since there is no such detection to reach for on iOS at all
 * (`useFilterPopoverCap`'s own header). The first cut of this fix reserved
 * unconditionally on every phone measurement and broke the Android case:
 * `window.innerHeight` there really does shrink to the keyboard-covered
 * figure, so subtracting this on top of an ALREADY-shrunk measurement
 * double-counted the same keyboard twice and drove the cap to zero --
 * falsified against `e2e/phone-shell.pw.ts`'s own Android test, which is
 * what caught it. `useFilterPopoverCap` compares each measurement against
 * the viewport height it saw when the popover FIRST opened: smaller than
 * that baseline means a real shrink already happened and its own arithmetic
 * is trustworthy on its own (Android's case); still at the baseline means
 * nothing has told this hook anything, which is the iOS case this constant
 * exists for.
 *
 * This is the same shape of fix `styles.css`'s icon-picker sheet already
 * uses for the identical iOS trap ("give the picker the full 85dvh so its
 * scroller STARTS above the fold"): reserve the worst case, geometric
 * rather than detected. It costs this popover nothing ordinary -- four short
 * rows and a status strip never approach a 336px cut -- and it is what keeps
 * the popover's own scroller (already `overflow-y: auto` below) starting,
 * and ending, above a keyboard-covered band rather than only above the
 * fully uncovered viewport.
 */
const PHONE_KEYBOARD_RESERVE_PX = 336;

/**
 * How tall the popover may be: the distance from where it actually is to the
 * bottom of the viewport, measured.
 *
 * WHY IT NEEDED ONE AT ALL. It is an anchored popover, so it is deliberately
 * excluded from the phone sheet rules in `styles.css` -- turning it into a
 * bottom sheet would move it away from the control it belongs to, and that
 * exclusion is a decision this does not overturn. But the exclusion left it
 * with `max-height: none` and `overflow-y: visible`, so its usable height was
 * whatever the viewport happened to leave below its anchor. Measured at
 * 375x667 (iPhone SE portrait, still shipping) with the viewport shrunk by a
 * keyboard, two of its controls sat at 383px and 422px in a 331px viewport
 * with nothing to scroll: a control that cannot be reached and cannot be
 * scrolled to.
 *
 * WHY MEASURED AND NOT A CONSTANT. CSS cannot say "as tall as the distance
 * from here to the bottom of the viewport" for an absolutely positioned box,
 * and every constant that could stand in for it is tuned to one anchor
 * position -- it would go wrong the first time the header grows a row. The
 * element's own rect knows where it is; asking it costs one read.
 *
 * WHY IT RE-MEASURES. `resize` and not `visualViewport`: on Android the
 * layout viewport really does shrink when the keyboard opens, and a cap taken
 * only at open time would still be the pre-keyboard one. `visualViewport` is
 * the listener `styles.css` rules out for its jitter and double-resize loops,
 * and this does not use it -- on iOS the layout viewport does not move at
 * all, so `resize` never fires there and this hook never learns a keyboard
 * opened. `PHONE_KEYBOARD_RESERVE_PX` is what makes the popover's own
 * scroller the thing that brings covered controls back regardless: reserved
 * out of every phone measurement unconditionally, not only once told, it
 * keeps the scroller short enough that its own bottom edge sits above where
 * an iOS keyboard would cover, with the rest one scroll away.
 *
 * Returns `null` while closed, so the popover renders exactly as it does
 * today until it has been measured once.
 */
/**
 * What a right-click on a session row offers, and why each item is there.
 *
 * THE SAME THREE THE CHORD TABLE ALREADY OFFERS for the focused row -- `r`,
 * `s`, `x` -- and nothing invented for the occasion. The operator asked for
 * "rename, remove"; `remove` for a session IS `x`. A session is a live process
 * on a cwd rather than a stored record, so ending it is the whole of removing
 * it, and the only surface with a separate "Remove" is the PROJECT heading one
 * level up, where it hides the project and ends what vam started, behind a
 * confirm.
 *
 * EVERY ITEM IS ALWAYS DRAWN. An unavailable one is disabled and carries its
 * reason; it is never dropped. A menu whose shape changed with the row under
 * the pointer would make the operator read it every time instead of learning
 * where the third item is -- and the two reasons below are facts worth
 * saying, not states worth hiding.
 *
 * Module scope rather than a closure inside the component, so the whole item
 * set can be asserted without rendering a sidebar.
 */
export function rowMenuItems(
  sessionId: string,
  how: {
    /** `pendingAction` for this row: closing can take the full stop timeout. */
    readonly closing: boolean;
    readonly onRenameSession?: ((sessionId: string) => void) | undefined;
    readonly onClose: (sessionId: string) => void;
    readonly onReopen?: ((sessionId: string) => void) | undefined;
    /** Has this row's source MEASURED that the conversation is over? */
    readonly ended?: boolean;
    /** Does this row's source advertise `resumeSession`? */
    readonly canReopen?: boolean;
  },
): ContextMenuItem[] {
  // A row on its way out takes no orders -- the same fact the row button and
  // the `x` already wear. A rename issued into those fifteen seconds would be
  // a rename of something that is leaving.
  const stopping = how.closing ? 'this session is already closing' : null;
  // The phone shell draws this list with no rename flow to offer. Saying so is
  // the honest half of keeping the item on screen.
  const noRoute = 'not available here';
  return [
    {
      id: 'rename',
      label: 'Rename session',
      unavailable: stopping ?? (how.onRenameSession === undefined ? noRoute : null),
      onPick: () => how.onRenameSession?.(sessionId),
    },
    {
      id: 'reopen',
      label: 'Reopen session',
      /**
       * `docs/design/reopening-a-session.md` §3: never offered for a session
       * that is LIVE, because `--resume` on a running one starts a COPY, and
       * two processes on one conversation is the collision that once made
       * Close kill the wrong tmux session.
       *
       * Drawn-and-disabled rather than dropped, on this menu's own rule above.
       * "Not offered" as an absence teaches the operator nothing; the sentence
       * is what tells them a finished session could be reopened here and that
       * this one has not finished.
       *
       * `ended` is the source's own MEASUREMENT, not the row's colour --
       * `Session.ended` carries why those are different.
       */
      unavailable:
        stopping ??
        (how.onReopen === undefined
          ? noRoute
          : how.canReopen === false
            ? 'this source has no way to return to a conversation'
            : how.ended === true
              ? null
              : 'this session is still running — reopening would start a second copy of it'),
      onPick: () => how.onReopen?.(sessionId),
    },
    {
      id: 'close',
      label: 'Close session',
      danger: true,
      unavailable: stopping,
      onPick: () => how.onClose(sessionId),
    },
  ];
}

function useFilterPopoverCap(
  open: boolean,
  menuRef: RefObject<HTMLDivElement | null>,
): number | null {
  const phone = usePhoneViewport();
  const [cap, setCap] = useState<number | null>(null);
  // The viewport height this popover saw the moment it opened -- `null`
  // until the first measurement. `PHONE_KEYBOARD_RESERVE_PX`'s own header:
  // a REAL shrink below this baseline (Android's `resize`) means the
  // browser already reserved the keyboard for us, and reserving again on
  // top of it is what drove the cap to zero the first time this was
  // written. Still AT the baseline means nothing has told this hook
  // anything, which is the silent-iOS-cover case the constant guards.
  const openHeight = useRef<number | null>(null);
  useEffect(() => {
    if (!open) {
      setCap(null);
      openHeight.current = null;
      return;
    }
    const measure = () => {
      const menu = menuRef.current;
      if (menu === null) return;
      // `top`, not `bottom`: the top edge is where the anchor put it and does
      // not move when the cap is applied, so re-measuring cannot walk the
      // popover down the screen one resize at a time.
      const top = menu.getBoundingClientRect().top;
      openHeight.current ??= window.innerHeight;
      const alreadyShrunk = window.innerHeight < openHeight.current;
      const reserve = phone && !alreadyShrunk ? PHONE_KEYBOARD_RESERVE_PX : 0;
      setCap(Math.max(0, window.innerHeight - top - FILTER_POPOVER_FOOT - reserve));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, menuRef, phone]);
  return cap;
}

/**
 * The browser viewport's own width, live -- `Canvas.tsx`'s own
 * `viewportWidth` state, duplicated here rather than threaded down as a
 * prop: this pane is `memo`'d against 40-odd already-stable props
 * (`SessionList`'s own doc comment), and a value that changes on every
 * window resize is the one kind of prop that would defeat that memo for the
 * WHOLE pane rather than only the popover reading it.
 *
 * What it is FOR: the filter popover no longer clamps its width to the
 * sidebar column (`FILTER_POPOVER_WIDTH`'s own header) -- it floats past it,
 * the way orca's own does, so what bounds it now is the window it must stay
 * inside of, not the column it opened from.
 */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    function onResize() {
      setWidth(window.innerWidth);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export type SessionListProps = {
  readonly entries: readonly SessionEntry[];
  /** True while the first read of the source is still out (`useSourceModel`)
   *  — "no sessions" and "still asking" must read differently. Optional,
   *  defaulting to `false`. */
  readonly loading?: boolean;
  /**
   * WHETHER VAM HAS A SESSION OF ITS OWN, ANYWHERE -- `Canvas.tsx`'s own
   * `hasOwnSession`, computed there off the UNFILTERED model and handed down
   * rather than re-derived here from `allEntries` below: the two surfaces
   * this list draws that state the same claim as the desktop's
   * getting-started screen (`showGettingStarted`'s phone copy of it, and
   * this list's own "No sessions yet" line) must read the identical fact
   * that screen does, not a second computation of it that could drift.
   * `entries.length === 0` alone is NOT this: a session vam started that is
   * merely hidden by dismiss or a filter leaves `entries` empty while this
   * stays `true`, and it is exactly that gap neither line may state as "no
   * sessions". Optional, defaulting to `false` — a caller with no unfiltered
   * fact of its own falls back to the exact behaviour this prop replaces
   * (`entries.length === 0` decides alone), never a NEW claim.
   */
  readonly hasOwnSession?: boolean;
  /**
   * The same sessions BEFORE any narrowing -- `Canvas`'s `allEntries`.
   *
   * `entries` has been through search, the status pills and the two origin
   * rules, one of which (`hideAgentStarted`) is ON BY DEFAULT. Everything this
   * component DRAWS comes from `entries`, which is right: the list is the
   * filter's result. Two things must not, and both are about removing a
   * project, because removal acts on the whole project while a filter shows
   * part of it:
   *
   *   - the confirm's counts and the plan they describe, or the dialog states
   *     a number smaller than what it is about to do; and
   *   - the restore strip, or searching for another project unmounts the only
   *     control that brings this one back.
   *
   * Optional, defaulting to `entries`, so a caller that does not filter can
   * pass nothing and get identical behaviour.
   */
  readonly allEntries?: readonly SessionEntry[];
  readonly focusedSessionId: string | null;
  /**
   * THE JUMP LABELS: session id to the one key that jumps to it, empty
   * whenever `f` has not armed the mode.
   *
   * A PROP RATHER THAN A FACT THIS PANE DERIVES, because the map is the key
   * handler's. `Canvas.tsx` builds it from the same `sessionIds` the window
   * listener matches a pressed letter against, so the badge a row wears and
   * the row that letter moves to are one answer. Rebuilding it here from
   * `entries` would be a second one, and it would be the wrong one the moment
   * the two lists were ordered differently.
   *
   * It shipped with nowhere to be drawn at all: the map was built, read inside
   * the listener, and handed to no component — so `f` armed a mode whose only
   * trace on screen was the status bar reading `JUMP`, and asked the operator
   * to type a label they could not see.
   *
   * Optional and defaulting to none, like every flag on this pane: no test
   * that renders it directly is about jumping, and the phone shell — which is
   * handed these same props — has no chord layer to arm the mode with.
   */
  readonly jumpLabels?: ReadonlyMap<string, string>;
  /**
   * Is this pane the whole screen, on a device with no keyboard and no canvas?
   *
   * Optional and defaulting to false, the way every flag on this pane is:
   * every test that renders it directly is about something else, and a
   * required flag would have made that change edit all of them.
   * It selects the row variant the UI spec's D1 describes -- not a second
   * component, the same one saying different things, because on a phone this
   * list IS the surface: nothing beside it repeats a status, answers a
   * question, or gives a cursor somewhere to be.
   */
  readonly phone?: boolean;
  /**
   * The connectivity dot (`SourceReadout`, `Canvas.tsx`), folded into the
   * avatar row on a phone rather than drawn in a bar of its own.
   *
   * `PhoneShell.tsx` used to give this its own `<header>` above this pane,
   * whole reason for being was seven visible pixels in a 48px, full-width,
   * bordered bar -- the healthy arm paints nothing but a dot (see
   * `SourceReadout`'s own comment). The operator's report, translated: "an
   * empty gap and a blue dot" at the very top of the getting-started screen.
   * The readout is still mandatory -- a dropped tunnel and an idle factory
   * must not look the same -- so it moves here, into the row that already
   * exists on screen either way, rather than being dropped.
   *
   * `undefined` everywhere else: the desktop draws its own copy in the
   * canvas top bar and never hands one down to this pane.
   */
  readonly sourceReadout?: ReactNode;
  /** Which factory this is. The mockup calls it a workspace; vam has one. */
  readonly workspace: string;
  readonly filter: string;
  readonly filtering: boolean;
  readonly onFilterChange: (value: string) => void;
  readonly onFilterCommit: () => void;
  readonly onFilterCancel: () => void;
  /** Mouse route to what `/` does. */
  readonly onOpenFilter: () => void;
  /**
   * The status narrowing, and the popover that owns it.
   *
   * It used to be a `<Panel>` floating over the canvas. One piece of state
   * with two controls on two surfaces is a disagreement waiting to happen,
   * and the canvas was the wrong surface anyway: what the narrowing produces
   * is THIS list, so the control belongs beside it.
   */
  readonly statusFilter: StatusFilter;
  readonly onStatusFilter: (value: StatusFilter) => void;
  /** Counts over the UNFILTERED workspace — a count that moved when you
   * clicked it would be a count of your own click. */
  readonly statusTally: Readonly<Record<StatusFilter, number>>;
  readonly filterMenuOpen: boolean;
  readonly onFilterMenuToggle: (open: boolean) => void;
  /** The two origin toggles, and what each one costs you. */
  readonly originFilters: SessionFilters;
  readonly onOriginFilters: (next: SessionFilters) => void;
  /** The popover's Group-by/Sort-by choice, and how the operator changes it. */
  readonly viewOptions: ViewOptions;
  readonly onViewOptions: (next: ViewOptions) => void;
  /** How many sessions each rule matches, over the UNFILTERED workspace. A
   * toggle that hid things without saying how many would be a disappearance. */
  readonly hiddenCounts: {
    readonly agent: number;
    readonly unprompted: number;
    readonly ended: number;
    readonly foreign: number;
    readonly idle: number;
  };
  /**
   * HOW MANY ROWS `hideForeign` IS HIDING RIGHT NOW -- NOT `hiddenCounts.
   * foreign` above, which counts every foreign session whether or not the
   * rule is even on. `Canvas.tsx` computes this with
   * `countHiddenByForeignFilter` (`session-filter.ts`) rather than this pane
   * doing it from `allEntries` itself, because the count has to agree with
   * two exemptions only `Canvas.tsx`'s own `entries` memo knows about:
   * `vamListingGap` standing the rule down entirely, and `?demo=1` being
   * exempt from it so `fixtures/demo.ts`'s own foreign row is never hidden.
   * A count computed here from `allEntries` alone would say "hidden" about a
   * row `entries` never actually hid.
   *
   * `docs/design/vam-owns-the-session.md`'s trap, closed a second time:
   * `listVamSessions` answering `ok, []` -- no tmux server yet, the state
   * after every reboot before vam starts its first session -- is not a
   * `vamListingGap` (ownership is honestly zero), so `hideForeign` can still
   * empty the sidebar with no explanation at all. This is what the quiet
   * line at the foot of the list reads to say why.
   */
  readonly foreignHiddenCount: number;
  /**
   * WHY THE FOREIGN AND ENDED RULES ARE STANDING DOWN RIGHT NOW, or `null` on
   * every ordinary poll. `docs/design/vam-owns-the-session.md`'s own trap:
   * "an unreadable tmux listing must not empty the sidebar" -- once a source's
   * own tmux read fails, neither rule can trust what it would otherwise hide
   * (`Canvas.tsx`'s `entries` memo is what actually stands them down; this is
   * the words for why, so the popover can say so rather than silently
   * narrowing less than the operator expects).
   */
  readonly vamListingGap?: string | null;
  readonly renamingId: string | null;
  readonly renameDraft: string;
  readonly onRenameChange: (value: string) => void;
  readonly onRenameCommit: () => void;
  readonly onRenameCancel: () => void;
  readonly onPick: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  /** Absent where there is no reopen flow to offer -- the phone shell. */
  readonly onReopen?: ((sessionId: string) => void) | undefined;
  /**
   * Whether a source here advertises `resumeSession` at all. The PER-ROW
   * refusals belong to the callback, which answers in the source's own words;
   * this only decides whether the item can ever be live.
   */
  readonly canReopen?: boolean;
  /**
   * THE RIGHT-CLICK MENU'S TWO NEW ROUTES, and the reason they are new.
   *
   * Renaming a session was `r` and changing its icon was `s`, both
   * KEYBOARD-ONLY: there was no pointer route to either, on any surface. The
   * chords act on the FOCUSED row; these act on the row the pointer named, so
   * a right-click does not have to move the cursor first.
   *
   * OPTIONAL, and the menu says so rather than hiding the item. The phone
   * shell draws this list too and has no rename flow to offer -- a menu that
   * silently dropped an item would change shape between two surfaces showing
   * the same row, which is the failure `hiddenCounts` exists to avoid one
   * level up.
   */
  readonly onRenameSession?: (sessionId: string) => void;
  readonly onAdd: () => void;
  /**
   * Whether `onAdd` is about to fall back to New project -- `Canvas.tsx`'s
   * own `focusedEntry === null`, computed there and handed down rather than
   * approximated here from `entries`/`focusedSessionId`: `onAdd`'s real
   * target is `focusedEntry`, built off the UNFILTERED session set, and a
   * second guess from this component's own FILTERED `entries` could disagree
   * with it the moment a search or a status pill hides the focused row
   * without un-focusing it. The footer's LABEL is read from this so it can
   * never claim "New session" while a click is about to start a project
   * instead -- the exact lie `newSessionDecline` already exists to prevent
   * one layer up.
   */
  readonly addWillCreateProject: boolean;
  /**
   * The `+` in a project's heading. Separate from `onAdd` because it can say
   * WHICH project the click was about, and the answer differs per project the
   * moment there is a route to create a session in one.
   */
  readonly onAddInProject: (project: Project) => void;
  /**
   * The `+` in the Projects header. A project here is a grouping of live
   * sessions on their cwd, so there is nothing to "create" — the only thing
   * this can mean is: choose a directory, start a session in it, and the
   * project exists because something is running there. The caller owns both
   * halves; this component owns the button.
   */
  readonly onNewProject: () => void;
  /**
   * Why a new session cannot be started, in the SOURCE's own words, or `null`
   * when it can. Both `+` controls caption themselves from this: a control
   * that claims it works when it does not is the defect this prop exists to
   * make impossible, and the component cannot ask a source anything itself.
   */
  readonly newSessionDecline: string | null;
  /**
   * Whether THIS BUILD can open a native directory picker at all --
   * `window.api?.dialog?.chooseDirectory !== undefined`, read at the call
   * site exactly as `DetailPanel.tsx`'s `prRepo` insists on for the same
   * bridge. Read only by the phone's own getting-started screen
   * (`GettingStarted.tsx`, drawn below when `phone` and the list is empty):
   * absent there, the screen withdraws its New project button rather than
   * drawing one the browser build and a phone can never act on.
   */
  readonly hasDirectoryPicker: boolean;
  /**
   * The id of the one action currently in flight -- a project id for a create,
   * a session id for a close -- or `null`. Owned by `Canvas.tsx`, which is
   * also where the guard that stops a second press lives; this draws it. One
   * prop rather than one per control, because it is one fact.
   */
  readonly pendingAction: string | null;
  /**
   * The project vam is starting a session in, or null.
   *
   * SEPARATE FROM `pendingAction` on purpose. That is the serialisation lock
   * and holds a project id while one is being REMOVED too, so reading it here
   * would draw "starting a session" over a project being deleted -- two
   * different things wearing one value, which is the defect this repo keeps
   * finding rather than one to add.
   *
   * `projectId` IS `null` FOR A PROJECT THAT DOES NOT EXIST YET -- the
   * "new project" `+`'s whole case. That control chooses a directory and
   * starts a session in it; there is no project, and so no section in
   * `entries`, until that session exists. `null` is how this component tells
   * the two waits apart: a real id is matched against an existing section
   * (below), and `null` draws a provisional section of its own, named from
   * `projectName` because there is no `Project` to read a name off.
   */
  readonly starting: { readonly projectId: string | null; readonly projectName: string } | null;
  /** Opens the icon picker for a project's heading — the mouse route; there
   * is no keyboard shortcut for it, unlike the session picker's `s`. */
  readonly onPickIcon: (project: Project) => void;
  /**
   * Rename a project's heading -- the local override, "Rename repo" in its
   * own menu item. NOT "Rename project": the group menu already owns that
   * label for the group one level up (UI "project"; see the vocabulary table
   * in `domain/model.ts`), and a second control reading the same words in a
   * sibling menu is the exact confusion the "one-line shortcut tips, missing
   * tooltips, first-load spinner, click-outside menus" fix resolved on the
   * two `+` buttons.
   *
   * Optional, and a control whose handler is absent is not drawn -- same
   * idiom and same reason as `onRenameGroup`: a caller with nowhere to store
   * the override must not be given a button that silently does nothing.
   */
  readonly onRenameProject?: (project: Project, name: string) => void;
  /**
   * The ids of the projects that are folded shut, and the ask to fold one.
   *
   * OPTIONAL, and that is a decision rather than an oversight: without them
   * this component keeps the fold in its own state, so folding works the day
   * it ships. Pass them — from `prefs.collapsedProjects` via
   * `isProjectCollapsed`/`setProjectCollapsed` — and the fold survives a
   * reload instead of a re-render.
   */
  readonly collapsedProjects?: readonly string[];
  readonly onToggleCollapse?: (project: Project) => void;
  /**
   * The groups to draw headings for -- UI "project", the layer ABOVE a
   * project; see the vocabulary table in `domain/model.ts`.
   *
   * PASSED RATHER THAN DERIVED FROM `entries`, and only for the empty case: a
   * group the operator has just made holds no project, so no entry mentions
   * it and a list built from the entries alone would draw nothing where they
   * are standing. Every non-empty group is placed by `entry.group`, in the
   * order `orderedSessions` ranked it.
   *
   * Optional and defaulting to none, like the fold below it: every test that
   * renders this pane is about something else, and the empty list is what
   * every store in existence holds.
   */
  readonly groups?: readonly Group[];
  /**
   * The ids of the groups folded shut, and the ask to fold one. Exactly
   * `collapsedProjects`/`onToggleCollapse` one level up, with the same
   * fallback-to-local-state decision and for the same reason: the control
   * works the day it ships, and persists once the caller passes
   * `prefs.collapsedGroups`.
   */
  readonly collapsedGroups?: readonly string[];
  readonly onToggleGroupCollapse?: (group: Group) => void;
  /**
   * The group lifecycle: make one, rename it, give it a glyph, dissolve it.
   *
   * Every one of them is a prefs write and nothing else -- no session ends, no
   * project is hidden, no source is asked anything -- which is why none of
   * them is serialised behind `pendingAction` and why `onUngroup` needs no
   * confirm. Optional, and a control whose handler is absent is not drawn: a
   * caller that has nowhere to store a group must not be given a button that
   * silently does nothing.
   */
  readonly onCreateGroup?: (name: string) => void;
  readonly onRenameGroup?: (group: Group, name: string) => void;
  readonly onPickGroupIcon?: (group: Group) => void;
  readonly onUngroup?: (group: Group) => void;
  /**
   * Open the list of repos to put in this group. The LIST lives in `Canvas`,
   * like both icon pickers, because it is wider than this column -- the row
   * only asks.
   */
  readonly onAddToGroup?: (group: Group) => void;
  /**
   * Removing a project, and bringing one back. ALL THREE ARE REQUIRED, and
   * that is the decision -- read on before making them optional again.
   *
   * The neighbours above (`collapsedProjects`, `onToggleCollapse`) are
   * optional, with an internal fallback, so folding works for a caller that
   * passes nothing. This trio deliberately does NOT follow them. A fallback
   * here would work -- the component can keep its own hidden list and call
   * `onClose` per session -- and that is precisely the problem: a caller that
   * dropped one of these props would go on removing projects, silently, into
   * state that dies with the component. The operator would see the project
   * disappear, and see it again on the next launch, which is the exact bug the
   * persisted list exists to prevent. Required means the compiler notices
   * instead of the operator.
   *
   * `hiddenProjects` is the ids removed under THIS source, from
   * `prefs.hiddenProjects` via `isProjectHidden`.
   *
   * `onRemoveProject` performs the whole act -- end, hide, report -- because
   * the caller can do things this component cannot: `Canvas` holds one
   * in-flight action at a time and returns early while one is running, so a
   * loop of `onClose` calls issued at the wrong moment would end nothing while
   * the project disappeared anyway. All this component owes it is a `plan` it
   * has already disclosed and had confirmed.
   *
   * `onHideProject` is the restore strip's route, and only that: bringing a
   * project back ends nothing, so there is nothing to serialise or refuse.
   */
  readonly hiddenProjects: readonly string[];
  readonly onHideProject: (project: Project, hidden: boolean) => void;
  readonly onRemoveProject: (project: Project, plan: RemovalPlan) => void;
  /**
   * The project `p` has just asked to reveal, or null when nothing has been
   * asked. A fresh object each press, so pressing `p` twice reveals twice.
   *
   * The ask arrives as a prop because the KEY is not this component's: it is
   * `revealProject` in the chord table, resolved by the one window listener in
   * `Canvas.tsx`. See the effect below for what that bought.
   */
  readonly revealRequest?: { readonly projectId: string } | null;
  readonly onSettings: () => void;
  /**
   * Opens the same Settings overlay `onSettings` does, focused directly on
   * the Remote section — pairing, approve/deny, unpair and revoke all — so
   * the operator reaches it without navigating through Settings first. Not a
   * second overlay: `RemotePanel` stays the one place that draws it.
   */
  readonly onRemote: () => void;
  /**
   * The theme ON SCREEN, already resolved — never `prefs.theme`, which can be
   * `system`. The two-way ternary below is exactly why: a third value would
   * land in its `else` arm, label the wrong direction and typecheck anyway.
   */
  readonly theme: EffectiveTheme;
  readonly onToggleTheme: () => void;
  /**
   * The current rendered width (task-1's `renderedWidth`), applied inline.
   *
   * Optional, and ABSENT means full width: a missing width is already the true
   * statement "nobody is sizing me", which is the phone shell's case, and a
   * `'fill'` sentinel would be a second way to say it.
   */
  readonly width?: number;
  /** `PaneResizer`, positioned by the caller — kept out of this file's own concerns. */
  readonly resizeHandle: ReactNode;
};

/**
 * One glyph per `Group by: Status` bucket -- the same words the status pill
 * row and the popover's own status marks use, drawn once here rather than a
 * fourth place inventing a mapping of its own. `Bell`/`LoaderCircle` are the
 * exact glyphs `status-mark.tsx` already draws for `waiting`/`running`;
 * `Moon` is orca's own icon for "sleeping"; `Check` reads "over" the way the
 * `Done` status pill's tone already does.
 */
function StatusBucketIcon({ bucket }: { readonly bucket: StatusBucket }): ReactNode {
  switch (bucket) {
    case 'needs-you':
      return <Bell size={13} strokeWidth={1.7} />;
    case 'running':
      // Static, deliberately -- unlike the status MARK's own spinner
      // (`status-mark.tsx`), which has its own reduced-motion handling this
      // small heading glyph does not duplicate. The bucket's word already
      // says "Running"; the icon is a caption, not a live indicator.
      return <LoaderCircle size={13} strokeWidth={1.7} />;
    case 'sleeping':
      return <Moon size={13} strokeWidth={1.7} />;
    case 'done':
      return <Check size={13} strokeWidth={1.7} />;
    default:
      return null;
  }
}

/**
 * Every section header in the filter popover -- "Group by", "Status",
 * "Filters", "Hidden projects" -- shares this one string, so the four of
 * them cannot drift apart from each other one at a time. Sentence case,
 * muted, no mono font and no letter-spacing: the operator's own review of
 * the first draft (which set all four in `font-mono uppercase
 * tracking-[0.12em]`, an eyebrow label) against orca's own screenshot,
 * where "Group by" and "Filters" read as ordinary dimmed words.
 */
const SECTION_HEADER = 'text-meta text-ink-dim';

/** The thin rule between one block of the popover and the next -- orca's own
 *  separators, drawn as a plain top border rather than a margin, so the
 *  `gap-2` the popover's own flex column already carries reads as the space
 *  on EITHER side of the rule instead of needing a second constant tuned to
 *  look right beside it. */
const SECTION_RULE = 'border-line border-t';

/** Why the PR cell of the Group-by control is disabled -- `title`'s own
 *  string, read on hover (`GROUP_BY_PILLS`'s own comment explains why not a
 *  `Note`). `docs/design/workspace-options.md`'s own words for the gap: a
 *  session can carry zero, one or several open pull requests, so there is
 *  no single bucket key the way there is for `Status`, and orca's own
 *  single "PR" bucket bakes in a policy -- one appearance or several? does
 *  "no PR" get a bucket of its own? -- nobody has decided yet. */
const PR_GROUPING_TITLE =
  'Grouping by PR needs a bucketing policy that is not decided yet -- a session can carry zero, one or several open PRs';

/**
 * The Group-by segmented control's four pills, orca's own order and words.
 * `pr` is not a `GroupBy` value -- there is nothing for the popover to WRITE
 * when it is pressed, which `disabled: true` enforces at the type the click
 * handler reads rather than merely in prose. See `docs/design/workspace-
 * options.md` for why grouping by pull request is not offered yet.
 */
const GROUP_BY_PILLS: readonly {
  readonly value: GroupBy | 'pr';
  readonly label: string;
  readonly disabled: boolean;
}[] = [
  { value: 'none', label: 'None', disabled: false },
  { value: 'status', label: 'Status', disabled: false },
  { value: 'pr', label: 'PR', disabled: true },
  { value: 'project', label: 'Project', disabled: false },
];

/** In the drill-in's own order, top to bottom -- `needs-you` first because
 *  it is the shipped default, the same reason it heads `STATUS_BUCKET_ORDER`. */
const SORT_BY_OPTIONS: readonly SortBy[] = ['needs-you', 'name'];

const SORT_BY_LABELS: Readonly<Record<SortBy, string>> = {
  'needs-you': 'Needs you first',
  name: 'Name',
};

/**
 * THE DRILL-IN: a back affordance, a radiogroup, arrow-key roving focus.
 *
 * A separate component rather than inline JSX in `SessionList` itself, for
 * the one thing that needs its own lifecycle: focus lands on the back button
 * the moment this mounts, so a keyboard operator who pressed "Sort by" does
 * not have to Tab past it to reach the two options -- the same "where the
 * keyboard goes when a layer opens" contract `SessionList`'s own popover-
 * open effect already keeps for the popover as a whole.
 */
function SortByMenu({
  value,
  onBack,
  onChange,
}: {
  readonly value: SortBy;
  readonly onBack: () => void;
  readonly onChange: (next: SortBy) => void;
}): ReactNode {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  /** ArrowDown/ArrowUp, wrapping -- two options is short enough that
   *  wrapping reads as a single ring rather than a dead end at either end. */
  const moveFocus = (from: SortBy, delta: 1 | -1) => {
    const index = SORT_BY_OPTIONS.indexOf(from);
    const next = SORT_BY_OPTIONS[(index + delta + SORT_BY_OPTIONS.length) % SORT_BY_OPTIONS.length];
    backRef.current
      ?.closest('[data-sort-by-menu]')
      ?.querySelector<HTMLButtonElement>(`[data-sort-by-option="${next}"]`)
      ?.focus();
  };

  return (
    <div data-sort-by-menu className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          ref={backRef}
          data-popover-back
          aria-label="back to workspace options"
          onClick={onBack}
          className="vam-tap flex h-[24px] w-[24px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-ink-faint hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={1.8} />
        </button>
        <span className="text-body font-semibold text-ink">Sort by</span>
      </div>
      <div role="radiogroup" aria-label="Sort by" className="flex flex-col gap-1">
        {SORT_BY_OPTIONS.map((option) => {
          const on = option === value;
          return (
            // A `<button role="radio">` group is the ARIA Authoring
            // Practices Guide's OWN alternative to `<input type="radio">`,
            // not a workaround: this row is a full hit target with a label
            // AND a trailing check glyph, styled like every other popover
            // row, which a native radio's fixed circle cannot become.
            // biome-ignore lint/a11y/useSemanticElements: see above
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              data-sort-by-option={option}
              onClick={() => onChange(option)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
                  return;
                }
                event.preventDefault();
                moveFocus(option, event.key === 'ArrowDown' ? 1 : -1);
              }}
              className={[
                'vam-tap flex w-full cursor-pointer items-center justify-between gap-2 rounded-[7px] border px-2 py-1.5 text-left text-control',
                on
                  ? 'border-line-loud bg-raised text-ink'
                  : 'border-line text-ink-dim hover:border-line-strong',
              ].join(' ')}
            >
              <span className="min-w-0 flex-1 truncate">{SORT_BY_LABELS[option]}</span>
              {on && <Check size={14} strokeWidth={1.8} className="flex-none" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `React.memo`: `draft` (the composer's text) lives one level up in
 * `Canvas`, so a keystroke re-renders `Canvas` and would otherwise
 * re-render this whole pane too. `Canvas` carries the matching half --
 * every one of its 40+ props here is a stable `useCallback`/`useMemo`.
 */
export const SessionList = memo(function SessionList(props: SessionListProps) {
  const {
    entries,
    loading = false,
    hasOwnSession = false,
    allEntries: unfiltered,
    focusedSessionId,
    jumpLabels = NO_JUMP_LABELS,
    phone = false,
    sourceReadout,
    filter,
    filtering,
    onFilterChange,
    onFilterCommit,
    onFilterCancel,
    onOpenFilter,
    statusFilter,
    onStatusFilter,
    statusTally,
    filterMenuOpen,
    onFilterMenuToggle,
    originFilters,
    onOriginFilters,
    viewOptions,
    onViewOptions,
    hiddenCounts,
    foreignHiddenCount,
    vamListingGap = null,
    renamingId,
    renameDraft,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    onPick,
    onClose,
    onReopen,
    canReopen,
    onRenameSession,
    onAdd,
    addWillCreateProject,
    onAddInProject,
    onNewProject,
    newSessionDecline,
    hasDirectoryPicker,
    pendingAction,
    starting,
    onPickIcon,
    onRenameProject,
    revealRequest,
    collapsedProjects,
    onToggleCollapse,
    groups = [],
    collapsedGroups,
    onToggleGroupCollapse,
    onCreateGroup,
    onRenameGroup,
    onPickGroupIcon,
    onUngroup,
    onAddToGroup,
    hiddenProjects,
    onHideProject,
    onRemoveProject,
    onSettings,
    onRemote,
    theme,
    onToggleTheme,
    width,
    resizeHandle,
  } = props;

  /**
   * What a control wears while its own action is running: it cannot be pressed
   * again, it says so to a screen reader and on hover, and `data-pending`
   * carries the breathe in `styles.css` -- switched off under
   * `prefers-reduced-motion`, where these attributes and the caption are what
   * is left, and they are enough.
   */
  const pending = (id: string, busy: string) =>
    pendingAction === id
      ? ({ 'data-pending': 'true', 'aria-busy': true, disabled: true, title: busy } as const)
      : {};

  /**
   * THE PHONE'S OWN GETTING-STARTED SCREEN (`GettingStarted.tsx`) TAKES
   * OVER THIS LIST'S BODY -- see the render site's own comment for why a
   * phone needs its copy drawn HERE rather than in `DetailPanel`.
   * `filter.trim() === ''`/`!loading`, the same guard the plain "No sessions
   * yet" line already used: a search with no match, or a listing still in
   * flight, is a different emptiness and keeps its own existing text.
   * `!hasOwnSession` is the THIRD: `entries` can be empty while vam still
   * owns a session merely hidden by dismiss or a filter, and that must read
   * the same "not truly empty" the desktop's own screen now does.
   */
  const showGettingStarted =
    phone && entries.length === 0 && filter.trim() === '' && !loading && !hasOwnSession;

  /**
   * THE WATERMARK BEHIND THE FOREIGN-HIDDEN NOTE: the count it was last left
   * at, by an auto-hide or a Dismiss. Read once per mount from
   * `localStorage` (`prefs/foreign-hidden-note.ts`) so a relaunch does not
   * nag about a count the operator already saw; written back by
   * `acknowledgeForeignHiddenCount` below, the ONE place either exit path
   * (the timer, or the button) records it.
   *
   * `foreignHiddenCount > 0` ALONE would put the note back on screen on
   * every poll for as long as anything is foreign-hidden — the operator's
   * own ask was the opposite of that: seen once, it stays gone FOR THAT
   * COUNT, and comes back only once the count GROWS past this watermark, a
   * session vam did not start joining the ones already named.
   */
  const [acknowledgedForeignCount, setAcknowledgedForeignCount] = useState(
    readAcknowledgedForeignHiddenCount,
  );
  const acknowledgeForeignHiddenCount = useCallback((count: number) => {
    setAcknowledgedForeignCount(count);
    writeAcknowledgedForeignHiddenCount(count);
  }, []);
  const foreignNoteShown = foreignHiddenCount > acknowledgedForeignCount && !showGettingStarted;
  /** Paused while the pointer is over the note, or focus is inside it — see
   * the note's own render site for the handlers that set this. */
  const [foreignNotePaused, setForeignNotePaused] = useState(false);
  /**
   * LAGS `foreignNoteShown` ON THE WAY OUT ONLY, so a hide is a fade
   * (`FOREIGN_HIDDEN_NOTE_FADE_MS`) rather than a snap, and unmounts for real
   * once the fade ends — never earlier, and never later than a fresh
   * appearance needs: if the count grows again mid-fade, `foreignNoteShown`
   * flips back to `true` and this effect cancels the fade outright.
   */
  const [foreignNoteClosing, setForeignNoteClosing] = useState(false);
  const foreignNoteCloseTimer = useRef<number | null>(null);
  /** The PREVIOUS render's `foreignNoteShown`, so the effect below can tell a
   * real true-to-false TRANSITION (the only case that should fade) apart from
   * a component mounted already-acknowledged, where `foreignNoteShown` is
   * `false` from the very first render and there is nothing to fade FROM —
   * without this, that mount ran the same effect body once regardless, and
   * a relaunch flashed a fully-invisible note for one `FOREIGN_HIDDEN_NOTE_
   * FADE_MS` before it disappeared for real. */
  const foreignNoteWasShown = useRef(foreignNoteShown);
  useEffect(() => {
    const wasShown = foreignNoteWasShown.current;
    foreignNoteWasShown.current = foreignNoteShown;
    if (foreignNoteShown) {
      if (foreignNoteCloseTimer.current !== null) {
        window.clearTimeout(foreignNoteCloseTimer.current);
        foreignNoteCloseTimer.current = null;
      }
      setForeignNoteClosing(false);
      return;
    }
    if (!wasShown) return;
    setForeignNoteClosing(true);
    const ms = prefersReducedMotion() ? 0 : FOREIGN_HIDDEN_NOTE_FADE_MS;
    foreignNoteCloseTimer.current = window.setTimeout(() => setForeignNoteClosing(false), ms);
    return () => {
      if (foreignNoteCloseTimer.current !== null) {
        window.clearTimeout(foreignNoteCloseTimer.current);
      }
    };
  }, [foreignNoteShown]);
  const foreignNoteMounted = foreignNoteShown || foreignNoteClosing;
  /**
   * THE AUTO-HIDE COUNTDOWN ITSELF. `foreignNoteRemainingMs` survives a
   * pause: leaving clears the live timer and banks the elapsed time back
   * into this ref (the cleanup below), rather than either letting the old
   * timer fire underneath the pause or restarting a full window on every
   * hover. `foreignNoteCycleCount` is what tells "the same appearance,
   * still counting down" apart from "the count grew again while the note
   * was already up", which gets the full window back — the same fresh-start
   * `RESTORE_STRIP_VISIBLE_MS`'s own effect gives a second hide mid-countdown.
   */
  const foreignNoteRemainingMs = useRef(FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS);
  const foreignNoteCycleCount = useRef<number | null>(null);
  useEffect(() => {
    if (!foreignNoteShown) {
      foreignNoteRemainingMs.current = FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS;
      foreignNoteCycleCount.current = null;
      return;
    }
    if (foreignNoteCycleCount.current !== foreignHiddenCount) {
      foreignNoteCycleCount.current = foreignHiddenCount;
      foreignNoteRemainingMs.current = FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS;
    }
    if (foreignNotePaused) return;
    const startedAt = Date.now();
    const id = window.setTimeout(
      () => acknowledgeForeignHiddenCount(foreignHiddenCount),
      foreignNoteRemainingMs.current,
    );
    return () => {
      window.clearTimeout(id);
      foreignNoteRemainingMs.current = Math.max(
        0,
        foreignNoteRemainingMs.current - (Date.now() - startedAt),
      );
    };
  }, [foreignNoteShown, foreignNotePaused, foreignHiddenCount, acknowledgeForeignHiddenCount]);
  /**
   * Is the provisional "your project is starting" row (below,
   * `data-project-section-provisional`) about to draw inside the scroller?
   * `showGettingStarted` does not read `starting` at all, so the two used to
   * mount AT ONCE -- an empty `OverlayScroll` beside `GettingStarted`, both
   * `flex-1` siblings of this `<aside>`. Splitting equal, unclaimed space
   * between a box with nothing in it and a box asking to CENTRE is exactly
   * the operator's own report, measured: the getting-started block sat in
   * the bottom 300px of a 600px free area, not its middle, because the
   * empty scroller silently kept the top 300 for itself. Mutually exclusive
   * below fixes that without touching either screen's own contract: the
   * provisional row wins while it is live, since it is the one carrying
   * news, and getting-started returns the moment `starting` clears.
   */
  const showStartingProvisional = starting !== null && starting.projectId === null;

  const filterRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuWasOpen = useRef(false);
  const filterPopoverCap = useFilterPopoverCap(filterMenuOpen, menuRef);
  const viewportWidth = useViewportWidth();

  /**
   * Which face of the popover is showing -- the main options view, or the
   * Sort-by drill-in. Reset to `'main'` on every CLOSE, not merely on open,
   * so a popover the operator drilled into and dismissed with Escape or a
   * click outside reopens at the top rather than wherever they left it --
   * the same "always the front page" contract a fresh mount already gives a
   * dialog that unmounts between opens; this one does not unmount, so the
   * reset has to be explicit.
   */
  const [optionsView, setOptionsView] = useState<'main' | 'sort-by'>('main');
  useEffect(() => {
    if (!filterMenuOpen) {
      setOptionsView('main');
    }
  }, [filterMenuOpen]);

  /**
   * Where the keyboard goes when the popover opens, and where it comes back
   * to when it closes.
   *
   * Written as one effect on the OPEN flag rather than in the click handler,
   * because there are two ways to close it — the control itself and the
   * global Escape — and a keyboard user stranded on `document.body` by one of
   * them would have no way back into the list. Nothing here traps Tab: the
   * popover is a plain run of buttons, so Tab walks out of it the way it
   * walks out of anything else.
   */
  useEffect(() => {
    if (filterMenuOpen) {
      menuRef.current?.querySelector('button')?.focus();
    } else if (menuWasOpen.current) {
      menuButtonRef.current?.focus();
    }
    menuWasOpen.current = filterMenuOpen;
  }, [filterMenuOpen]);

  /**
   * A press anywhere outside closes the popover.
   *
   * `pointerdown`, not `click`: a click only lands after the button is
   * released, so a press-drag-release that starts outside and ends inside
   * would never close it, and the menu would still be open under the pointer
   * that was trying to dismiss it. Pointerdown is also what every other
   * dismissible surface in a desktop app listens for.
   *
   * The toggle button is excluded explicitly. Without that, pressing it while
   * the menu is open runs BOTH this handler and the button's own `onClick`,
   * which closes and reopens in one press and looks like the button is dead.
   *
   * Listener attached only while open, so a closed sidebar costs nothing.
   */
  useEffect(() => {
    if (!filterMenuOpen) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target === null) {
        return;
      }
      if (menuRef.current?.contains(target) === true) {
        return;
      }
      if (menuButtonRef.current?.contains(target) === true) {
        return;
      }
      onFilterMenuToggle(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [filterMenuOpen, onFilterMenuToggle]);

  // Imperative focus in both cases, for the same reason: the keystroke that
  // opened the box is the request for it, so `autoFocus` would be claiming a
  // thing that was already granted, wherever the element happened to mount.
  useEffect(() => {
    if (filtering) {
      filterRef.current?.focus();
    }
  }, [filtering]);
  useEffect(() => {
    if (renamingId !== null) {
      renameRef.current?.select();
    }
  }, [renamingId]);

  /**
   * Which heading is showing its controls, from EITHER route.
   *
   * One piece of state for hover and for `p`, not two, so there is a single
   * answer to "is this heading revealed" — two would disagree the first time
   * the pointer left a heading the keyboard had just revealed.
   */
  const [revealed, setRevealed] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  /**
   * The fold, when no caller owns it. See `collapsedProjects` above: the
   * prop wins when it is passed, and this is what makes the control real
   * rather than inert while the wiring to prefs is someone else's file.
   */
  const [localCollapsed, setLocalCollapsed] = useState<readonly string[]>([]);
  const collapsed = collapsedProjects ?? localCollapsed;
  /** The same fallback for the group fold. See `collapsedGroups` on the props. */
  const [localGroupCollapsed, setLocalGroupCollapsed] = useState<readonly string[]>([]);
  const groupCollapsed = collapsedGroups ?? localGroupCollapsed;
  /**
   * The one group name being typed, and what it is for: a group about to
   * exist, or one being renamed. ONE piece of state, because one editor is
   * open at a time and two would need a rule about which wins.
   *
   * The idiom is the session rename's, deliberately -- a row that turns into
   * a field, Enter commits, Escape cancels -- and NOT an overlay:
   * `ConfirmRemoveProject`'s header states vam's overlay idiom exists to make
   * a disclosure, and naming a group discloses nothing.
   */
  const [groupDraft, setGroupDraft] = useState<
    { readonly kind: 'new' } | { readonly kind: 'rename'; readonly group: Group } | null
  >(null);
  const [groupDraftName, setGroupDraftName] = useState('');
  /**
   * THE RIGHT-CLICKED ROW, and where the pointer was when it happened.
   *
   * One piece of state for the whole list rather than one per row: only one
   * menu can be open, and a right-click on a second row must MOVE it rather
   * than open a second. Holding the session id (not the row element) is what
   * makes that a replacement instead of a stack.
   */
  const [rowMenu, setRowMenu] = useState<{
    readonly sessionId: string;
    readonly title: string;
    // Captured WHEN THE MENU OPENS rather than read when an item is picked.
    // The operator is deciding about the row they right-clicked, and a poll
    // landing while the menu is up must not quietly change what the item in
    // front of them means.
    readonly ended: boolean;
    readonly at: { readonly x: number; readonly y: number };
  } | null>(null);
  const [openGroupMenu, setOpenGroupMenu] = useState<string | null>(null);
  /** Never `entries`. See `allEntries` on the props for what reads this. */
  const allEntries = unfiltered ?? entries;
  const hidden = hiddenProjects;
  /** The project whose removal is being confirmed, or null. One at a time. */
  const [confirming, setConfirming] = useState<Project | null>(null);
  /**
   * The project heading whose name is being edited, or null. Exactly
   * `groupDraft`'s `'rename'` case, one level down -- there is no `'new'`
   * case here, since a project heading is never created from this pane, only
   * derived from a live session's cwd.
   */
  const [projectDraft, setProjectDraft] = useState<Project | null>(null);
  const [projectDraftName, setProjectDraftName] = useState('');

  const projectMenuRefs = useRef(new Map<string, HTMLButtonElement>());
  const groupMenuRefs = useRef(new Map<string, HTMLButtonElement>());
  const foldRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const projectPanelRef = useRef<HTMLDivElement>(null);
  const groupPanelRef = useRef<HTMLDivElement>(null);
  const openMenuWas = useRef<string | null>(null);
  const openGroupMenuWas = useRef<string | null>(null);

  /**
   * One right-click handler per session, for the two buttons that make up a
   * row. Curried rather than inlined twice so the two cannot drift, and so
   * the wrapper -- a static `<div>` -- never has to carry a pointer handler
   * it could only answer with a mouse.
   */
  const onRowMenu =
    (sessionId: string, title: string, ended: boolean) =>
    (event: { preventDefault: () => void; clientX: number; clientY: number }) => {
      event.preventDefault();
      setRowMenu({ sessionId, title, ended, at: { x: event.clientX, y: event.clientY } });
    };

  const toggleCollapse = useCallback(
    (project: Project) => {
      if (onToggleCollapse !== undefined) {
        onToggleCollapse(project);
        return;
      }
      setLocalCollapsed((current) =>
        current.includes(project.id)
          ? current.filter((id) => id !== project.id)
          : [...current, project.id],
      );
    },
    [onToggleCollapse],
  );

  const cancelGroupDraft = useCallback(() => {
    setGroupDraft(null);
    setGroupDraftName('');
  }, []);

  /** An empty name creates nothing and renames nothing -- it just closes. */
  const commitGroupDraft = useCallback(() => {
    const name = groupDraftName.trim();
    if (groupDraft !== null && name !== '') {
      if (groupDraft.kind === 'new') {
        onCreateGroup?.(name);
      } else {
        onRenameGroup?.(groupDraft.group, name);
      }
    }
    setGroupDraft(null);
    setGroupDraftName('');
  }, [groupDraft, groupDraftName, onCreateGroup, onRenameGroup]);

  const cancelProjectDraft = useCallback(() => {
    setProjectDraft(null);
    setProjectDraftName('');
  }, []);

  /**
   * UNLIKE `commitGroupDraft`, an empty name still commits -- it is the undo,
   * not a no-op. A group has no name of its own to fall back to; a project
   * does, and `setProjectRename` already treats an empty title as "clear the
   * override", so the trimmed name is always handed onward.
   */
  const commitProjectDraft = useCallback(() => {
    if (projectDraft !== null) {
      onRenameProject?.(projectDraft, projectDraftName.trim());
    }
    setProjectDraft(null);
    setProjectDraftName('');
  }, [projectDraft, projectDraftName, onRenameProject]);

  const toggleGroupCollapse = useCallback(
    (group: Group) => {
      if (onToggleGroupCollapse !== undefined) {
        onToggleGroupCollapse(group);
        return;
      }
      setLocalGroupCollapsed((current) =>
        current.includes(group.id)
          ? current.filter((id) => id !== group.id)
          : [...current, group.id],
      );
    },
    [onToggleGroupCollapse],
  );

  /**
   * What removing this project would do, over the project's WHOLE membership.
   * The dialog and the click that confirms it call this, so the sentence the
   * operator read and the act they authorised cannot come apart.
   */
  const planFor = useCallback(
    (project: Project) =>
      removalPlan(
        allEntries.filter((e) => e.project.id === project.id).map((entry) => entry.session),
      ),
    [allEntries],
  );

  /**
   * `p` — reveal the focused session's project and put the keyboard on its
   * fold.
   *
   * The reveal is the point: everything hover shows, `p` shows too, and it
   * lands on the first of the two controls so the next Tab reaches the menu.
   * Chosen over "toggle the fold directly" because a key that folds without
   * showing you the control teaches nothing about where the control is.
   *
   * IT USED TO OWN ITS OWN WINDOW LISTENER HERE, on the argument that a new
   * action kind would be a compile error in two files that task did not own.
   * Sound, and the price was two defects this project has fixed everywhere
   * else: the key was in no `buildKeySheet` row, because the sheet is derived
   * from the chord tables and this was not in one; and it fired while an
   * overlay was open, because the overlay guard lives in the one listener this
   * one bypassed. So the KEY moved into the table and only its EFFECT stayed —
   * the reveal and the focus are this component's own state and refs.
   */
  useEffect(() => {
    if (revealRequest === null || revealRequest === undefined) {
      return;
    }
    const { projectId } = revealRequest;
    if (!entries.some((candidate) => candidate.project.id === projectId)) {
      return;
    }
    setRevealed(projectId);
    foldRefs.current.get(projectId)?.focus();
  }, [entries, revealRequest]);

  /**
   * Bring the focused row into view when it is not.
   *
   * `j`/`k`, `Cmd+number`, `gg`/`G` and search all move focus, so the cursor
   * routinely lands on a row scrolled out of sight. `reveal-row.ts` decides
   * how far — minimum distance, and `null` for a row already visible, so
   * ordinary `j`/`k` movement inside the viewport never repositions anything.
   *
   * Keyed on `focusedSessionId` ALONE, deliberately. The entries re-arrive on
   * every poll, and depending on them would re-run this after a scroll the
   * operator performed themselves, dragging them back to a row they had
   * chosen to scroll away from. Focus moving is the only thing that earns a
   * scroll.
   *
   * A session inside a collapsed project has no row rendered at all: the map
   * misses, and nothing scrolls. That is the honest answer — the fold is what
   * hides it, and `p` (or the fold control) is what shows it again.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const row = focusedSessionId === null ? undefined : rowRefs.current.get(focusedSessionId);
    if (scroller === null || row === undefined) {
      return;
    }
    const box = row.getBoundingClientRect();
    const top = revealScrollTop({
      // Into the scroller's content coordinates: both rects are viewport-
      // relative, and the difference plus the current scroll is where the row
      // sits in the list itself.
      rowTop: box.top - scroller.getBoundingClientRect().top + scroller.scrollTop,
      rowHeight: box.height,
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
    });
    if (top === null) {
      return;
    }
    // Smooth scrolling is motion; someone who asked for less of it gets the
    // jump, not the loss of the behaviour.
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    scroller.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  }, [focusedSessionId]);

  /** Same contract as the filter popover above: in on open, back out on close. */
  useEffect(() => {
    if (openMenu !== null) {
      projectPanelRef.current?.querySelector('button')?.focus();
    } else if (openMenuWas.current !== null && confirming === null && projectDraft === null) {
      // Not when the menu closed BECAUSE it opened a dialog (`confirming`) or
      // an inline editor (`projectDraft`) -- a parent effect runs after its
      // child's, so without either guard the restore lands after the confirm
      // has taken focus, or after the rename editor has, and drags the
      // keyboard back out: `groupDraft === null` guards the group menu's
      // equivalent effect the same way, added after the restore was found
      // stealing focus from "Rename" and silently discarding the draft via
      // the editor's own `onBlur`.
      projectMenuRefs.current.get(openMenuWas.current)?.focus();
    }
    openMenuWas.current = openMenu;
  }, [openMenu, confirming, projectDraft]);

  /** A press outside a project's action menu closes it — same idiom as the
   *  filter popover above: `pointerdown`, and the toggle excluded so pressing
   *  it does not close-then-reopen in one press. */
  useEffect(() => {
    if (openMenu === null) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target === null) return;
      if (projectPanelRef.current?.contains(target) === true) return;
      if (projectMenuRefs.current.get(openMenu)?.contains(target) === true) return;
      setOpenMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [openMenu]);

  /** Same contract as the project menu above, for the group's own action
   *  menu. `groupDraft === null` guards it exactly as `confirming === null`
   *  guards the project one: "Rename" opens an inline editor that
   *  autofocuses and cancels itself on blur, so stealing focus back to the
   *  toggle right after would silently wipe what it just opened. */
  useEffect(() => {
    if (openGroupMenu !== null) {
      groupPanelRef.current?.querySelector('button')?.focus();
    } else if (openGroupMenuWas.current !== null && groupDraft === null) {
      groupMenuRefs.current.get(openGroupMenuWas.current)?.focus();
    }
    openGroupMenuWas.current = openGroupMenu;
  }, [openGroupMenu, groupDraft]);

  useEffect(() => {
    if (openGroupMenu === null) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target === null) return;
      if (groupPanelRef.current?.contains(target) === true) return;
      if (groupMenuRefs.current.get(openGroupMenu)?.contains(target) === true) return;
      setOpenGroupMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [openGroupMenu]);

  /**
   * How many rules are narrowing the list right now — the badge's number.
   *
   * Derived, never stored: the status choice counts once when it is not
   * `all`, and each origin toggle counts once when it is on. That is exactly
   * the set of things the popover can turn on, so the badge can never drift
   * from what the popover shows.
   */
  const applied = (key: keyof SessionFilters) =>
    originFilters[key] && !DEFAULT_SESSION_FILTERS[key] ? 1 : 0;
  const activeFilters =
    (statusFilter === 'all' ? 0 : 1) +
    applied('hideAgentStarted') +
    applied('onlyPrompted') +
    applied('hideEnded') +
    applied('hideForeign');

  /**
   * Whether ANY rule is narrowing the list, default or not — what the toggle's
   * own border says.
   *
   * The badge and the border answer two different questions on purpose. The
   * badge counts rules the OPERATOR applied, so a default never shows up as a
   * number they did not put there. The border reports the state of the list,
   * so a default that is holding rows back still lights the control that opens
   * the popover explaining it: hidden, uncounted AND unmarked would leave a
   * hidden session indistinguishable from one that does not exist.
   */
  const narrowing =
    activeFilters > 0 ||
    originFilters.hideAgentStarted ||
    originFilters.onlyPrompted ||
    originFilters.hideEnded ||
    originFilters.hideForeign;

  // Sized against the WINDOW, not the column (`FILTER_POPOVER_WIDTH`'s own
  // header). On the desktop that is a CEILING: `min(320, viewportWidth -
  // 24)`, which lets the popover float past a sidebar narrower than 320 + 24
  // without ever exceeding the window. On a phone there is no sidebar to
  // float past and no reason to leave a phone screen's own width on the
  // table beside a 320px card -- the operator's own words for it, "on phone
  // full-width minus gutters" -- so the ceiling does not apply there.
  const popoverWidth = phone
    ? Math.max(0, viewportWidth - FILTER_POPOVER_GUTTER)
    : Math.min(FILTER_POPOVER_WIDTH, viewportWidth - FILTER_POPOVER_GUTTER);

  /**
   * `entries` arrives project-major (see the file doc comment) UNLESS
   * `viewOptions.groupBy` says otherwise -- `Canvas.tsx` folds
   * `applyViewOrder` into `entries` itself, so this pane never re-sorts, it
   * only re-BUCKETS the same already-ordered array. `hidden` is applied
   * HERE, to `entries` directly, rather than to a `section` afterward as it
   * used to be: a `Status`/`None` section can hold several projects at once,
   * so "is THIS section's one project hidden" stopped being a question a
   * section could even answer.
   *
   * `project` on a `Status`/`None` section is a real `Project` -- the first
   * entry's -- kept ONLY so the section still has something to key its `<li>`
   * and its rows' fallback `source` off; nothing here ever reads it as "the
   * project this section is about", because for those two modes there is no
   * such thing. The heading JSX below is what enforces that: it branches on
   * `viewOptions.groupBy` before it ever reaches for `section.project` as a
   * subject rather than a key.
   */
  const visibleEntries = entries.filter((entry) => !hidden.includes(entry.project.id));
  const sections: {
    readonly project: Project;
    readonly items: readonly SessionEntry[];
    readonly group: Group | null;
    readonly bucket: StatusBucket | null;
  }[] = [];
  if (viewOptions.groupBy === 'status') {
    // One pass collapsing consecutive same-bucket runs -- `applyViewOrder`'s
    // own contract is that a `status` grouping arrives bucket-contiguous, the
    // same promise `orderedSessions` makes for `project`.
    for (const entry of visibleEntries) {
      const bucket = statusBucketOf(entry.session);
      const current = sections[sections.length - 1];
      if (current !== undefined && current.bucket === bucket) {
        (current.items as SessionEntry[]).push(entry);
      } else {
        sections.push({ project: entry.project, items: [entry], group: null, bucket });
      }
    }
  } else if (viewOptions.groupBy === 'none') {
    // One section, everything in it -- there is no heading to key runs by.
    const first = visibleEntries[0];
    if (first !== undefined) {
      sections.push({ project: first.project, items: visibleEntries, group: null, bucket: null });
    }
  } else {
    for (const entry of visibleEntries) {
      const current = sections[sections.length - 1];
      if (current !== undefined && current.project.id === entry.project.id) {
        (current.items as SessionEntry[]).push(entry);
      } else {
        sections.push({
          project: entry.project,
          items: [entry],
          group: entry.group ?? null,
          bucket: null,
        });
      }
    }
  }

  /**
   * A removed project is dropped from the list HERE rather than upstream, and
   * its group is kept so the restore strip below can name it. Its sessions are
   * still in `entries` -- most of them are still running -- and the count in
   * the header still includes them, which is honest: they exist, this list has
   * stopped drawing them.
   */
  const removed: Project[] = [];
  for (const entry of allEntries) {
    if (hidden.includes(entry.project.id) && !removed.some((p) => p.id === entry.project.id)) {
      removed.push(entry.project);
    }
  }

  /**
   * A15.3: the STRIP is momentary; the SET it names is not. `removed` above
   * is the honest, permanent record of what is hidden -- it has to stay
   * complete, because the filter menu's own "Hidden projects" section
   * (below) reads it too and that one must never time out. `stripVisible`
   * is a second, purely presentational fact layered on top: whether the
   * receipt for a RECENT hide is still on screen.
   *
   * Keyed on the SET of hidden ids, not on `removed`'s own array identity --
   * the loop above builds a fresh array every render, so depending on
   * `removed` itself would fire this effect every render regardless of
   * whether anything actually changed. Sorted before joining so a stable set
   * drawn in a different order (entries can reorder without a project being
   * un-hidden or re-hidden) does not read as a change either.
   */
  const removedKey = removed
    .map((project) => project.id)
    .sort()
    .join(',');
  const [stripVisible, setStripVisible] = useState(() => removedKey !== '');
  // `null` on mount, deliberately: it can never equal a real key (even the
  // empty string), so the effect below always runs once after the first
  // paint -- which is what starts the auto-dismiss timer even for a project
  // that arrived ALREADY hidden (a restored prefs blob), not only for one
  // hidden during this session. A ref initialised to `removedKey` itself
  // would read the first render as "nothing changed" and never schedule it.
  const previousRemovedKey = useRef<string | null>(null);
  useEffect(() => {
    if (removedKey === previousRemovedKey.current) return;
    previousRemovedKey.current = removedKey;
    if (removedKey === '') {
      setStripVisible(false);
      return;
    }
    setStripVisible(true);
    const timer = window.setTimeout(() => setStripVisible(false), RESTORE_STRIP_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [removedKey]);
  const showRestoreStrip = stripVisible && removed.length > 0;

  /**
   * The same sections, each carrying the two flags its heading renders from.
   * `hidden` is no longer filtered here -- `visibleEntries` above already
   * took it out, per ENTRY, which is the only grain that is correct once a
   * section can hold more than one project. Fold/reveal are real ONLY under
   * `Group by: Project`: a `Status`/`None` section's own `project` is a
   * placeholder key, and reading the operator's project-collapse list
   * against it would fold or hover-reveal an entire status bucket because
   * some UNRELATED project it happens to be keyed by was folded once.
   */
  const folded = sections.map((section) => ({
    ...section,
    isCollapsed: viewOptions.groupBy === 'project' && collapsed.includes(section.project.id),
    isRevealed: viewOptions.groupBy === 'project' && revealed === section.project.id,
  }));

  /**
   * What the list draws, top to bottom: group headings and project sections in
   * ONE flat sequence.
   *
   * Flat, not nested, and that is the point. The rows are unchanged and so is
   * every selector over them -- a grouped project keeps its own
   * `data-project-heading` and `data-project-rows` exactly where a dozen tests
   * expect them, and gains an indent and a `data-in-group` instead of a new
   * wrapper. Headings at BOTH levels stay captions: neither is focusable, so a
   * second caption level adds no stop for `j` to land on.
   *
   * Order comes from `entries`, which arrived from `orderedSessions` already
   * ranked across both levels -- so a group appears where its most urgent
   * session put it, and no re-sort happens here. A group holding no live
   * project has no entry to appear beside, so it is appended: an empty group
   * ranks last there too.
   */
  /**
   * The one name editor, used by both routes. Rendered at most once: a new
   * group's row sits at the top of the list, a rename replaces the heading's
   * own name, and `groupDraft` says which.
   */
  /** Nothing to open a menu for when the caller wired no group action. */
  const hasGroupMenu =
    onRenameGroup !== undefined || onPickGroupIcon !== undefined || onUngroup !== undefined;

  const groupEditor = (
    <input
      data-group-draft
      value={groupDraftName}
      placeholder="project name"
      aria-label="project name"
      ref={(node) => {
        if (node !== null && document.activeElement !== node) {
          node.focus();
        }
      }}
      onChange={(event) => setGroupDraftName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitGroupDraft();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelGroupDraft();
        }
      }}
      onBlur={cancelGroupDraft}
      className="min-w-0 flex-1 rounded-[5px] border border-line-strong bg-card px-1 py-0.5 font-mono text-control text-ink outline-none"
    />
  );

  /** Exactly `groupEditor`, one level down -- a project heading's own name,
   *  reused rather than reinvented: same Enter/Escape/blur handling, same
   *  focus-on-mount ref, same classes. */
  const projectEditor = (
    <input
      data-project-draft
      value={projectDraftName}
      placeholder="repo name"
      aria-label="repo name"
      ref={(node) => {
        if (node !== null && document.activeElement !== node) {
          node.focus();
        }
      }}
      onChange={(event) => setProjectDraftName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitProjectDraft();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelProjectDraft();
        }
      }}
      onBlur={cancelProjectDraft}
      className="min-w-0 flex-1 rounded-[5px] border border-line-strong bg-card px-1 py-0.5 font-mono text-control text-ink outline-none"
    />
  );

  const drawn: (
    | { readonly kind: 'group'; readonly group: Group; readonly count: number }
    | { readonly kind: 'section'; readonly section: (typeof folded)[number] }
  )[] = [];
  const drawnGroups = new Set<string>();
  const countIn = (groupId: string) =>
    folded
      .filter((section) => section.group?.id === groupId)
      .reduce((total, section) => total + section.items.length, 0);
  for (const section of folded) {
    const group = section.group;
    if (group !== null && !drawnGroups.has(group.id)) {
      drawnGroups.add(group.id);
      drawn.push({ kind: 'group', group, count: countIn(group.id) });
    }
    if (group === null || !groupCollapsed.includes(group.id)) {
      drawn.push({ kind: 'section', section });
    }
  }
  // Folders are a `Group by: Project` concept -- `Status`/`None` regroup
  // globally and have no use for an empty one's placeholder heading either.
  if (viewOptions.groupBy === 'project') {
    for (const group of groups) {
      // Only the genuinely EMPTY ones. A group whose members exist but were
      // narrowed away by search or removed from the sidebar has nothing under
      // it here, and a heading over nothing is not information -- while a group
      // the operator just made and has put nothing in yet is the one thing they
      // are looking for.
      if (!drawnGroups.has(group.id) && group.projects.length === 0) {
        drawn.push({ kind: 'group', group, count: 0 });
      }
    }
  }

  return (
    <aside
      data-sidebar-pane
      // No width given means nobody is sizing this pane, so it takes the room
      // it is in rather than a number it was never handed -- and `shrink-0`
      // goes with the number, since a fixed column is the only thing that has
      // to refuse to shrink.
      className={`relative flex h-full min-w-0 flex-col border-line border-r bg-sidebar ${width === undefined ? 'w-full' : 'shrink-0'}`}
      style={width === undefined ? undefined : { width }}
    >
      {resizeHandle}
      {/* `<header>`, not a plain `div`: `PhoneShell.tsx`'s own list screen
          used to carry a second, separate one immediately above this pane
          for `sourceReadout` alone (see that prop's own comment). This is
          "the app bar" `PhoneShell.list.test.tsx` already asserts the
          readout sits inside -- true before by accident of a bar that held
          nothing else, true now on purpose. */}
      <header className="flex flex-col gap-2.5 border-line border-b p-3">
        {/* The avatar bar, which used to be the sidebar's footer.
            It took the place of the workspace line -- avatar, name and the
            word "workspace" -- which is gone at the operator's request. vam
            has exactly one workspace, so a line naming it spent the widest
            row in the column restating something that never varies, and the
            avatar already carries its initial for anyone who wants it. */}
        <div data-avatar-bar className="flex items-center gap-[7px]">
          {/* THE ACCOUNT ICON, where the letter avatar used to sit -- the
              operator's own request: replace the initial with an icon that
              opens usage for every provider vam knows, reset times and all.
              `UsagePopover` is self-contained (its own open state, its own
              polling, its own dismissal wiring). See that component's own
              header for the rest. */}
          <UsagePopover />
          {/* Pushes the icons to the right edge on every surface. On a
              phone, and only there, it is ALSO where the connectivity dot
              lives now: `min-w-0`/`truncate` so the rare non-healthy arms
              (real words, not a bare dot -- "connecting to the source…", an
              error) shrink rather than shove the icons off a 390px row. */}
          {phone && sourceReadout !== undefined ? (
            <span className="min-w-0 flex-1 truncate">{sourceReadout}</span>
          ) : (
            <span className="flex-1" />
          )}
          {/* NOT ON A PHONE, at the operator's request -- and the reason is
              not that the screen is small. Four of the five sections behind
              this gear read and write `prefs`, which is `localStorage` on
              whichever device is looking: a theme chosen on the phone changes
              the phone, not the machine the sessions run on, and a shortcut
              edited there binds keys for a device with no keyboard. The fifth
              reaches a bridge the browser build does not have. `Remote` beside
              this is the one whose subject is the DESKTOP, so it stays and
              opens the overlay on the one section a phone can act on. See
              `settings/sections.ts`, `PHONE_SECTIONS`. */}
          {!phone && (
            <ShortcutTip label="Settings" action={SETTINGS_ACTION}>
              <button
                type="button"
                onClick={onSettings}
                aria-label="settings"
                className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
              >
                <Settings size={14} strokeWidth={1.5} />
              </button>
            </ShortcutTip>
          )}
          {/* Beside Settings, at the operator's request: pairing, approve/deny,
              unpair and revoke-all were all real already, buried one section
              inside Settings. This opens the same overlay, focused directly
              on Remote (`SettingsOverlay`'s `initialSection`) — one surface,
              not a second one. No `vam-tap`/`[data-tap-skin]` opt-in needed:
              `styles.css` already ENUMERATES `[data-avatar-bar] button` at a
              44px floor for the phone shell, the same rule Settings and the
              theme toggle already ride on, and none of the three paints a
              border that pull request 222's shrink-to-30 rule would need to
              undo — an icon with no border needs no opt-out either way. */}
          <ShortcutTip label="Remote access" action={REMOTE_ACTION}>
            <button
              type="button"
              onClick={onRemote}
              aria-label="remote access"
              className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
            >
              <Smartphone size={14} strokeWidth={1.5} />
            </button>
          </ShortcutTip>
          {/* No chord reaches the theme toggle, so the tip is its label. */}
          <ShortcutTip label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'switch to light theme' : 'switch to dark theme'}
              className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
            >
              <Sun size={14} strokeWidth={1.5} />
            </button>
          </ShortcutTip>
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {filtering ? (
              <div className="flex h-[30px] items-center gap-2 rounded-[8px] border border-line bg-card px-2.5">
                <span className="font-mono text-meta text-ink-faint">/</span>
                <input
                  ref={filterRef}
                  value={filter}
                  onChange={(event) => onFilterChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onFilterCommit();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      onFilterCancel();
                    }
                  }}
                  placeholder="Search sessions"
                  className="min-w-0 flex-1 bg-transparent font-mono text-control text-ink outline-none placeholder:text-ink-faint"
                  aria-label="filter sessions"
                />
                <span className="font-mono text-meta text-ink-faint">{entries.length}</span>
              </div>
            ) : (
              <ShortcutTip label="Search sessions" action={SEARCH_ACTION}>
                <button
                  type="button"
                  onClick={onOpenFilter}
                  aria-label="search sessions"
                  className="vam-tap flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[8px] border border-line bg-card px-2.5 text-ink-dim hover:border-line-strong"
                >
                  <Search size={14} strokeWidth={1.6} />
                  <span className="flex-1 text-left text-control">Search sessions</span>
                  <InlineChord
                    action={SEARCH_ACTION}
                    className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-meta"
                  />
                </button>
              </ShortcutTip>
            )}
          </div>
        </div>
      </header>

      {/* The seam between the two blocks, at the operator's request: search
          is one thing, the projects are another, and this row says so.
          Orca's shape. The filter control MOVED here from beside the search
          box -- moved, not copied: two controls answering the same question
          in one column is how a sidebar stops being readable. It belongs to
          the project list rather than to search, because what it narrows is
          the list below it. */}
      <div
        data-projects-header
        className="relative flex items-center gap-1.5 border-line border-b px-3 py-2"
      >
        <span className="font-mono text-meta text-ink-dim uppercase tracking-[0.12em]">
          Projects
        </span>
        <span className="flex-1" />
        {/* The layer above: a group of the projects vam already knows, named
            "project" because that is the operator's word for it (see the
            vocabulary table in `domain/model.ts`). LEFT of the directory
            picker, untouched and unmoved. Both are the same 26px square.

            THE ACCESSIBLE NAME STAYS QUALIFIED; renaming it would ripple into
            `screen.getByLabelText` in the canvas's own new-session tests, well
            past the two controls the operator actually looked at. So the
            TOOLTIP -- what a sighted or keyboard-focused person reads -- does
            the disambiguating instead: "a group of repos" says plainly this
            button makes the OUTER layer, not the same thing as the button
            beside it. */}
        {onCreateGroup !== undefined && (
          <ShortcutTip label="New project (a group of repos)">
            <button
              type="button"
              data-new-group
              aria-label="new project (a group of repos)"
              onClick={() => {
                setGroupDraftName('');
                setGroupDraft({ kind: 'new' });
              }}
              className="vam-tap flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center text-ink-faint"
            >
              {/* THE HIT IS 44 ON A PHONE, THE PAINT IS 30. On the desktop this
                  skin is the 26px square the button used to be and nothing
                  moves. On a phone `.vam-phone .vam-tap` grows the BUTTON to 44
                  and `styles.css` sizes the skin to 30 -- because what makes a
                  phone control read as too big is not the 44, it is a
                  `border-line` rectangle drawn AT 44 around a 13px glyph
                  (UI spec `vam-phone-controls`, 2.1 and 3.1). The per-project
                  `+` beside it is the same 44 box with no border and reads
                  correctly sized, which is the whole finding. Not the desktop's
                  `vam-hit-24` inversion: that hangs the hit area off an
                  `::after`, and the phone guard reads
                  `getBoundingClientRect()` on the element, which cannot see
                  one. */}
              <span
                aria-hidden="true"
                data-tap-skin
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-line bg-card hover:border-line-strong"
              >
                <FolderPlus size={13} strokeWidth={1.6} />
              </span>
            </button>
          </ShortcutTip>
        )}
        {/* Choose a directory, start a session in it — the only thing this
            button does; a project is derived from the cwd of a live session,
            so there is nothing to create and nothing to store. THE TOOLTIP
            NAMES THE ACTION, NOT "project": the accessible name stays "new
            project" (see the button above), but the words a person reads on
            focus never repeat the word the group button just used for
            something else. */}
        <ShortcutTip label={newSessionDecline ?? 'Choose a directory and start a session in it'}>
          <button
            type="button"
            data-new-project
            aria-label="new project"
            onClick={onNewProject}
            className="vam-tap flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center text-ink-faint"
            {...pending(NEW_PROJECT_PENDING, 'Starting a session in the chosen directory…')}
          >
            <span
              aria-hidden="true"
              data-tap-skin
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-line bg-card hover:border-line-strong"
            >
              <Plus size={13} strokeWidth={1.6} />
            </span>
          </button>
        </ShortcutTip>
        {/* Search answers "the one called permalink"; this answers "the ones
            that stopped" — two different questions, so two controls. */}
        <ShortcutTip label="Filter sessions" action={FILTER_MENU_ACTION}>
          <button
            type="button"
            ref={menuButtonRef}
            data-filter-toggle
            aria-haspopup="dialog"
            aria-expanded={filterMenuOpen}
            aria-label="filter sessions"
            onClick={() => onFilterMenuToggle(!filterMenuOpen)}
            className={[
              'vam-tap flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center',
              filterMenuOpen || narrowing ? 'text-ink' : 'text-ink-faint',
            ].join(' ')}
          >
            {/* The badge rides INSIDE the skin, not on the button. On a phone
                the button is 44 and the skin 30, so a badge placed against
                the button's corner would float 7px clear of the chip it
                counts for. `aria-hidden` costs nothing here: the button carries
                `aria-label`, so its accessible name is "filter sessions"
                either way and the digit was never announced. */}
            <span
              aria-hidden="true"
              data-tap-skin
              className={[
                'relative flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border bg-card',
                filterMenuOpen || narrowing
                  ? 'border-line-loud'
                  : 'border-line hover:border-line-strong',
              ].join(' ')}
            >
              <Filter size={13} strokeWidth={1.6} />
              {/* Absent at zero, not a zero. A badge reading "0" is a badge
                claiming something is narrowed when nothing is, and the count
                this draws is the count of rules actually excluding sessions.
                A DEFAULT is not one of them: it is not a rule the operator
                applied, so a fresh install would open showing a "1" for a
                choice nobody made. The border above still reports it, and the
                popover names it. The colour is `filter-badge`, which carries
                waiting's amber under its own name — see `styles.css`.

                THE CIRCLE GREW WITH THE NUMERAL, from 13px to 16px. This was
                8.5px of mono, the smallest type anywhere in vam and half a
                pixel under the next-smallest; the type scale's floor is 11px
                and 11px of numeral does not fit a 13px circle. The Agents
                badge in `DetailPanel.tsx` made exactly this move for exactly
                this reason (9px in 13px became 10.5px in 16px, and
                `e2e/pane-colour-shots.mjs` holds it at `box >= 14`), so this
                is that decision applied a second time rather than a new one.
                `leading-none` because the box is fixed: the scale's 16px
                leading would otherwise set the line box for the circle. */}
              {activeFilters > 0 && (
                <span
                  data-filter-badge
                  className="-top-1 -right-1 absolute flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-filter-badge px-[3px] font-mono text-meta leading-none text-ground"
                >
                  {activeFilters}
                </span>
              )}
            </span>
          </button>
        </ShortcutTip>

        {filterMenuOpen && (
          <div
            ref={menuRef}
            data-filter-menu
            role="dialog"
            aria-label="workspace options"
            onKeyDown={(event) => {
              // Escape peels ONE layer, drill-in first: back out of the
              // submenu rather than closing the whole popover under it. The
              // global `cancel` chord (Canvas.tsx) still closes the popover
              // from the MAIN view -- this only claims the key while a
              // submenu is open, via the same `preventDefault` contract
              // that chord already stands down for: "React dispatches at
              // its root container, which is BELOW this window listener, so
              // by the time a key arrives here the pane has already had its
              // say."
              if (event.key === 'Escape' && optionsView !== 'main') {
                event.preventDefault();
                setOptionsView('main');
              }
            }}
            style={
              filterPopoverCap === null
                ? { width: popoverWidth }
                : { width: popoverWidth, maxHeight: filterPopoverCap, overflowY: 'auto' }
            }
            className="absolute top-[36px] left-3 z-20 flex flex-col gap-2 rounded-[9px] border border-line-strong bg-card p-2.5 shadow-lg"
          >
            {optionsView === 'sort-by' ? (
              <SortByMenu
                value={viewOptions.sortBy}
                onBack={() => setOptionsView('main')}
                onChange={(sortBy) => {
                  onViewOptions({ ...viewOptions, sortBy });
                  setOptionsView('main');
                }}
              />
            ) : (
              <>
                {/* orca calls the same idea "Workspace options"; vam's own
                    list is titled "Projects" a few pixels above this button,
                    so the popover's own heading names the CONTROLS rather
                    than repeating that word. `text-heading`, the same size
                    every other panel's own `<h2>` title carries
                    (`KeySheet.tsx`, `ErrorLogPanel.tsx`) -- bold like orca's
                    own, which reads noticeably larger than the rows under
                    it, not merely heavier. */}
                <span className="text-heading font-semibold text-ink">Workspace options</span>

                {/* SENTENCE CASE, MUTED -- not the mono/uppercase/tracked
                    eyebrow every section header here used to be. Orca's own
                    "Group by" and "Filters" read as ordinary words, dimmed,
                    not as a label wearing letter-spacing. `SECTION_HEADER`
                    below is the one class string every section header in
                    this popover shares, so the four of them can never drift
                    apart from each other again. */}
                <span className={SECTION_HEADER}>Group by</span>
                {/* `role="radiogroup"`/`role="radio"`, orca's own segmented
                    control read as a set of mutually exclusive choices
                    rather than four independent buttons. `PR` is disabled
                    rather than omitted -- see `docs/design/workspace-
                    options.md` for why grouping by pull request has no
                    design yet, and the operator asked to see orca's own
                    shape, four pills wide. `divide-x` draws the thin rule
                    BETWEEN cells orca's own screenshot carries and the
                    first draft did not: unselected cells there were
                    distinguished from each other by nothing but a gap. */}
                <div
                  data-group-by
                  role="radiogroup"
                  aria-label="Group by"
                  // `flex-shrink-0`, EXPLICIT: every other row in this
                  // popover's own flex column refuses to shrink below its
                  // content by the CSS default (a flex item's automatic
                  // minimum size is its content size) -- but `overflow-
                  // hidden` below (needed to clip `divide-x`'s dividers to
                  // the group's own rounded corners) changes that default
                  // FOR THIS ONE CHILD: an item with non-visible overflow
                  // gets an automatic minimum size of ZERO instead. On a
                  // phone, where the popover's own height is capped and
                  // `overflow-y: auto` (`useFilterPopoverCap`), that made
                  // this the one row the flex algorithm was free to shrink
                  // when content ran long -- measured collapsing to a 2px
                  // sliver, border and all, while every sibling kept its
                  // full height. Falsified: remove this class, reload the
                  // phone screenshot, watch the segmented control vanish
                  // again.
                  className="flex flex-shrink-0 items-stretch divide-x divide-line overflow-hidden rounded-[8px] border border-line bg-ground"
                >
                  {GROUP_BY_PILLS.map(({ value, label, disabled }) => {
                    const on = !disabled && viewOptions.groupBy === value;
                    return (
                      // Same APG-sanctioned `role="radio"` button pattern as
                      // the Sort-by drill-in's own options -- a segmented
                      // pill control has no native-input equivalent that
                      // keeps its shape, and one pill is `disabled` with its
                      // own `title`, which a hidden native radio cannot
                      // surface as a hover tooltip the way `<button
                      // disabled>` does. `disabled` (not merely styled to
                      // look it) is also why this reaches for `title` and
                      // not `Note`/`ShortcutTip`: a disabled element takes
                      // neither a pointer event nor keyboard focus in any
                      // browser, so Radix's trigger would never open on it
                      // either way, and `title` is the one tooltip
                      // mechanism that still answers a plain hover.
                      // biome-ignore lint/a11y/useSemanticElements: see above
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        data-group-by-option={value}
                        disabled={disabled}
                        title={disabled ? PR_GROUPING_TITLE : undefined}
                        onClick={
                          disabled || value === 'pr'
                            ? undefined
                            : () => onViewOptions({ ...viewOptions, groupBy: value })
                        }
                        className={[
                          'vam-tap flex-1 px-1.5 py-1 text-center font-mono text-control',
                          disabled
                            ? 'cursor-not-allowed text-ink-faint opacity-50'
                            : on
                              ? 'cursor-pointer bg-raised text-ink'
                              : 'cursor-pointer text-ink-dim hover:text-ink',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className={SECTION_RULE} />

                {/* The drill-in row -- orca's own "Sort by  Agent Activity ›"
                    shape: label left, value and a chevron right, no border
                    or fill of its own (orca's own rows carry neither; only
                    the Group-by SEGMENTED control above is a bordered
                    control, because a segmented control has cells to
                    separate and a plain row has nothing to separate from
                    itself). Only two members offered (`SORT_BY_LABELS`'s
                    own header), so a submenu is more ceremony than a flat
                    two-pill row would need, and it is built anyway: task B
                    asks for at least one real drill-in with a back
                    affordance and keyboard support, and Sort by is the
                    control that is actually a CHOICE among named options
                    rather than a toggle, which is what a drill-in is for. */}
                <button
                  type="button"
                  data-sort-by-open
                  onClick={() => setOptionsView('sort-by')}
                  className="vam-tap flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                >
                  <span className="min-w-0 flex-1 truncate">Sort by</span>
                  <span className="flex-none truncate text-ink-faint">
                    {SORT_BY_LABELS[viewOptions.sortBy]}
                  </span>
                  <ChevronRight size={12} strokeWidth={1.8} className="flex-none text-ink-faint" />
                </button>

                <div className={SECTION_RULE} />

                {/* ITS OWN SECTION, WITH ITS OWN HEADER -- the operator's own
                    review of the first draft: the status pills read as an
                    orphan between Sort by and Filters, with nothing saying
                    what they were. Nothing else about them moved: same four
                    pills, same `STATUS_FILTERS`, same counts. */}
                <span className={SECTION_HEADER}>Status</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {STATUS_FILTERS.map(([key, label]) => {
                    const on = statusFilter === key;
                    const count = statusTally[key];
                    const loud = key === 'waiting' && count > 0;
                    return (
                      <button
                        key={key}
                        type="button"
                        data-status-pill={key}
                        aria-pressed={on}
                        onClick={() => onStatusFilter(key)}
                        className={[
                          'cursor-pointer rounded-full border bg-ground px-2.5 py-1 font-mono text-control',
                          on
                            ? 'border-line-loud bg-raised text-ink'
                            : loud
                              ? 'border-waiting-tint text-waiting'
                              : 'border-line text-ink-dim hover:border-line-strong',
                        ].join(' ')}
                      >
                        {label} {count}
                      </button>
                    );
                  })}
                </div>

                <div className={SECTION_RULE} />

                <span className={SECTION_HEADER}>Filters</span>
                {/*
              orca's own row shape: a leading icon, the label, a switch on
              the right, FLAT -- no bordered card, no fill, of its own. Only
              the switch says on or off now; a row used to also carry a
              border and a background for the same fact, which orca's own
              rows do not (every row there reads identically except for its
              switch). `role="switch"`/`aria-checked` replace the plain
              button's `aria-pressed` -- a filter row IS a two-state toggle,
              which `switch` names and `pressed` (built for a momentary
              "is this tool active" button) does not. The row stays the
              WHOLE hit target (orca's own rows are fully clickable, not
              just their track), so `vam-tap`'s 44px floor still applies
              without a second, narrower target inside it.

              THE "DEFAULT" BADGE IS GONE, and so is the two-line layout it
              shared a row with -- the operator's own review of the first
              draft. What a rule takes away still says so, but quietly and
              inline: "· N hidden" in a muted ink, after the label, and only
              when N is greater than zero -- an operator who has narrowed
              nothing sees no dangling "· 0 hidden" on every row. The
              LABELS themselves are shorter for the same reason width
              stopped being the reason they truncated: the longer sentence
              each one used to spell out now lives in `Note`'s own tooltip,
              reachable on hover AND on keyboard focus (`Note.tsx`'s own
              header: a `title` opens on neither, on a tool driven from the
              keyboard).

              `data-origin-toggle` is UNCHANGED, so every existing reader of
              this popover (five unit files, `Canvas.filter-origin.test.tsx`,
              `Canvas.filter-reach.test.tsx`) still finds the same rows at
              the same keys; `data-filter-default` is gone with the badge it
              named.
            */}
                {(
                  [
                    [
                      'agent',
                      Bot,
                      'Hide agent-started',
                      'Hide sessions a factory role started for itself — QA runs, orchestrators and the like, not one you began yourself.',
                      originFilters.hideAgentStarted,
                      hiddenCounts.agent,
                    ],
                    [
                      'prompted',
                      MessageSquare,
                      'Only prompted by me',
                      'Show only sessions where you typed the first prompt yourself, not one an agent or skill started for you.',
                      originFilters.onlyPrompted,
                      hiddenCounts.unprompted,
                    ],
                    // ON BY DEFAULT, and the count beside it is the whole reason a
                    // toggle was accepted in place of a hard removal: "the filter
                    // should get a toggle to show/hide those recent sessions".
                    // Turning it off is how a finished session is found again, and
                    // the row it brings back is the one that carries Reopen.
                    [
                      'ended',
                      Archive,
                      'Hide ended',
                      'Hide conversations the source has measured as finished — nothing left running or waiting on you.',
                      originFilters.hideEnded,
                      hiddenCounts.ended,
                    ],
                    // THE FOURTH ROW: `docs/design/vam-owns-the-session.md`, the
                    // operator's own ask distilled -- "it should only show the
                    // sessions that vam creates." ON BY DEFAULT for the same
                    // reason `ended` is: the count beside it is what keeps a
                    // hidden session from being indistinguishable from one that
                    // does not exist. `Terminal`, orca's own glyph for its
                    // "Hide CLI-created" row, the closest thing it has to this.
                    [
                      'foreign',
                      Terminal,
                      'Hide sessions started outside vam',
                      'Hide sessions vam did not start itself, opened by hand outside vam’s own control.',
                      originFilters.hideForeign,
                      hiddenCounts.foreign,
                    ],
                    // THE FIFTH ROW, new with this pass -- orca's "Hide
                    // sleeping", `Moon` and all. OFF by shipped default; see
                    // `session-filter.ts`'s own header for `hideIdle`.
                    [
                      'idle',
                      Moon,
                      'Hide sleeping',
                      'Hide sessions that are alive and attached, simply between turns — what orca calls sleeping.',
                      originFilters.hideIdle,
                      hiddenCounts.idle,
                    ],
                  ] as const
                ).map(([key, Icon, label, note, on, hides]) => (
                  <Note key={key} text={note}>
                    <button
                      type="button"
                      data-origin-toggle={key}
                      role="switch"
                      aria-checked={on}
                      onClick={() =>
                        onOriginFilters(
                          key === 'agent'
                            ? { ...originFilters, hideAgentStarted: !on }
                            : key === 'ended'
                              ? { ...originFilters, hideEnded: !on }
                              : key === 'foreign'
                                ? { ...originFilters, hideForeign: !on }
                                : key === 'idle'
                                  ? { ...originFilters, hideIdle: !on }
                                  : { ...originFilters, onlyPrompted: !on },
                        )
                      }
                      className={[
                        // `vam-tap`, and `py-1.5` restored: measured on the phone
                        // project at 390x844, these rows painted ~28px tall without
                        // it -- under the 44px floor the rest of the phone UI keeps
                        // (`.vam-phone .vam-tap` in styles.css). "No 44x44 sweep
                        // covers this popover" was the previous fix's argument for
                        // shrinking them instead, and that reasoning ran backwards:
                        // no sweep covering it means nobody MEASURED it, not that
                        // the floor holds. `vam-tap` is what every other text-row
                        // menu item in this file already wears (the group menu's
                        // "Rename project" / "Change project icon", a few hundred
                        // lines down) for exactly this reason -- and the same flat
                        // hover fill those rows carry, now that this row is flat
                        // too.
                        'vam-tap flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink',
                      ].join(' ')}
                    >
                      <Icon size={14} strokeWidth={1.7} className="flex-none text-ink-faint" />
                      {/* The label and its count are grouped and NEITHER
                          carries `flex-1` -- a group that grew to fill the
                          row (the first draft's shape) put empty space
                          BETWEEN a short label and its count, since the
                          growing box's content stayed left-aligned while the
                          box itself stretched to the switch. The spacer
                          after this group is what fills the row instead, so
                          the group hugs its own content -- label and count
                          close together -- and only shrinks, via `min-w-0`
                          on the label itself, when the two together do not
                          fit: on the longest label ("Hide sessions started
                          outside vam") that is the label that gives way, not
                          the count silently clipped to "1 …" the way a
                          single shared truncating span once did. The full
                          sentence is one hover or Tab away in `Note`'s own
                          tooltip regardless. */}
                      <span className="flex min-w-0 items-baseline gap-1">
                        <span className="min-w-0 truncate">{label}</span>
                        {/* Quiet, and absent rather than a dangling "0": the
                            one place the operator can still see what a rule
                            is holding back, now inline instead of a second
                            line and a badge. */}
                        {hides > 0 && (
                          <span className="flex-none whitespace-nowrap text-ink-faint">
                            · {hides} hidden
                          </span>
                        )}
                      </span>
                      <span className="flex-1" />
                      {/* The switch itself, purely a picture: `aria-checked`
                      above on the button is the fact, this is the paint. */}
                      <span
                        aria-hidden="true"
                        className={[
                          'relative h-[16px] w-[28px] flex-none rounded-full transition-colors',
                          on ? 'bg-running' : 'bg-line-strong',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'absolute top-[2px] h-[12px] w-[12px] rounded-full bg-ground transition-transform',
                            on ? 'translate-x-[14px]' : 'translate-x-[2px]',
                          ].join(' ')}
                        />
                      </span>
                    </button>
                  </Note>
                ))}

                {/* WHY "ended" AND "foreign" JUST STOPPED NARROWING, if they did.
                `docs/design/vam-owns-the-session.md`'s own trap: "an
                unreadable tmux listing must not empty the sidebar." Both
                rules read a fact vam's own tmux spine has to answer for --
                whether a row is vam's at all -- and `Canvas.tsx` stands them
                both down the instant that spine could not be read, showing
                every row rather than trusting a default it cannot back up.
                This says why, in the one place an operator would otherwise
                read the toggles as simply not working. */}
                {vamListingGap !== null && (
                  <span
                    data-vam-listing-gap
                    className="rounded-[7px] border border-failed bg-card px-2 py-1.5 text-control text-failed"
                  >
                    {vamListingGap}
                  </span>
                )}

                {/* A15.3: the UNTIMED twin of the restore strip below. That strip
                shows for a while and then goes; a project it named does not
                stop being hidden just because the receipt for hiding it
                expired, so this section carries the exact same list for as
                long as ANYTHING is hidden -- the surviving route the strip's
                own "More in Filters" chip points at. Absent, not empty, when
                nothing is hidden: an always-there heading over a list that is
                usually blank would be a section for a state that is rarely
                true. */}
                {removed.length > 0 && (
                  <>
                    <div className={SECTION_RULE} />
                    <span className={SECTION_HEADER}>Hidden projects</span>
                    <div
                      data-filter-hidden-projects
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      {removed.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          data-restore-project={project.id}
                          aria-label={`restore ${project.name}`}
                          onClick={() => onHideProject(project, false)}
                          className="flex cursor-pointer items-center gap-1 rounded-[6px] border border-line px-1.5 py-0.5 text-control text-ink-faint hover:border-line-strong hover:text-ink"
                        >
                          <RotateCcw size={10} strokeWidth={1.8} />
                          {project.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* WITHDRAWN WHILE GETTING-STARTED OWNS THE SCREEN -- see
          `showStartingProvisional`'s own comment for why the exception
          below exists and what leaving this mounted unconditionally used to
          cost. `flex-1` here and on that screen's own root are BOTH real
          when both are on screen at once: two siblings asking for the same
          free space split it, which is the bug. */}
      {(!showGettingStarted || showStartingProvisional) && (
        <OverlayScroll
          className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-2.5 py-2.5"
          scrollRef={(el) => {
            scrollerRef.current = el;
          }}
        >
          <ul className="flex flex-col gap-3.5">
            {groupDraft?.kind === 'new' && (
              <li className="flex items-center gap-[7px] px-1 pb-0.5">
                <span className="flex h-[15px] w-[15px] flex-none items-center justify-center text-ink-faint">
                  <Folder size={11} strokeWidth={1.7} />
                </span>
                {groupEditor}
              </li>
            )}
            {/* A PROJECT THAT DOES NOT EXIST YET -- `newProject`'s whole case,
              and the reason `starting.projectId` can be `null`. Every OTHER
              wait is drawn inside a section that already exists (below,
              `starting?.projectId === section.project.id`); this one has no
              such section to join, because there is no project until a
              session is actually running in this directory.

              So it draws its own, and deliberately not by building a fake
              `Project` and reusing the real heading: that heading's `+`,
              menu, collapse and rename all close over `section.project`, and
              handing them one invented for a directory that may still fail to
              spawn would offer "Remove project", "Change project icon" and a
              per-project `+` for something that is not there to remove,
              re-icon or add to. This heading is a name and nothing a pointer
              can act on -- no button, no menu, not even the session count the
              real heading prints, because inventing a count for zero sessions
              would look like a project the model disagrees with a heartbeat
              later. `data-session-starting`, not `data-session-row`, for the
              same reason the real one is: not focusable, not closable, not
              stoppable.

              IT DISAPPEARS THE MOMENT `starting` DOES -- the row arriving
              (Canvas.tsx's shared arrival effect, the same one that clears an
              existing project's wait) or the attempt failing (`newProject`'s
              own catch). Nothing here starts a timer or guesses an amount of
              time to wait. */}
            {starting !== null && starting.projectId === null && (
              <li data-project-section-provisional className="flex flex-col gap-[5px]">
                <div className="relative flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5">
                  <span className="flex h-[15px] w-[15px] flex-none items-center justify-center text-ink-faint">
                    <Monitor size={11} strokeWidth={1.7} />
                  </span>
                  {/* Typed exactly like the real project heading below -- upper
                    case and letter-spacing dropped with it, the same size and
                    weight taken with it: this row becomes one the moment the
                    session arrives, and a change of case, of size, of weight
                    or of face at that moment would read as the name having
                    been rewritten. See the real heading below for why it is
                    14px and semibold on a 20px line rather than plain
                    `text-heading`. */}
                  <span className="truncate text-[13px] font-semibold leading-[20px] text-ink-dim">
                    {starting.projectName}
                  </span>
                </div>
                <div className="flex flex-col gap-[5px]" style={{ paddingLeft: SIDEBAR_STEP }}>
                  <div
                    data-session-starting
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-[9px] border border-line border-dashed px-3 py-2 text-control text-ink-faint"
                  >
                    <span className="h-1.5 w-1.5 flex-none rounded-full bg-line-strong vam-breathe" />
                    <span className="min-w-0 truncate">
                      starting a session in {starting.projectName}…
                    </span>
                  </div>
                </div>
              </li>
            )}
            {drawn.map((item, index) => {
              if (item.kind === 'group') {
                const { group, count } = item;
                const isGroupCollapsed = groupCollapsed.includes(group.id);
                return (
                  <li
                    key={group.id}
                    /* A RULE AND SOME AIR ABOVE EACH GROUP. The list's own
                     `gap-3.5` separates every sibling by the same amount, so a
                     group boundary -- the one boundary in this column that
                     ends a whole subtree -- looked exactly like the gap
                     between two projects inside one. The line is what says
                     "everything above here belonged to something else".

                     NOT above the first, and the exception is about what is
                     above it rather than about which group it is: the search
                     chrome already draws a border a few pixels up, and a
                     second line under it reads as a double rule rather than as
                     a separator. (Two transient rows can precede it -- the
                     new-group editor and a project being created -- and for
                     the seconds they exist the first group keeps its bare top.
                     Drawing the rule for them would mean recomputing this from
                     state that is about to vanish.) */
                    className={[
                      'flex flex-col gap-[5px]',
                      index === 0 ? '' : 'border-line border-t pt-3.5',
                    ].join(' ')}
                  >
                    {/* A caption over captions. Same <div>, same reasons as the
                      project heading below: not a control, not focusable,
                      never a stop for `j`. A second caption level adds no
                      position, so `hjkl`, `Cmd+<digit>` and `gt`/`gT` count
                      exactly what they counted before. */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: as the
                      project heading -- the hover is a pure reveal and giving
                      this a role would put a stop in the list. */}
                    <div
                      data-group-heading
                      data-group-id={group.id}
                      onMouseEnter={() => setRevealed(group.id)}
                      onMouseLeave={() =>
                        setRevealed((current) => (current === group.id ? null : current))
                      }
                      className="relative flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5"
                    >
                      {/* THE SLOT IS THE NAME'S LINE BOX: 20px is
                        `--text-heading--line-height`, the leading of the name
                        beside it, so the icon stands as tall as the line it
                        heads rather than two-thirds of it (`HEADING_SLOT_PX`;
                        the literal here is Tailwind's, the number is owned
                        there). The EMOJI's size (an emoji is text and takes no
                        `size`) is the name's own, so the picture is never the
                        smaller thing beside it -- see `HEADING_GLYPH_PX`,
                        which owns the argument for all three numbers and the
                        measured inks. THAT NAME IS NOW 13, NOT `text-heading`
                        (15): the size moved with it below, or this slot would
                        reintroduce the exact inversion `HEADING_GLYPH_PX`'s
                        own comment was written to close -- the level above
                        reading as the SMALLER picture the moment only the
                        word beside it shrank. `e2e/sidebar-tree-shots.mjs`
                        asserts the equality (an emoji's `fontSize` against the
                        caption's own), so a heading whose icon and name drift
                        apart again fails there rather than merely here in
                        prose. */}
                      <span
                        data-group-icon={group.id}
                        className="flex h-[20px] w-[20px] flex-none items-center justify-center text-[13px] leading-none text-ink-faint"
                      >
                        {/* `text-ink-faint` on the span is the EMOJI's ink and
                          the placeholder's; a chosen glyph carries its own
                          tone class, which wins on the element itself. The two
                          agree when the tone is `neutral`, which is the value
                          `--vam-icon-neutral` holds for exactly that reason
                          (`styles.css`). */}
                        <IconMark
                          value={parseIcon(group.icon)}
                          size={HEADING_GLYPH_PX}
                          fallback={<Folder size={HEADING_GLYPH_PX} strokeWidth={1.7} />}
                        />
                      </span>
                      {groupDraft?.kind === 'rename' && groupDraft.group.id === group.id ? (
                        groupEditor
                      ) : (
                        /* ONE STEP ABOVE THE ROWS UNDER IT, and in the SANS
                         face the rows are titled in. The argument for both is
                         made once, on the project name below, because the
                         operator asked for both levels in one breath each
                         time. The register is untouched: upper case and
                         tracking are what separate this level from the
                         project's, and at 13px a name the column cannot hold
                         still clips to an ellipsis before the count and the
                         controls, which do not move -- measured, at the
                         default width, with a 531px name in a 117px box.

                         BOLD AND TWO PIXELS SMALLER THAN `text-heading`, and
                         not `text-heading` itself. Operator, in one breath,
                         twice: first "make the project and group titles bold
                         and 1px smaller; the session name regular weight and
                         also 1px smaller" (landing at 14), then, in the
                         workspace-options pass, "make the project and group
                         title font size in the sidebar 1px smaller" again
                         (landing at 13, this size). `font-semibold` (600)
                         rather than a new `font-bold` (700): it is the weight
                         every OTHER bold heading in the renderer already uses
                         beside `text-heading` (`SettingsOverlay.tsx`,
                         `ErrorLogPanel.tsx`, `KeySheet.tsx`,
                         `ErrorBoundary.tsx`), and it measures visibly heavier
                         than the row's own regular weight on the face this
                         actually resolves to -- Geist is asked for but never
                         loaded (no `@font-face`, no package), so every one of
                         these headings paints in the `-apple-system` fallback,
                         where 600 already reads apart from 400 by design. 13
                         is two pixels below `--text-heading` (15) and does not
                         land on any of the scale's other three steps, so it is
                         a named exception in `type-scale.test.ts` rather than
                         a fifth step -- see `EXCEPTIONS` there for the count
                         and the reason repeated. `leading-[20px]` keeps the
                         line box `text-heading` carried, so none of the
                         `min-h-[21px]` arithmetic on this container (and the
                         project heading's, below) moves: only the ink shrinks,
                         not the row. `e2e/sidebar-tree-shots.mjs` reads both
                         the size and the weight off the paint. */
                        <span className="truncate text-[13px] font-semibold leading-[20px] text-ink uppercase tracking-[0.12em]">
                          {group.name}
                        </span>
                      )}
                      {/* Summed over every member, because that is what the
                        heading is over. A count of one member's sessions under
                        a caption naming several would be a number about
                        something else. */}
                      <span
                        data-group-count={group.id}
                        className="font-mono text-meta text-ink-faint"
                      >
                        {count}
                      </span>
                      <span className="flex-1" />
                      <button
                        type="button"
                        data-group-collapse={group.id}
                        aria-expanded={!isGroupCollapsed}
                        aria-label={`${isGroupCollapsed ? 'expand' : 'collapse'} ${group.name}`}
                        onClick={() => toggleGroupCollapse(group)}
                        className={[
                          'vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:text-ink focus:opacity-100',
                          revealed === group.id || isGroupCollapsed ? 'opacity-100' : 'opacity-0',
                        ].join(' ')}
                      >
                        {isGroupCollapsed ? (
                          <ChevronRight size={12} strokeWidth={1.8} />
                        ) : (
                          <ChevronDown size={12} strokeWidth={1.8} />
                        )}
                      </button>

                      {hasGroupMenu && (
                        <button
                          type="button"
                          ref={(node) => {
                            if (node === null) {
                              groupMenuRefs.current.delete(group.id);
                            } else {
                              groupMenuRefs.current.set(group.id, node);
                            }
                          }}
                          data-group-menu={group.id}
                          aria-haspopup="menu"
                          aria-expanded={openGroupMenu === group.id}
                          aria-label={`more actions for ${group.name}`}
                          onClick={() =>
                            setOpenGroupMenu((current) => (current === group.id ? null : group.id))
                          }
                          className={[
                            'vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-full border border-transparent text-ink-faint hover:border-line-strong hover:text-ink focus:opacity-100',
                            revealed === group.id || openGroupMenu === group.id
                              ? 'opacity-100'
                              : 'opacity-0',
                          ].join(' ')}
                        >
                          <MoreHorizontal size={12} strokeWidth={1.8} />
                        </button>
                      )}

                      {/* Last in the row and last in tab order, as the project
                        heading's own `+` is: the controls acting on the
                        heading come first, the one that adds something to it
                        comes after them. It offers what vam ALREADY KNOWS --
                        no directory dialog, no validation, no IPC; see
                        `ProjectPicker`.

                        A GENUINELY EMPTY group (no projects, so nothing under
                        it explains itself) gets the named, permanently-visible
                        form instead of the quiet hover `+` -- there is no row
                        content to hover in the first place, so an opacity-0
                        control here is not an accelerator, it is the only way
                        in, invisible. Sized by its own label (`whitespace-nowrap`,
                        no fixed width, no `truncate`) so it cannot clip
                        regardless of the group name next to it; the label
                        itself is fixed text, not the group name, so it never
                        grows with it. A non-empty group keeps the quiet `+`
                        unchanged: its row already has content explaining
                        itself, and the sidebar's hover-reveal pattern is
                        deliberate everywhere else. */}
                      {onAddToGroup !== undefined &&
                        (group.projects.length === 0 ? (
                          <button
                            type="button"
                            data-add-to-group={group.id}
                            onClick={() => onAddToGroup(group)}
                            title={`Add a repo to ${group.name}`}
                            aria-label={`add a repo to ${group.name}`}
                            className="vam-tap vam-hit-24 flex h-[19px] flex-none cursor-pointer items-center gap-[3px] whitespace-nowrap rounded-[5px] border border-line-strong px-1.5 font-mono text-control text-ink-quiet hover:text-ink-dim"
                          >
                            <Plus size={11} strokeWidth={1.7} />
                            add repo
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-add-to-group={group.id}
                            onClick={() => onAddToGroup(group)}
                            title={`Add a repo to ${group.name}`}
                            aria-label={`add a repo to ${group.name}`}
                            className={[
                              'vam-tap vam-hit-24 flex h-[19px] w-[19px] flex-none cursor-pointer items-center justify-center rounded-[5px] border border-transparent text-ink-quiet hover:border-line-strong hover:text-ink-dim focus:opacity-100',
                              revealed === group.id ? 'opacity-100' : 'opacity-0',
                            ].join(' ')}
                          >
                            <Plus size={13} strokeWidth={1.7} />
                          </button>
                        ))}

                      {openGroupMenu === group.id && (
                        <div
                          ref={groupPanelRef}
                          data-group-menu-panel={group.id}
                          role="menu"
                          aria-label={`${group.name} actions`}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setOpenGroupMenu(null);
                            }
                          }}
                          className="absolute top-[19px] right-0 z-20 flex w-[168px] flex-col rounded-[9px] border border-line-strong bg-card p-1 shadow-lg"
                        >
                          {onRenameGroup !== undefined && (
                            <button
                              type="button"
                              role="menuitem"
                              data-group-menu-item="rename"
                              onClick={() => {
                                setGroupDraftName(group.name);
                                setGroupDraft({ kind: 'rename', group });
                                setOpenGroupMenu(null);
                              }}
                              className="vam-tap cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                            >
                              Rename project
                            </button>
                          )}
                          {onPickGroupIcon !== undefined && (
                            <button
                              type="button"
                              role="menuitem"
                              data-group-menu-item="icon"
                              onClick={() => {
                                onPickGroupIcon(group);
                                setOpenGroupMenu(null);
                              }}
                              className="vam-tap cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                            >
                              Change project icon
                            </button>
                          )}
                          {/* PLAIN, and last only because it is the one that
                            ends the group. It is not red and it opens no
                            modal: `ConfirmRemoveProject`'s own header says the
                            overlay idiom is there to make a disclosure rather
                            than to add a click, and its disclosure is two
                            session counts. Ungrouping has no counts -- no
                            session ends, nothing is hidden, `hiddenProjects`
                            is not touched -- and its entire outcome is on
                            screen the instant it happens: the heading goes and
                            its members reappear one level up. The red stays
                            where the consequence is, on the project heading's
                            "Remove project", so weight goes on keeping matching
                            consequence. */}
                          {onUngroup !== undefined && (
                            <button
                              type="button"
                              role="menuitem"
                              data-group-menu-item="ungroup"
                              onClick={() => {
                                onUngroup(group);
                                setOpenGroupMenu(null);
                              }}
                              className="vam-tap cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                            >
                              Ungroup
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              }
              const { isCollapsed, isRevealed, ...section } = item.section;
              // `section.project.id` alone collides under `Status`: two
              // buckets can easily share the same FIRST entry's project (one
              // project with both a waiting and a done session, say), and
              // `section.project` there is only ever a placeholder key, never
              // a claim that the two sections are "the same project".
              const sectionKey = section.bucket ?? section.project.id;
              return (
                <li
                  key={sectionKey}
                  {...(section.group === null ? {} : { 'data-in-group': section.group.id })}
                  // The indent the level above buys, on the container rather
                  // than per row -- the same decision `data-project-rows` already
                  // documents one level down, for the same reason. ONE unit, and
                  // only for a project that has a group above it to be indented
                  // FROM: see `SIDEBAR_STEP`.
                  style={section.group === null ? undefined : { paddingLeft: SIDEBAR_STEP }}
                  className="flex flex-col gap-[5px]"
                >
                  {/*
                    THE HEADING, ONE OF THREE SHAPES -- the real, interactive
                    project heading below under `Group by: Project`; a plain,
                    non-interactive status heading (icon, label, count, no
                    menu -- there is no single project a "rename" or "remove"
                    could act on) under `Status`; nothing at all under `None`,
                    where the rows are the whole story. `section.project`
                    below this branch is always a REAL, meaningful project --
                    it is only ever a placeholder key in the two branches that
                    never reach for it as a subject, which is the invariant
                    `sections`' own comment states.
                  */}
                  {viewOptions.groupBy === 'project' ? (
                    <>
                      {/* A caption, not a stop. A plain <div>, so nothing can focus it
                and `j` never lands on a heading. */}
                      {/* `min-h` reserves the add button's own height. The heading is
                  otherwise as tall as its tallest child, so the row -- and
                  every row under it -- would jump a few pixels each time focus
                  moved between projects and the add came or went. */}
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: the hover is
                  a pure reveal, and the keyboard has its own path to the same
                  controls -- `p`. The rule exists to catch mouse-ONLY
                  interaction; giving this heading a role or a tabindex to
                  satisfy it would put a stop in the list that `j` lands on,
                  which is the thing the comment above deliberately avoids. */}
                      <div
                        data-project-heading
                        data-project-id={section.project.id}
                        {...(isRevealed ? { 'data-project-revealed': 'true' } : {})}
                        onMouseEnter={() => setRevealed(section.project.id)}
                        onMouseLeave={() =>
                          setRevealed((current) =>
                            current === section.project.id ? null : current,
                          )
                        }
                        className="relative flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5"
                      >
                        {/* No chord picks a PROJECT icon — `icon` (`s`) picks the
                      focused SESSION's, which is a different subject — so the
                      tip is the label alone. It replaces a native `title`,
                      which no browser opens on keyboard focus. */}
                        <ShortcutTip label="Change project icon">
                          {/* Same slot as the group's above -- 20px, the name's own
                        line, the SAME size as the emoji (13, not
                        `text-heading` -- see the group heading's own comment
                        for why the two must move together) -- and the same
                        `HEADING_GLYPH_PX` for the glyph, because a level is
                        not a third kind of icon. `vam-hit-24` hangs
                        the hit area off an `::after` and the phone floor is a
                        `min-`, so neither box moves with this one. */}
                          <button
                            type="button"
                            data-project-icon={section.project.id}
                            onClick={() => onPickIcon(section.project)}
                            aria-label={`change icon for ${section.project.name}`}
                            className="vam-tap vam-hit-24 flex h-[20px] w-[20px] flex-none cursor-pointer items-center justify-center text-[13px] leading-none text-ink-faint hover:text-ink-dim"
                          >
                            <IconMark
                              value={parseIcon(section.project.icon)}
                              size={HEADING_GLYPH_PX}
                              fallback={
                                /* A monitor, not a middot. The glyph has to read as "this
                           is a machine you can name" — the middot read as a bullet
                           and gave a clickable control no affordance at all. It is
                           a placeholder in the literal sense: the picker replaces
                           it with whatever icon you choose, and choosing nothing
                           leaves something that still looks deliberate. It is also
                           what a value this build cannot draw falls back to, so an
                           icon named by a newer vam looks like "none picked"
                           rather than like a printed storage key. */
                                <Monitor
                                  data-project-icon-placeholder
                                  size={HEADING_GLYPH_PX}
                                  strokeWidth={1.7}
                                />
                              }
                            />
                          </button>
                        </ShortcutTip>
                        {projectDraft?.id === section.project.id ? (
                          projectEditor
                        ) : (
                          /* NOT UPPER CASE, and not letter-spaced. Both are a
                       caption's loudest register, and this heading was wearing
                       them directly under a group heading wearing the same --
                       so the two levels shouted in one voice and the eye had
                       nothing to sort them by. The group keeps the register
                       (it is the level above and says so); a repo is written
                       the way its directory is written, which is also the way
                       the operator typed it. Upper case cost legibility too:
                       a repo name is mostly lower-case letters with
                       distinctive ascenders, and capitalising them throws that
                       shape away in the narrowest column in the app.

                       ONE STEP ABOVE THE ROWS IT HEADS. The operator, reading
                       the column: "make the font size of the project and the
                       group a bit larger than the session". It was the other
                       way round -- this name sat at `text-meta` (11px) over
                       rows titled at `text-body` (13px), so the level that
                       groups the list was the smallest type in it. "A bit
                       larger than the session" is the scale's own next step
                       up from the row, `text-heading` (15px), and not a new
                       number between the two: the scale has four steps and
                       `test/renderer/type-scale.test.ts` holds it to four.
                       The cost is one pixel of row: `text-heading` carries a
                       20px line where `text-meta` carried 16, and 20 plus the
                       `pb-0.5` is 22 against the 21px `min-h` -- measured,
                       and the same on the group above. The count beside the
                       name stays `text-meta`: it is subordinate to the name,
                       not a peer of the rows. `e2e/sidebar-tree-shots.mjs`
                       reads both sizes off the paint and asserts the order.

                       AND NOT MONO. The operator, once the sizes had moved:
                       "use the regular font, not mono". Both heading names
                       were set in `--font-mono` over rows titled in
                       `--font-sans`, so the level that names the list was the
                       one thing in it written like a code sample -- and at
                       15px a mono repo name is also the widest thing in the
                       narrowest column, since every glyph takes the em. A
                       heading is set in the face of the titles it heads; the
                       count beside it stays mono, because a count is meta and
                       every piece of meta here (branch, age, badge) is mono.
                       The same guard reads `fontFamily` off every heading
                       name against the row title's and asserts they agree.

                       BOLD AND TWO PIXELS SMALLER THAN `text-heading`, and the
                       session name a pixel smaller and regular. Operator, in
                       one breath, twice: first "make the project and group
                       titles bold and 1px smaller; the session name regular
                       weight and also 1px smaller" (landing at 14), then, in
                       the workspace-options pass, one pixel further. See the
                       group heading above for the full argument --
                       `font-semibold` (600) because it is the weight every
                       other bold heading in the renderer already pairs with
                       `text-heading`, and because Geist is asked for but never
                       loaded (no `@font-face`, no package), so this paints in
                       the `-apple-system` fallback, where 600 already reads
                       apart from the row's 400 by design; 13 because it is two
                       pixels below `--text-heading` (15) and lands on none of
                       the scale's other three steps, so it
                       is a named exception in `type-scale.test.ts`'s
                       `EXCEPTIONS` rather than a fifth step; `leading-[20px]`
                       because it is the same line `text-heading` carried, so
                       the `min-h-[21px]` arithmetic two paragraphs up does not
                       move. The row title below drops to `text-control`
                       (12px, one below `text-body`'s 13) and loses its
                       focused-row `font-medium`: the scale's own floor for
                       "control" already sits where the operator asked the
                       session name to land, and the cursor row was never
                       reading as focused BECAUSE of that weight -- the border,
                       the raised surface and the status-coloured stripe
                       (`data-row-cursor`) all still mark it; dropping the
                       extra weight is what makes "regular" true of every row,
                       not only the ones nobody has picked. */
                          <span className="truncate text-[13px] font-semibold leading-[20px] text-ink-dim">
                            {section.project.name}
                          </span>
                        )}
                        <span className="font-mono text-meta text-ink-faint">
                          {section.items.length}
                        </span>
                        <span className="flex-1" />

                        {/* Revealed, never conditional. The row's close button is
                    removed from the DOM until hover, and that is right for a
                    control with a keyboard twin (`x`); these two have none, so
                    removing them would leave the fold reachable by pointer
                    only. Transparent-but-present keeps Tab working, and
                    `focus:opacity-100` means the tab stop you land on is a
                    thing you can see. */}
                        <button
                          type="button"
                          ref={(node) => {
                            if (node === null) {
                              foldRefs.current.delete(section.project.id);
                            } else {
                              foldRefs.current.set(section.project.id, node);
                            }
                          }}
                          data-project-collapse={section.project.id}
                          aria-expanded={!isCollapsed}
                          aria-label={`${isCollapsed ? 'expand' : 'collapse'} ${section.project.name}`}
                          onClick={() => toggleCollapse(section.project)}
                          className={[
                            'vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:text-ink focus:opacity-100',
                            isRevealed || isCollapsed ? 'opacity-100' : 'opacity-0',
                          ].join(' ')}
                        >
                          {isCollapsed ? (
                            <ChevronRight size={12} strokeWidth={1.8} />
                          ) : (
                            <ChevronDown size={12} strokeWidth={1.8} />
                          )}
                        </button>

                        <button
                          type="button"
                          ref={(node) => {
                            if (node === null) {
                              projectMenuRefs.current.delete(section.project.id);
                            } else {
                              projectMenuRefs.current.set(section.project.id, node);
                            }
                          }}
                          data-project-menu={section.project.id}
                          aria-haspopup="menu"
                          aria-expanded={openMenu === section.project.id}
                          aria-label={`more actions for ${section.project.name}`}
                          onClick={() =>
                            setOpenMenu((current) =>
                              current === section.project.id ? null : section.project.id,
                            )
                          }
                          className={[
                            'vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-full border border-transparent text-ink-faint hover:border-line-strong hover:text-ink focus:opacity-100',
                            isRevealed || openMenu === section.project.id
                              ? 'opacity-100'
                              : 'opacity-0',
                          ].join(' ')}
                        >
                          <MoreHorizontal size={12} strokeWidth={1.8} />
                        </button>

                        {/* THE `+` THAT USED TO STAND HERE IS IN THE MENU NOW, and
                  the whole argument for that is the column it left. Every
                  heading carried three controls -- fold, menu, add -- over a
                  narrow list whose rows are mostly quiet, and the operator
                  read the result as clutter. Two of the three are about the
                  heading itself; the third is the only one that makes
                  something, and a menu is where a made thing belongs.

                  What the move costs is one click, and what it buys back is
                  more than that: the menu focuses its first item on open, and
                  the add is that item, so `...` then Enter is the pointer-free
                  gesture that the hover-revealed `+` never had. It also gets
                  room for words -- see the refusal at the item itself, which
                  used to need a tooltip because an icon button has nowhere to
                  put a sentence.

                  The reveal-on-hover reasoning this replaced is not lost, it
                  is answered: the objection to a permanent `+` was a column of
                  boxes standing over the session names, and no box now stands
                  there at all. */}

                        {/* There is still no "Project settings": vam has no
                    per-project setting to open.

                    "Remove project" USED TO BE ABSENT FOR A REASON THAT HAS
                    ONLY HALF EXPIRED, and the surviving half is what shapes
                    it. A project here is a grouping of live sessions on their
                    cwd, so there is nothing stored to delete and ending every
                    session vam can end still leaves the project on screen at
                    the next refresh. What changed is that `Session.
                    vamControlled` now says, per session, whether vam started
                    it -- so the item can end what it is entitled to end,
                    persist a removal for the remainder, and state both counts
                    instead of reporting its own inability. It is destructive
                    and it is last, behind a confirm.

                    EVERY ITEM IN BOTH MENUS WEARS `vam-tap` NOW, which is
                    inert on a desktop and a 44px floor on a phone. They did
                    not, because on a phone these menus held nothing on the
                    critical path -- a 28px "Change project icon" is a target
                    somebody misses, not a task they cannot do. Moving the
                    per-project new session in here changed that: it was a
                    control with the floor, and the ONLY route to starting a
                    session in a named project. A control that changes surface
                    keeps its floor, and one item at 44px beside four at 28
                    would be a menu that looks broken -- so the floor is the
                    menu's, not the item's. */}
                        {openMenu === section.project.id && (
                          <div
                            ref={projectPanelRef}
                            data-project-menu-panel={section.project.id}
                            role="menu"
                            aria-label={`${section.project.name} actions`}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setOpenMenu(null);
                              }
                            }}
                            className="absolute top-[19px] right-0 z-20 flex w-[168px] flex-col rounded-[9px] border border-line-strong bg-card p-1 shadow-lg"
                          >
                            {/* FIRST, and first is a decision rather than an
                          accident of when it was added. Everything else in
                          this menu arranges the project or ends it; this is
                          the only item that makes something, and the panel
                          puts focus on its first item when it opens -- so
                          first is what turns `...`+Enter into the accelerator
                          the hover-revealed `+` could never be for a keyboard.
                          It is also as far as the list can put it from the one
                          red item at the bottom.

                          The heading's own DOM order said the opposite ("the
                          controls acting on the heading come first, the one
                          that adds comes after them"), and that rule does not
                          carry across: it was about TAB ORDER through a row of
                          icons nothing focuses by default, where being last
                          costs nothing. Here the first position is the focused
                          one.

                          THE REFUSAL IS THE ITEM'S OWN SECOND LINE. It used to
                          need a tooltip -- an icon button has nowhere to put a
                          sentence, and a `title` opens on hover and nothing
                          else, so a keyboard user pressed and got silence. A
                          menu item has the room, and visible text is the one
                          channel that reaches everybody. The item stays
                          clickable either way: refusing on click and saying
                          why is honest, while a control that cannot be pressed
                          just reads as broken.

                          No chord is offered beside it. `o` starts a session
                          in the FOCUSED session's project, which is a
                          different project from the one this menu names
                          whenever it matters -- printing it here would read as
                          "press this instead" for a key that does something
                          else. */}
                            <button
                              type="button"
                              role="menuitem"
                              data-project-menu-item="new-session"
                              onClick={() => {
                                onAddInProject(section.project);
                                setOpenMenu(null);
                              }}
                              className="vam-tap flex cursor-pointer flex-col justify-center gap-0.5 rounded-[6px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                            >
                              New session
                              {newSessionDecline !== null && (
                                <span data-new-session-decline className="text-ink-faint text-meta">
                                  {newSessionDecline}
                                </span>
                              )}
                            </button>
                            {/* "Rename repo", not "Rename project" -- the group
                          menu already owns that label one level up (UI
                          "project" is the code's `Group`), and the
                          click-outside-menus fix resolved the identical
                          collision on the two `+` buttons by keeping "repo"
                          for this exact layer rather than repeating a word
                          two menus now disagree about. */}
                            {onRenameProject !== undefined && (
                              <button
                                type="button"
                                role="menuitem"
                                data-project-menu-item="rename"
                                onClick={() => {
                                  setProjectDraftName(section.project.name);
                                  setProjectDraft(section.project);
                                  setOpenMenu(null);
                                }}
                                className="vam-tap cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                              >
                                Rename repo
                              </button>
                            )}
                            <button
                              type="button"
                              role="menuitem"
                              data-project-menu-item="collapse"
                              onClick={() => {
                                toggleCollapse(section.project);
                                setOpenMenu(null);
                              }}
                              className="vam-tap cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                            >
                              {isCollapsed ? 'Expand project' : 'Collapse project'}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              data-project-menu-item="icon"
                              onClick={() => {
                                onPickIcon(section.project);
                                setOpenMenu(null);
                              }}
                              className="vam-tap cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                            >
                              Change project icon
                            </button>
                            {/* Last, and the only red thing in the menu. The icon is
                        LEFT of the label, where the two items above have
                        nothing, because this is the one item you must not
                        press by mistake. */}
                            <button
                              type="button"
                              role="menuitem"
                              data-project-menu-item="remove"
                              onClick={() => {
                                setConfirming(section.project);
                                setOpenMenu(null);
                              }}
                              className="vam-tap flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-control text-danger hover:bg-line-strong"
                            >
                              <Trash2 size={12} strokeWidth={1.8} />
                              Remove project
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : section.bucket !== null ? (
                    /**
                     * THE STATUS HEADING -- a caption, not a control. No
                     * menu, no rename, no icon picker: there is no single
                     * project underneath a bucket for any of those to act
                     * on. `data-status-heading` carries the bucket id itself
                     * (`STATUS_BUCKET_ORDER`'s own values), which is what the
                     * "one heading per non-empty bucket, in this order" claim
                     * is checked against.
                     */
                    <div
                      data-status-heading={section.bucket}
                      className="relative flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5"
                    >
                      <span className="flex h-[20px] w-[20px] flex-none items-center justify-center text-ink-faint">
                        <StatusBucketIcon bucket={section.bucket} />
                      </span>
                      <span className="truncate text-[13px] font-semibold leading-[20px] text-ink-dim">
                        {STATUS_BUCKET_LABELS[section.bucket]}
                      </span>
                      <span className="font-mono text-meta text-ink-faint">
                        {section.items.length}
                      </span>
                    </div>
                  ) : null}

                  {/* The indent lives on ONE container per project, not on each
                  row. A margin per row would have to be repeated on the
                  rename editor too, and any row that missed it would sit a
                  few pixels out of line with its neighbours' hover and focus
                  backgrounds -- the failure mode that makes an indent look
                  like a bug. Here the rows keep their own padding contract
                  untouched, and the focused row's slab and its status stripe
                  move inward WITH the row: the stripe then lands exactly on
                  the indent line, which is the edge that says "these belong
                  to that heading". Full-bleed highlight was the alternative
                  and it is the wrong one -- a background wider than the row
                  it highlights re-erases the grouping the indent just drew.
                  ONE `SIDEBAR_STEP`, which is the same unit the project
                  heading above takes from its group -- it used to be six
                  pixels here against that heading's eight, so the deeper of
                  the two levels stepped LESS than the shallower one and the
                  column read flat. The narrowness argument that chose six
                  survives in the size of the unit, not in a second number:
                  see `SIDEBAR_STEP`. */}
                  {!isCollapsed && (
                    <div
                      {...(viewOptions.groupBy === 'project'
                        ? { 'data-project-rows': section.project.id }
                        : viewOptions.groupBy === 'status'
                          ? { 'data-status-rows': section.bucket }
                          : { 'data-flat-rows': true })}
                      // No heading to indent FROM under `Status`/`None` -- see
                      // the heading branch above.
                      style={
                        viewOptions.groupBy === 'project'
                          ? { paddingLeft: SIDEBAR_STEP }
                          : undefined
                      }
                      className="flex flex-col gap-[5px]"
                    >
                      {/* A SESSION THAT DOES NOT EXIST YET, and says so.
                        It is NOT a `data-session-row`: those are things the
                        operator can focus, close, stop and rename, and this is
                        none of them. No status pill, no age, no title -- vam
                        knows none of those yet and a placeholder wearing
                        invented ones is the content this pane has spent
                        several rounds having removed.

                        `Group by: Project` ONLY: a session being started has
                        no status yet, so it cannot coherently sit under a
                        `Status` bucket, and `None` has no heading for the
                        text below to name -- it simply does not draw while
                        either mode is active, which the top-level provisional
                        row above the tree (`starting.projectId === null`'s
                        own branch) does not cover either. */}
                      {viewOptions.groupBy === 'project' &&
                        starting?.projectId === section.project.id && (
                          <div
                            data-session-starting
                            aria-live="polite"
                            className="flex items-center gap-2 rounded-[9px] border border-line border-dashed px-3 py-2 text-control text-ink-faint"
                          >
                            <span className="h-1.5 w-1.5 flex-none rounded-full bg-line-strong vam-breathe" />
                            <span className="min-w-0 truncate">
                              starting a session in {section.project.name}…
                            </span>
                          </div>
                        )}
                      {section.items.map((entry) => {
                        const { session } = entry;
                        const isFocused = session.id === focusedSessionId;
                        // The one key that jumps here, or nothing when no jump
                        // is armed -- and nothing, too, for a row past the end
                        // of `JUMP_KEYS`: twenty labels is what the home row and
                        // the top row can spell, and a twenty-first row wearing
                        // a letter that jumped nowhere would be worse than a row
                        // wearing none.
                        const jumpLabel = jumpLabels.get(session.id);
                        const needsYou = session.status === 'waiting';
                        // The newest step's own input: what the session asked,
                        // in the words the session screen's IN region shows.
                        // Newest first, which is the order `decisions` is in.
                        const newestAsk = session.decisions[0]?.input ?? null;
                        // WHAT THE SESSION SAYS IT IS BLOCKED ON, or nothing.
                        // Three states collapse to two here for the same reason
                        // they do in `DetailPanel`: absent ("no surface reports
                        // a wait") and null ("waiting, cause unnamed") differ in
                        // what vam knows and not in anything it could honestly
                        // print, and a word invented for the second would be
                        // indistinguishable from one a session reported.
                        const waitingCause =
                          typeof session.waitingFor === 'string' && session.waitingFor !== ''
                            ? session.waitingFor
                            : null;
                        // The SAME notion the close button already wears, applied
                        // to the whole row: closing can take the full stop timeout,
                        // and for those fifteen seconds the row is not something
                        // the operator can act on. `pendingAction` stays the one
                        // source of truth -- there is no second pending state here.
                        const closing = pendingAction === session.id;
                        const closingLabel = `Stopping “${session.title}”…`;
                        // WHICH SOURCE THIS ROW BELONGS TO, in the same order
                        // the status bar's glyph reads it (`Canvas.tsx`,
                        // `sourceKeyOf`): the session's own stamp first, its
                        // project's second, because the two are written by
                        // different readers and the narrower one is the one
                        // about THIS row. `null` is an entry that names neither
                        // -- a fixture, or a model assembled before sources
                        // existed -- and it draws the lane with nothing in it.
                        // `entry.project`, NOT `section.project`: under
                        // `Status`/`None` one section can hold several
                        // projects, and `section.project` there is only ever
                        // a placeholder key -- this row's OWN project is the
                        // one whose source fallback is actually correct.
                        const rowSource = session.source ?? entry.project.source ?? null;

                        return (
                          <div key={session.id}>
                            {renamingId === session.id ? (
                              <div className="flex items-center gap-1.5 rounded-[9px] border border-line-loud bg-raised px-2.5 py-2.5">
                                <input
                                  ref={renameRef}
                                  value={renameDraft}
                                  onChange={(event) => onRenameChange(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      onRenameCommit();
                                    } else if (event.key === 'Escape') {
                                      event.preventDefault();
                                      onRenameCancel();
                                    }
                                  }}
                                  className="min-w-0 flex-1 rounded-[var(--radius-sm)] bg-card px-1 font-mono text-control text-ink outline-none ring-1 ring-waiting"
                                  aria-label="rename session"
                                />
                              </div>
                            ) : (
                              <div
                                // A NAMED group. `group-hover:` matches ANY ancestor
                                // carrying `group`, and OverlayScroll wraps this whole
                                // list in one — so an unnamed group here meant hovering
                                // anywhere in the sidebar revealed every row's close
                                // button at once, the exact opposite of what the class
                                // was there to do.
                                // `data-row-pending` carries the dim (styles.css)
                                // rather than an inline colour, so the row keeps
                                // its own tokens and the treatment is one rule.
                                {...(closing
                                  ? { 'data-row-pending': session.id, 'aria-busy': true }
                                  : {})}
                                className="group/row relative"
                              >
                                <button
                                  type="button"
                                  // Held by id, like `foldRefs` above: the reveal
                                  // effect needs THIS session's row, and a
                                  // querySelector on every focus change would go
                                  // looking for it in the document instead.
                                  ref={(node) => {
                                    if (node === null) {
                                      rowRefs.current.delete(session.id);
                                    } else {
                                      rowRefs.current.set(session.id, node);
                                    }
                                  }}
                                  data-session-row={session.id}
                                  onClick={() => onPick(session.id)}
                                  /* ON THE BUTTON, not on the wrapper around it.
                                   The button IS the row -- `w-full`, the whole
                                   box -- so the target is the same, and it is
                                   the element the keyboard focuses, which is
                                   where the Menu key and Shift+F10 fire their
                                   `contextmenu`. A handler on the static
                                   wrapper would have been a pointer-only
                                   affordance in everything but name.
                                   `preventDefault` is not optional: without it
                                   Electron opens the SHELL's menu over the
                                   app's, offering Reload and Inspect Element
                                   over a session list. */
                                  onContextMenu={onRowMenu(
                                    session.id,
                                    session.title,
                                    session.ended === true,
                                  )}
                                  // Not actionable and not a tab stop -- but still
                                  // drawn, and still the row for THIS session: the
                                  // operator has to be able to see which one is
                                  // closing, which is the whole point of the state.
                                  disabled={closing}
                                  tabIndex={closing ? -1 : undefined}
                                  {...(closing ? { title: closingLabel } : {})}
                                  className={[
                                    // `vam-tap`: the row is the screen's primary
                                    // tap target, and it says so itself rather
                                    // than relying on its content to happen to
                                    // add up to 44px.
                                    'vam-tap relative flex w-full cursor-pointer flex-col gap-[7px] overflow-hidden rounded-[9px] px-2.5 py-2.5 text-left',
                                    // Over the 44 floor `vam-tap` sets, and the
                                    // extra is what makes a scrolling list
                                    // forgiving of a moving thumb.
                                    phone ? 'min-h-[56px]' : '',
                                    isFocused && !phone
                                      ? 'border border-line-loud bg-raised'
                                      : 'border border-transparent',
                                  ].join(' ')}
                                >
                                  {/* Not on a phone. `focusedId` does not move
                                    when the session screen closes, so one
                                    round trip leaves this bar marking a
                                    session the operator has already left --
                                    and the ring around it measures 2.15:1 on
                                    the light canvas, under even the 3:1
                                    non-text floor (issue 188). On a desktop it
                                    says where the next keystroke lands; here
                                    nothing lands anywhere. */}
                                  {isFocused && !phone && (
                                    <span
                                      data-row-cursor
                                      className={`absolute top-0 bottom-0 left-0 w-0.5 ${STATUS_DOT[session.status]}`}
                                    />
                                  )}

                                  {/* THE JUMP LABEL: the key that brings the
                                    cursor here, drawn on the row it addresses.
                                    Vimium's idiom and its reasoning -- the
                                    label has to be ON the thing it names, or
                                    the operator is matching a letter against a
                                    list they have to remember.

                                    ABSOLUTE, so arming the mode moves nothing:
                                    twenty rows all growing a badge in the flow
                                    at once would reflow the column under the
                                    cursor at the exact moment the operator is
                                    reading it. It overlays the tail of a long
                                    title, which is the trade the gesture is
                                    worth: one keystroke later it is gone.

                                    `bg-ink`/`text-ground` rather than a status
                                    hue. The label is not a fact about the
                                    session -- it is a transient address for
                                    one keystroke -- and the two ends of the
                                    ink ramp are the one pair guaranteed to
                                    read on every surface in both themes.

                                    The letter is drawn EXACTLY as it must be
                                    typed, lower case and all: the handler
                                    matches `event.key`, so a label printed `A`
                                    over a key that only answers to `a` would
                                    be an instruction that does not work. The
                                    `sr-only` word is what stops the badge from
                                    reading as a bare letter in the row's
                                    accessible name. */}
                                  {jumpLabel !== undefined && (
                                    <span
                                      data-jump-label={jumpLabel}
                                      className="pointer-events-none absolute top-1/2 right-2 z-10 flex h-[18px] min-w-[18px] -translate-y-1/2 items-center justify-center rounded-[4px] bg-ink px-1 font-mono font-semibold text-meta text-ground leading-none"
                                    >
                                      <span className="sr-only">jump key </span>
                                      {jumpLabel}
                                    </span>
                                  )}

                                  <span className="flex items-center gap-2">
                                    {/* ONE MARK ON THIS LINE, and it used to be
                                    two. The status mark and the provider mark
                                    were paired inside a `gap-1.5` wrapper
                                    here, so that they read as two marks about
                                    this row and cost the title one gap rather
                                    than two. The operator unpaired them: "in
                                    the sidebar, put the provider glyph before
                                    the branch name, under the session name."
                                    The wrapper went with the pairing -- a
                                    flex box around a single `flex-none` child
                                    is a box that does nothing, and a comment
                                    explaining a pair would be describing a
                                    layout that is no longer here.

                                    WHAT THE SPLIT SAYS. The title line is now
                                    only about what the session IS: its status
                                    and its name. Where the work came from --
                                    the agent that ran it, the branch it ran
                                    on -- is one sentence, and it is the line
                                    below. The title also gets back the 18px
                                    the pair cost it, which at the 200px
                                    sidebar minimum was about three characters
                                    of a name that was already truncating. */}
                                    {/* A MARK, not a dot. Five statuses drawn as
                                    five circles differing only in hue is the
                                    reading the operator called samey -- and
                                    hue is the one channel that is missing for
                                    somebody (WCAG 1.4.1). Each status is a
                                    shape now, in a lane that does not resize
                                    when one becomes another, and the motion
                                    each carries is its own: see
                                    `status-mark.tsx` for which and why. The
                                    `vam-breathe` that used to pulse the
                                    running and waiting dots went with them --
                                    a spinner that also breathes is two
                                    animations saying one thing.
                                    SILENT ON A PHONE: `data-row-meta` below
                                    prints the status as visible text there,
                                    and a second invisible copy is read
                                    twice. */}
                                    <StatusMark status={session.status} announce={!phone} />
                                    <span
                                      data-row-title
                                      className={[
                                        // ONE PIXEL SMALLER AND REGULAR.
                                        // Operator, in one breath with the two
                                        // headings above: "the session name
                                        // regular weight and also 1px smaller."
                                        // `text-control` (12px/16px), not a new
                                        // exception: it is the scale's own next
                                        // step down from `text-body` (13px), so
                                        // the ask lands on a step that already
                                        // exists rather than a fifth one
                                        // (`test/renderer/type-scale.test.ts`).
                                        // `font-normal` makes the 400 explicit
                                        // rather than merely inherited, so the
                                        // "regular" in the ask is a class this
                                        // element carries, not an absence.
                                        'truncate text-control font-normal',
                                        // The dim-unless-focused title is a
                                        // keyboard affordance: it exists so a
                                        // cursor row pops out of a column. With
                                        // no cursor it is only every row but one
                                        // being harder to read than it needs to be.
                                        //
                                        // NO LONGER `font-medium` ON FOCUS. That
                                        // bump predated this ask and was never
                                        // what the affordance above argues for
                                        // -- the argument is about CONTRAST
                                        // (`text-ink` against `text-ink-dim`),
                                        // and the focused row also carries a
                                        // border, a raised surface and a
                                        // status-coloured stripe
                                        // (`data-row-cursor`) that a weight
                                        // change never touched. Keeping the
                                        // extra weight here would leave one row
                                        // in the column not-regular, which is
                                        // the one thing the operator's sentence
                                        // ruled out.
                                        phone || isFocused ? 'text-ink' : 'text-ink-dim',
                                      ].join(' ')}
                                    >
                                      {session.title}
                                    </span>
                                  </span>

                                  {/* One line of real information where the
                                    desktop spends one on a placeholder. The
                                    status WORD is the second channel WCAG
                                    1.4.1 wants beside the dot; `needs you` is
                                    the `waiting` token on session state, which
                                    is what that token means and the only place
                                    a row borrows one. The branch is appended
                                    LAST so it is the segment that truncates
                                    first at 320px -- the age never is. */}
                                  {phone && (
                                    <span
                                      data-row-meta
                                      className="flex min-w-0 items-center gap-1 truncate font-mono text-meta text-ink-dim"
                                    >
                                      {/* THE PROVIDER OPENS THIS LINE TOO, and
                                        the phone is not an afterthought
                                        here: it draws its OWN meta line, with
                                        the status word and the age the
                                        desktop has no room for, so moving the
                                        mark on one row and not the other is
                                        the exact shape of a defect that looks
                                        right in whichever surface its author
                                        had open. The branch is last on this
                                        line rather than next, because at
                                        390px it is the segment that has to
                                        truncate first -- so "before the
                                        branch name" is satisfied by leading
                                        the line, and the mark keeps the ink
                                        and the height of the text it leads. */}
                                      <ProviderLane source={rowSource} />
                                      {session.status === 'waiting' ? (
                                        <span data-row-needs-you className="flex-none text-waiting">
                                          needs you
                                        </span>
                                      ) : (
                                        <span className="flex-none">{session.status}</span>
                                      )}
                                      <span className="flex-none">·</span>
                                      <span
                                        data-session-age
                                        // The gap's explanation is `sr-only` rather than a
                                        // `title`, which opens on hover and on nothing else --
                                        // and this span lives inside the row's own <button>, so
                                        // it cannot take a tab stop of its own without nesting an
                                        // interactive control. The row button already has an
                                        // accessible name built from its contents; the sentence
                                        // joins it there, and the em-dash stays as drawn.
                                        title={
                                          session.age === null
                                            ? undefined
                                            : `last activity ${session.age} ago`
                                        }
                                        className="flex-none"
                                      >
                                        {session.age ?? 'no age'}
                                        {session.age === null && (
                                          <span className="sr-only">
                                            this source cannot say when the session last did
                                            anything
                                          </span>
                                        )}
                                      </span>
                                      {session.branch !== null && (
                                        <>
                                          <span className="flex-none">·</span>
                                          <span data-session-branch className="truncate">
                                            {session.branch}
                                          </span>
                                        </>
                                      )}
                                    </span>
                                  )}
                                  {/* The waiting row's third line: what is being
                                    asked, rather than only that something is.
                                    NO LONGER PHONE-ONLY. The gate said the
                                    desktop sidebar "sits beside a canvas and a
                                    detail pane that answer it" -- and the
                                    canvas was deleted in 0.2, so half that
                                    premise no longer exists and the other half
                                    answers ONE session at a time. Finding the
                                    row blocked on a Bash approval across four
                                    tabs cost four opens, which is the cost this
                                    line exists to remove.
                                    THE CAUSE LEADS. `newestAsk` is the
                                    operator's own newest prompt echoed back: it
                                    says what the session was set going on,
                                    never what it is stuck on, so a row blocked
                                    on a permission prompt read exactly like one
                                    quietly working. `waitingFor` is the only
                                    surface that names the cause -- so it is
                                    drawn first, in the waiting amber, and the
                                    prompt follows it as context. Either alone
                                    is a line; neither is no line. */}
                                  {needsYou && (waitingCause !== null || newestAsk !== null) && (
                                    <span
                                      data-row-question
                                      className="line-clamp-2 text-control text-ink-dim"
                                    >
                                      {waitingCause !== null && (
                                        <span data-row-waiting className="text-waiting">
                                          {waitingCause}
                                        </span>
                                      )}
                                      {waitingCause !== null && newestAsk !== null && (
                                        <span aria-hidden="true"> · </span>
                                      )}
                                      {newestAsk}
                                    </span>
                                  )}
                                  {/* Branch on the left, time on the right, and nothing
                                between them. The step-verb pill and the progress
                                bar that used to sit here were removed at the
                                operator's request: both drew a per-status colour
                                channel over data no source supplies, so a row at
                                rest read as a dashboard reporting nothing. */}
                                  {!phone && (
                                    /*
                                     * QUIETER THAN `ink-faint`, AND BY OPACITY RATHER THAN BY A
                                     * DIMMER TOKEN. The operator asked for the age and the branch
                                     * to recede. `--vam-ink-faint` cannot carry that: it is in
                                     * `TEXT_TOKENS` and so owes WCAG 1.4.3's 4.5:1 on every surface
                                     * it is painted on, and its worst pairing
                                     * (`--vam-in-bubble`) is already 4.71:1 -- 0.21 of headroom.
                                     * One step down fails that guard everywhere the token is worn,
                                     * most of it nowhere near this row.
                                     *
                                     * Opacity composites against whatever surface the row is
                                     * actually on, so the pair stays in tone wherever the row is
                                     * drawn. The value is picked from a MEASUREMENT rather than
                                     * from arithmetic over the token a reader would guess at: all
                                     * seven rows composite over `--vam-raised`, not over
                                     * `--vam-sidebar` and not over the selected row's fill. On that
                                     * ground 0.82 lands at 4.74:1. The floor is 0.80
                                     * (4.59:1) and 0.78 fails, so this keeps roughly a fifth of a
                                     * point in hand -- which is the budget a future palette has to
                                     * move `--vam-raised` within before the guard below stops it.
                                     *
                                     * `token-contrast.test.ts` CANNOT SEE THIS. It parses the
                                     * stylesheet and compares two declarations, so an opacity on an
                                     * element is invisible to it and it stays green at any value.
                                     * The real measurement is therefore an e2e guard that reads
                                     * `getComputedStyle` on this span and composites it by hand --
                                     * `sidebar-tree-shots.mjs`. Dimming further without moving that
                                     * guard's number is how this silently becomes unreadable.
                                     */
                                    <span
                                      // Its own hook rather than `data-row-meta`, which is the
                                      // PHONE row's and is asserted absent here. The guard needs to
                                      // find the element the opacity sits on, not one of its
                                      // children, because compositing is a property of this node.
                                      data-row-meta-line
                                      className="flex items-center gap-1.5 font-mono text-meta text-ink-faint opacity-[0.82]"
                                    >
                                      <span className="flex min-w-0 flex-1 items-center gap-1">
                                        {/* WHICH AGENT RAN THIS, before the
                                          branch it ran on. The operator moved
                                          it here from the title line: "put the
                                          provider glyph before the branch
                                          name, under the session name."

                                          WHY THE TWO BELONG TOGETHER. Nothing
                                          else on the row answers "which
                                          provider" -- two checkouts of one
                                          directory read by two sources are two
                                          project headings with the same
                                          basename on them -- and the branch is
                                          the other half of the same question:
                                          where this session's work came from.
                                          The title line above says what the
                                          session IS; this line says where it
                                          is from. That is also why the mark
                                          leads the line rather than joining
                                          the age on the right: it introduces
                                          the branch, and a mark after the name
                                          it belongs to introduces nothing.

                                          UNCONDITIONAL, WHERE THE BRANCH GLYPH
                                          BELOW IS NOT, and the two rules are
                                          not in conflict. `GitBranch` is
                                          suppressed for a null branch because
                                          it would be a mark spent on an
                                          absence -- there is no name for it to
                                          sit beside. The provider lane is
                                          drawn empty for a sourceless row
                                          because a lane that collapses to its
                                          content moves the branch name of
                                          every row beside it, which is
                                          `status-mark.tsx`'s rule and the
                                          reason `ProviderLane` owns the width
                                          rather than the glyph.

                                          NOT THE SESSION ICON COMING BACK.
                                          That one (removed from the row, and
                                          pinned by `SessionList.icon.test.tsx`)
                                          repeated the project heading's own
                                          mark down the column and said nothing
                                          new; this says a thing no other part
                                          of the row says. Its decorativeness
                                          and its size are argued at
                                          `ProviderLane` and `PROVIDER_LANE_PX`. */}
                                        <ProviderLane source={rowSource} />
                                        {/* THE GLYPH GOES WITH THE NAME. A branch
                                          icon beside an em-dash is a row
                                          announcing that it has nothing to
                                          announce -- two marks spent on an
                                          absence, on every row of every source
                                          that cannot report a branch, which is
                                          most of them. Nothing is lost by
                                          drawing neither: there was no name to
                                          print either way, and the sentence
                                          that says WHOSE gap it is stays below
                                          in the row's accessible name, where
                                          it was the only copy anyway. */}
                                        {session.branch !== null && (
                                          /* `flex-none` IS A FIX, not tidying.
                                           An `<svg>` is a flex item with an
                                           auto basis, so this glyph shrank
                                           whenever the line was tight --
                                           MEASURED at the 264px default
                                           sidebar on the demo fixture: 8x10
                                           on one row and 9.9x10 on another,
                                           a branch icon squeezed narrow
                                           while keeping its height. It was
                                           already happening before the
                                           provider lane arrived (8.7x10 with
                                           the lane hidden), and the lane's
                                           14px made it worse, which is how
                                           it was found: the guard's "every
                                           branch name starts the same
                                           distance past its lane" came back
                                           [14, 28, 26].
                                           The NAME is what gives way on this
                                           line -- `data-branch-head`
                                           truncates and `data-branch-tail`
                                           is `flex-none` for exactly this
                                           reason -- and a 10px glyph has no
                                           two pixels to give. */
                                          <GitBranch
                                            size={10}
                                            strokeWidth={1.6}
                                            className="flex-none"
                                          />
                                        )}
                                        <span
                                          data-session-branch
                                          // `title` survives ONLY for the non-null case, where it
                                          // reveals text that is already in the DOM and merely
                                          // clipped -- the one legitimate use of the attribute.
                                          // The null case's sentence is information found nowhere
                                          // else, so it becomes `sr-only` text inside the row
                                          // button's own accessible name (see the age cell).
                                          title={session.branch ?? undefined}
                                          // `overflow-hidden` IS the guarantee (see
                                          // `BRANCH_TAIL_MAX_CHARS`'s doc comment): this box is
                                          // already sized correctly by the row's own flex layout
                                          // (`min-w-0`, shrunk to exactly the space
                                          // `data-session-age` -- `flex-none` -- does not need,
                                          // computed by the browser from its REAL rendered width).
                                          // `data-branch-tail` below is `flex-none` and will
                                          // happily paint past this box's edge; clipping here is
                                          // what refuses to let that paint land on the age, at any
                                          // width, any age string, any font.
                                          className="flex min-w-0 items-center overflow-hidden"
                                        >
                                          {session.branch === null ? (
                                            /* The em-dash is gone and the
                                             sentence is not: a screen reader
                                             still learns which fact is missing
                                             and why, from the one place that
                                             ever carried it. The age cell
                                             below KEEPS its dash, and the
                                             difference is deliberate -- it
                                             holds a column open on the right
                                             edge that a number will land in,
                                             where the branch dash held nothing
                                             open at all. */
                                            <span className="sr-only">
                                              this source cannot say which branch the session is on
                                            </span>
                                          ) : (
                                            <>
                                              <span data-branch-head className="truncate">
                                                {splitBranch(session.branch).head}
                                              </span>
                                              {/* `flex-none` always -- the tail never shares in
                                                the head's shrink, which is the whole point: the
                                                distinguishing final segment gives way last. Past
                                                `BRANCH_TAIL_MAX_CHARS`, `truncate` and an inline
                                                `maxWidth` turn on TOGETHER as a PREFERRED cut
                                                point -- an early, readable "…" rather than
                                                whatever character the parent's `overflow-hidden`
                                                above happens to land on. `truncate` alone sets no
                                                ceiling, and Tailwind's static scanner cannot see a
                                                class built from `BRANCH_TAIL_MAX_CHARS` at build
                                                time, so the width is inline rather than an
                                                arbitrary class -- the same reason `popoverWidth`
                                                above is a `style`, not a class. If this estimate
                                                is ever a few pixels optimistic, the parent's clip
                                                is the actual backstop, not this. */}
                                              <span
                                                data-branch-tail
                                                className={
                                                  splitBranch(session.branch).tail.length >
                                                  BRANCH_TAIL_MAX_CHARS
                                                    ? 'flex-none truncate'
                                                    : 'flex-none'
                                                }
                                                style={
                                                  splitBranch(session.branch).tail.length >
                                                  BRANCH_TAIL_MAX_CHARS
                                                    ? { maxWidth: `${BRANCH_TAIL_MAX_CHARS}ch` }
                                                    : undefined
                                                }
                                              >
                                                {splitBranch(session.branch).tail}
                                              </span>
                                            </>
                                          )}
                                        </span>
                                      </span>
                                      <span
                                        data-session-age
                                        // The gap's explanation is `sr-only` rather than a
                                        // `title`, which opens on hover and on nothing else --
                                        // and this span lives inside the row's own <button>, so
                                        // it cannot take a tab stop of its own without nesting an
                                        // interactive control. The row button already has an
                                        // accessible name built from its contents; the sentence
                                        // joins it there, and the em-dash stays as drawn.
                                        title={
                                          session.age === null
                                            ? undefined
                                            : `last activity ${session.age} ago`
                                        }
                                        className="flex-none"
                                      >
                                        {session.age ?? '—'}
                                        {session.age === null && (
                                          <span className="sr-only">
                                            this source cannot say when the session last did
                                            anything
                                          </span>
                                        )}
                                      </span>
                                    </span>
                                  )}
                                </button>

                                {/* Mouse route to the same thing `x` does. Hidden until the
                            row is hovered, so a list at rest is a list of names
                            rather than a row of buttons.

                            HIDDEN MEANS UNHITTABLE, AND FOCUS REVEALS. The
                            phone rule in `styles.css` takes this button away
                            entirely on a coarse pointer, which was the fix
                            for "invisible and still tappable"; on a desktop
                            it stayed `opacity: 0` with its pointer events
                            and its focus ring intact, so Tab could land on a
                            control drawn nowhere (WCAG 2.4.7) and a pen or a
                            touchscreen on a desktop build could hit it
                            blind. The tab strip's `×` carries the same two
                            lines for the same reason. */}
                                <ShortcutTip label="Close this session" action={CLOSE_ACTION}>
                                  <button
                                    type="button"
                                    onClick={() => onClose(session.id)}
                                    /* The `x` sits OUTSIDE the row button, so a
                                     right-click on it would otherwise reach
                                     nothing. Same menu, same session. */
                                    onContextMenu={onRowMenu(
                                      session.id,
                                      session.title,
                                      session.ended === true,
                                    )}
                                    aria-label={`close ${session.title}`}
                                    {...pending(session.id, `Stopping ${session.title}…`)}
                                    className={[
                                      'absolute top-2 right-2 cursor-pointer rounded-[var(--radius-sm)] px-1 text-control text-ink-faint',
                                      'opacity-0 hover:bg-card hover:text-failed group-hover/row:opacity-100',
                                      'pointer-events-none group-hover/row:pointer-events-auto',
                                      'focus-visible:pointer-events-auto focus-visible:opacity-100',
                                      'focus-visible:ring-1 focus-visible:ring-cursor-ring',
                                    ].join(' ')}
                                  >
                                    ×
                                  </button>
                                </ShortcutTip>

                                {/* The indicator, over the row rather than beside
                                it. Three channels for one fact, because one of
                                them is always missing for somebody: the turning
                                mark, the word, and `aria-busy` on the row. With
                                `prefers-reduced-motion` the mark parks upright
                                (styles.css) and the word carries it alone --
                                never "no indicator". `pointer-events-none` so
                                it cannot become a second thing to click on a
                                row that refuses clicks. */}
                                {closing && (
                                  <span
                                    data-row-busy
                                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                                  >
                                    <span className="flex items-center gap-1.5 rounded-[7px] border border-line bg-card px-2 py-1 text-control text-ink-dim">
                                      <LoaderCircle
                                        size={11}
                                        strokeWidth={1.8}
                                        className="vam-spin"
                                      />
                                      {closingLabel}
                                    </span>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}

            {entries.length === 0 && loading && (
              // First read still out -- distinct from "no sessions" below and
              // from a failure, which the banner above the canvas already
              // names. Same spinner as the row-busy indicator above.
              <li
                data-sidebar-loading
                className="flex items-center gap-1.5 px-1 py-4 text-control text-ink-dim"
              >
                <LoaderCircle size={11} strokeWidth={1.8} className="vam-spin" />
                Loading sessions…
              </li>
            )}
            {/* NOT "No sessions yet" WHEN THE REAL REASON IS `foreignHiddenCount`
              -- the strip below the list already names it, and an operator
              reading both would read the second as contradicting the first.
              `filter.trim() !== ''` (a search with no match) is left alone:
              that emptiness is about the query, not about ownership, and
              stays true whether or not anything is foreign-hidden elsewhere.
              NOR WHEN `hasOwnSession` IS TRUE -- a session vam started that
              is merely hidden by dismiss or a filter is not "no sessions",
              the same fact the getting-started screen and the tab strip now
              both read off the unfiltered model. */}
            {entries.length === 0 &&
              !loading &&
              filter.trim() === '' &&
              foreignHiddenCount === 0 &&
              !hasOwnSession && (
                <li className="px-1 py-4 text-control text-ink-dim">No sessions yet</li>
              )}
            {entries.length === 0 && !loading && filter.trim() !== '' && (
              <li className="px-1 py-4 text-control text-ink-dim">No match</li>
            )}
          </ul>
        </OverlayScroll>
      )}

      {/*
       * THE QUIET LINE `docs/design/vam-owns-the-session.md`'s own trap
       * needed a second time. `vamListingGap` above covers a listing vam
       * could not READ; this covers a listing vam read PERFECTLY and found
       * nothing of its own in -- `listVamSessions` answering `ok, []`, the
       * ordinary state after every reboot before vam starts its first
       * session. That is not a failure and stays out of `vamListingGap`
       * entirely: ownership really is zero. But `hideForeign` (on by
       * default) can still take every row with it, and an operator opening
       * the app to a wordless empty sidebar cannot tell "vam is broken" from
       * "vam owns nothing yet" -- exactly the ambiguity the design's trap
       * forbids, for a different cause than the one it names.
       *
       * SHOWN WHETHER OR NOT THE LIST IS EMPTY, unlike the loading/no-match
       * lines above: a single row hidden among several visible ones is as
       * unmentioned as twelve hidden behind none, just quieter about it --
       * `countHiddenByForeignFilter`'s own header is the small-count half of
       * this. `border-line border-t` and the restore strip's own spacing,
       * because this is the same shape of fact (something is hidden, here
       * is the one-tap way back) and a different visual language for it
       * would teach the operator two idioms for one idea.
       *
       * `Show` flips the SAME pref the popover's fourth row does
       * (`onOriginFilters({ ...originFilters, hideForeign: false })`) rather
       * than opening the popover -- the popover is one MORE tap away for a
       * state this severe, and the row itself already disappears the
       * instant the pref does, since `foreignHiddenCount` reads the live
       * pref and not a snapshot.
       *
       * WITHDRAWN WHILE THE PHONE'S GETTING-STARTED SCREEN OWNS THIS SAME
       * LINE (`showGettingStarted`, below): that screen carries its own
       * copy of this exact sentence (`GettingStarted.tsx`'s own
       * `foreignHiddenCount` prop, the identical value), and drawing both at
       * once put "1 session hidden — vam did not start it · Show" on a
       * 390px screen twice, one above an otherwise-empty list and one below
       * it. The desktop never withdraws this strip -- its getting-started
       * screen lives in the detail pane, so there is no second copy here to
       * collide with.
       *
       * NOT A STANDING COST EITHER, per the operator's own follow-on ask:
       * `foreignNoteShown`/`foreignNoteClosing`/`foreignNoteMounted` above
       * are what make this auto-hide after `FOREIGN_HIDDEN_NOTE_AUTO_HIDE_MS`
       * and stay quiet for the count it was left at, the same "receipt, not
       * furniture" rule `RESTORE_STRIP_VISIBLE_MS` already applies to the
       * strip below. Hover/focus PAUSE that clock rather than letting it fire
       * out from under a still-reading operator; Dismiss ends it right away.
       */}
      {foreignNoteMounted && (
        <div
          data-foreign-hidden
          // A TRANSIENT STATUS MESSAGE, not a static block of chrome: `role`
          // is what tells `noStaticElementInteractions` (and, more to the
          // point, a screen reader) that hover/focus on this element mean
          // something, and `status`'s own implicit `aria-live="polite"` is
          // the right way to hear "N sessions hidden" arrive without an
          // operator having had to go looking for it.
          role="status"
          onMouseEnter={() => setForeignNotePaused(true)}
          onMouseLeave={() => setForeignNotePaused(false)}
          // React's `onFocus`/`onBlur` are the bubbling kind (unlike the DOM
          // events they are named for), so these fire once for the whole
          // subtree rather than needing a handler on every focusable child --
          // `Show` today, `Dismiss` below. `relatedTarget` is what tells
          // "focus moved to Dismiss, still inside" apart from "focus left the
          // note entirely": only the second should resume the clock.
          onFocus={() => setForeignNotePaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setForeignNotePaused(false);
            }
          }}
          className={[
            'flex flex-wrap items-center gap-1.5 border-line border-t px-[11px] py-2',
            'text-control text-ink-faint transition-opacity motion-reduce:transition-none',
            foreignNoteClosing ? 'opacity-0' : 'opacity-100',
          ].join(' ')}
          style={{ transitionDuration: `${FOREIGN_HIDDEN_NOTE_FADE_MS}ms` }}
        >
          <span data-foreign-hidden-count>
            {foreignHiddenCount} session{foreignHiddenCount === 1 ? '' : 's'} hidden — vam did not
            start {foreignHiddenCount === 1 ? 'it' : 'them'}
          </span>
          {/* `vam-tap`: a phone renders this same strip on the list screen the
              instant `hideForeign` empties it, and a control that size fails
              the 44px floor every other phone control keeps -- the exact
              mistake this task's own defect 2 already made once with the
              popover's origin rows. */}
          <button
            type="button"
            data-foreign-hidden-show
            aria-label="show sessions vam did not start"
            onClick={() => onOriginFilters({ ...originFilters, hideForeign: false })}
            className="vam-tap ml-auto flex-none cursor-pointer font-mono text-control text-ink-dim underline hover:text-ink"
          >
            Show
          </button>
          {/* Same 26px square, same radius, same colours as the header's own
              icon buttons (Settings/Remote/theme) -- `vam-tap` added on top
              of that fixed size, exactly the `Show` button's own trick just
              above, so `min-height`/`min-width: 44px` wins over the 26px on
              a phone without a `[data-tap-skin]` layer: a borderless glyph
              button needs no separate paint box, the same reasoning
              `styles.css`'s own `.vam-phone .vam-tap` header gives for the
              tab strip's close `×`. */}
          <ShortcutTip label="Dismiss">
            <button
              type="button"
              data-foreign-hidden-dismiss
              aria-label="Dismiss"
              onClick={() => acknowledgeForeignHiddenCount(foreignHiddenCount)}
              className="vam-tap flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </ShortcutTip>
        </div>
      )}

      {/* A15.3: where a removed project comes back from, for a WHILE.
          A permanent strip is a standing cost for a momentary action, so
          this shows right after a hide and lets itself go
          (`RESTORE_STRIP_VISIBLE_MS`) rather than sitting in the sidebar for
          as long as anything, anywhere, is hidden. It still names each
          project while it is up: a removal that left no visible trace would
          be indistinguishable from a project that stopped existing, which is
          the one thing this list must never be ambiguous about.

          Once it times out the route does NOT disappear with it -- the
          filter menu's own "Hidden projects" section below carries the exact
          same list, untimed, for exactly this reason. The chip at the end of
          THIS row points there: same row as the projects, right-aligned,
          rather than a caption on a line of its own, because this whole
          change is about not spending an extra line on a receipt. */}
      {showRestoreStrip && (
        <div
          data-restore-strip
          className="flex flex-wrap items-center gap-1.5 border-line border-t px-[11px] py-2"
        >
          <span className="w-full font-mono text-meta text-ink-dim uppercase tracking-[0.12em]">
            Removed
          </span>
          {removed.map((project) => (
            <button
              key={project.id}
              type="button"
              data-restore-project={project.id}
              aria-label={`restore ${project.name}`}
              onClick={() => onHideProject(project, false)}
              className="flex cursor-pointer items-center gap-1 rounded-[6px] border border-line px-1.5 py-0.5 text-control text-ink-faint hover:border-line-strong hover:text-ink"
            >
              <RotateCcw size={10} strokeWidth={1.8} />
              {project.name}
            </button>
          ))}
          <ShortcutTip label="More in Filters" action={FILTER_MENU_ACTION}>
            <button
              type="button"
              data-restore-strip-more
              aria-label="more hidden projects, in the filter menu"
              onClick={() => onFilterMenuToggle(true)}
              className="ml-auto flex flex-none cursor-pointer items-center gap-1 font-mono text-control text-ink-faint hover:text-ink"
            >
              Filters
              <InlineChord
                action={FILTER_MENU_ACTION}
                className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-meta"
              />
            </button>
          </ShortcutTip>
        </div>
      )}

      {confirming !== null && (
        <ConfirmRemoveProject
          projectName={confirming.name}
          plan={planFor(confirming)}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            // The caller owns ending, hiding and reporting -- see the prop.
            // Everything this component owed the operator happened before the
            // click: the plan was computed over the whole project and stated,
            // count by count, in the dialog they are answering.
            onRemoveProject(confirming, planFor(confirming));
            setConfirming(null);
          }}
        />
      )}

      {/* THE ROW'S RIGHT-CLICK MENU, drawn once for the whole list.
          `position: fixed` (see `ContextMenu.tsx`), so it does not matter that
          this is outside the scroll container the row lives in -- and it has
          to be outside, or the container's `overflow` would clip it. */}
      {rowMenu !== null && (
        <ContextMenu
          label={`actions for ${rowMenu.title}`}
          at={rowMenu.at}
          onClose={() => setRowMenu(null)}
          items={rowMenuItems(rowMenu.sessionId, {
            closing: pendingAction === rowMenu.sessionId,
            onRenameSession,
            onClose,
            onReopen,
            ended: rowMenu.ended,
            canReopen,
          })}
        />
      )}

      {/* The mockup's own footer strip: workspace line, search, session rows,
          then this — last, not first. It sits above the workspace/settings
          footer rather than merged into it, because those two rows answer
          different questions ("what am I in", not "what do I do next") and
          the mockup keeps New session as its own full-width strip. */}
      {/* WITHDRAWN, NOT DRAWN AND DUPLICATED, while the phone's own
          getting-started screen owns this same act below: that screen carries
          its own primary New project button, and a second one immediately
          above it would be two controls for one act on a 390px screen. The
          desktop never withdraws this strip -- its getting-started screen
          lives in the DETAIL pane, a different piece of chrome entirely, so
          there is no sibling button to collide with there. */}
      {!showGettingStarted && (
        <div className="border-line border-t px-[11px] py-2.5">
          {/* Grey and small, at the operator's request. The fill and the medium
              weight were doing as much of the shouting as the colour: an
              ink-on-`line-strong` slab made the least urgent control in the
              sidebar its loudest. It is an outline now, a step down the ink
              ladder, and shorter and smaller in the same breath so the type
              still fits the box. Hover restores full ink, so it still reads as
              something you press. */}
          {/* The footer names no project: it starts one in the FOCUSED
              session's, exactly as `o` does, so it is pending for that same
              project id and for no other.

              NEVER A DEAD END. With nothing focused there is no project for
              this button to add a session TO -- `addWillCreateProject`, the
              exact condition `Canvas.tsx`'s `onAdd` itself branches on, so the
              label can never claim "New session" while a click is about to
              start a project instead. `o` still opens this same control (the
              chip beside it never changes): in that state `o` ALSO falls back
              to New project, so the chord shown here stays true regardless of
              which act it currently performs. */}
          <ShortcutTip
            label={addWillCreateProject ? 'New project' : 'New session'}
            action={NEW_SESSION_ACTION}
          >
            <button
              type="button"
              data-sidebar-add
              onClick={onAdd}
              aria-label={
                addWillCreateProject ? 'new project (no session to add to)' : 'new session'
              }
              {...pending(
                addWillCreateProject
                  ? NEW_PROJECT_PENDING
                  : (entries.find((candidate) => candidate.session.id === focusedSessionId)?.project
                      .id ?? ''),
                addWillCreateProject
                  ? 'Starting a session in the chosen directory…'
                  : 'Starting a session…',
              )}
              className="vam-tap flex h-7 w-full cursor-pointer items-center justify-center gap-[7px] rounded-[8px] border border-ink-quiet text-control text-ink-dim hover:border-ink-faint hover:text-ink"
            >
              {addWillCreateProject ? (
                <FolderPlus size={13} strokeWidth={1.7} />
              ) : (
                <Plus size={13} strokeWidth={1.7} />
              )}
              {addWillCreateProject ? 'New project' : 'New session'}
              {/* Read, not written: this cell used to spell `o`. */}
              <InlineChord
                action={NEW_SESSION_ACTION}
                className="ml-0.5 font-mono text-meta text-ink-faint"
              />
            </button>
          </ShortcutTip>
        </div>
      )}
      {/* THE PHONE'S OWN GETTING-STARTED SCREEN. `DetailPanel`'s copy
          (`GettingStarted.tsx`, wired in `Canvas.tsx`'s `gettingStarted` prop)
          is unreachable from a phone: `PhoneShell` mounts `SessionList` as
          ITS list screen and only reaches `DetailPanel` once a session is
          already open (`entry !== null`), so an app with no session to show
          would otherwise draw this list's own "No sessions yet" line and
          nothing else -- the desktop's rich screen, minus everything that
          made it a getting-started screen. This is that same screen, the
          identical component, replacing the list body on the ONE surface
          the desktop does not need it to.

          `&& !showStartingProvisional`: REPLACING, not joining -- see that
          flag's own comment. While a first project is being created there is
          real news to show (the provisional row above), and this screen
          would otherwise sit beside it fighting it for the same free space,
          each centring in whatever half it was left. */}
      {showGettingStarted && !showStartingProvisional && (
        <GettingStarted
          onNewProject={onNewProject}
          newProjectDecline={newSessionDecline}
          hasDirectoryPicker={hasDirectoryPicker}
          foreignHiddenCount={foreignHiddenCount}
          onShowForeign={() => onOriginFilters({ ...originFilters, hideForeign: false })}
          phone
        />
      )}
    </aside>
  );
});
