/**
 * Every CSI sequence, so a captured screen can be read as text.
 *
 * `capturePaneArgv` asks for `-e`, which is what makes the Terminal tab
 * COLOURED -- and it means every capture arrives with escape sequences in it.
 * A row drawn as the picker's cursor is exactly the row the CLI inverts, so
 * the label a parser lifts off it carries the sequence unless something takes
 * it off: the operator would be shown the bytes, and `text.includes(label)` on
 * the review screen would compare a coloured label against a differently
 * coloured line. The status line is the same story with a different victim --
 * the model's name is painted dim, so `Sonnet 5` arrives as
 * `[2mSonnet 5[0m` and a button would wear the escape.
 *
 * ONE MODULE RATHER THAN ONE COPY PER PARSER, which is why this moved out of
 * `answer.ts`. There are two readers of these screens now (`answer.ts` for the
 * picker, `model.ts` for the status line) and a second regular expression for
 * the same bytes is a second opinion about what an escape sequence is: the day
 * one of them learns about a sequence the other has not met, a screen reads
 * one way for the question card and another way for the model label.
 */

const CSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:?]*[ -/]*[@-~]`, 'g');

export const plain = (text: string): string => text.replace(CSI, '');
