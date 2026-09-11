/**
 * FOCUS VIEW: how much of a turn's working the transcript column draws.
 *
 * Operator: "drop the shown/collapsed progress setting and replace it with a
 * focus mode like the Claude Code plugin in VS Code. The default shows the
 * whole agent message." The plugin describes itself in one sentence:
 *
 *   "hide tool calls and other in-progress activity in the chat, showing only
 *    your prompts and Claude's responses. Folded activity stays one click
 *    away, and a live indicator names the tool currently running."
 *
 * WHAT VAM FOLDS IS THE TURN'S PROGRESS LINE, NOT A LIST OF TOOL CALLS -- and
 * that is the faithful reading of the sentence above, not a compromise with
 * it. `Decision` carries `label`, `input`, `output`, the agent-proposed
 * `commands` (commands for a PERSON to run, not the calls the turn made) and
 * `errorCount`, a COUNT. There is no list of calls in this model to hide, so a
 * mode claiming to hide them would have to invent its rows, and an invented
 * row on the one surface that reports failure is the false badge `errorCount`
 * refuses. What vam draws for a turn's working is ONE condensed line
 * (`data-progress-line`), and that line is the whole of the working on screen:
 * fold it and the page reads as prompts and responses, which is the reading
 * the plugin's text is about. The granularity is a property of vam's model,
 * not an oversight here, and itemised tool calls are a transcript-reader
 * change that this deliberately does not build toward.
 *
 * AND THE OTHER HALF OF THE PLUGIN'S SENTENCE IS THE PART THAT IS NEW.
 * "Folded activity stays one click away." The setting this replaces withdrew
 * the line and offered nothing to bring it back -- which is not a fold, it is
 * a deletion with a preference in front of it, and it cost the operator the
 * detail permanently. `drawsUnfoldControl` below is the way back, and the two
 * predicates are written as a PAIR: under focus view every turn draws either
 * its line or a way to get it back, never neither. `prefs.focus-view.test.ts`
 * sweeps all 96 combinations of the facts the rule reads and asserts exactly
 * that.
 *
 * THE BOUND ON FOLDING IS `drawsProgressLine`, and it is the whole safety
 * argument of this file. Read it before changing anything here.
 */

/**
 * Off, and the default is load-bearing rather than a taste.
 *
 * Every other appearance default answers "what should a new operator see".
 * This one also answers "what happens to an operator who never opens the
 * picker", and this setting can REMOVE a line from a screen they read. A
 * default that hid it would ship a change nobody asked for to everybody who
 * did not ask; a default that hides nothing cannot. The plugin ships its own
 * checkbox unticked for the same reason.
 */
export const DEFAULT_FOCUS_VIEW = false;

/** The word the retired `turnProgress` field held for the folded mode. Named
 *  once, here, so the migration below and any later reader agree. */
const LEGACY_COLLAPSED = 'collapsed';

/**
 * A stored boolean, or the mode that hides nothing.
 *
 * TOTAL, like `clampOutFontSize`: a devtools edit, an older vam, a
 * half-written payload -- none of them may decide this, and the direction of
 * the fallback matters. Falling back to ON would fold a screen on the strength
 * of a value nobody chose.
 *
 * AND IT CARRIES THE OLD FIELD ACROSS, which this one earns and
 * `dismissedSessions` did not. `prefs.ts`'s header draws that line: a field no
 * write path could ever have produced needs no migration, because a key nobody
 * wrote is a key nobody reads. `turnProgress` had a settings row AND a writer,
 * so an operator can have chosen `collapsed` -- dropping it would silently
 * un-set a preference somebody made. The legacy word is a FALLBACK for a
 * payload that predates the boolean, never an override of it: where both
 * exist, the boolean is the one the operator set last.
 */
export function readFocusView(raw: unknown, legacy: unknown): boolean {
  if (typeof raw === 'boolean') {
    return raw;
  }
  return legacy === LEGACY_COLLAPSED ? true : DEFAULT_FOCUS_VIEW;
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
  /**
   * Has the operator pressed this turn's way back?
   *
   * A READING GESTURE, NOT A PREFERENCE, which is why it arrives as a fact
   * about the turn rather than as a second stored field. It says "show me this
   * one", about one turn, for as long as the column is on screen -- and a
   * store that persisted it would answer a question nobody asked twice, then
   * accumulate a list of turn ids for sessions that have since been pruned.
   */
  readonly unfolded: boolean;
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
export function drawsProgressLine(focusView: boolean, turn: TurnProgressFacts): boolean {
  if (!focusView) return true;
  if (turn.unfolded) return true;
  if ((turn.errorCount ?? 0) > 0) return true;
  return turn.newest && (turn.activity !== null || turn.waitingCause !== null);
}

/**
 * Does this turn draw a way back to the working focus view took?
 *
 * THE OTHER HALF OF ONE DECISION, and it is defined as the complement rather
 * than re-derived so it cannot drift: exactly the turns whose line focus view
 * folded, and no others. Two conditionals written independently is how a fold
 * comes to have no way back on the one case nobody thought about -- and a fold
 * with no way back is a deletion.
 *
 * IT IS NOT DRAWN WHEN THE LINE IS. A control offering to restore something
 * already on screen is a control that does nothing, which is the same defect
 * as one that cannot act. Nor when focus view is off: there is nothing folded
 * to restore.
 */
export function drawsUnfoldControl(focusView: boolean, turn: TurnProgressFacts): boolean {
  return focusView && !drawsProgressLine(focusView, turn);
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
let active: boolean = DEFAULT_FOCUS_VIEW;
const listeners = new Set<() => void>();

/** The snapshot `useSyncExternalStore` compares by identity — a boolean, so it
 *  is stable by construction and no cache is needed. */
export function activeFocusView(): boolean {
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
export function setActiveFocusView(next: boolean): void {
  const mode = readFocusView(next, undefined);
  if (mode === active) return;
  active = mode;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  contract, and the shape `subscribeEvents` already has in this repo. */
export function subscribeFocusView(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
