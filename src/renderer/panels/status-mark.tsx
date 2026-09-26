/**
 * What a session's status looks like, answered in one place.
 *
 * Five statuses used to be five dots differing only in hue, and the operator
 * read the result as cluttered and samey -- which it was: a column of
 * identical circles says "five of something" long before it says which five.
 * Colour is also the channel that is missing for somebody, and WCAG 1.4.1 says
 * so. So each status takes a SHAPE, and the hue becomes the second channel
 * rather than the only one.
 *
 * A module of its own, on the argument that "which mark stands for a status"
 * is a rule about the session model, not a detail of the sidebar. The sidebar
 * was the first caller; the tab strip is the second (`Canvas.tsx`,
 * `TabStrip`), and it adopted this table rather than keeping its own dot,
 * which is what this paragraph asked of it. The phone list still draws its
 * own. The argument that outlives the caller count is that the rule is
 * statable and testable on its own.
 *
 * `session-icon.tsx` used to sit beside this file making the same argument for
 * "which glyph stands for a session". That question has no answer now -- the
 * operator removed session icons outright -- so this module is the last of the
 * pair, and the reasoning above stands on its own merits rather than on a
 * neighbour's.
 *
 * THE LANE IS FIXED, AND THAT IS HALF THE POINT. A status changes under the
 * operator's eyes -- `running` becomes `waiting` the moment an agent asks a
 * question -- and glyphs of different intrinsic widths would re-lay-out the
 * title beside them every time one did. The mark is a box the glyph is centred
 * in, so the row's geometry is a constant and only its content moves.
 *
 * `idle` KEEPS THE DOT IT ALWAYS HAD, deliberately. It is the one status that
 * means nothing is happening, and a drawn glyph for nothing-happening would be
 * the loudest mark in a column of rows that are mostly idle. A small dot in a
 * big lane is the shape of "at rest" -- it is the only mark that does not fill
 * its box.
 */

import { Bell, Check, Circle, LoaderCircle, SquareTerminal, TriangleAlert } from 'lucide-react';
import { type ReactElement, useRef } from 'react';
import type { SessionStatus } from '../domain/model.js';

/**
 * The side of the lane every mark is centred in, in px.
 *
 * 14, which is the tallest glyph plus its stroke, and under the 16px slot the
 * project heading's icon takes: a session's mark reads as a smaller relative
 * of the heading's glyph rather than as its equal.
 *
 * THAT SENTENCE USED TO BE FALSE ON SCREEN, and this number is why it is true
 * now. The lane was "one pixel under" a 15px slot, which was right about the
 * boxes and wrong about the ink: the mark's glyph is 12 and the heading's was
 * 11, so the level above painted as the smaller mark. The heading now draws
 * its glyph at THIS number -- `HEADING_GLYPH_PX` in `SessionList.tsx` is
 * `MARK_LANE_PX`, derived rather than copied -- as tall as the whole lane a
 * mark is merely centred in. Change the lane and the heading follows.
 */
export const MARK_LANE_PX = 14;

/** The glyph inside the lane. Smaller than the lane so a round mark and a
 *  triangular one, which bear their mass differently, both have room to sit
 *  centred rather than one touching the edges. */
export const GLYPH_PX = 12;

/**
 * One turn of `.vam-spin`, in ms — the same 1.1s the rule in `styles.css`
 * declares, and the only number here that is a copy of anything.
 *
 * It has to be a copy: the stylesheet owns the animation and JavaScript owns
 * the phase, and neither can read the other's number at build time. The
 * duplication is pinned rather than trusted -- `status-mark.test.tsx` parses
 * `.vam-spin` out of the stylesheet and fails if the two ever disagree, which
 * is the failure that would otherwise show up as a barely-visible stutter.
 */
export const SPIN_PERIOD_MS = 1100;

/**
 * How far into its turn a spinner mounting NOW should already be.
 *
 * A CSS animation starts when its element does, so rows that arrive at
 * different moments spin at different angles -- and a column of spinners out
 * of step reads as a busy machine rather than as one working list. Driving
 * them from a shared clock is the fix, and the cheapest shared clock is the
 * wall clock itself: every mark's angle is `now % period`, a pure function of
 * the time, so marks that never meet still agree.
 *
 * Spent as a NEGATIVE `animation-delay`, which is the one property that means
 * "this animation has already been running for that long". The alternative --
 * a `requestAnimationFrame` loop writing a transform -- would re-render every
 * running row sixty times a second to draw what the compositor draws for free.
 */
export function spinPhaseMs(now: number = Date.now()): number {
  return now % SPIN_PERIOD_MS;
}

/**
 * The glyph for each status, and the only list of statuses in this file.
 *
 * A `Record<SessionStatus, …>` on purpose: a sixth status added to the union
 * stops this table compiling, which is the guard `model.ts` promises the four
 * status maps give. `SESSION_STATUSES` below is `Object.keys` of it, so no
 * reader -- test, guard or future surface -- has to retype the list and then
 * drift from it.
 */
