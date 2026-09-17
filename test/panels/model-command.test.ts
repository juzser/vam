/**
 * THE MODEL CONTROL'S THREE STATES, AND THE KEYS THE ENABLED ONE SENDS.
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
 * chosen, by typing that line; a session vam cannot type into cannot; and a
 * source that only records keeps the request-in-words it always had.
 *
 * `modelControlState` is the decision table, and it is asserted row by row so
 * that a change to one arm reddens here before it reaches the pane.
 */

import { describe, expect, it } from 'vitest';
import {
  MODEL_CHOICES,
  modelCommandLine,
  modelCommandStrokes,
  modelControlState,
} from '../../src/renderer/panels/model-command.js';
import { isPaneKey, MAX_KEY_TEXT, type PaneKey } from '../../src/shared/terminal.js';

const texts = (strokes: readonly PaneKey[]): string[] =>
  strokes.map((stroke) => (stroke.kind === 'text' ? stroke.text : `<${stroke.kind}>`));

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
});

describe('what one choice becomes on the wire', () => {
  it('is the CLI’s argument form, `/model <alias>`, never the bare command that opens a menu', () => {
    // A bare `/model` opens an interactive picker in the REPL; vam must never
    // drive that menu (it cannot read it back), so the argument form is the
    // only line this ever produces.
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
    // `/model` bare -- the menu -- and type the rest into the answer. A space
    // would hand the CLI two arguments. Both are refused before any key is
    // built, with `null` and never a shorter line.
    expect(modelCommandLine('')).toBeNull();
    expect(modelCommandLine('   ')).toBeNull();
    expect(modelCommandLine('opus\nhello')).toBeNull();
    expect(modelCommandLine('opus haiku')).toBeNull();
    expect(modelCommandLine('op\tus')).toBeNull();
    expect(modelCommandLine(`op${String.fromCharCode(27)}us`)).toBeNull();
    expect(modelCommandStrokes('')).toBeNull();
    expect(modelCommandStrokes('a b')).toBeNull();
  });

  it('is typed as literal text and then a SEPARATE Enter, every stroke one the channel accepts', () => {
    const strokes = modelCommandStrokes('opus');
    expect(strokes).not.toBeNull();
    expect(texts(strokes ?? [])).toEqual(['/model opus', '<enter>']);
    for (const stroke of strokes ?? []) expect(isPaneKey(stroke)).toBe(true);
  });

  it('splits a long model id at the channel’s bound rather than sending one refused key', () => {
    // `/model ` plus a full id runs past `MAX_KEY_TEXT` (sixteen). Handed over
    // whole it fails `isPaneKey` in main, which answers `unaimed` -- a sentence
    // about session PAIRING that would be false. `composedStrokes` exists for
    // exactly this and is what splits it, so the pieces rejoin into the line
    // and each one is within the bound.
    const strokes = modelCommandStrokes('claude-opus-5-20260501') ?? [];
    const pieces = strokes.filter((s) => s.kind === 'text');
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.kind === 'text' && piece.text.length <= MAX_KEY_TEXT).toBe(true);
      expect(isPaneKey(piece)).toBe(true);
    }
    expect(texts(strokes).slice(0, -1).join('')).toBe('/model claude-opus-5-20260501');
    expect(strokes.at(-1)).toEqual({ kind: 'enter' });
  });

  it('ends with exactly one Enter, and nothing after it', () => {
    // The submit is the last stroke so that a run failing midway leaves the
    // line sitting in the pane UNSENT rather than half-submitted -- the same
    // rule `reply.ts` keeps for a prompt.
    const strokes = modelCommandStrokes('haiku') ?? [];
    expect(strokes.filter((s) => s.kind === 'enter')).toHaveLength(1);
    expect(strokes.at(-1)?.kind).toBe('enter');
  });
});
