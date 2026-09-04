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
 */

import type { Command } from '../domain/model.js';

export type CanvasAction =
  | {
      readonly kind: 'command';
      readonly id: string;
      /** The row this entry belongs to — what `i` puts the keyboard on. */
      readonly rowId: string;
      readonly label: string;
    }
  | {
      readonly kind: 'prompt';
      readonly id: 'prompt';
      readonly rowId: null;
      readonly label: string;
    };

/**
 * The pane's actions, top to bottom.
 *
 * The prompt is always last and always present — it is the one action that does
 * not depend on the step having proposed anything, so a pane with no commands
 * still has somewhere for `I` to land.
 */
export function buildActions(commands: readonly Command[]): CanvasAction[] {
  const actions: CanvasAction[] = [];

  for (const command of commands) {
    actions.push({
      kind: 'command',
      id: `command:${command.id}`,
      rowId: command.id,
      label: command.label,
    });
  }

  actions.push({ kind: 'prompt', id: 'prompt', rowId: null, label: 'write a prompt' });
  return actions;
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
