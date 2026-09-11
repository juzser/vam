/**
 * Contrast, measured rather than claimed.
 *
 * `styles.css` is full of ratios written into comments — "6.01 on sidebar",
 * "clears 4.5:1 there" — and until this file existed not one of them was
 * checked by anything. That is how a cursor ring shipped at 2.15:1 on the
 * light ground: the value was read off an artboard, the reading was accurate,
 * and nobody multiplied it out. So this guard recomputes the ratios from the
 * token text itself, ground by ground, and fails on the number rather than on
 * the prose.
 *
 * The grounds are the ones a token is actually rendered on. Two exclusions
 * are deliberate and are NOT oversights (see issue 188):
 *
 *  - `--vam-raised`: the only `ink-faint`-on-`raised` sites pair
 *    `hover:bg-raised` with `hover:text-ink`, so the ground and the ink change
 *    together and the combination never renders. That sentence was FALSE for
 *    one release: PR #288 left the question card's options and its fold row on
 *    `bg-raised` while their number, preview and "marked, not sent" stayed
 *    `ink-faint` -- the pairing rule held everywhere the comment had looked
 *    and nowhere it had not. Those sites now paint `line-strong` and lift
 *    their ink with it (`OPTION_QUIET_INK`), so the exclusion is true again;
 *    `surface-elevation.test.ts` is what holds the new pair to its numbers.
 *  - `--vam-segment-on`: `ink-faint` reaches it only through a `disabled:`
 *    variant while the fill arrives on `hover:`, and a disabled button takes
 *    no hover fill.
 *
 * `--vam-ink-ghost` used to be excluded here too, genuinely below both
 * thresholds wherever it carried text. That was the deferral; issue 201 is
 * the decision. The token was split: `--vam-ink-quiet` took over every site
 * that has to be read (text, a control border, an icon glyph), leaving
 * `ink-ghost` for marks that carry no meaning of their own.
 *
 * THIS FILE THEN SAID "`ink-ghost` CARRIES NO TEXT ANYMORE, SO THERE IS
 * NOTHING LEFT HERE FOR IT TO FAIL", AND THAT SENTENCE WAS FALSE FOR THREE
 * RELEASES. `DetailPanel.tsx` carried `marker:text-ink-ghost` on every list
 * item an agent's answer renders, and a `::marker` is a PAINTED GLYPH: the
 * "1." an operator counts steps by was drawn at 1.79:1 on the pane beside body
 * text at 7.21:1. The exclusion was written as a fact about the palette when
 * it was only ever a fact about where this guard had looked, and the operator
 * reported the result -- "the bullets and numbers in the response lists are
 * too faint".
 *
 * SO THE MARKERS ARE NOW UNDER MEASUREMENT, and not by adding their two tokens
 * to a list -- they were both already on it, which is exactly why nothing
 * failed. Two things were added instead. `carries each list marker at the
 * floor its own kind of mark owes` records the decision and the two DIFFERENT
 * floors a number and a bullet answer to; `never routes a list marker through
 * an ink it does not measure` holds the rule, so a marker pointed back at
 * `ink-ghost` reddens here whichever file does it.
 *
 * NEITHER OF THOSE PROVES A GLYPH IS PAINTED, and this file is not the place
 * that can. `e2e/pane-colour-shots.mjs` reads
 * `getComputedStyle(li, '::marker').color` off a real item of a real list in a
 * browser; that is the load-bearing guard for the fix, and the comment on the
 * second test below records the mutation that proved it has to be.
 *
 * A guard that asserts a ground nothing renders on is a guard that gets
 * deleted, so each ground below is one some component really paints.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from '../support/contrast.js';
import { ruleBody, THEMES, tokens } from '../support/css-tokens.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

/**
 * Every `::marker` rule the renderer writes, and the ink token each points at.
 *
 * BOTH SPELLINGS, because the two that exist are written differently and a
 * regex that knew only one would go quiet on the other: Tailwind's `marker:`
 * variant, and the arbitrary `[&>li::marker]:` one `DetailPanel.tsx` uses so a
 * list's own markers can be coloured without the rule reaching down into a
 * nested list's.
 *
 * THIS IS NOT THE BANNED SHAPE, and the distinction is the one
 * `ink-ghost-sites.test.ts` already draws. The standing lesson is that a
 * content scan must not stand in for a rendered measurement. Here the scan
 * answers "WHICH TOKEN does a marker name" -- a fact about the source text,
 * which the source text is direct evidence of -- and then hands that token to
 * the ratio maths below. What the glyph ACTUALLY PAINTS is measured in a real
 * browser by `e2e/pane-colour-shots.mjs`, on a real `li::marker`, because a
 * rule that matched nothing would pass this scan.
 */