const GLYPH: Readonly<Record<SessionStatus, (phase: number, size: number) => ReactElement>> = {
  /**
   * Two bodies, one of which the stylesheet always hides.
   *
   * `LoaderCircle` is an arc with a bite out of it. Stopped, it is not a
   * paused spinner -- it is a broken ring, and a reader who asked for less
   * motion gets a mark that reads as damage. `prefers-reduced-motion`
   * therefore swaps the glyph rather than freezing it: a WHOLE ring, which is
   * a deliberate shape at rest and still nobody else's mark (idle's dot is
   * filled and a third the size, done is a tick, failed is a triangle).
   *
   * Both are in the DOM because CSS cannot choose a React component. The cost
   * is one hidden `<svg>` per running row, which is cheaper than a media query
   * subscription per row and, unlike one, cannot disagree with the paint.
   */
  running: (phase, size) => (
    <>
      <LoaderCircle
        data-mark-motion="spin"
        className="vam-spin text-running"
        style={{ animationDelay: `-${phase}ms` }}
        size={size}
        strokeWidth={1.8}
      />
      <Circle data-mark-motion="rest" className="text-running" size={size} strokeWidth={1.8} />
    </>
  ),
  /**
   * It rings when the wait STARTS and then holds still.
   *
   * The swing is finite in the stylesheet (`.vam-swing`), and it plays here
   * because the element is new: a row that was running drew a `LoaderCircle`,
   * so React mounts a fresh `<svg>` the moment the status flips and the
   * animation runs from its first frame. Nothing schedules it, nothing has to
   * remember whether it has already rung, and a re-render for any other reason
   * does not ring it again.
   *
   * A bell that never stops is a smoke alarm. The sidebar is a thing the
   * operator leaves on screen all day, and a permanent motion in the corner of
   * the eye is exactly what they asked to be rid of.
   */
  waiting: (_phase, size) => (
    <Bell data-mark-swing className="vam-swing text-waiting" size={size} strokeWidth={1.8} />
  ),
  /** The mark for "nothing is happening": the dot the row always had, at the
   *  size it always was, alone in a lane the others fill. */
  idle: () => <span className="h-[7px] w-[7px] flex-none rounded-full bg-idle" />,
  /**
   * An open pane with nothing started in it (`model.ts`): idle's dot, HOLLOW.
   * Same size, same lane, same neutral ink -- it is the same quiet -- and the
   * ring rather than the fill is what says "nothing is in here yet" to an eye
   * that has learnt idle's dot means "an agent, resting". A distinct shape
   * for a distinct status, as every other row of this table is; the outline
   * is drawn with the token as a border so the row's ink and this mark cannot
   * disagree about the colour.
   */
  unstarted: () => (
    <span className="h-[7px] w-[7px] flex-none rounded-full border border-idle bg-transparent" />
  ),
  /**
   * A pane vam started, whose agent has exited but whose conversation vam
   * still knows -- `docs/design/vam-terminal-only.md`. `unstarted`'s hollow
   * dot, at the same size and the same neutral ink, says "a pane and nothing
   * else"; this glyph is what tells the operator there IS something else --
   * a conversation, paused at the shell -- without borrowing `idle`'s filled
   * dot, which means an AGENT resting between turns and would be a lie here.
   * The literal terminal glyph reads as "this pane's shell is what is live
   * right now" on sight, which a shape variation on the same small dot could
   * not have said as plainly.
   */
  terminal: (_phase, size) => (
    <SquareTerminal className="text-idle" size={size} strokeWidth={1.8} />
  ),
  /** A tick, not a circled one: the circled check draws a second ring into a
   *  column that already has one turning in it. A hair more stroke than its
   *  neighbours because a tick is two strokes and nothing else, and at 12px it
   *  otherwise reads lighter than the glyphs around it. */
  done: (_phase, size) => <Check className="text-done" size={size} strokeWidth={2} />,
  failed: (_phase, size) => <TriangleAlert className="text-failed" size={size} strokeWidth={1.8} />,
};

/**
 * Every status the model has, in one runtime list, derived from the table
 * above rather than written out again.
 *
 * `SessionStatus` is a type and disappears at build time, so anything that has
 * to WALK the statuses -- a test, a fixture, a future legend -- needs a value.
 * Deriving it here means the walk and the drawing can never be a member apart.
 */
export const SESSION_STATUSES = Object.keys(GLYPH) as readonly SessionStatus[];

/**
 * One session's status, drawn.
 *
 * `announce` is the screen-reader half. The mark is the only thing on a
 * desktop row that carries the status at all -- the word appears nowhere --
 * so it says it, which is a channel the dot it replaces never had. The phone
 * row prints the same word as visible text a few pixels below, and there a
 * second invisible copy is simply read twice; that caller passes `false`.
 */
export function StatusMark({
  status,
  announce = true,
  lane = MARK_LANE_PX,
  glyph = GLYPH_PX,
}: {
  status: SessionStatus;
  announce?: boolean;
  /**
   * The lane and the glyph, in px, for a caller whose line is not the
   * sidebar row's. The defaults are the row's; the tab strip passes its own
   * (`TAB_MARK_LANE_PX` in `Canvas.tsx`, with the argument for the number).
   * Two numbers rather than a scale so each surface can state its lane as a
   * fact about its own line box, not as a ratio of somebody else's.
   */
  lane?: number;
  glyph?: number;
}): ReactElement {
  /**
   * Fixed at mount, not re-read per render.
   *
   * The phase is only ever correct at the instant the element's own animation
   * starts. Re-computing it on a later render would hand a running animation a
   * new delay without moving its start time, which is a visible jump -- the
   * one artefact this whole mechanism exists to prevent. A remount recomputes
   * it, and that is right: a mark arriving late should join the others where
   * they are.
   */
  const phase = useRef(spinPhaseMs()).current;
  return (
    <span
      data-status-mark={status}
      /* The size is a `style`, not an `h-[14px]` class, for the reason
         `SessionList.tsx` gives at `BRANCH_TAIL_MAX_CHARS`: Tailwind's scanner
         reads source text, so a class assembled from a constant is a class it
         never generates -- the rule would simply not exist and the lane would
         collapse to its content, which is the one thing it must not do. An
         inline style keeps `MARK_LANE_PX` the single place the number lives. */
      style={{ width: lane, height: lane }}
      className="flex flex-none items-center justify-center"
    >
      {GLYPH[status](phase, glyph)}
      {announce && <span className="sr-only">{status}</span>}
    </span>
  );
}
