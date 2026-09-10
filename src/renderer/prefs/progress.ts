/**
 * CONCISE MODE: how much of a turn's working the transcript column draws.
 *
 * Operator request: "add a setting to adjust concise mode -- to show the
 * progress, or collapse it, like the Claude Code plugin". The plugin's shape is
 * already half-built here -- `DetailPanel.tsx` condensed each turn's
 * intermediate work into ONE line (`data-progress-line`) when the three band
 * separators came off -- and what was missing is the operator's say over
 * whether that line is drawn at all.
 *
 * WHAT THE TWO MODES ARE NOT. `shown` does not list a turn's tool calls,
 * because the model has no list to draw from: `Decision` carries `label`,
 * `input`, `output`, the agent-proposed `commands` (which are commands for a
 * PERSON to run, not the calls the turn made) and `errorCount`, a COUNT. A
 * richer progress view would have to invent its rows, and an invented row on
 * the one surface that reports failure is the false badge `errorCount`'s own
 * comment refuses. So the setting controls the thing that genuinely varies:
 * whether a turn spends a row saying it happened.
 *
 *  - `shown`     -- every turn keeps its line: the mark, the label, its
 *                   failure count, and on the newest turn the session's
 *                   activity and what it is waiting on. Today's screen.
 *  - `collapsed` -- the line is withdrawn from turns that have nothing to
 *                   report, so prompt and answer read as continuous prose.
 *
 * THE BOUND ON `collapsed` IS `drawsProgressLine` BELOW, and it is the whole
 * safety argument of this file. Read it before changing either mode.
 */

/** The two words the store may hold. */
export type TurnProgress = 'shown' | 'collapsed';

/**
 * Shown, and the default is load-bearing rather than a taste.
 *
 * Every other appearance default here answers "what should a new operator
 * see". This one also answers "what happens to an operator who never opens the
 * picker", and this setting can REMOVE a line from a screen they read. A
 * default that hid it would ship a change nobody asked for to everybody who
 * did not ask; a default that hides nothing cannot.
 */
export const DEFAULT_TURN_PROGRESS: TurnProgress = 'shown';

/**
 * A stored word, or the mode that hides nothing.
 *
 * Total, like `clampOutFontSize`: a value an older vam wrote, a mode a later
 * vam withdrew, a devtools edit -- none of them may reach the column, and the
 * direction of the fallback matters. Falling back to `collapsed` would take
 * lines off the screen on the strength of a value nobody chose.
 */
export function readTurnProgress(raw: unknown): TurnProgress {
  return raw === 'shown' || raw === 'collapsed' ? raw : DEFAULT_TURN_PROGRESS;
}

/**
 * What the rule needs to know about one turn, and deliberately no more.
 *
 * `errorCount` arrives OPTIONAL, exactly as `Decision` carries it, so the one
 * place that decides what absent means is `drawsProgressLine` itself -- a
 * caller that pre-folded it to a number would be making that decision
 * somewhere this file cannot see.
 */
export type TurnProgressFacts = {
  /** `Decision.errorCount`: absent is "this source cannot report failures". */
  readonly errorCount: number | undefined;
  /** Is this the newest turn vam read -- the only one "right now" is about? */
  readonly newest: boolean;
  /** `Session.activity`, or `null`. Drawn on the newest turn and no other. */
  readonly activity: string | null;
  /** What the session says it is blocked on, or `null`. Newest turn only. */
  readonly waitingCause: string | null;
};

/**
 * Does this turn draw its condensed progress line?
 *
 * ONE RULE, ONE PLACE. The pane reads this function and the tests read this
 * function; a second conditional in the JSX is how a mode comes to hide a line
 * the rule says it keeps.
 *
 * WHAT `collapsed` KEEPS, and why each one is not negotiable:
 *
 *  - A TURN WHOSE TOOLS FAILED. `Decision.errorCount` exists because a turn's
 *    mark was binary, so a turn whose tools blew up three times still read
 *    `✓` and the collapsed line said "12 turns read" over a run that was on
 *    fire: "collapsing intermediate work may cost the operator DETAIL; it must
 *    never cost them ALARM". A mode that folded a failing turn away would be
 *    that exact defect with a preference in front of it.
 *  - THE NEWEST TURN'S PRESENT. Activity and a waiting cause are not a
 *    finished turn's working -- they are what the session is doing right now,
 *    and `TurnBlock` only ever draws them on the newest turn. Folding them
 *    would answer "what is this session doing" with silence, which is the
 *    question vam exists for.
 *
 * WHAT IT COSTS, named rather than discovered: the mark and the label of every
 * quiet turn. That is the detail the operator asked to be rid of.
 *
 * ABSENT AND ZERO ARE THE SAME HERE, ON PURPOSE. `errorCount` absent means the
 * source cannot report tool failures and zero means vam looked and found none
 * -- two different unknowns, and the difference is real -- but NEITHER is a
 * failure, so neither may hold a line open on failure grounds. A rule that
 * branched on `undefined` would put a line on screen that says "look at this
 * turn" over a source that never looked, which is the false badge in the other
 * direction. Where the two differ is at the COLUMN, once, beside the count of
 * the window they qualify -- see `data-column-unreadable` in `DetailPanel`.
 */
export function drawsProgressLine(mode: TurnProgress, turn: TurnProgressFacts): boolean {
  if (mode === 'shown') return true;
  if ((turn.errorCount ?? 0) > 0) return true;
  return turn.newest && (turn.activity !== null || turn.waitingCause !== null);
}

/**
 * THE MODE IN FORCE, module state rather than a prop, and that is a fact about
 * where the pane is mounted rather than a preference for globals.
 *
 * `Canvas.tsx` owns the prefs state and mounts one `DetailPanel` per split
 * leaf; `PhoneShell` mounts another. `out`'s font size solved the same problem
 * by going onto the document as a custom property (`applyOutFontSize`), which
 * works because CSS is in force everywhere with nothing to re-render. This is
 * not a paint: it decides which elements EXIST, so it has to reach React --
 * hence a store with a snapshot and a subscription, the same shape
 * `errors/log.ts` hands `ErrorLogPanel` through `useSyncExternalStore`.
 */
let active: TurnProgress = DEFAULT_TURN_PROGRESS;
const listeners = new Set<() => void>();

/** The snapshot `useSyncExternalStore` compares by identity — a string, so it
 *  is stable by construction and no cache is needed. */
export function activeTurnProgress(): TurnProgress {
  return active;
}

/**
 * Put a mode in force. Called by `activatePrefs`, which every read and every
 * write goes through.
 *
 * A CHANGE, NOT EVERY WRITE. `activatePrefs` runs on every prefs write, so a
 * theme flip or a renamed project would otherwise tell every mounted column to
 * re-render for a mode that did not move.
 */
export function setActiveTurnProgress(next: TurnProgress): void {
  const mode = readTurnProgress(next);
  if (mode === active) return;
  active = mode;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  contract, and the shape `subscribeEvents` already has in this repo. */
export function subscribeTurnProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
