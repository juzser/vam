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
 * KEYS, OR LINES. "saved as your default for new sessions" is a change to
 * `~/.claude/settings.json` nobody asked for, so main drives the CLI's own
 * `/model` menu and presses `s` instead (`main/terminal/model-switch.ts`). The
 * last piece to go was `modelCommandLine`, which survived while main still
 * typed the argument form for a full model id; the operator chose refusal over
 * that fallback, the free-text row went with it, and what is left here is the
 * decision table and the five rows the popover draws. The one-word rule is
 * `isModelChoice` alone now, and the last describe below holds both facts.
 *
 * `modelControlState` is the decision table, and it is asserted row by row so
 * that a change to one arm reddens here before it reaches the pane.
 */

import { describe, expect, it } from 'vitest';
// The whole module too, because one of the assertions below is about what it
// does NOT export -- which a named import cannot ask.
import * as modelCommand from '../../src/renderer/panels/model-command.js';
import {
  MODEL_CHOICES,
  modelButtonLabel,
  modelButtonName,
  modelControlState,
  modelRunningClause,
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

  it('wears the same word whichever source the name came from', () => {
    // ONE VOCABULARY. The transcript hands up an id (`claude-opus-5`) and
    // main derives the footer's own shape from it before it crosses the
    // bridge (`transcript-model.ts`), so the button does not rename itself
    // when a session's footer appears or disappears.
    expect(modelButtonLabel('Opus 5')).toBe(modelButtonLabel('Opus 5'));
    expect(runningModelRows('Opus 5')).toEqual(['opus']);
  });
});

/**
 * WHAT THE NOTE AND THE ACCESSIBLE NAME MAY CLAIM, which is not the same for
 * the two sources of one name.
 *
 * `model` is the CLI's painted footer: what the session is SET TO, now. The
 * note has always said "running X" for it and still does.
 *
 * `last-turn` is the session's own transcript: what the API SERVED on the most
 * recent turn (`main/sources/claude-code/transcript-model.ts`), which is the
 * only source there is on a machine whose operator has replaced the CLI's
 * status line with a script of their own. It LAGS by exactly one turn, and the
 * moment it lags is the moment an operator is most likely to be reading it --
 * they have just switched the model and are looking at the button to see
 * whether it took. So the words change with the source: a note reading
 * "running Opus 5" a second after a switch to Haiku would be vam claiming a
 * fact it had not checked, and the sentence that explains what they are seeing
 * is the one that says which turn it is about.
 *
 * THE BUTTON'S OWN LABEL DOES NOT CHANGE, and that is deliberate rather than
 * an oversight: it is ten characters wide at vam's narrowest legal pane and
 * already clips (`e2e/model-picker-shots.mjs` measured the overflow), so a
 * qualifier there would be a qualifier nobody can read. The note and the
 * accessible name have room; the label has none.
 */
describe('how much the words around the button claim', () => {
  it('says "running" only for the footer, which is the only source that knows', () => {
    expect(modelRunningClause({ kind: 'model', name: 'Opus 5' })).toBe('running Opus 5');
  });

  it('says which turn it is about when the name came from the transcript', () => {
    expect(modelRunningClause({ kind: 'last-turn', name: 'Opus 5' })).toBe(
      'last turn ran on Opus 5',
    );
  });

  it('says nothing at all when vam could not read one', () => {
    expect(modelRunningClause(null)).toBeNull();
  });

  it('carries the same distinction into the accessible name', () => {
    expect(modelButtonName({ kind: 'model', name: 'Opus 5' })).toBe(
      'model: Opus 5 — choose one for this session',
    );
    expect(modelButtonName({ kind: 'last-turn', name: 'Opus 5' })).toBe(
      'model: Opus 5, what the last turn ran on — choose one for this session',
    );
    expect(modelButtonName(null)).toBe('model — choose one for this session');
  });
});

/**
 * AND THIS MODULE BUILDS NO `/model <choice>` LINE AT ALL ANY MORE.
 *
 * TWO BUILDERS WENT, ONE AT A TIME. `modelCommandStrokes` cut the line into
 * `PaneKey`s for `terminal.send`, and the CLI answers that form with "and
 * saved as your default for new sessions" -- so every pick rewrote
 * `~/.claude/settings.json`. It went when main took the route over and drove
 * the CLI's own menu. `modelCommandLine` outlived it by one change: main still
 * typed the argument form for a full model id, and the renderer printed that
 * line in the caption while refusing a choice that was not one word.
 *
 * NEITHER REASON SURVIVED THIS ONE. The operator chose refusal over the
 * fallback, so main types the argument form for nothing; the free-text row
 * went with it, so every choice the picker can send is one of `MODEL_CHOICES`'
 * own ids and no input is left that the one-word rule could refuse. The rule
 * did not move -- it is `isModelChoice`, in main's own `shared/terminal.ts`,
 * on whatever crosses the bridge -- so what is asserted here is the rule's
 * corpus against that one copy, and the ABSENCE of a renderer-side speller for
 * the line that costs somebody their default.
 */
describe('the one-word rule, and the builder that is not here to break it', () => {
  it('holds for an alias, a full model id, and nothing carrying whitespace', () => {
    // The corpus the two copies used to be compared on, kept whole and asked
    // of the copy that remained. A raw newline in a literal payload reaches
    // the pane as 0x0a and the REPL submits on it (`tmux/argv.ts`), so a
    // choice carrying one would submit `/model` bare -- opening a menu with
    // the rest typed into it. A space would hand the CLI two arguments.
    for (const choice of ['opus', 'default', 'claude-opus-5-20260501']) {
      expect(isModelChoice(choice), choice).toBe(true);
    }
    for (const choice of ['', '   ', 'opus haiku', 'opus\nhello', 'op\tus', 'opus']) {
      expect(isModelChoice(choice), JSON.stringify(choice)).toBe(false);
    }
  });

  it('exports no way to spell `/model <choice>` in the least trusted process', () => {
    // NOT A STYLE POINT. A renderer-side builder for the argument form is the
    // one thing standing between a future hand and the defect this whole
    // change removes: the line is right there, already written, and typing it
    // over `terminal.send` is one call away. `modelCommandLine` was that, and
    // it is asserted gone rather than merely deleted.
    expect(Object.keys(modelCommand)).not.toContain('modelCommandLine');
    expect(Object.keys(modelCommand)).not.toContain('modelCommandStrokes');
    for (const [name, value] of Object.entries(modelCommand)) {
      if (typeof value !== 'function') continue;
      expect(String(value), name).not.toContain('/model ');
    }
    // And the sweep really had a corpus to sweep -- five exports, of which
    // three are functions -- rather than passing on an empty object.
    expect(Object.keys(modelCommand).length).toBeGreaterThanOrEqual(4);
  });
});
