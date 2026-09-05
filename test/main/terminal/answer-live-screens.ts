/**
 * Screens captured from a REAL `AskUserQuestion` picker, pasted in unaltered.
 *
 * Throwaway Claude Code session (v2.1.261) in a scratch directory on a private
 * tmux socket, created, driven and killed inside the task that added this file;
 * the operator's own session was never named or sent a key. The prompt asked
 * for ONE `AskUserQuestion` call carrying TWO questions, and for `Cobalt` to be
 * an option in both -- which is the fixture that separates a loop that
 * confirms which question it is looking at from one that got lucky.
 *
 * WHAT THESE PROVE, and none of it was guessed:
 *
 *  - a real picker INTERLEAVES description lines between its rows, so a parser
 *    that walks contiguous lines out from the cursor sees a one-row picker,
 *  - the CLI names the question in a TAB STRIP (`☐` unanswered, `☒` answered,
 *    `✔ Submit` last) and prints the question TEXT above the options,
 *  - Enter on a single-select row ANSWERS AND ADVANCES: the strip flips to
 *    `☒`, the text changes to the next question, and the cursor resets to row
 *    one,
 *  - after the LAST question the CLI shows its own review naming every
 *    question and answer, with `Submit answers` under the cursor.
 *
 * The separator lines are shortened to keep the file narrow; nothing else is
 * touched. There is no path, id or name from the machine in any of them.
 */

const RULE = '─'.repeat(40);

/** Question one of two, cursor on row one, as first drawn. */
export const COLOUR_ASKED = [
  `←  ☐ Colour  ☐ Fruit  ✔ Submit  →`,
  '',
  'Which colour do you prefer?',
  '',
  '❯ 1. Crimson',
  '     A deep, rich red.',
  '  2. Cobalt',
  '     A strong, vivid blue.',
  '  3. Emerald',
  '     A bright, jewel-toned green.',
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
].join('\n');

/** The same screen after one Down, and after a second. */
export const COLOUR_ON = (row: number): string =>
  COLOUR_ASKED.split('\n')
    .map((line) => {
      const at = /^[❯ ] (\d)\./.exec(line);
      if (at === null) return line;
      return `${Number(at[1]) === row ? '❯' : ' '}${line.slice(1)}`;
    })
    .join('\n');

/** Question two, drawn by the CLI itself after question one was answered. */
export const FRUIT_ASKED = [
  `←  ☒ Colour  ☐ Fruit  ✔ Submit  →`,
  '',
  'Which fruit do you prefer?',
  '',
  '❯ 1. Apple',
  '     Crisp and classic.',
  '  2. Cobalt',
  '     Listed as requested, though it is not actually a fruit.',
  '  3. Cherry',
  '     Small, sweet and tart.',
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
].join('\n');

export const FRUIT_ON = (row: number): string =>
  FRUIT_ASKED.split('\n')
    .map((line) => {
      const at = /^[❯ ] (\d)\./.exec(line);
      if (at === null) return line;
      return `${Number(at[1]) === row ? '❯' : ' '}${line.slice(1)}`;
    })
    .join('\n');

/** The CLI's own review of the whole set, after the last question. */
export const REVIEW = [
  `←  ☒ Colour  ☒ Fruit  ✔ Submit  →`,
  '',
  'Review your answers',
  '',
  ' ● Which colour do you prefer?',
  '   → Emerald',
  ' ● Which fruit do you prefer?',
  '   → Cherry',
  '',
  'Ready to submit your answers?',
  '',
  '❯ 1. Submit answers',
  '  2. Cancel',
].join('\n');

/** And the screen once the set is committed: no picker at all. */
export const RESOLVED = [
  '⏺ User answered Claude questions:',
  '  ⎿  · Which colour do you prefer? → Emerald',
  '     · Which fruit do you prefer? → Cherry',
  '',
].join('\n');
