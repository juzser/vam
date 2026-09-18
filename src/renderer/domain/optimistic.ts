/**
 * The turn the operator has typed but the source has not reported back yet.
 *
 * `sendPrompt` awaits its write, then asks for a reload, so between the key
 * and the next model there is a round trip in which the canvas shows no sign
 * of the prompt at all. That gap is a subprocess and a whole model rebuild
 * wide, and it reads as the app having missed the key. A pending prompt is
 * what fills it: the typed words drawn as the newest turn, from the moment
 * they are sent, until the real one arrives and replaces them.
 *
 * WHAT MAY BE PAINTED AND WHAT MAY NOT. The words themselves are true for
 * every source -- the operator typed them and they exist. `running` is not:
 * where `deliverPrompt` is false the factory RECORDS a prompt and has no
 * channel into any agent (see `sendPrompt`), so painting the session as
 * running there would claim an agent is composing an answer when nothing was
 * told anything. Hence `live`, which is the source's `deliverPrompt` and
 * nothing else.
 *
 * HOW A PAINTED TURN IS RECOGNISED IN THE REAL MODEL, which is the part that
 * decides whether the operator sees their message once or twice. Vam cannot
 * match on id: the id here is vam's own, and the source assigns its own when
 * it records the turn. The only thing the two share is the session and the
 * words. So the pairing is (session, input) -- and it is a COUNT, not a
 * lookup, against a baseline taken at send time: `seen` is how many turns
 * with those exact words the session already had. The pending prompt is
 * dropped only once the model holds MORE than that. Without the baseline a
 * prompt resending words the session had heard before would be reconciled
 * against the old turn and never paint at all; without the count, two sends
 * of the same words would both be dropped by one real turn.
 *
 * AND HOW A PAINT DIES WHEN IT IS NEVER RECOGNISED, which is the other half
 * and was missing. The match above is EXACT string equality, and for a while
 * it was the ONLY way a paint could ever be retired -- so a source that
 * recorded the words back differing by one character kept the paint alive for
 * the life of the renderer: drawn as the newest turn with `output: null`, with
 * the real turn and its real answer sitting above it. The operator reported
 * exactly that, twice. Divergence is not hypothetical: the prompt reaches a
 * Claude Code session as `send-keys -l` keystrokes typed into a tmux pane with
 * no bracketed paste to frame it, and a multi-line one is typed line by line
 * with a `\`+Enter escape between them (`sources/claude-code/reply.ts`), so a
 * TUI that is booting, re-wrapping or echoing records something that is not
 * byte-identical -- and there is no echo confirming the turn landed at all, so
 * the paint's `running` claim (`live`, below) rests on the keystroke alone and
 * MUST be able to expire, which is what the two rules below and the clock do.
 *
 * So there are two more ways out, and they answer different questions.
 * OVERTAKEN (`seenAll`) is evidence: the session has recorded a turn since the
 * send and the match did not claim it, so the round trip demonstrably
 * completed without the words coming back as they went out. It is the fast
 * one -- the first poll that carries the divergent turn ends the paint.
 * EXPIRED (`PAINT_LIFETIME_MS`) is the backstop, and it is the only rule here
 * that is not a function of what the source managed to say: it is what makes
 * "forever" impossible even when the source records nothing at all.
 *
 * Everything here is a pure function of its arguments. No React, and no clock:
 * `reconcile` is told the time rather than reading one, and `sentAt` is a fact
 * recorded at send time by the caller that did the sending.
 */

import type { CanvasModel, Decision, Session } from './model.js';

