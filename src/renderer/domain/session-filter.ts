/**
 * What narrows the one set the sidebar lists, the canvas draws and the cursor
 * moves over. Pure, so the rules can be tested without a DOM.
 *
 * There is exactly one home for all of it — the sidebar's filter popover.
 */

import type { SessionStatus } from './model.js';

export type StatusFilter = 'all' | SessionStatus;

/** The popover's pill row, in the order it is drawn. `failed` is deliberately
 * absent: the mockup's row is four wide and a failed session already shows up
 * under `All` in its own colour. */
export const STATUS_FILTERS: readonly (readonly [StatusFilter, string])[] = [
  ['all', 'All'],
  ['running', 'Running'],
  ['waiting', 'Needs you'],
  ['done', 'Done'],
];
