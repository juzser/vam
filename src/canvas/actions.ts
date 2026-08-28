/**
 * Everything `j`/`k` can land on inside the action pane, in the order it is
 * drawn.
 *
 * The list is flat and one entry per BUTTON, not per row. That is the whole
 * decision here, and it was made against two alternatives:
 *
 *  - one entry per row plus a key for each verdict (`y` grants, `n` denies).
 *    Both letters already mean something in the grammar (`yy` copies, `n` walks
 *    matches), and a modal meaning is exactly what §4 says this tool does not
 *    have.
 *  - one entry per row with `Enter` as the primary verdict. That requires the
 *    reader to know which verdict is "primary" for a decision that accepts a
 *    defect onto the permanent record. Nothing on screen could say it.
 *
 * One stop per button costs a keypress and buys an interface where the ring
 * around the thing you are about to press IS the answer to what will happen.
 * The order matches the DOM so `j` moves down the screen, never around it.
 */

import type { ApiFinding, ApiLesson } from '../adapter/api.js';
import type { Command } from '../domain/model.js';

export type CanvasAction =
  | {
      readonly kind: 'waiver';
      readonly id: string;
      /** The row this button belongs to — what `i` opens the note box on. */
      readonly rowId: string;
      readonly verdict: 'granted' | 'denied';
      readonly label: string;
    }
  | {
      readonly kind: 'lesson';
      readonly id: string;
      readonly rowId: string;
      readonly verdict: 'approve' | 'reject';
      readonly label: string;
    }
  | {
      readonly kind: 'command';
      readonly id: string;
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
 * not depend on the factory having asked anything, so a pane with an empty
 * queue and no commands still has somewhere for `I` to land.
 *
 * Within a row the conservative verdict comes first: "bắt sửa" before "bỏ qua",
 * "bỏ" before "duyệt". `j` from the row above therefore stops on the answer
 * that changes nothing, and reaching the one that accepts a defect takes one
 * more deliberate press.
 */
export function buildActions(
  waivers: readonly ApiFinding[],
  lessons: readonly ApiLesson[],
  commands: readonly Command[],
): CanvasAction[] {
  const actions: CanvasAction[] = [];

  for (const finding of waivers) {
    actions.push({
      kind: 'waiver',
      id: `waiver:${finding.fingerprint}:denied`,
      rowId: finding.fingerprint,
      verdict: 'denied',
      label: `bắt sửa ${finding.fingerprint}`,
    });
    actions.push({
      kind: 'waiver',
      id: `waiver:${finding.fingerprint}:granted`,
      rowId: finding.fingerprint,
      verdict: 'granted',
      label: `bỏ qua ${finding.fingerprint}`,
    });
  }

  for (const lesson of lessons) {
    actions.push({
      kind: 'lesson',
      id: `lesson:${lesson.lessonId}:reject`,
      rowId: lesson.lessonId,
      verdict: 'reject',
      label: `bỏ ${lesson.lessonId}`,
    });
    actions.push({
      kind: 'lesson',
      id: `lesson:${lesson.lessonId}:approve`,
      rowId: lesson.lessonId,
      verdict: 'approve',
      label: `duyệt ${lesson.lessonId}`,
    });
  }

  for (const command of commands) {
    actions.push({
      kind: 'command',
      id: `command:${command.id}`,
      rowId: command.id,
      label: command.label,
    });
  }

  actions.push({ kind: 'prompt', id: 'prompt', rowId: null, label: 'nhập prompt' });
  return actions;
}

/**
 * Keep a cursor pointing at something after the list under it changed.
 *
 * Answering a queue row removes it, and an index left dangling past the end
 * silently becomes "nothing selected" — so `Enter` would do nothing and the
 * pane would look broken rather than answered. Clamping to the last entry keeps
 * the cursor on the nearest surviving thing, which after answering the last
 * waiver is the prompt.
 */
export function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, index), length - 1);
}
