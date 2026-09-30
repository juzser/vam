/**
 * One hand-built screen per case the desktop Submit can meet, each in the shape
 * of a RECORDED screen from `answer-live-screens.ts` (`COLOUR_ASKED`,
 * `FRUIT_ASKED`, `REVIEW`) or `lesson-screens.ts` (`LESSON_ASKED`, the wrap).
 * Nothing here was captured: a screen that is not a recording says so.
 */
import { COLOUR_ASKED, COLOUR_ON, FRUIT_ASKED, RESOLVED, REVIEW } from './answer-live-screens.js';

export { RESOLVED, REVIEW };

const RULE = '─'.repeat(40);
const FOOT = 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel';

/** The screen with the cursor on `row` (1-based), for any screen built below. */
export const cursorOn = (screen: string, row: number): string =>
  screen
    .split('\n')
    .map((line) => {
      const at = /^[❯ ] (\d)\./.exec(line);
      return at === null ? line : `${Number(at[1]) === row ? '❯' : ' '}${line.slice(1)}`;
    })
    .join('\n');

/** A picker: tab strip, question rows, then `options` (each row plus its extra lines). */
const picker = (strip: string, question: readonly string[], options: readonly string[]): string =>
  [
    strip,
    '',
    ...question,
    '',
    ...options,
    `  ${options.filter((o) => /^[❯ ] \d\./.test(o)).length + 1}. Type something.`,
    RULE,
    FOOT,
  ].join('\n');

/** Case 1, single question: derived from COLOUR_ASKED (question one of one). */
export const SINGLE = COLOUR_ASKED;
export const SINGLE_Q = 'Which colour do you prefer?';

/** Case 2, step 2 of 3: FRUIT_ASKED with a third tab in the strip. */
export const STEP2_OF_3 = FRUIT_ASKED.replace(
  '☒ Colour  ☐ Fruit  ✔ Submit',
  '☒ Colour  ☐ Fruit  ☐ Size  ✔ Submit',
);
export const STEP2_Q = 'Which fruit do you prefer?';

/**
 * Case 3, a question wrapped over two rows: derived from LESSON_ASKED, where
 * the CLI folds the question at a SPACE. The row keeps its trailing space in a
 * recording, but `capture-pane` may trim it, so the space at the wrap is
 * absent here (the suspect).
 */
export const WRAPPED_Q = 'Which colour do you prefer for the header?';
export const WRAPPED = picker(
  '←  ☐ Colour  ✔ Submit  →',
  ['Which colour do you prefer for the', 'header?'],
  ['❯ 1. Crimson', '  2. Cobalt', '  3. Emerald'],
);

/** Case 3b: the recorded LESSON_ASKED shape, trailing space kept at the wrap. */
export const WRAPPED_KEPT = WRAPPED.replace('for the\n', 'for the \n');

/** Case 4, an option with a description: COLOUR_ASKED itself interleaves them. */
export const DESCRIBED = COLOUR_ASKED;

/** Case 5, an option label that wraps: label row folds onto an indented row. */
export const LONG_LABEL = 'Rewrite the whole module from scratch';
export const LABEL_WRAPPED = picker(
  '←  ☐ Plan  ✔ Submit  →',
  ['How should we proceed?'],
  ['❯ 1. Rewrite the whole module', '     from scratch', '  2. Leave it alone'],
);
export const LABEL_Q = 'How should we proceed?';

/** Case 6, multiSelect: FRUIT_ASKED's shape with the boxes a multi picker draws. */
export const MULTI_Q = 'Which fruits do you like?';
export const multi = (row: number, ticked: readonly number[]): string =>
  picker(
    '←  ☐ Fruits  ✔ Submit  →',
    [MULTI_Q],
    ['Apple', 'Banana', 'Cherry'].map(
      (label, at) =>
        `${at + 1 === row ? '❯' : ' '} ${at + 1}. [${ticked.includes(at + 1) ? '✔' : ' '}] ${label}`,
    ),
  );

/** REVIEW's shape for the multi set, naming the ticked answer. */
export const MULTI_REVIEW = REVIEW.replace('Which colour do you prefer?', MULTI_Q)
  .replace('→ Emerald', '→ Apple, Cherry')
  .replace(/ ● Which fruit do you prefer\?\n {3}→ Cherry\n/, '');

export { COLOUR_ON };

/** Question three of the set: FRUIT_ASKED's shape, its own tab lit. */
export const SIZE_Q = 'Which size do you prefer?';
export const SIZE = picker(
  '←  ☒ Colour  ☒ Fruit  ☐ Size  ✔ Submit  →',
  [SIZE_Q],
  ['❯ 1. S', '  2. M', '  3. L'],
);

/** REVIEW's shape naming each `[question, answer]` pair, cursor on Submit. */
export const review = (pairs: readonly (readonly [string, string])[]): string =>
  [
    '←  ☒ Colour  ☒ Fruit  ☒ Size  ✔ Submit  →',
    '',
    'Review your answers',
    '',
    ...pairs.flatMap(([q, a]) => [` ● ${q}`, `   → ${a}`]),
    '',
    'Ready to submit your answers?',
    '',
    '❯ 1. Submit answers',
    '  2. Cancel',
  ].join('\n');
