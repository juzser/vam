/**
 * THE MODEL CONTROL'S THREE STATES, AND WHAT THE ENABLED ONE IS ALLOWED TO ASK
 * FOR.
 *
 * The operator's ask, translated: "re-check the model picker in the prompt
 * input. Confirm whether choosing a model in vam is possible or not. If a
 * model cannot be chosen in some session, the model button should be disabled
 * for that session."
 *
 * WHAT WAS TRUE AND STOPPED BEING TRUE. The free-text field wrote `model: x`
 * onto the draft's first line, and its note said so: "vam cannot switch models
 * -- the factory chooses". Honest for the RECORDING source, where the prompt
 * is filed and the factory picks the model. Since PR 383 a Claude Code prompt is
 * TYPED into the session's tmux pane (`reply.ts`), so that line lands in the
 * CLI's prompt as words the agent reads -- and it switches nothing. Measured
 * on Claude Code 2.1.274: `/model sonnet` + Enter at the REPL answers "Set
 * model to Sonnet 5 and saved as your default for new sessions" and the status
 * line changes at once. So a session vam can type into CAN have its model
 * chosen; a session vam cannot type into cannot; and a source that only
 * records keeps the request-in-words it always had.
 *
 * AND THE SECOND HALF OF THAT ANSWER LINE IS WHY THIS MODULE NO LONGER BUILDS
 * KEYS. "saved as your default for new sessions" is a change to
 * `~/.claude/settings.json` nobody asked for, so main drives the CLI's own
 * `/model` menu and presses `s` instead (`main/terminal/model-switch.ts`).
 * What is left here is the decision table, the five rows the popover draws,
 * and the one-word rule.
 *
 * `modelControlState` is the decision table, and it is asserted row by row so
 * that a change to one arm reddens here before it reaches the pane.
 */

import { describe, expect, it } from 'vitest';
import {
  MODEL_CHOICES,
  modelButtonLabel,
  modelCommandLine,
  modelControlState,
  runningModelRows,
} from '../../src/renderer/panels/model-command.js';
import { isModelChoice } from '../../src/shared/terminal.js';

describe('which of the three controls a session gets', () => {
  it('keeps the request line for a source that only records, whatever the session says', () => {
    // The factory: no `deliverPrompt` at all, so nothing vam types reaches an
    // agent and the words in the prompt are the honest request. Neither the
    // terminal fact nor ownership changes that -- there is no pane to type
    // `/model` into on this source, so the row is decided before they are read.
    for (const terminal of [true, false, undefined]) {
      for (const vamControlled of [true, false, undefined]) {
        expect(modelControlState({ delivers: false, terminal, vamControlled })).toBe('request');
        expect(modelControlState({ delivers: undefined, terminal, vamControlled })).toBe('request');
      }
    }
  });

  it('offers the picker only where a key can really be pressed: delivers, a pane, and vam’s own', () => {
    // The same two facts `canCycleMode` reads, and for the same reason: vam
    // can press a key only in a pane it started, and only where the source
    // says there is a pane surface at all. Absent `terminal` reads as "nobody
    // withdrew it", exactly as the Terminal tab reads its own absence.
    expect(modelControlState({ delivers: true, terminal: true, vamControlled: true })).toBe(
      'picker',
    );
    expect(modelControlState({ delivers: true, terminal: undefined, vamControlled: true })).toBe(
      'picker',
    );
  });

  it('disables, rather than hides, where the source delivers but this session cannot be typed into', () => {
    // A session vam did not start (the operator's own `claude`), or a source
    // that delivers prompts but has withdrawn its terminal. The operator asked
    // for DISABLED here, not absent: a row with no button at all says "there
    // is no such thing as a model here", which is false -- there is one, and
    // vam has no keyboard into the session to change it.
    expect(modelControlState({ delivers: true, terminal: true, vamControlled: false })).toBe(
      'disabled',
    );
    expect(modelControlState({ delivers: true, terminal: true, vamControlled: undefined })).toBe(
      'disabled',
    );
    expect(modelControlState({ delivers: true, terminal: false, vamControlled: true })).toBe(
      'disabled',
    );
  });
});

