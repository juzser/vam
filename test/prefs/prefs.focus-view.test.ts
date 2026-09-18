// @vitest-environment happy-dom

/**
 * FOCUS VIEW: one stored boolean, the rule it decides, and the way back.
 *
 * Operator: "drop the shown/collapsed progress setting and replace it with a
 * focus mode like the Claude Code plugin in VS Code. The default shows the
 * whole agent message." The plugin's own words for what it does:
 *
 *   "hide tool calls and other in-progress activity in the chat, showing only
 *    your prompts and Claude's responses. Folded activity stays one click
 *    away, and a live indicator names the tool currently running."
 *
 * WHAT VAM FOLDS IS THE TURN'S PROGRESS LINE AND ITS LIST OF TOOL CALLS.
 *
 * The list is new, and it is why this paragraph was rewritten rather than
 * kept. It used to say there was no list of calls in the model to hide, and
 * that was true of the MODEL and false of the DATA: the reader parsed every
 * `tool_use` part of the transcript and kept exactly one of them -- the newest
 * in the whole window -- as `Session.activity`. So the operator turned focus
 * view off, which promises the working, and got `✓ claude-code` per turn.
 * "Show the whole progress when focus view is off" is what they said about it,
 * and `Decision.steps` is what a turn carries now.
 *
 * The pairing below is unchanged by that and is the reason it is safe: the
 * calls are drawn INSIDE the progress section, so folding still folds one
 * thing, and the way back still restores one thing.
 *
 * THE PART THAT IS NEW IS THE WAY BACK. The setting this replaces withdrew the
 * line and offered nothing to bring it back, which is not a fold -- it is a
 * deletion with a preference in front of it, and it cost the operator detail
 * permanently. "Folded activity stays one click away" is the half that makes
 * the trade honest, so the pairing below is the assertion this file exists
 * for: under focus view, every turn draws EITHER its line OR a way to get it
 * back, never neither.
 */

import { describe, expect, it } from 'vitest';
import {
  activeFocusView,
  DEFAULT_FOCUS_VIEW,
  drawsProgressLine,
  drawsTurnSteps,
  drawsUnfoldControl,
  readFocusView,
  setActiveFocusView,
  subscribeFocusView,
  type TurnProgressFacts,
} from '../../src/renderer/prefs/progress.js';

/** A finished turn with nothing to report — the one focus view folds. */
const QUIET: TurnProgressFacts = {
  errorCount: 0,
  newest: false,
  activity: null,
  waitingCause: null,
  unfolded: false,
};

describe('the stored boolean', () => {
  it('is off by default, so shipping the setting hides nothing from anybody', () => {
    // The default answers two questions, not one: what a new operator sees,
    // and what happens to an operator who never opens the picker. A default of
    // ON would take a line off the screen of everybody who did not ask.
    expect(DEFAULT_FOCUS_VIEW).toBe(false);
    expect(readFocusView(undefined, undefined)).toBe(false);
  });

  it('reads a real boolean, and nothing else', () => {
    expect(readFocusView(true, undefined)).toBe(true);
    expect(readFocusView(false, undefined)).toBe(false);
    // Total, like `clampOutFontSize`: a devtools edit, an older vam, a
    // half-written payload -- none of them may decide this, and the direction
    // of the fallback matters. Falling back to ON would fold a screen on the
    // strength of a value nobody chose.
    for (const junk of ['true', 1, {}, [], null, 'collapsed']) {
      expect(readFocusView(junk, undefined), JSON.stringify(junk)).toBe(false);
    }
  });

  it('carries a stored `collapsed` across rather than dropping it', () => {
    // THE MIGRATION, AND WHY THIS FIELD EARNS ONE. `prefs.ts`'s header draws
    // the line: `dismissedSessions` needed none because no write path could
    // ever have produced it, so a key nobody wrote is a key nobody reads.
    // `turnProgress` is the opposite -- it had a settings row and a writer,
    // so an operator CAN have chosen `collapsed`, and dropping it would
    // silently un-set a preference they made.
    expect(readFocusView(undefined, 'collapsed')).toBe(true);
    expect(readFocusView(undefined, 'shown')).toBe(false);
    // And the new field wins where both exist: the old word is a fallback for
    // a payload that predates the boolean, never an override of it.
    expect(readFocusView(false, 'collapsed')).toBe(false);
    expect(readFocusView(true, 'shown')).toBe(true);
  });
});

