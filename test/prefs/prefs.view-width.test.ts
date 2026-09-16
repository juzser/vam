// @vitest-environment happy-dom

/**
 * THE WIDTH OF A VIEW: one stored flag, two measured maxima, and the store
 * that puts the flag in force.
 *
 * WHY THE TWO MAXIMA ARE PINNED HERE AND NOT ONLY IN A COMMENT. The whole of
 * this setting's honesty is that "narrowed" means the SAME PROMISE in four
 * views -- no more than eighty characters on a line -- and that the two pixel
 * answers differ only because a proportional character and a terminal cell are
 * not the same width. A test that restated the pixel numbers as literals would
 * let that promise drift silently the day somebody re-measured one of them and
 * not the other, so every number below is DERIVED from
 * `NARROW_MAX_CHARACTERS` and the one measured advance.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setNarrowViews,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  activeNarrowViews,
  DEFAULT_NARROW_VIEWS,
  NARROW_MAX_CHARACTERS,
  NARROW_PROSE_MAX_WIDTH,
  NARROW_PROSE_TEXT_PX,
  NARROW_TERMINAL_MAX_WIDTH,
  PROSE_ADVANCE_PX,
  readNarrowViews,
  setActiveNarrowViews,
  subscribeNarrowViews,
} from '../../src/renderer/prefs/view-width.js';

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

describe('the one promise the narrowed state makes', () => {
  it('is eighty characters a line, which is a standard rather than a taste', () => {
    // WCAG 2.2 SC 1.4.8 Visual Presentation: "Width is no more than 80
    // characters or glyphs." Pinned because a changed number changes the
    // shape of four views at once, and it should cost an edit here.
    expect(NARROW_MAX_CHARACTERS).toBe(80);
  });

  it('turns that promise into prose pixels through the measured advance, not a guess', () => {
    // The advance is a MEASUREMENT of the face the app actually paints in
    // (`view-width.ts` records where it came from); the pixel maximum is that
    // measurement times the character count and nothing else.
    expect(NARROW_PROSE_TEXT_PX).toBe(Math.floor(NARROW_MAX_CHARACTERS * PROSE_ADVANCE_PX));
    expect(NARROW_PROSE_MAX_WIDTH).toContain(`${NARROW_PROSE_TEXT_PX}px`);
  });

  it('never rounds the cap UP past its own promise', () => {
    // THE INVARIANT, STATED WITHOUT NAMING A ROUNDING FUNCTION, because the
    // function is the implementation and this is the rule. 80 × 6.0079 is
    // 480.63; `Math.round` shipped 481, and Chromium measured 80.4 characters
    // on the line. A maximum rounds DOWN or it is not a maximum.
    expect(NARROW_PROSE_TEXT_PX).toBeLessThanOrEqual(NARROW_MAX_CHARACTERS * PROSE_ADVANCE_PX);
    // And not by more than a character, which is the other way to satisfy the
    // line above and be wrong.
    expect(NARROW_PROSE_TEXT_PX).toBeGreaterThan((NARROW_MAX_CHARACTERS - 1) * PROSE_ADVANCE_PX);
  });

  it('turns it into terminal columns through `ch`, which is the browser measuring for us', () => {
    // `terminal-size.ts` warns in its own header that a plausible-looking
    // width-to-height RATIO is out by a column every seventeen. `ch` is the
    // advance of `0` as the engine measures it, so in a monospace face `80ch`
    // IS eighty columns at whatever size the screen is drawn at -- and the
    // half cell is rounding slack, argued in `view-width.ts`.
    expect(NARROW_TERMINAL_MAX_WIDTH).toContain(`${NARROW_MAX_CHARACTERS + 0.5}ch`);
    // And it must NOT be the prose answer: the two views do not share a pixel
    // maximum, which is the whole reason there are two constants.
    expect(NARROW_TERMINAL_MAX_WIDTH).not.toContain(`${NARROW_PROSE_TEXT_PX}px`);
  });
});

describe('the stored flag', () => {
  it('ships off, so no upgrade re-wraps anybody’s session', () => {
    // Narrowing the terminal tells tmux fewer columns, which reflows a
    // RUNNING agent's screen. A default of on would do that to every operator
    // on the release they upgraded, for a choice none of them made.
    expect(DEFAULT_NARROW_VIEWS).toBe(false);
    expect(EMPTY_PREFS.narrowViews).toBe(DEFAULT_NARROW_VIEWS);
  });

  it('is turned on only by a literal true', () => {
    // The safe direction, the one `readEditorHighlight` argues: a value this
    // vam cannot read must not re-shape four views on the strength of a
    // choice nobody made.
    expect(readNarrowViews(true)).toBe(true);
    for (const raw of [false, 'true', 1, 0, null, undefined, {}, Number.NaN]) {
      expect(readNarrowViews(raw), JSON.stringify(raw) ?? 'undefined').toBe(DEFAULT_NARROW_VIEWS);
    }
  });

  it('round-trips through the store, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setNarrowViews(setTheme(EMPTY_PREFS, 'light'), true));
    const back = readPrefs(storage);
    expect(back.narrowViews).toBe(true);
    expect(back.theme).toBe('light');
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    const back = stored({ theme: 'light', outFontSize: 15 });
    expect(back.narrowViews).toBe(DEFAULT_NARROW_VIEWS);
    expect(back.outFontSize).toBe(15);
  });

  it('normalises on the way in as well as on the way out', () => {
    expect(setNarrowViews(EMPTY_PREFS, 'yes').narrowViews).toBe(DEFAULT_NARROW_VIEWS);
    expect(stored({ narrowViews: 'yes' }).narrowViews).toBe(DEFAULT_NARROW_VIEWS);
    expect(stored({ narrowViews: true }).narrowViews).toBe(true);
  });
});

describe('the flag in force reaches React', () => {
  it('is what the last read put there, and tells its subscribers when it moves', () => {
    setActiveNarrowViews(DEFAULT_NARROW_VIEWS);
    const heard = vi.fn();
    const stop = subscribeNarrowViews(heard);

    readPrefs(fake(JSON.stringify({ narrowViews: true })));
    expect(activeNarrowViews()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    setActiveNarrowViews(false);
    expect(activeNarrowViews()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('says nothing when a write moves some other preference', () => {
    // `activatePrefs` runs on every write, and every listener that wakes here
    // re-measures a pane and may spawn a `tmux resize-window`. Telling them
    // about a theme flip would resize the operator's sessions for a setting
    // nobody touched -- the rule `terminal-font.ts` states for the same
    // reason.
    setActiveNarrowViews(DEFAULT_NARROW_VIEWS);
    const heard = vi.fn();
    const stop = subscribeNarrowViews(heard);
    readPrefs(fake(JSON.stringify({ narrowViews: DEFAULT_NARROW_VIEWS, theme: 'light' })));
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});
