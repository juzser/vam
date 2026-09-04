/**
 * Everything `j`/`k` can land on inside the action pane, in the order it is
 * drawn.
 *
 * The list holds one entry per thing the pane DRAWS, and that is the whole
 * decision here. It used to hold more: two stops per waivable finding and two
 * per lesson candidate, from black-smith's governance queue. The queue was
 * taken out of the pane at the operator's request and this list was not, so
 * the cursor kept walking stops with nothing on screen and `Enter` on one of
 * them filed a real governance decision the operator could not see himself
 * making. An action the pane does not render is not a quieter feature, it is
 * an invisible button.
 *
 * `test/panels/action-parity.test.tsx` holds the two lists to each other:
 * every entry here has an element on screen, in this order.
 *
 * It holds ONE entry today. The proposed commands used to contribute a stop
 * each, drawn as a strip above the composer; the operator asked for the strip
 * to go and for the same commands to be offered by the `!` typeahead inside
 * the prompt box instead. A suggestion list that exists only while it is being
 * typed into is not somewhere a pane cursor can rest, so the stops went with
 * the rows -- rather than being left behind, which is precisely how the
 * governance queue became an invisible button.
 */

export type CanvasAction = {
  readonly kind: 'prompt';
  readonly id: 'prompt';
  readonly label: string;
};

/**
 * The pane's actions, top to bottom.
 *
 * The prompt does not depend on the step having proposed anything, so `I`
 * always has somewhere to land and something to look at when it lands.
 */
export function buildActions(): CanvasAction[] {
  return [{ kind: 'prompt', id: 'prompt', label: 'write a prompt' }];
}

/**
 * Keep a cursor pointing at something after the list under it changed.
 *
 * Moving to a step with fewer commands shortens the list, and an index left
 * dangling past the end silently becomes "nothing selected" — so `Enter` would
 * do nothing and the pane would look broken rather than empty. Clamping to the
 * last entry keeps the cursor on the nearest surviving thing, which is at worst
 * the prompt.
 */
export function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, index), length - 1);
}