describe('what focus view folds, and what it may never fold', () => {
  it('draws every turn’s line while focus view is off', () => {
    expect(drawsProgressLine(false, QUIET)).toBe(true);
    expect(drawsUnfoldControl(false, QUIET)).toBe(false);
  });

  it('folds a quiet, finished, older turn', () => {
    expect(drawsProgressLine(true, QUIET)).toBe(false);
  });

  it('never folds a turn whose tools failed', () => {
    // `errorCount` exists because a turn's mark was binary, so a turn whose
    // tools blew up three times still read as a tick. Folding it away would be
    // that defect with a preference in front of it: collapsing intermediate
    // work may cost the operator DETAIL, it must never cost them ALARM.
    expect(drawsProgressLine(true, { ...QUIET, errorCount: 3 })).toBe(true);
  });

  it('keeps the newest turn’s line while there is a present to report', () => {
    // The plugin keeps a live indicator naming the running tool for the same
    // reason: activity and a waiting cause are not a finished turn's working,
    // they are what the session is doing RIGHT NOW -- the question vam exists
    // to answer.
    expect(drawsProgressLine(true, { ...QUIET, newest: true, activity: 'editing' })).toBe(true);
    expect(drawsProgressLine(true, { ...QUIET, newest: true, waitingCause: 'a question' })).toBe(
      true,
    );
    // Only on the newest turn: an older turn's activity is not a present.
    expect(drawsProgressLine(true, { ...QUIET, newest: false, activity: 'editing' })).toBe(false);
  });

  it('treats "vam looked and found none" exactly like "vam cannot look"', () => {
    // Absent and zero are two different unknowns and the difference is real,
    // but NEITHER is a failure, so neither may hold a line open on failure
    // grounds. Where they differ is at the column, once, beside the count.
    expect(drawsProgressLine(true, { ...QUIET, errorCount: undefined })).toBe(false);
  });
});

describe('the working itself, which is the thing the mode is named for', () => {
  it('draws every call of every turn while focus view is off', () => {
    // The operator's sentence: "show the whole progress when focus view is
    // off". Off is the DEFAULT, so this is what an operator who never opened
    // the picker sees -- and what they saw before was the turn's mark and the
    // agent's name.
    expect(drawsTurnSteps(false, QUIET)).toBe(true);
    expect(drawsTurnSteps(false, { ...QUIET, newest: true, activity: 'editing' })).toBe(true);
  });

  it('withholds them under focus view, which is the whole of what it promises', () => {
    // "hide tool calls and other in-progress activity". A turn kept on screen
    // by a failure still keeps its line -- alarm is never folded -- but the
    // list is the itemised working the mode exists to put away.
    expect(drawsTurnSteps(true, QUIET)).toBe(false);
    expect(drawsTurnSteps(true, { ...QUIET, errorCount: 3 })).toBe(false);
    expect(drawsTurnSteps(true, { ...QUIET, newest: true, activity: 'editing' })).toBe(false);
  });

  it('gives them back to the turn the operator unfolded, and to no other', () => {
    // The control says "show this turn's working". The working is the calls:
    // a way back that restored only the mark and the label would be a control
    // that does almost nothing, which is the defect the unfold exists against.
    expect(drawsTurnSteps(true, { ...QUIET, unfolded: true })).toBe(true);
    expect(drawsTurnSteps(true, QUIET)).toBe(false);
  });

  it('never draws a call where no progress section exists to hold it', () => {
    // THE CONTAINMENT INVARIANT, swept rather than sampled: the list lives
    // inside `data-detail-block="progress"`, so steps without a line would be
    // rows in a section that is not drawn -- or, worse, a second section the
    // fold does not know about.
    const bools = [true, false];
    const counts = [undefined, 0, 1];
    const strings = [null, 'editing'];
    let checked = 0;
    const orphaned: string[] = [];
    for (const focus of bools) {
      for (const errorCount of counts) {
        for (const newest of bools) {
          for (const activity of strings) {
            for (const waitingCause of strings) {
              for (const unfolded of bools) {
                const turn = { errorCount, newest, activity, waitingCause, unfolded };
                checked += 1;
                if (drawsTurnSteps(focus, turn) && !drawsProgressLine(focus, turn)) {
                  orphaned.push(`${focus ? 'focus' : 'full'} ${JSON.stringify(turn)}`);
                }
              }
            }
          }
        }
      }
    }
    expect({ checked, orphaned }).toEqual({ checked: 96, orphaned: [] });
  });
});