describe('the five choices are the CLI’s own aliases', () => {
  it('names exactly Default · Sonnet · Fable · Opus · Haiku, in the menu’s own order', () => {
    // Measured on Claude Code 2.1.274: a bare `/model` opens a menu of these
    // five, and `claude --help` says `--model` takes "an alias for the latest
    // model (e.g. 'fable', 'opus', or 'sonnet')". The ids are what is typed;
    // the labels are what the CLI's own menu prints.
    expect(MODEL_CHOICES.map((choice) => choice.id)).toEqual([
      'default',
      'sonnet',
      'fable',
      'opus',
      'haiku',
    ]);
    expect(MODEL_CHOICES.map((choice) => choice.label)).toEqual([
      'Default',
      'Sonnet',
      'Fable',
      'Opus',
      'Haiku',
    ]);
  });

  it('carries each alias’s VERSION, in the values the CLI’s own menu printed', () => {
    // Operator: "in the model picker, put the version on the right as well".
    //
    // RE-MEASURED RATHER THAN RECALLED, and the measurement contradicted the
    // request's own example ("Opus has version 5.1"). Captured from Claude
    // Code 2.1.276 on 2026-09-18 -- `claude` in an empty directory over a
    // private tmux socket, a bare `/model`, `capture-pane -p`:
    //
    //     ❯ 1. Default (recommended) ✔  Sonnet 5 · Efficient for routine tasks
    //       2. Sonnet                   Sonnet 5 · Efficient for routine tasks
    //       3. Fable                    Fable 5.1 · Most capable for your ...
    //       4. Opus                     Opus 5 · Best for everyday, complex ...
    //       5. Haiku                    Haiku 4.5 · Fastest for quick answers
    //
    // So FABLE is 5.1 and OPUS is 5, which is the way round the request had
    // them reversed. A literal list because the CLI is the only authority for
    // these and nothing in vam can derive them.
    expect(MODEL_CHOICES.map((choice) => choice.version)).toEqual([
      // `Default` has no version OF ITS OWN -- it is whichever model the CLI
      // currently recommends -- so it carries that model's name and number,
      // exactly as the CLI's own right-hand column does. "Default 5" would be
      // a version of a thing that has none.
      'Sonnet 5',
      '5',
      '5.1',
      '5',
      '4.5',
    ]);
  });
});

describe('which rows the session’s own model marks', () => {
  // The operator's ask, translated: "the model switcher button's label also
  // needs to show the model that is currently selected, and there should be a
  // tick icon on the currently selected model in the popover."
  //
  // The fact behind both halves is `SessionModel`, read off the CLI's status
  // line in the session's pane (`main/terminal/model.ts`). What follows is the
  // one rule that turns that string into ticks -- including the pair the
  // status line cannot tell apart, which was MEASURED rather than assumed:
  // `/model default` and `/model sonnet` both leave `wd1 Sonnet 5 in:0 out:0`
  // on screen, while the CLI's own menu ticks whichever was chosen.

  it('marks the one row whose model the CLI is naming', () => {
    expect(runningModelRows('Opus 5')).toEqual(['opus']);
    expect(runningModelRows('Fable 5.1')).toEqual(['fable']);
    expect(runningModelRows('Haiku 4.5')).toEqual(['haiku']);
  });

  it('marks BOTH Default and Sonnet when the CLI says Sonnet 5, because it cannot say which', () => {
    // Default IS Sonnet 5 today -- the CLI's own right-hand column says so --
    // so both rows' model is what this session is running, and both marks are
    // true. Which ALIAS was selected is the part the status line does not
    // carry, and vam does not claim it: the surface marks both rather than
    // picking one and being wrong half the time.
    expect(runningModelRows('Sonnet 5')).toEqual(['default', 'sonnet']);
  });

  it('marks nothing at all when vam could not read the line', () => {
    // The common case: a session with a question open is not painting its
    // status line at all.
    expect(runningModelRows(null)).toEqual([]);
  });

  it('marks nothing for a model none of the five is', () => {
    // MEASURED: a session switched to a full model id
    // (`/model claude-sonnet-4-5-20250929`) reads `Sonnet 4.5` on the footer.
    // Ticking the `Sonnet` row there would be a lie the operator could act on
    // -- that row is Sonnet 5, and picking it would CHANGE the model.
    expect(runningModelRows('Sonnet 4.5')).toEqual([]);
    expect(runningModelRows('Quartz 9')).toEqual([]);
    expect(runningModelRows('')).toEqual([]);
    // And the version drift `MODEL_CHOICES` documents: the day the CLI ships
    // the next Opus the footer says `Opus 6`, and no row matches until someone
    // re-captures the five. No tick beats a tick on the wrong number.
    expect(runningModelRows('Opus 6')).toEqual([]);
  });

  it('is not fooled by a name that is merely a prefix of a row’s', () => {
    expect(runningModelRows('Opus')).toEqual([]);
    expect(runningModelRows('Opus 5.1')).toEqual([]);
    expect(runningModelRows('Sonnet 51')).toEqual([]);
  });
});