/**
 * How long a paint may stand in for a turn the source has not reported back.
 *
 * WHY A CLOCK AND NOT JUST THE OVERTAKEN RULE. `seenAll` is the better rule
 * when it fires -- it is evidence rather than a guess -- and it does not hold
 * on its own. Claude Code's model is built from the last 128 KiB of a
 * transcript (`sources/claude-code/source.ts`), so on a long session old turns
 * fall out of the window as new ones arrive and the total can PLATEAU. A rule
 * that can plateau is a rule that can still keep a paint forever, which is the
 * defect itself. This one cannot: it is the only rule here that does not ask
 * the source for permission.
 *
 * WHAT IT COSTS WHEN IT IS WRONG, in each direction.
 *   TOO EARLY -- a source that is merely slow has its paint taken down before
 *   the real turn lands, so the operator's prompt flickers out of the column
 *   and back. Nothing is lost: the words reached the session, and the composer
 *   was cleared only because the send succeeded. It costs one confusing second.
 *   TOO LATE -- a stale row sits at the top of the column claiming to be the
 *   newest turn while the real one, with the real answer, sits under it, and
 *   the operator is told their turn ended without an answer. That is the bug
 *   this exists to bound. Unbounded, it lasts the life of the renderer.
 * The asymmetry is why this number is generous but finite.
 *
 * WHY 30s. `sendPrompt` asks for a reload the moment its write lands, and a
 * source that cannot push (`liveUpdates: false`, which is Claude Code) is
 * re-read every `SOURCE_POLL_INTERVAL_MS` = 10s besides. Three whole intervals
 * is that immediate reload plus two further polls, every one of which has had
 * its chance to carry the turn back -- so this never fires on a paint that is
 * still legitimately waiting for the first reload after a send. The
 * relationship between the two numbers is asserted in
 * `Canvas.optimistic-reply.test.tsx`, so moving the poll interval cannot
 * quietly make this too tight.
 */
export const PAINT_LIFETIME_MS = 30_000;

/**
 * How often the caller re-checks its paints against the clock.
 *
 * Here beside the lifetime rather than in `Canvas.tsx` so the pair can be read
 * together: this is the granularity of `PAINT_LIFETIME_MS`, and a paint can
 * therefore stand for up to a second longer than the lifetime says. One second
 * is well under the resolution at which the number above is argued (whole
 * ten-second polls), and the timer exists only while something is pending.
 */
export const PAINT_SWEEP_INTERVAL_MS = 1_000;

export type PendingPrompt = {
  /** Vam's own id for the painted turn. Never matched against the source's. */
  readonly id: string;
  readonly sessionId: string;
  /** The prompt as it was sent, verbatim -- this is half of the pairing. */
  readonly input: string;
  /** How many turns with these words the session had when it was sent. */
  readonly seen: number;
  /**
   * How many turns of ANY words the session had when it was sent -- the
   * baseline the OVERTAKEN rule measures against. More than this, with none of
   * them matching, and the session has recorded a turn since the send that is
   * not the one vam painted: the round trip completed and the words came back
   * changed. Taken from the same model and the same instant as `seen`.
   */
  readonly seenAll: number;
  /** Whether the source DELIVERS, so the session may be painted as running. */
  readonly live: boolean;
  /**
   * When the paint went up, `Date.now()` at the send -- the other half of the
   * expiry, and a FACT the sender recorded rather than a clock this module
   * reads. Set before the write is awaited, because what the expiry bounds is
   * how long the row has been on screen, not how long the write took.
   */
  readonly sentAt: number;
};

/** How many of `sessionId`'s turns were opened with exactly `input`. */
export function countTurnsWithInput(model: CanvasModel, sessionId: string, input: string): number {
  let count = 0;
  for (const project of model.projects) {
    for (const session of project.sessions) {
      if (session.id !== sessionId) continue;
      count += session.decisions.filter((decision) => decision.input === input).length;
    }
  }
  return count;
}

/**
 * How many turns `sessionId` has in total, whatever their words.
 *
 * A COUNT OF WHAT THE MODEL HOLDS, not of what the session has ever had: the
 * Claude Code adapter reads a byte window, so this can fall as well as rise.
 * `reconcile` only ever reads it as "strictly more than the baseline", which
 * is the direction that cannot be produced by the window sliding backwards.
 */
export function countTurns(model: CanvasModel, sessionId: string): number {
  let count = 0;
  for (const project of model.projects) {
    for (const session of project.sessions) {
      if (session.id === sessionId) count += session.decisions.length;
    }
  }
  return count;
}