describe('the way back', () => {
  it('offers one for exactly the turns it folded', () => {
    expect(drawsUnfoldControl(true, QUIET)).toBe(true);
    // Not for a turn it did not fold: two affordances for one line, one of
    // them promising to restore something already on screen.
    expect(drawsUnfoldControl(true, { ...QUIET, errorCount: 2 })).toBe(false);
    expect(drawsUnfoldControl(true, { ...QUIET, newest: true, activity: 'editing' })).toBe(false);
  });

  it('draws the line again once the operator asks for it', () => {
    const opened = { ...QUIET, unfolded: true };
    expect(drawsProgressLine(true, opened)).toBe(true);
    // And the control goes with it: it said "show this turn's working", and
    // the working is now shown.
    expect(drawsUnfoldControl(true, opened)).toBe(false);
  });

  it('never leaves a turn with neither, which is what a deletion looks like', () => {
    // THE INVARIANT THE WHOLE FEATURE RESTS ON, swept over every combination
    // of the facts the rule reads rather than over the three cases above. A
    // fold with no way back is not a fold.
    const bools = [true, false];
    const counts = [undefined, 0, 1];
    const strings = [null, 'editing'];
    let checked = 0;
    const stranded: string[] = [];
    for (const focus of bools) {
      for (const errorCount of counts) {
        for (const newest of bools) {
          for (const activity of strings) {
            for (const waitingCause of strings) {
              for (const unfolded of bools) {
                const turn = { errorCount, newest, activity, waitingCause, unfolded };
                checked += 1;
                const line = drawsProgressLine(focus, turn);
                const way = drawsUnfoldControl(focus, turn);
                // Exactly one of the two, always. Neither is a deletion; both
                // is a control that undoes nothing.
                if (line === way) {
                  stranded.push(`${focus ? 'focus' : 'full'} ${JSON.stringify(turn)}`);
                }
              }
            }
          }
        }
      }
    }
    // 2 x 3 x 2 x 2 x 2 x 2. The literal is the point: a sweep that examined
    // nothing would satisfy the emptiness check forever.
    expect({ checked, stranded }).toEqual({ checked: 96, stranded: [] });
  });
});

describe('the mode in force reaches the pane', () => {
  it('tells its readers when it changes, and only when it changes', () => {
    setActiveFocusView(DEFAULT_FOCUS_VIEW);
    let told = 0;
    const stop = subscribeFocusView(() => {
      told += 1;
    });
    setActiveFocusView(true);
    expect(activeFocusView()).toBe(true);
    // A theme flip or a renamed project runs `activatePrefs` too; a store that
    // told everyone on every write would re-render every mounted column for a
    // value that did not move.
    setActiveFocusView(true);
    expect(told).toBe(1);
    setActiveFocusView(false);
    expect(told).toBe(2);
    stop();
    setActiveFocusView(true);
    expect(told).toBe(2);
    setActiveFocusView(DEFAULT_FOCUS_VIEW);
  });
});
