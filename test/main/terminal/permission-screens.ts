/**
 * Permission-prompt screens, INVENTED, not captured.
 *
 * `answer-live-screens.ts` beside this file was pasted out of a real
 * `AskUserQuestion` picker. These are not, and the difference is the whole
 * reason the file is separate rather than three more exports there. Driving a
 * real permission prompt means creating a Claude Code session and letting it
 * ask to run something; the task that wrote this was forbidden both, so what
 * follows is reconstructed from the shape the CLI is known to draw -- a title,
 * the command under review, a question, and a numbered list with `❯` on the
 * cursor -- with every command, path and name replaced by an invented one.
 *
 * WHAT THAT MEANS FOR A READER. A test over these proves that `readPicker` is
 * shape-generic over a numbered prompt that is NOT an `AskUserQuestion` call:
 * no header strip, no checkboxes, no `Chat about this` row, three options
 * rather than five. It does NOT prove that the bytes the CLI emits are these
 * bytes. The two variants below exist because that unknown has exactly one
 * axis that matters -- whether the rows are drawn inside a box border -- and a
 * parser that reads only one of them would be a coin toss dressed as a test.
 */

/** The plain form: rows at the left margin, the way the picker draws them. */
export const BASH_PERMISSION = [
  'Bash command',
  '',
  '  scripts/rebuild-index.sh --force',
  '  Rebuild the search index from scratch',
  '',
  'Do you want to proceed?',
  '❯ 1. Yes',
  '  2. Yes, and do not ask again for scripts/rebuild-index.sh',
  '  3. No, and tell the agent what to do differently',
  '',
].join('\n');

/** The framed form: the same prompt inside the CLI's rounded box. */
const WIDTH = 62;
const framed = (line: string): string => `│ ${line.padEnd(WIDTH)} │`;
export const BASH_PERMISSION_FRAMED = [
  `╭${'─'.repeat(WIDTH + 2)}╮`,
  ...[
    'Bash command',
    '',
    '  scripts/rebuild-index.sh --force',
    '  Rebuild the search index from scratch',
    '',
    'Do you want to proceed?',
    '❯ 1. Yes',
    '  2. Yes, and do not ask again for scripts/rebuild-index.sh',
    '  3. No, and tell the agent what to do differently',
  ].map(framed),
  `╰${'─'.repeat(WIDTH + 2)}╯`,
].join('\n');

/** A file-write prompt: a different title, the same numbered grammar. */
export const EDIT_PERMISSION = [
  'Edit file',
  '',
  'Do you want to make this edit to notes/plan.md?',
  '  1. Yes',
  '❯ 2. Yes, allow all edits during this session',
  '  3. No, and tell the agent what to do differently',
].join('\n');
