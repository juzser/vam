/**
 * ELEVATION HAS A DIRECTION, AND THE DARK PALETTE WAS POINTING THE WRONG WAY.
 *
 * The operator, twice: "there are still a lot of black patches", and then
 * "the In bubble needs more contrast within the pane". Both are the same
 * defect measured from two sides, and neither is a matter of taste.
 *
 * MEASURED, on the painted DOM, before this file existed (`e2e/pane-colour-
 * shots.mjs` re-measures it in a browser; these are the token values behind
 * what it read):
 *
 *   dark   --vam-panel  #141414   on pane/sidebar #171717   1.028:1 DARKER
 *   dark   --vam-raised #1a1a1a   on pane         #171717   1.030:1 lighter
 *   light  --vam-panel  #ffffff   on pane/sidebar #f0eeea   1.159:1 lighter
 *
 * So a `bg-panel` card sitting on the detail pane or the sidebar was painting
 * a fill from BELOW its own ground in dark, and from above it in light. That
 * is not a card, it is a hole punched in the surface -- and it is what the
 * operator has been pointing at. The light theme was already right, which is
 * why a fix reasoned only in dark would have inverted the problem rather than
 * solved it.
 *
 * THE TOKEN IS NOT WRONG; THE CALL SITES WERE. `styles.css` orders its
 * surfaces ground < sunken < well < header < panel < sidebar/pane < raised and
 * says so -- `--color-sidebar` is documented as sitting "between `panel` and
 * `raised` in dark". `panel` is a LOWER rung than the pane BY DESIGN. What the
 * palette did not have was a rung for the object those call sites actually
 * are: a card that sits ON the pane. Hence `--vam-card`, and hence the two
 * assertions below that are about direction rather than about a value.
 *
 * WHY NOT REUSE A RUNG:
 *   `raised`  is above the pane in dark (1.03) but is #f0f0ee in light --
 *             1.015:1 on the pane, which would have deleted the light theme's
 *             crisp white cards to fix the dark one.
 *   `panel`   is the light theme's card and the dark theme's hole.
 *   `header`, `well`, `sunken`, `ground` are all below the pane in dark.
 * No existing pair is above the pane in both themes, and that is the whole
 * argument for a thirteenth swatch rather than a repointed utility.
 *
 * `--vam-in-bubble` is the second half. The In bubble wore `raised`: 1.030:1
 * in dark and 1.015:1 in light against the band behind it, which is below the
 * threshold at which a person reliably sees an edge -- the bubble the operator
 * asked for was, in practice, not drawn. It now carries the In region's own
 * teal (`--vam-rule-in`) at fill strength.
 *
 * BOTH NUMBERS, BECAUSE ONE OF THEM CANNOT DO THE JOB. The light pane sits at
 * 86% relative luminance, so the WCAG ratio of ANY colour lighter than it is
 * capped at 1.159:1 -- pure white. Holding the light bubble to a dark theme's
 * ratio would have been holding it to an impossible number, and holding it to
 * a reachable one would have accepted 1.03 in dark. So each floor is stated in
 * the units it can be met in: a luminance ratio, and a CIE76 perceptual
 * distance, which is what actually says "that is a different colour".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, deltaE, relativeLuminance } from '../support/contrast.js';
import { ruleBody, THEMES, tokens } from '../support/css-tokens.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

/**
 * The surfaces a card or a bubble is drawn ON. Both, not one: the detail pane
 * and the sidebar paint separate tokens since the operator asked for the two
 * settings to come apart, and the same card component lands on each.
 */
const GROUNDS = ['--vam-pane', '--vam-sidebar'] as const;

/**
 * The floor the In bubble owes, per theme, in each unit.
 *
 * The RATIO floors are the reachable ones. Dark's 1.35 sits just under the
 * band the palette's own tinted grounds already occupy (`--vam-waiting-tint`
 * 1.389:1, `--vam-done-tint` 1.444:1 against the pane), so the bubble is held
 * to the standard the design set for a tinted fill rather than to a number
 * invented here. Light's 1.10 is 95% of the 1.159 ceiling that pure white
 * imposes on anything lighter than that theme's pane -- there is no room above
 * it, and pretending otherwise would be asking for a colour that does not
 * exist.
 *
 * The DISTANCE floor is the same in both themes and is the one that carries
 * the operator's complaint: 6.24 is what the light theme's own card step
 * (white on the pane) measures, so "at least as distinct as a card" is the
 * bar, and it is a bar the light theme can actually clear by adding hue where
 * it cannot add luminance.
 */
