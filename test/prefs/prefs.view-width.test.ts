// @vitest-environment happy-dom

/**
 * THE WIDTH OF A VIEW: one stored flag, one rule in two units, and the store
 * that puts the flag in force.
 *
 * THE RULE MOVED TWICE AND SO DID THIS FILE. It was "no more than eighty
 * characters on a line"; the operator used the build and asked for two thirds
 * of the pane instead ("narrow width cần lớn hơn, khoảng 2/3 pane width"), and
 * the eighty became the FLOOR under that fraction. Then they split a pane and
 * met the floor as a defect: a column pinned at eighty characters with the
 * margins shrinking around it, in a pane that was not wide enough to give them
 * for any reading benefit. So the floor is now a THRESHOLD -- narrowing applies
 * only while two thirds of the pane is at least eighty characters, and below
 * that the view is left whole. The eighty is still here and still asserted, in
 * the third role it has had; every assertion below was re-aimed at that role
 * rather than deleted, because a guard that measured the old promise should
 * measure the new one.
 *
 * NOT ONE PIXEL NUMBER IS PINNED HERE, AND THAT IS STILL THE POINT. The first
 * cut pinned `480`, derived from an advance measured once on macOS, and the
 * first Linux CI run put 83.95 characters on the line it produced. Both halves
 * of the floor are measurements -- the prose one off a ruler in the real face
 * (`narrowProseMaxWidth`), the terminal one off `ch` -- so what is asserted
 * below is the ARITHMETIC and the DIRECTION, never a platform's answer.
 *
 * THE ARITHMETIC IS RESOLVED HERE, NOT ONLY SPELLED. The step is a CSS
 * expression, and a string assertion can only say that it was typed; whether
 * it steps WHERE it should is a question about its value at a pane width.
 * `resolveLength` below evaluates the expression the way an engine would -- a
 * percentage against a pane, `rem` against the root, `ch` against a cell --
 * so the boundary can be asked about directly, at one and a half floors and a
 * layout unit either side of it. What it cannot say is what Chromium ROUNDS to
 * there; `e2e/view-width-shots.mjs` measures that against real rectangles.
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
  NARROW_FLOOR_CHARACTERS,
  NARROW_PANE_FRACTION,
  NARROW_STEP_GAIN,
  NARROW_TERMINAL_FLOOR,
  NARROW_TERMINAL_MAX_WIDTH,
  NARROW_THRESHOLD_FLOORS,
  narrowMaxWidth,
  narrowProseMaxWidth,
  PROSE_RULER_CLASS,
  PROSE_RULER_TEXT,
  readNarrowViews,
  setActiveNarrowViews,
  subscribeNarrowViews,
} from '../../src/renderer/prefs/view-width.js';

const KEY = 'vam.prefs.v1';
const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

/**
 * What one unit is worth when the expression is resolved: a percentage
 * against the pane, `rem` against the root, `ch` against one cell of the
 * mono face.
 */
type Lengths = { readonly pane: number; readonly rem: number; readonly ch: number };

/**
 * Resolve a CSS length expression -- `calc()`, `max()`, `min()`, the four
 * operators and the four units the caps are written in -- to pixels, for one
 * pane width.
 *
 * NOT A CSS ENGINE, AND IT KNOWS IT: no layout units, no float rounding, no
 * saturation. That is what makes it the right tool for the question asked
 * here, which is where the step SHOULD land in exact arithmetic; where the
 * engine rounds it to is the guard's question. Written as a recursive descent
 * over a token list rather than a `Function` over rewritten text, so a unit
 * it does not know is a thrown error and not a silent `NaN`.
 */
