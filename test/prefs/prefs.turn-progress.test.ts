// @vitest-environment happy-dom

/**
 * HOW MUCH OF A TURN'S WORKING THE COLUMN DRAWS: one stored word, the rule it
 * decides, and everything that must survive a payload predating it.
 *
 * The operator asked for a control over concise mode -- "show the progress, or
 * collapse it, like the Claude Code plugin". The stored half is here; what the
 * pane does with it is `test/panels/DetailPanel.turn-progress.test.tsx`.
 *
 * THE RULE IS TESTED AS A FUNCTION AND AS PAINT, in that order and in two
 * files, because the two can disagree: a pure predicate that says "keep this
 * line" is worth nothing if the pane draws the line off a second conditional.
 * The pane's file reads the same function, so a disagreement is not
 * expressible -- and this file pins what the function itself promises.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setOutFontSize,
  setTheme,
  setTurnProgress,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  activeTurnProgress,
  DEFAULT_TURN_PROGRESS,
  drawsProgressLine,
  setActiveTurnProgress,
  subscribeTurnProgress,
  type TurnProgress,
} from '../../src/renderer/prefs/progress.js';

const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) this.value = value;
    },
  };
}

const stored = (payload: object) => readPrefs(fake(JSON.stringify(payload)));

/** A quiet, finished, older turn -- the one collapsing is FOR. */
const quiet = { errorCount: undefined, newest: false, activity: null, waitingCause: null } as const;

describe('the turn-progress choice round-trips', () => {
  it('defaults to shown, so merely shipping the setting hides nothing', () => {
    // The same argument `outFontSize`'s 12 was chosen on, and the stronger one
    // here: this setting can REMOVE a line an operator relies on, so an
    // operator who never opens the picker must keep the screen they have.
    expect(DEFAULT_TURN_PROGRESS).toBe('shown');
    expect(EMPTY_PREFS.turnProgress).toBe(DEFAULT_TURN_PROGRESS);
  });

  it('writes and reads back a chosen mode, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setTurnProgress(setTheme(EMPTY_PREFS, 'system'), 'collapsed'));
    const back = readPrefs(storage);
    expect(back.turnProgress).toBe('collapsed');
    expect(back.theme).toBe('system');
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    const back = stored({ theme: 'light', outFontSize: 15 });
    expect(back.turnProgress).toBe(DEFAULT_TURN_PROGRESS);
    expect(back.theme).toBe('light');
    expect(back.outFontSize).toBe(15);
  });

  it('falls back to shown for anything that is not one of the two words', () => {
    // A hand edit, a devtools write, a mode a later vam withdrew. Falling back
    // to the mode that hides nothing is the only safe direction: the other one
    // takes lines off the screen on the strength of a value nobody wrote.
    for (const raw of ['hidden', '', 0, null, {}, ['collapsed'], true]) {
      const back = stored({ turnProgress: raw, theme: 'light' });
      expect(back.turnProgress, JSON.stringify(raw)).toBe(DEFAULT_TURN_PROGRESS);
      expect(back.theme, 'one bad field costs only itself').toBe('light');
    }
    // And on the way in as well, so nothing downstream has to wonder.
    expect(setTurnProgress(EMPTY_PREFS, 'nonsense' as TurnProgress).turnProgress).toBe(
      DEFAULT_TURN_PROGRESS,
    );
  });

  it('leaves the neighbouring appearance settings alone', () => {
    const both = setOutFontSize(setTurnProgress(EMPTY_PREFS, 'collapsed'), 15);
    expect(both.turnProgress).toBe('collapsed');
    expect(both.outFontSize).toBe(15);
  });
});

describe('the chosen mode reaches the pane', () => {
  it('is in force after a read, not only after a write', () => {
    // The pane is mounted by `Canvas.tsx`, which owns the prefs state; the
    // column reads the mode off this module instead of down a prop, the way
    // `out`'s font size reaches it off the document. So the read path has to
    // arm it or a reload comes up in the wrong mode.
    readPrefs(fake(JSON.stringify({ turnProgress: 'collapsed' })));
    expect(activeTurnProgress()).toBe('collapsed');
    readPrefs(fake(JSON.stringify({ turnProgress: 'shown' })));
    expect(activeTurnProgress()).toBe('shown');
  });

  it('is in force after a write, and tells its readers', () => {
    setActiveTurnProgress('shown');
    let told = 0;
    const stop = subscribeTurnProgress(() => {
      told += 1;
    });
    writePrefs(fake(), setTurnProgress(EMPTY_PREFS, 'collapsed'));
    expect(activeTurnProgress()).toBe('collapsed');
    expect(told).toBe(1);
    // A write that changes nothing is not news: `useSyncExternalStore` calls
    // every listener it is told to, and a store that fires on every prefs
    // write would re-render the column on an unrelated theme flip.
    writePrefs(fake(), setTurnProgress(EMPTY_PREFS, 'collapsed'));
    expect(told).toBe(1);
    stop();
    setActiveTurnProgress('shown');
    expect(told).toBe(1);
  });
});

describe('what collapsing costs, and what it may never cost', () => {
  it('draws every turn’s line while progress is shown', () => {
    expect(drawsProgressLine('shown', quiet)).toBe(true);
  });

  it('withdraws the line from a quiet, finished, older turn when collapsed', () => {
    expect(drawsProgressLine('collapsed', quiet)).toBe(false);
  });

  it('never withdraws it from a turn whose tools failed', () => {
    // THE FOLD MAY COST DETAIL, NEVER ALARM (`Decision.errorCount`). This is
    // the assertion the whole setting is bounded by.
    expect(drawsProgressLine('collapsed', { ...quiet, errorCount: 1 })).toBe(true);
    expect(drawsProgressLine('collapsed', { ...quiet, errorCount: 12 })).toBe(true);
  });

  it('keeps the newest turn’s line while there is a present to report', () => {
    // Activity and a waiting cause are not a past turn's working: they are
    // what the session is doing NOW, and they are only ever drawn on the
    // newest turn. Collapsing the intermediate work of finished turns must
    // not blind the operator to the live one.
    expect(drawsProgressLine('collapsed', { ...quiet, newest: true, activity: 'coder' })).toBe(
      true,
    );
    expect(
      drawsProgressLine('collapsed', { ...quiet, newest: true, waitingCause: 'permission prompt' }),
    ).toBe(true);
    // Newest with nothing to say is still quiet.
    expect(drawsProgressLine('collapsed', { ...quiet, newest: true })).toBe(false);
    // And an OLDER turn's activity was never drawn, so it cannot be kept: the
    // rule must not resurrect a line the pane would not have drawn anyway.
    expect(drawsProgressLine('collapsed', { ...quiet, activity: 'coder' })).toBe(false);
  });

  it('treats "vam looked and found none" exactly like "vam cannot look"', () => {
    // TWO DIFFERENT UNKNOWNS MUST NEVER LOOK THE SAME -- and the way to honour
    // that here is to make neither of them look like an ALARM. `errorCount`
    // absent is "this source cannot report tool failures"; zero is a reading.
    // Neither is a failure, so neither may hold a line open in collapsed mode
    // on failure grounds, and a rule that branched on `undefined` would put a
    // line on screen that says "look here" over a source that never looked.
    // Where the two DO differ is the column's own qualifier, which is asserted
    // in the pane's file.
    expect(drawsProgressLine('collapsed', { ...quiet, errorCount: 0 })).toBe(
      drawsProgressLine('collapsed', { ...quiet, errorCount: undefined }),
    );
    expect(drawsProgressLine('collapsed', { ...quiet, errorCount: 0 })).toBe(false);
  });
});
