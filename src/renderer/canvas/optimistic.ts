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
 * where `deliverPrompt` is false black-smith RECORDS a prompt and has no
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
 * Everything here is a pure function of a model and a list. No React.
 */

import type { CanvasModel, Decision, Session } from '../domain/model.js';

export type PendingPrompt = {
  /** Vam's own id for the painted turn. Never matched against the source's. */
  readonly id: string;
  readonly sessionId: string;
  /** The prompt as it was sent, verbatim -- this is half of the pairing. */
  readonly input: string;
  /** How many turns with these words the session had when it was sent. */
  readonly seen: number;
  /** Whether the source DELIVERS, so the session may be painted as running. */
  readonly live: boolean;
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
 * The pending prompts the model has not caught up with yet.
 *
 * Oldest first within one (session, input) group: two sends of the same words
 * are reconciled in the order they were sent, so one real turn retires one
 * paint rather than both.
 */
export function reconcile(
  model: CanvasModel,
  pending: readonly PendingPrompt[],
): readonly PendingPrompt[] {
  // How many real turns each group still has to spend, counted once per group.
  const budget = new Map<string, number>();
  return pending.filter((one) => {
    const key = `${one.sessionId} ${one.input}`;
    const real = budget.get(key) ?? countTurnsWithInput(model, one.sessionId, one.input);
    if (real > one.seen) {
      // This paint is spent by one real turn; the next one in the group needs
      // another beyond it.
      budget.set(key, real - 1);
      return false;
    }
    budget.set(key, real);
    return true;
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