const MARKER_INK = /(?:\bmarker:|::marker\]:)text-([a-z0-9-]+)/g;

const RENDERER_DIR = resolve(process.cwd(), 'src/renderer');

/**
 * The renderer's own `.ts`/`.tsx` files. A local walk rather than a shared
 * helper: `ink-ghost-sites.test.ts` sweeps all of `src/` asking who USES one
 * token, this asks which inks the markers name, and the two corpora are
 * different questions that happen to need the same three lines.
 */
function rendererSources(dir: string = RENDERER_DIR): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...rendererSources(full));
    else if (['.ts', '.tsx'].includes(extname(e.name))) out.push(full);
  }
  return out;
}

/** Text grounds: every surface fill a component paints `--vam-ink-*` text on. */
const TEXT_GROUNDS = [
  '--vam-ground',
  '--vam-sunken',
  '--vam-panel',
  '--vam-header',
  '--vam-sidebar',
  // The detail pane's own fill, split off `sidebar` when the operator asked
  // for the two settings to come apart. It starts on the same value, which is
  // exactly why it belongs here rather than being taken on trust: the two are
  // free to diverge now, and every line of prose in the right-hand pane is
  // painted on this one.
  '--vam-pane',
  // The fill of a card sitting ON the pane or the sidebar, split off `panel`
  // when the operator reported black patches a second time. It carries
  // captions, key hints, provider names and every menu row in the sidebar's
  // popovers, so it owes 1.4.3 like the rest -- and it is the ground that
  // BOUNDS its own value: at #2f2f2f `ink-quiet` measures 4.526:1 and one step
  // further (#303030) 4.462:1, which fails — so `--vam-card` stops one rung
  // under that ceiling rather than lifting further off the pane. The ceiling
  // is a function of the INK and moves with it: it was #272727 while
  // `ink-quiet` was #8d8d8d, and the second dark lift carried that ink to
  // #969696, which is what bought the card a real step off the pane (2.95 ->
  // 3.30 L*, `dark-lift.test.ts`).
  '--vam-card',
] as const;

/**
 * `--vam-in-bubble` IS DELIBERATELY NOT A TEXT GROUND, and the omission is the
 * interesting half.
 *
 * It carries exactly one ink -- `--vam-ink-dim`, the prompt's own paragraph in
 * `DetailPanel.tsx` -- which measures 4.787:1 on it in dark and 7.490:1 in
 * light. Listing it above would demand all nine text tokens, and two of them
 * genuinely fail there in dark: `ink-faint`/`ink-quiet` at 3.355:1 and
 * `failed` at 3.588:1. Meeting that would mean a fill so close to the pane
 * that the bubble goes back to being invisible, which is the complaint that
 * created the token.
 *
 * So the pair that exists is asserted, in `surface-elevation.test.ts`, and the
 * ones that do not exist are PREVENTED rather than measured: the e2e guard
 * reads the colour the bubble's paragraph is really painted with and holds it
 * to 4.5:1, so an edit that reaches for a quieter grey fails there.
 */