/**
 * The pending prompts the model has not caught up with yet.
 *
 * Oldest first within one (session, input) group: two sends of the same words
 * are reconciled in the order they were sent, so one real turn retires one
 * paint rather than both.
 *
 * `now` is a PARAMETER, not a `Date.now()` inside: this stays a pure function
 * of its arguments, which is what lets the whole of it be asserted from a test
 * with no clock and no timers. The caller owns the clock -- see `Canvas.tsx`,
 * which sweeps on every new model and on a timer besides, so that a paint
 * expires even while the source is failing to produce new models at all.
 */
export function reconcile(
  model: CanvasModel,
  pending: readonly PendingPrompt[],
  now: number,
): readonly PendingPrompt[] {
  // How many real turns each group still has to spend, counted once per group.
  const budget = new Map<string, number>();
  // And the same accounting for the SESSION as a whole, which the overtaken
  // rule spends from. It has to be a budget for the same reason the one above
  // does: with two paints up and one new turn arrived, an unbudgeted rule
  // retires BOTH -- the second on the strength of the first one's turn.
  const beyond = new Map<string, number>();
  return pending.filter((one) => {
    const key = `${one.sessionId} ${one.input}`;
    const real = budget.get(key) ?? countTurnsWithInput(model, one.sessionId, one.input);
    const all = beyond.get(one.sessionId) ?? countTurns(model, one.sessionId);
    if (real > one.seen) {
      // This paint is spent by one real turn; the next one in the group needs
      // another beyond it. That turn is also one of the session's, so it is
      // spent from BOTH budgets -- otherwise the very turn that retired this
      // paint by matching would go on to retire the next one as overtaken.
      budget.set(key, real - 1);
      beyond.set(one.sessionId, all - 1);
      return false;
    }
    budget.set(key, real);
    // OVERTAKEN BEFORE EXPIRED, so a paint that has evidence against it is
    // retired on the evidence and spends the turn it was overtaken by. Letting
    // the clock take it first would leave that turn unspent for the next paint
    // to be retired by, which is one real turn retiring two paints.
    if (all > one.seenAll) {
      beyond.set(one.sessionId, all - 1);
      return false;
    }
    // MEMOISATION, NOT ACCOUNTING -- stated because the two writes above are
    // accounting and look identical. Nothing was consumed by a paint that
    // reaches here: it was not matched and it was not overtaken, so neither
    // budget moves and this only saves the next paint of the same session a
    // walk of the model. Deleting it changes no verdict, which is why no test
    // can be written for it.
    beyond.set(one.sessionId, all);
    return now - one.sentAt < PAINT_LIFETIME_MS;
  });
}

function paint(session: Session, pending: PendingPrompt): Session {
  const decision: Decision = {
    id: pending.id,
    // The turn has no agent name yet -- nothing has answered. `you` is what
    // the pane already calls the half of a turn the operator wrote.
    label: 'you',
    input: pending.input,
    // `null`, not the empty string: the session has the prompt and has not
    // finished answering, which is exactly what `null` means (model.ts).
    output: null,
    commands: [],
    // The one thing that marks this turn as vam's own rather than a source's.
    // A reader that draws a turn's ABSENCES needs it: every sentence about an
    // absence is a claim about what the source reported, and no source
    // reported this (`model.ts`, `DetailPanel.tsx`'s `noAnswerNote`).
    unconfirmed: true,
  };
  return {
    ...session,
    status: pending.live ? 'running' : session.status,
    decisions: [decision, ...session.decisions],
  };
}

/** The model with every pending prompt drawn as its session's newest turn. */
export function withPending(model: CanvasModel, pending: readonly PendingPrompt[]): CanvasModel {
  if (pending.length === 0) {
    return model;
  }
  return {
    ...model,
    projects: model.projects.map((project) => ({
      ...project,
      sessions: project.sessions.map((session) =>
        pending
          .filter((one) => one.sessionId === session.id)
          .reduce((built, one) => paint(built, one), session),
      ),
    })),
  };
}