const IN_FLOORS = {
  dark: { ratio: 1.35, distance: 6.24 },
  light: { ratio: 1.1, distance: 6.24 },
} as const;

describe('surfaces are ordered by elevation, in both themes', () => {
  for (const theme of THEMES) {
    const t = tokens(ruleBody(CSS, theme.selector));
    const hex = (name: string): string => {
      const v = t.get(name);
      expect(v, `${theme.name} block defines ${name}`).toBeDefined();
      return v as string;
    };

    describe(theme.name, () => {
      /**
       * FIRST, THAT THE TOKENS EXIST AND DIFFER. Found by falsification on
       * the sibling e2e guard and it applies just as hard here: every
       * comparison below is relative, and a pair of absent tokens compares
       * equal to itself forever. `hex()` throws on a missing name, and this
       * asserts the two are not the same string, so "lighter than" can never
       * pass on one colour read twice.
       */
      it('defines a card fill and a bubble fill that are colours of their own', () => {
        const card = hex('--vam-card');
        const bubble = hex('--vam-in-bubble');
        expect(card).toMatch(/^#[0-9a-f]{6}$/i);
        expect(bubble).toMatch(/^#[0-9a-f]{6}$/i);
        // Three values, not four: `pane` and `sidebar` deliberately start on
        // the same colour in each theme (`--color-pane` says why), so the
        // claim is that the two NEW fills are distinct from that shared
        // ground and from each other.
        expect(new Set([card, bubble, hex('--vam-pane')]).size).toBe(3);
      });

      it('paints a card LIGHTER than the pane and the sidebar it sits on', () => {
        // The direction, per ground, as data -- so a failure names which
        // ground the card fell under rather than just saying `false`.
        const card = hex('--vam-card');
        expect(
          GROUNDS.map((g) => ({
            ground: g,
            lighter: relativeLuminance(card) > relativeLuminance(hex(g)),
          })),
        ).toEqual([
          { ground: '--vam-pane', lighter: true },
          { ground: '--vam-sidebar', lighter: true },
        ]);
      });

      it('paints the In bubble lighter than the pane, and by a step a person can see', () => {
        const pane = hex('--vam-pane');
        const bubble = hex('--vam-in-bubble');
        const floors = IN_FLOORS[theme.name];
        expect({
          lighter: relativeLuminance(bubble) > relativeLuminance(pane),
          ratio: contrast(bubble, pane) >= floors.ratio,
          distance: deltaE(bubble, pane) >= floors.distance,
        }).toEqual({ lighter: true, ratio: true, distance: true });
      });

      it('leaves the In bubble further from the pane than the fill it replaced', () => {
        // `raised` is what the bubble wore, and the number that made this a
        // bug rather than a preference: 1.03:1 in dark, 1.015:1 in light.
        // Asserting the IMPROVEMENT and not only the floor is what stops a
        // future edit from meeting the floor by moving the pane instead.
        const pane = hex('--vam-pane');
        expect(deltaE(hex('--vam-in-bubble'), pane)).toBeGreaterThan(
          deltaE(hex('--vam-raised'), pane) * 4,
        );
      });

      it('keeps the one ink the bubble actually paints readable on it', () => {
        // `--vam-ink-dim` is the ONLY text colour inside the bubble
        // (`DetailPanel.tsx`, the prompt's own `<p>`), and it is the reason
        // the fill stops where it does rather than going a rung further: at
        // this depth `ink-faint` measures 3.35:1 and could not be used there.
        // That constraint is recorded in `styles.css` beside the value; the
        // e2e guard measures the ink the bubble is REALLY painted with, which
        // is the half a token list cannot check.
        expect(contrast(hex('--vam-ink-dim'), hex('--vam-in-bubble'))).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