/** Tokens that carry body text and therefore owe WCAG 1.4.3's 4.5:1. */
const TEXT_TOKENS = [
  '--vam-ink',
  '--vam-ink-dim',
  '--vam-ink-faint',
  '--vam-ink-quiet',
  '--vam-running',
  '--vam-waiting',
  '--vam-idle',
  '--vam-done',
  '--vam-failed',
] as const;

describe('token contrast, per theme', () => {
  for (const theme of THEMES) {
    const t = tokens(ruleBody(CSS, theme.selector));

    const hex = (name: string): string => {
      const v = t.get(name);
      expect(v, `${theme.name} block defines ${name}`).toBeDefined();
      return v as string;
    };

    /**
     * Every pair this guard looked at, and which of them fell short.
     *
     * Shaped as one object so the count and the verdict are asserted in a
     * single expectation. A guard that reports "nothing failed" over a corpus
     * of zero passes for the wrong reason -- a sibling guard on another branch
     * did exactly that, asking its question of a caption its fixture never drew
     * -- so the number of comparisons is part of the expected value and a
     * shortened token or ground list reddens this file.
     */
    const measure = (pairs: readonly (readonly [string, string])[], floor: number) => ({
      pairs: pairs.length,
      failing: pairs
        .filter(([token, ground]) => contrast(hex(token), hex(ground)) < floor)
        .map(([token, ground]) => `${token} on ${ground}`),
    });

    describe(theme.name, () => {
      it('carries text at 4.5:1 or better on every surface it is painted on', () => {
        const pairs = TEXT_TOKENS.flatMap((token) =>
          TEXT_GROUNDS.map((ground) => [token, ground] as const),
        );
        // 9 tokens x 7 grounds. The literal is the point: it is what makes
        // deleting a row from either list a failure rather than a quieter pass.
        expect(measure(pairs, 4.5)).toEqual({ pairs: 63, failing: [] });
      });

      it('reads the waiting amber against its own tint and wash', () => {
        // `StepNode` paints `bg-waiting-tint text-waiting`, and the wash is the
        // same pairing one step quieter. A status colour that fails against the
        // fill its own design pairs it with is the worst case, not a corner one.
        const pairs = [
          ['--vam-waiting', '--vam-waiting-tint'],
          ['--vam-waiting', '--vam-waiting-wash'],
        ] as const;
        expect(measure(pairs, 4.5)).toEqual({ pairs: 2, failing: [] });
      });

      it('marks the cursor at 3:1 against the ground', () => {
        // A non-text indicator owes 3:1 (WCAG 1.4.11), and the ring is the only
        // thing that says which row the cursor is on — the card border does not
        // vary with focus and the sidebar highlights the SESSION. `--vam-dots`
        // (the grid-dot token this pair used to also check) is gone with the
        // canvas it was drawn on — 0.2 migration, A12.1 (epic.md decision 5).
        const pairs = [['--vam-cursor-ring', '--vam-ground']] as const;
        expect(measure(pairs, 3)).toEqual({ pairs: 1, failing: [] });
      });

      it('draws the segmented control border at 3:1 against the fill it encloses', () => {
        // `SettingsOverlay` draws `border-ink-faint` around a `bg-well` fill.
        // The ground is `well`, not `panel` — a comment there once measured the
        // wrong one and recorded a pass the border did not have.
        expect(measure([['--vam-ink-faint', '--vam-well']], 3)).toEqual({
          pairs: 1,
          failing: [],
        });
      });

      it('draws the "New session" control border at 3:1 against the sidebar it sits on', () => {
        // `SessionList` draws `border-ink-quiet` on a control with no fill of
        // its own, so the enclosing ground is the sidebar behind it, not a
        // well. WCAG 1.4.11, not 1.4.3 — the 4.5:1 text check above already
        // covers this pair at a stricter floor, but the border's own
        // obligation is 3:1 and this asserts that directly rather than by
        // implication.
        expect(measure([['--vam-ink-quiet', '--vam-sidebar']], 3)).toEqual({
          pairs: 1,
          failing: [],
        });
      });

      /**
       * THE TWO LIST MARKERS, AT TWO DIFFERENT FLOORS, because they are two
       * different kinds of thing and the previous answer treated them as one.
       *
       * A NUMBER IS CONTENT. "1." "2." "3." is how a reader refers to an item
       * -- an agent's numbered steps are precisely the thing an operator
       * counts, and "step 3 failed" is a sentence about the numeral. So it
       * owes 1.4.3's 4.5:1 like any other text, and it takes `ink-dim`, the
       * SAME ink as the item's own words. That is also `::marker`'s own
       * initial value (`currentColor`), so the change at the call site is to
       * stop overriding it rather than to invent a colour: a numeral quieter
       * than the words it numbers is one the reader has to hunt for.
       *
       * A BULLET IS NOT. A disc carries no meaning of its own -- the `<ul>`,
       * the indent and the gap between items already say "list", and nobody
       * refers to "the third bullet" by its glyph. So it does not owe 4.5:1.
       * What it does owe is 1.4.11's 3:1: it is a non-text mark a reader uses
       * to find where each item begins, and `ink-ghost` (1.79:1 on the pane)
       * never met that. It takes `ink-quiet`, which is the QUIETEST ink in the
       * palette that clears 3:1 -- `styles.css` says at `--vam-ink-quiet` that
       * there is no rung between `ghost` and `quiet` and refuses to invent a
       * third grey -- so the bullet stays one weight under the body text it
       * belongs to instead of out-shouting it.
       */
      it('carries each list marker at the floor its own kind of mark owes', () => {
        expect(measure([['--vam-ink-dim', '--vam-pane']], 4.5)).toEqual({
          pairs: 1,
          failing: [],
        });
        expect(measure([['--vam-ink-quiet', '--vam-pane']], 3)).toEqual({
          pairs: 1,
          failing: [],
        });
      });
    });
  }

  /**
   * A MARKER MAY NOT NAME AN INK THIS FILE DOES NOT MEASURE. Theme-independent,
   * so it runs once: the question is about the renderer's class names, not
   * about either palette.
   *
   * A NEGATIVE CLAIM ONLY, AND THAT SHAPE IS THE RESULT OF FALSIFYING IT. The
   * first version also asserted that at least two marker rules EXIST -- "the
   * renderer draws an ordered and an unordered list, so two rules is the
   * floor". Falsified by moving both class strings out of the `ul`/`ol`
   * attributes and into a comment on the same lines: nothing painted a marker
   * rule at all, the bullet fell back to the body's own ink, and this file
   * went GREEN on all thirteen tests. A regex cannot tell an attribute from
   * prose, so an existence claim made this way is a claim about a sentence.
   * That half is deleted rather than reworded.
   *
   * What is left cannot be satisfied by prose in the direction that matters: a
   * marker naming an unmeasured ink reddens whether it is written as code or
   * as a comment, so the only way to make this lie is to not write the thing
   * that would fail. It is a cheap second line, and it is the line that fires
   * on the exact regression that shipped -- a marker pointed at `ink-ghost`.
   *
   * EXISTENCE AND PAINT BELONG TO `e2e/pane-colour-shots.mjs`, which reads
   * `getComputedStyle(li, '::marker').color` off a real item of a real list
   * and holds each marker to its own floor. That guard caught the comment
   * mutation this one missed.
   */
  it('never routes a list marker through an ink it does not measure', () => {
    const files = rendererSources();
    // A SWEEP THAT READ NO FILES PASSES THE FILTER BELOW. Four guards in this
    // repo have gone green having examined zero of them.
    expect(files.length).toBeGreaterThan(20);

    const used: { file: string; ink: string }[] = [];
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(MARKER_INK)) {
        used.push({ file: file.slice(RENDERER_DIR.length + 1), ink: `--vam-${m[1]}` });
      }
    }
    expect(
      used.filter((u) => !TEXT_TOKENS.includes(u.ink as (typeof TEXT_TOKENS)[number])),
    ).toEqual([]);
  });
});