function resolveLength(expr: string, lengths: Lengths): number {
  const tokens = expr.match(/[\d.]+(?:px|rem|ch|%)?|[a-z]+\(|[()+\-*/,]/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const expectToken = (want: string) => {
    const got = take();
    if (got !== want) throw new Error(`expected ${want}, got ${got ?? 'the end'} in ${expr}`);
  };
  const primary = (): number => {
    const token = take();
    if (token === undefined) throw new Error(`ran out of tokens in ${expr}`);
    if (token === '(' || token === 'calc(') {
      const value = sum();
      expectToken(')');
      return value;
    }
    if (token === 'max(' || token === 'min(') {
      const args = [sum()];
      while (peek() === ',') {
        take();
        args.push(sum());
      }
      expectToken(')');
      return token === 'max(' ? Math.max(...args) : Math.min(...args);
    }
    const hit = /^([\d.]+)(px|rem|ch|%)?$/.exec(token);
    if (hit === null) throw new Error(`unreadable token ${token} in ${expr}`);
    const n = Number(hit[1]);
    switch (hit[2]) {
      case 'px':
        return n;
      case 'rem':
        return n * lengths.rem;
      case 'ch':
        return n * lengths.ch;
      case '%':
        return (n / 100) * lengths.pane;
      default:
        return n;
    }
  };
  const product = (): number => {
    let value = primary();
    while (peek() === '*' || peek() === '/') {
      const op = take();
      const right = primary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const op = take();
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };
  const value = sum();
  if (at !== tokens.length) throw new Error(`trailing tokens in ${expr}`);
  return value;
}

/** The root font size every `rem` resolves against, and one cell of a
 *  monospace face at 12.5px -- the measurement `TerminalTab.fit.test.tsx`
 *  records from one browser. Neither is pinned by any assertion below; they
 *  are what the expression is resolved AGAINST, and the claims are about the
 *  shape of the answer. */
const REM = 16;
const CELL = 6.6015625 * (12.5 / 10.5);
/** Chromium's layout unit -- the smallest distance two pane widths can differ
 *  by, and so the smallest step at which "one pane below the boundary" is a
 *  real pane. */
const LAYOUT_UNIT = 1 / 64;
/** Where the rule says the step is: the pane at which two thirds IS the floor,
 *  i.e. the reciprocal of two thirds. Written here from the fraction and NOT
 *  from `NARROW_THRESHOLD_FLOORS`, so the arithmetic below is a check on that
 *  constant rather than a restatement of it -- a threshold moved to 1.25 would
 *  otherwise move every boundary these tests probe along with it. */
const RECIPROCAL = 3 / 2;

/**
 * The width a `w-full` element takes under a cap: the pane, unless the cap is
 * narrower. A cap wider than the pane is the "changes no rectangle" the header
 * of `view-width.ts` argues for, and it is how the step lets go.
 */
const columnAt = (cap: string, pane: number, ch = CELL): number =>
  Math.min(pane, resolveLength(cap, { pane, rem: REM, ch }));

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

describe('the rule the narrowed state follows', () => {
  it('is two thirds of the pane, written as the operator’s own fraction', () => {
    // "narrow width cần lớn hơn, khoảng 2/3 pane width". A division rather
    // than 66.6667% so the source carries the fraction they asked for and not
    // a rounding of it -- and so that a reader can see at a glance that it IS
    // two thirds.
    expect(NARROW_PANE_FRACTION).toBe('calc(200% / 3)');
  });

  it('keeps the eighty as its FLOOR, which is the half that spares a narrow pane', () => {
    // NOT THE PROMISE ANY MORE, and `view-width.ts`'s header carries what
    // changed and who changed it. A bare percentage always binds: it would
    // have taken the 390px phone to 260px and vam's narrowest legal pane to
    // 213px, which is the one thing this setting must never do.
    expect(NARROW_FLOOR_CHARACTERS).toBe(80);
  });

  it('narrows only a pane of at least one and a half floors — the reciprocal of the fraction', () => {
    // THE ONE PANE WIDTH AT WHICH TWO THIRDS IS EXACTLY A FLOOR, and so the
    // boundary between "two thirds is about line length" and "two thirds is
    // just a smaller rectangle". Derived, not chosen: it is the reciprocal of
    // the fraction, and a fraction that moved would move it.
    expect(NARROW_THRESHOLD_FLOORS).toBe(1.5);
    expect((NARROW_THRESHOLD_FLOORS * 2) / 3).toBe(1);
  });

  it('spends the fraction and the step in one `max()`, with the floor inside the step', () => {
    // Swept rather than sampled: the advance is whatever the operator's
    // platform reports, so every plausible one has to come out right. 5.7180
    // is the Linux CI figure that broke the frozen constant; 6.0079 is this
    // macOS machine's. The floor is spelled out independently of the helper,
    // so a helper that dropped the padding or rounded the other way is caught
    // here and not only in the arithmetic below.
    for (const advance of [3, 4.7089, 5.718, 5.893, 6.0079, 8.4402, 11.5]) {
      const floor = `calc(${Math.floor(NARROW_FLOOR_CHARACTERS * advance)}px + 1.75rem)`;
      expect(narrowProseMaxWidth(advance), `${advance}`).toBe(
        `max(${NARROW_PANE_FRACTION}, calc((${floor} * ${NARROW_THRESHOLD_FLOORS} - 100%) * ${NARROW_STEP_GAIN}))`,
      );
      expect(narrowProseMaxWidth(advance), `${advance}`).toBe(narrowMaxWidth(floor));
    }
  });

  it('is exactly the floor at one and a half floors, which is also exactly two thirds', () => {
    // THE BOUNDARY, ASKED ABOUT DIRECTLY. At a pane of one and a half floors
    // the two candidate answers coincide -- two thirds of the pane IS the
    // floor -- and the rule says that pane narrows. So the step must land on
    // the floor there and not a pixel above it: the inner term is zero, and
    // the fraction wins.
    for (const advance of [4.7089, 5.718, 6.0079, 8.4402]) {
      const cap = narrowProseMaxWidth(advance) ?? '';
      const floor = Math.floor(NARROW_FLOOR_CHARACTERS * advance) + 1.75 * REM;
      const boundary = floor * RECIPROCAL;
      expect(columnAt(cap, boundary), `${advance}`).toBeCloseTo(floor, 6);
      expect(columnAt(cap, boundary), `${advance}`).toBeCloseTo((boundary * 2) / 3, 6);
    }
  });

  it('lets go entirely one layout unit below that, rather than pinning the column at the floor', () => {
    // THE DEFECT THIS RULE REPLACED, at the width where it first appeared.
    // Under `max(two thirds, floor)` a pane one unit short of the boundary got
    // a column pinned AT the floor with the margins shrinking around it as the
    // pane shrank; the operator met that in a split, as a column narrower
    // than the pane could comfortably give for no reading benefit. Now the cap
    // is wider than the pane there, which is to say there is no cap.
    for (const advance of [4.7089, 5.718, 6.0079, 8.4402]) {
      const cap = narrowProseMaxWidth(advance) ?? '';
      const floor = Math.floor(NARROW_FLOOR_CHARACTERS * advance) + 1.75 * REM;
      const pane = floor * RECIPROCAL - LAYOUT_UNIT;
      expect(columnAt(cap, pane), `${advance}`).toBe(pane);
      expect(resolveLength(cap, { pane, rem: REM, ch: CELL }), `${advance}`).toBeGreaterThan(pane);
    }
  });

  it('is two thirds of the pane or the whole pane at every width, and never anything between', () => {
    // THE RULE, SWEPT. A layout unit at a time from below vam's narrowest legal
    // pane to past a 4K monitor's, every width must resolve to one of two
    // answers, and which one is decided by the boundary alone. This is the
    // assertion the old rule fails: between one floor and one and a half it
    // answered "the floor", which is neither. It is also what a threshold
    // moved to 1.25 floors fails: the band between 1.25 and 1.5 would narrow
    // where the rule says it must not.
    for (const advance of [5.718, 6.0079]) {
      const cap = narrowProseMaxWidth(advance) ?? '';
      const floor = Math.floor(NARROW_FLOOR_CHARACTERS * advance) + 1.75 * REM;
      const boundary = floor * RECIPROCAL;
      let whole = 0;
      let fraction = 0;
      for (let pane = 300; pane <= 4000; pane += LAYOUT_UNIT) {
        const column = columnAt(cap, pane);
        if (pane < boundary) {
          if (column !== pane)
            throw new Error(`${advance}: capped at ${column} in a ${pane}px pane`);
          whole += 1;
        } else {
          if (Math.abs(column - (pane * 2) / 3) > 1e-6) {
            throw new Error(
              `${advance}: ${column} in a ${pane}px pane, two thirds is ${(pane * 2) / 3}`,
            );
          }
          fraction += 1;
        }
      }
      // Both branches were really walked, so a boundary outside the sweep
      // could not have made this vacuous.
      expect(whole, `${advance}`).toBeGreaterThan(1000);
      expect(fraction, `${advance}`).toBeGreaterThan(1000);
    }
  });

  it('steps within a layout unit, which is the gain’s whole job', () => {
    // WHY THE GAIN IS THE NUMBER IT IS. `max()` and `min()` cannot make a
    // discontinuity; the step is a ramp that crosses from "no cap" to "the
    // fraction" over a band of pane widths one gain-th of the pane wide.
    // Chromium lays out in 1/64px, so a gain that keeps the band under that
    // for any pane an operator has leaves no width at which the column is
    // between the two answers. 4000px is past a 4K monitor's full width.
    expect(4000 / NARROW_STEP_GAIN).toBeLessThan(LAYOUT_UNIT);
  });

  it('never rounds the floor UP past the characters it is counting', () => {
    // THE INVARIANT, STATED WITHOUT NAMING A ROUNDING FUNCTION, because the
    // function is the implementation and this is the rule. 80 × 6.0079 is
    // 480.63; `Math.round` shipped 481 and Chromium measured 80.4 characters
    // on the line, which is how the direction was found. The fraction has
    // slack now, so this is the only place it is still held.
    for (const advance of [4.7089, 5.718, 5.893, 6.0079, 8.4402]) {
      const px = Number(/calc\((\d+)px/.exec(narrowProseMaxWidth(advance) ?? '')?.[1]);
      expect(px, `${advance}`).toBeLessThanOrEqual(NARROW_FLOOR_CHARACTERS * advance);
      // And not short by a whole character, which is the other way to satisfy
      // the line above and be wrong.
      expect(px, `${advance}`).toBeGreaterThan((NARROW_FLOOR_CHARACTERS - 1) * advance);
    }
  });

  it('caps nothing at all until something has actually been measured', () => {
    // `fitPane`'s rule, in this file's terms: a ruler that has not been laid
    // out reports a zero box, and a zero advance would produce a 28px floor of
    // nothing but padding. happy-dom reports exactly those zeros, and so does
    // every real browser for one frame.
    //
    // NOT THE BARE FRACTION EITHER, which is the tempting wrong answer: the
    // fraction needs no measurement and could be applied immediately, but the
    // fraction without its floor is the half that narrows a phone.
    for (const nothing of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(narrowProseMaxWidth(nothing as number | null), String(nothing)).toBeUndefined();
    }
  });

  it('gives the terminal the same sentence, with columns for characters', () => {
    // `terminal-size.ts` warns in its own header that a plausible-looking
    // width-to-height RATIO is out by a column every seventeen. `ch` is the
    // advance of `0` as the engine measures it, so in a monospace face `80ch`
    // IS eighty columns at whatever size the screen is drawn at -- and the
    // half cell is rounding slack, argued in `view-width.ts`.
    expect(NARROW_TERMINAL_MAX_WIDTH).toContain(`${NARROW_FLOOR_CHARACTERS + 0.5}ch`);
    expect(NARROW_TERMINAL_FLOOR).toBe(`calc(${NARROW_FLOOR_CHARACTERS + 0.5}ch + 1.5rem + 2px)`);
    // THE SAME FRACTION, not a second opinion about the width: the terminal
    // was the one view that might have kept the old rule, and the header
    // argues why it did not.
    expect(NARROW_TERMINAL_MAX_WIDTH).toContain(NARROW_PANE_FRACTION);
    expect(NARROW_TERMINAL_MAX_WIDTH.startsWith('max(')).toBe(true);
    // AND THE SAME STEP, built by the same function from its own floor -- so
    // a threshold moved for one view moves for both, and there is one rule
    // and not two that happen to agree.
    expect(NARROW_TERMINAL_MAX_WIDTH).toBe(narrowMaxWidth(NARROW_TERMINAL_FLOOR));
    // And it must carry no pixel width of its own: the moment a platform's
    // prose answer were baked in here, "narrowed" would mean two things.
    expect(NARROW_TERMINAL_MAX_WIDTH).not.toMatch(/\d+px\s*\+\s*1\.75rem/);
  });

  it('steps the terminal at one and a half of ITS floor, whatever a cell measures', () => {
    // The floor is in `ch`, so the boundary moves with the face and the size
    // and nothing here may know where it is; it is resolved for three cells a
    // monospace face plausibly measures and asked the same three questions the
    // prose cap was. Below the boundary the tab is its whole box, at it the
    // tab is eighty and a half cells plus its chrome, above it two thirds.
    for (const cell of [5.775, CELL, 9.8]) {
      const floor = resolveLength(NARROW_TERMINAL_FLOOR, { pane: 0, rem: REM, ch: cell });
      const boundary = floor * RECIPROCAL;
      expect(columnAt(NARROW_TERMINAL_MAX_WIDTH, boundary, cell), `${cell}`).toBeCloseTo(floor, 6);
      const below = boundary - LAYOUT_UNIT;
      expect(columnAt(NARROW_TERMINAL_MAX_WIDTH, below, cell), `${cell}`).toBe(below);
      expect(columnAt(NARROW_TERMINAL_MAX_WIDTH, boundary * 2, cell), `${cell}`).toBeCloseTo(
        (boundary * 4) / 3,
        6,
      );
    }
  });
});

describe('the ruler the prose cap is measured on', () => {
  it('is rendered at the SMALLEST step anything read in the pane wears', () => {
    // `out` is the operator's stepper and `--text-control` is the smallest of
    // the pane's reading steps -- the option labels in the question card, the
    // refusals, the hints. The floor is shared by both, so it has to be
    // counted in the narrower or it is eighty of one and eighty-something of
    // the other. Derived from `OUT_FONT_SIZE_VAR` rather than restating the
    // custom property, because a renamed variable that still LOOKED right in a
    // string is how this becomes `min()` of one thing.
    //
    // `--text-body` WOULD BE A DEAD BRANCH NOW: since `[data-reading-pane]`
    // re-declares the scale in terms of the reading size, `min(out, body)`
    // collapses to `out` at every setting, and a `min()` that can never pick
    // its second argument is an expression no mutation can reach.
    //
    // A CONTENT SCAN, AND IT KNOWS IT. This repo has shipped a rule whose
    // selector matched nothing and read exactly like one that worked, so what
    // this claims is only that the declaration was TYPED. Whether it reaches
    // the element, and whether the column really follows the `out` stepper up
    // and down, is measured in a browser by `e2e/view-width-shots.mjs`.
    const rule = new RegExp(`\\.${PROSE_RULER_CLASS}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
    expect(rule, `no .${PROSE_RULER_CLASS} rule in styles.css`).not.toBe('');
    expect(rule).toContain(`var(${OUT_FONT_SIZE_VAR}`);
    expect(rule).toContain('var(--text-control');
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
