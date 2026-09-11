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
 * `ink-ghost` for marks that carry no meaning of their own. `ink-quiet` is
 * measured below like any other text token; `ink-ghost` carries no text
 * anymore, so there is nothing left here for it to fail.
 *
 * A guard that asserts a ground nothing renders on is a guard that gets
 * deleted, so each ground below is one some component really paints.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from '../support/contrast.js';
import { ruleBody, THEMES, tokens } from '../support/css-tokens.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

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
  // BOUNDS its own value: at #272727 `ink-quiet` measures 4.501:1 and one step
  // further it fails, which is why `--vam-card` stops where it does instead of
  // lifting further off the pane.
  '--vam-card',
] as const;

/**
 * `--vam-in-bubble` IS DELIBERATELY NOT A TEXT GROUND, and the omission is the
 * interesting half.
 *
 * It carries exactly one ink -- `--vam-ink-dim`, the prompt's own paragraph in
 * `DetailPanel.tsx` -- which measures 4.750:1 on it in dark and 7.424:1 in
 * light. Listing it above would demand all nine text tokens, and two of them
 * genuinely fail there in dark: `ink-faint`/`ink-quiet` at 3.364:1 and
 * `failed` at 4.036:1. Meeting that would mean a fill so close to the pane
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
    });
  }
});