describe('what the button says', () => {
  it('names the model the session is running', () => {
    expect(modelButtonLabel('Opus 5')).toBe('Opus 5');
    // Not one of the five, and still named: the button reports the pane, it
    // does not pick from vam's list.
    expect(modelButtonLabel('Sonnet 4.5')).toBe('Sonnet 4.5');
  });

  it('falls back to the word it always wore when vam could not read one', () => {
    // NOT a remembered choice and not a guess: "model" is what the control
    // said before it could read anything, and it is what an operator who
    // cannot be told the truth is shown.
    expect(modelButtonLabel(null)).toBe('model');
  });
});

/**
 * THE LINE THIS MODULE STILL OWNS IS THE ONE THE CAPTION PRINTS, and it used
 * to be the one vam typed. A `modelCommandStrokes` stood beside it, cutting
 * `/model <choice>` into `PaneKey`s for `terminal.send` -- and the CLI answers
 * that form with "and saved as your default for new sessions", so every pick
 * rewrote `~/.claude/settings.json`. It is gone; main drives the CLI's own
 * menu, and types this line itself only for the one choice that has no menu
 * row. What reaches the wire is asserted where it happens, in
 * `test/main/terminal/model-switch.test.ts`.
 */
describe('what one choice becomes in the caption, and what is refused outright', () => {
  it('is the CLI’s argument form, `/model <alias>`', () => {
    expect(modelCommandLine('opus')).toBe('/model opus');
    expect(modelCommandLine('default')).toBe('/model default');
    expect(modelCommandLine('  sonnet  ')).toBe('/model sonnet');
  });

  it('takes a full model id too, so the free-text row can name what the aliases cannot', () => {
    expect(modelCommandLine('claude-opus-5')).toBe('/model claude-opus-5');
  });

  it('refuses an empty choice, and any choice with whitespace or a control character in it', () => {
    // A raw newline in a literal payload reaches the pane as 0x0a and the REPL
    // submits on it (`tmux/argv.ts`), so a choice carrying one would submit
    // `/model` bare -- opening a menu with the rest typed into it. A space
    // would hand the CLI two arguments. Both are refused before the bridge is
    // touched, with `null` and never a shorter line.
    expect(modelCommandLine('')).toBeNull();
    expect(modelCommandLine('   ')).toBeNull();
    expect(modelCommandLine('opus\nhello')).toBeNull();
    expect(modelCommandLine('opus haiku')).toBeNull();
    expect(modelCommandLine('op\tus')).toBeNull();
    expect(modelCommandLine(`op${String.fromCharCode(27)}us`)).toBeNull();
  });

  it('agrees with the rule MAIN enforces, so neither side can drift alone', () => {
    // TWO COPIES, ONE RULE. The renderer's exists to WORD the refusal before
    // the bridge is touched; main's is the enforcement, because the renderer
    // is the least trusted process in the app. A choice one of them takes and
    // the other refuses would be a control that reports a pairing problem for
    // a line it built itself.
    const cases = [
      'opus',
      'default',
      'claude-opus-5-20260501',
      '',
      '   ',
      'opus haiku',
      'opus\nhello',
      'op\tus',
      `op${String.fromCharCode(27)}us`,
    ];
    for (const choice of cases) {
      expect(isModelChoice(choice.trim()), choice).toBe(modelCommandLine(choice) !== null);
    }
  });
});
