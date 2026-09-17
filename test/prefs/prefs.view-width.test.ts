// @vitest-environment happy-dom

/**
 * THE WIDTH OF A VIEW: one stored flag, two measured maxima, and the store
 * that puts the flag in force.
 *
 * NOT ONE PIXEL NUMBER IS PINNED HERE, AND THAT IS THE POINT. The first cut of
 * this file pinned `480`, derived from an advance measured once on macOS, and
 * the first Linux CI run put 83.95 characters on the line it produced. Both
 * maxima are measurements now -- the prose one off a ruler in the real face
 * (`narrowProseMaxWidth`), the terminal one off `ch` -- so what is asserted
 * below is the ARITHMETIC and the DIRECTION, never a platform's answer.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PREFS,
  OUT_FONT_SIZE_VAR,
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
  NARROW_TERMINAL_MAX_WIDTH,
  narrowProseMaxWidth,
  PROSE_RULER_CLASS,
  PROSE_RULER_TEXT,
  readNarrowViews,
  setActiveNarrowViews,
  subscribeNarrowViews,
} from '../../src/renderer/prefs/view-width.js';

const KEY = 'vam.prefs.v1';
const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

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

  it('turns that promise into prose pixels from a MEASURED advance, whatever it is', () => {
    // Swept rather than sampled: the advance is whatever the operator's
    // platform reports, so every plausible one has to come out right. 5.7180
    // is the Linux CI figure that broke the frozen constant; 6.0079 is this
    // macOS machine's.
    for (const advance of [3, 4.7089, 5.718, 5.893, 6.0079, 8.4402, 11.5]) {
      expect(narrowProseMaxWidth(advance), `${advance}`).toBe(
        `calc(${Math.floor(NARROW_MAX_CHARACTERS * advance)}px + 1.75rem)`,
      );
    }
  });

  it('never rounds the cap UP past its own promise', () => {
    // THE INVARIANT, STATED WITHOUT NAMING A ROUNDING FUNCTION, because the
    // function is the implementation and this is the rule. 80 × 6.0079 is
    // 480.63; `Math.round` shipped 481, and Chromium measured 80.4 characters
    // on the line. A maximum rounds DOWN or it is not a maximum.
    for (const advance of [4.7089, 5.718, 5.893, 6.0079, 8.4402]) {
      const px = Number(/calc\((\d+)px/.exec(narrowProseMaxWidth(advance) ?? '')?.[1]);
      expect(px, `${advance}`).toBeLessThanOrEqual(NARROW_MAX_CHARACTERS * advance);
      // And not short by a whole character, which is the other way to satisfy
      // the line above and be wrong.
      expect(px, `${advance}`).toBeGreaterThan((NARROW_MAX_CHARACTERS - 1) * advance);
    }
  });

  it('caps nothing at all until something has actually been measured', () => {
    // `fitPane`'s rule, in this file's terms: a ruler that has not been laid
    // out reports a zero box, and a zero advance would produce a 28px column
    // of nothing but padding. happy-dom reports exactly those zeros, and so
    // does every real browser for one frame.
    for (const nothing of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(narrowProseMaxWidth(nothing as number | null), String(nothing)).toBeUndefined();
    }
  });

  it('turns it into terminal columns through `ch`, which is the browser measuring for us', () => {
    // `terminal-size.ts` warns in its own header that a plausible-looking
    // width-to-height RATIO is out by a column every seventeen. `ch` is the
    // advance of `0` as the engine measures it, so in a monospace face `80ch`
    // IS eighty columns at whatever size the screen is drawn at -- and the
    // half cell is rounding slack, argued in `view-width.ts`.
    expect(NARROW_TERMINAL_MAX_WIDTH).toContain(`${NARROW_MAX_CHARACTERS + 0.5}ch`);
    // And it must carry no pixel width of its own: the moment a platform's
    // prose answer were baked in here, "narrowed" would mean two things.
    expect(NARROW_TERMINAL_MAX_WIDTH).not.toMatch(/\d+px\s*\+\s*1\.75rem/);
  });
});

describe('the ruler the prose cap is measured on', () => {
  it('is rendered at the SMALLER of the two prose sizes a response pane draws', () => {
    // `out` is the operator's stepper and `--text-body` is the type scale;
    // the column is shared by both, so the cap has to hold for the narrower
    // character or it is not a maximum. Derived from `OUT_FONT_SIZE_VAR`
    // rather than restating the custom property, because a renamed variable
    // that still LOOKED right in a string is how this becomes `min()` of one
    // thing.
    //
    // A CONTENT SCAN, AND IT KNOWS IT. This repo has shipped a rule whose
    // selector matched nothing and read exactly like one that worked, so what
    // this claims is only that the declaration was TYPED. Whether it reaches
    // the element, and whether the column really follows the `out` stepper up
    // and down, is measured in a browser by `e2e/view-width-shots.mjs`.
    const rule = new RegExp(`\\.${PROSE_RULER_CLASS}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
    expect(rule, `no .${PROSE_RULER_CLASS} rule in styles.css`).not.toBe('');
    expect(rule).toContain(`var(${OUT_FONT_SIZE_VAR}`);
    expect(rule).toContain('var(--text-body');
    expect(rule).toMatch(/font-size:\s*min\(/);
  });

  it('is ordinary lowercase English, which is what makes it conservative', () => {
    // THE DIRECTION IS THE WHOLE ARGUMENT. Agent answers carry capitals,
    // digits and identifiers, and those run WIDER: measured against the demo
    // transcript, this sample is 5.8930px where its answers average 6.0079 --
    // 1.9% narrower, so the column holds at most eighty of them. A ruler with
    // capitals or digits in it would drift the other way and promise eighty
    // while delivering eighty-one, and no assertion about a string length
    // would notice.
    expect(PROSE_RULER_TEXT).toBe(PROSE_RULER_TEXT.toLowerCase());
    expect(PROSE_RULER_TEXT).not.toMatch(/\d/);
    // Long enough that the engine's rounding of one rectangle is a thousandth
    // of the answer -- `RULER_TEXT` in `TerminalTab.tsx` makes the same
    // argument for ten characters instead of one.
    expect(PROSE_RULER_TEXT.length).toBeGreaterThan(200);
    // And really prose: a run of one letter would measure that letter.
    expect(new Set(PROSE_RULER_TEXT.replace(/[^a-z]/g, '')).size).toBeGreaterThan(20);
    expect(PROSE_RULER_TEXT.split(' ').length).toBeGreaterThan(40);
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
