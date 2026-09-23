/**
 * The model on a session's status line -- read off screens a real CLI painted.
 *
 * `model-status-screens.ts` beside this file holds the captures and says how
 * they were taken. What this file holds is the rule `readModelLine` applies to
 * them, and every way it must answer "I could not tell" instead of a name:
 * the operator is shown this string on the model button, so a wrong one is a
 * session running something other than what vam says it is.
 *
 * THE SYNTHETIC CASES ARE MARKED AS SUCH. The captures cover the shapes the
 * CLI actually paints; the constructed lines below cover the shapes it might
 * paint next -- a directory with a space in its name, a model name vam has
 * never heard of, a footer whose fields moved. A parser is a promise about
 * inputs nobody has produced yet, and those are the inputs.
 */

import { describe, expect, it } from 'vitest';
import { readModelLine } from '../../../src/main/terminal/model.js';
import {
  MODEL_MENU_OPEN,
  NARROW_TRUNCATED,
  OPUS_5_5_FRESH,
  OPUS_FRESH,
  PERMISSION_ASKING,
  PLAIN_SHELL,
  SONNET_WITH_CONTEXT,
  TRUST_PROMPT,
} from './model-status-screens.js';

/** A footer built to order, under the mode line the CLI always draws below it. */
const screenOf = (status: string): string =>
  [
    '',
    '⏺ some earlier turn',
    '',
    '─'.repeat(40),
    '❯ ',
    '─'.repeat(40),
    status,
    '  ⏵⏵ auto mode on',
  ].join('\n');

describe('a real status line names the model', () => {
  it('reads it off a fresh session, where the footer is dir, model, in and out', () => {
    expect(readModelLine(OPUS_FRESH)).toBe('Opus 5');
  });

  it('reads a version with a dot in it just as plainly — Claude Code 2.1.280, Opus 5.5', () => {
    // Real, not synthetic: `claude-opus-5-5` is the new default Opus id, and
    // this account's own footer already painted it with no `/model` typed.
    expect(readModelLine(OPUS_5_5_FRESH)).toBe('Opus 5.5');
  });

  it('reads it after a turn, where the CLI has inserted a ctx: field before in:', () => {
    // The whole reason the model is not counted from the end of the line.
    expect(readModelLine(SONNET_WITH_CONTEXT)).toBe('Sonnet 5');
  });

  it('strips the escape sequences the capture arrives with', () => {
    // `capturePaneArgv` asks for `-e`, so the fixtures carry the CSI bytes --
    // the model's own name is painted dim, `\u001b[2mSonnet 5\u001b[0m`. A
    // parser that forgot would put the escape on the button.
    //
    // `String.fromCharCode(27)` rather than the literal, which is this repo's
    // habit for the same reason `answer.ts` builds its pattern that way: a raw
    // control character in source is invisible to whoever reads it next.
    const esc = String.fromCharCode(27);
    expect(OPUS_FRESH).toContain(`${esc}[`);
    expect(readModelLine(OPUS_FRESH)).not.toContain(esc);
  });
});

describe('and every screen that does not carry one answers null', () => {
  it('a pane narrow enough that the CLI cut the line', () => {
    // 16 columns: `wd1 Sonnet …`. The name itself is cut, and a reader that
    // trusted the tokens it could see would put "Sonnet" on the button for a
    // session that could be running any Sonnet there is.
    expect(NARROW_TRUNCATED).toContain('Sonnet');
    expect(readModelLine(NARROW_TRUNCATED)).toBeNull();
  });

  it('a session asking permission, whose prompt takes the bottom of the screen', () => {
    expect(readModelLine(PERMISSION_ASKING)).toBeNull();
  });

  it('the CLI’s own /model menu, which replaces the footer while it is open', () => {
    expect(readModelLine(MODEL_MENU_OPEN)).toBeNull();
  });

  it('a session still on the trust prompt, which has not drawn a footer yet', () => {
    expect(readModelLine(TRUST_PROMPT)).toBeNull();
  });

  it('a pane running a shell and no CLI at all', () => {
    expect(readModelLine(PLAIN_SHELL)).toBeNull();
  });

  it('an empty capture', () => {
    expect(readModelLine('')).toBeNull();
  });
});

describe('the shape is checked whole, not sniffed', () => {
  it('SYNTHETIC: a directory with a space in its name still reads', () => {
    // The model is the last two tokens before the first field, so the extra
    // word lands where it belongs -- in the directory, which vam never reads.
    expect(readModelLine(screenOf('  my notes Opus 5 in:0 out:0'))).toBe('Opus 5');
  });

  it('SYNTHETIC: a model vam has never heard of reads too', () => {
    // The five aliases are a UI table, not a vocabulary this parser knows: the
    // day the CLI ships the next one, the button must name it.
    expect(readModelLine(screenOf('  wd1 Quartz 9.2 in:0 out:0'))).toBe('Quartz 9.2');
  });

  it('SYNTHETIC: a footer with no in:/out: tail is refused', () => {
    // The tail is the proof the line was not cut; without it the name may be.
    expect(readModelLine(screenOf('  wd1 Opus 5'))).toBeNull();
  });

  it('refuses a line the CLI cut inside its own tail — the 24-column capture', () => {
    // MEASURED, not invented: at 24 columns the footer reads exactly this.
    // The name happens to have survived the cut here, and it is still refused:
    // a line the CLI has trimmed is a line vam cannot prove it read whole, and
    // the cost of being wrong is a model name on a button that no session is
    // running. The label falls back to the word it always wore.
    expect(readModelLine(screenOf('  wd1 Sonnet 5 in:0 o…'))).toBeNull();
  });

  it('SYNTHETIC: a footer with no directory in front of the model is refused', () => {
    expect(readModelLine(screenOf('  Opus 5 in:0 out:0'))).toBeNull();
  });

  it('SYNTHETIC: an elided token where the version belongs is refused', () => {
    expect(readModelLine(screenOf('  wd1 Opus … in:0 out:0'))).toBeNull();
  });

  it('SYNTHETIC: an elided model name is refused even with the tail intact', () => {
    expect(readModelLine(screenOf('  wd1 Son… 5 in:0 out:0'))).toBeNull();
  });

  it('SYNTHETIC: a line that is only numbers where the model belongs is refused', () => {
    expect(readModelLine(screenOf('  wd1 42 5 in:0 out:0'))).toBeNull();
  });

  it('SYNTHETIC: the fields moving apart is refused rather than guessed at', () => {
    // in: immediately precedes out: on every real capture. If that ever stops
    // being true the footer has been redesigned, and a redesigned footer is
    // exactly the case this must not read confidently.
    expect(readModelLine(screenOf('  wd1 Opus 5 in:0 ctx:95% out:0'))).toBeNull();
  });

  it('SYNTHETIC: a transcript line shaped like a footer, high up the screen, is not read', () => {
    // This very repo prints status lines into its own transcripts. The footer
    // is the bottom of the screen and the search is bounded to it, so prose
    // that looks like one cannot be mistaken for one.
    const screen = [
      '  wd1 Haiku 4.5 in:0 out:0',
      ...Array.from({ length: 12 }, (_, i) => `⏺ line ${i}`),
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No',
      '',
    ].join('\n');
    expect(readModelLine(screen)).toBeNull();
  });

  it('SYNTHETIC: trailing blank lines do not push the footer out of the window', () => {
    expect(readModelLine(`${screenOf('  wd1 Opus 5 in:0 out:0')}\n\n\n\n`)).toBe('Opus 5');
  });
});
