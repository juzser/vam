import { describe, expect, it } from 'vitest';
import { readPrompt } from '../../../src/main/terminal/answer.js';
import { BASH_PERMISSION, BASH_PERMISSION_FRAMED, EDIT_PERMISSION } from './permission-screens.js';

/**
 * READING A PROMPT IS READING A PICKER PLUS ITS TITLE, and the title is the
 * part that is not decoration. `answerQuestion` re-identifies the screen by
 * `String.includes` on the step's question text before it matches a single
 * label (`answer.ts:see`), so a prompt vam cannot NAME is a prompt vam must
 * not answer: without the title there is nothing to check the screen against
 * between the arrow presses, and a Return would land wherever the CLI had
 * moved to.
 *
 * The screens are the invented ones from `permission-screens.ts`; their
 * provenance is stated there in full and is not restated here.
 */
describe('readPrompt', () => {
  it('names the prompt by the line that asks, not by the box title', () => {
    // `Bash command` is the frame's own heading and sits four lines further
    // up. The question is the line directly above the rows, which is also the
    // only line on the screen that `see` could check a picker against.
    expect(readPrompt(BASH_PERMISSION)).toEqual({
      title: 'Do you want to proceed?',
      options: [
        'Yes',
        'Yes, and do not ask again for scripts/rebuild-index.sh',
        'No, and tell the agent what to do differently',
      ],
    });
  });

  it('crosses the box border, as the row pattern already does', () => {
    // The border is why a framed prompt read as no picker at all before
    // #210. A title trapped behind the same border glyph would reintroduce
    // exactly that bug one line higher up.
    expect(readPrompt(BASH_PERMISSION_FRAMED)?.title).toBe('Do you want to proceed?');
  });

  it('reads a prompt whose cursor is not on the first row', () => {
    expect(readPrompt(EDIT_PERMISSION)).toEqual({
      title: 'Do you want to make this edit to notes/plan.md?',
      options: [
        'Yes',
        'Yes, allow all edits during this session',
        'No, and tell the agent what to do differently',
      ],
    });
  });

  it('is null for a screen with no picker on it', () => {
    expect(readPrompt('a session that is simply working\nand printing as it goes\n')).toBeNull();
  });

  it('refuses a picker nothing above it names', () => {
    // Rows with no line above them at all. There is no needle for `see`, so
    // there is no safe answer -- and `null` is the refusal, not an empty
    // title that would make every screen match.
    expect(readPrompt('❯ 1. Yes\n  2. No\n')).toBeNull();
  });

  it('reads through the SGR sequences capture-pane is asked for', () => {
    // `capturePaneArgv` passes `-e`, so the screen arrives with its colours
    // in it. A label carrying an escape sequence would be drawn to the
    // operator as garbage and would never equal the label sent back.
    const esc = String.fromCharCode(27);
    const coloured = [
      `${esc}[1mDo you want to proceed?${esc}[0m`,
      `${esc}[7m❯ 1. Yes${esc}[0m`,
      '  2. No',
      '',
    ].join('\n');
    expect(readPrompt(coloured)).toEqual({
      title: 'Do you want to proceed?',
      options: ['Yes', 'No'],
    });
  });
});
