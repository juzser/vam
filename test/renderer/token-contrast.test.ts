/**
 * Contrast, measured rather than claimed.
 *
 * `styles.css` is full of ratios written into comments — "6.01 on sidebar",
 * "clears 4.5:1 there" — and until this file existed not one of them was
 * checked by anything. That is how a cursor ring shipped at 2.15:1 on the
 * light canvas: the value was read off an artboard, the reading was accurate,
 * and nobody multiplied it out. So this guard recomputes the ratios from the
 * token text itself, ground by ground, and fails on the number rather than on
 * the prose.
 *
 * The grounds are the ones a token is actually rendered on. Three exclusions
 * are deliberate and are NOT oversights (see issue 188):
 *
 *  - `--vam-raised`: the only `ink-faint`-on-`raised` sites pair
 *    `hover:bg-raised` with `hover:text-ink`, so the ground and the ink change
 *    together and the combination never renders.
 *  - `--vam-segment-on`: `ink-faint` reaches it only through a `disabled:`
 *    variant while the fill arrives on `hover:`, and a disabled button takes
 *    no hover fill.
 *  - `--vam-ink-ghost`: genuinely below both thresholds wherever it carries
 *    text, and deliberately left that way here. Raising it is a different
 *    decision from raising `ink-faint` — it would collapse the ink ladder —
 *    and it has its own issue. Asserting it here would only get this file
 *    weakened by the first author it blocked.
 *
 * A guard that asserts a ground nothing renders on is a guard that gets
 * deleted, so each ground below is one some component really paints.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from '../support/contrast.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

/**
 * The text between the braces of the rule whose selector is `selector`. The
 * selector is matched at the start of a line, so the prose in the file's header
 * comment — which names both of these selectors — is not mistaken for the rule.
 */
function ruleBody(css: string, selector: string): string {
  const at = new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{`, 'm').exec(css);
  if (!at) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', at.index);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

/** Every `--vam-*: <value>;` declaration in a block, by name. */
function tokens(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--vam-[a-z0-9-]+):\s*([^;]+);/g)) {
    out.set(m[1] as string, (m[2] as string).trim());
  }
  return out;
}

const THEMES = [
  { name: 'dark', selector: ':root' },
  { name: 'light', selector: 'html.light' },
] as const;

/** Text grounds: every surface fill a component paints `--vam-ink-*` text on. */
const TEXT_GROUNDS = [
  '--vam-canvas',
  '--vam-sunken',
  '--vam-panel',
  '--vam-header',
  '--vam-sidebar',
] as const;

/** Tokens that carry body text and therefore owe WCAG 1.4.3's 4.5:1. */
const TEXT_TOKENS = [
  '--vam-ink',
  '--vam-ink-dim',
  '--vam-ink-faint',
  '--vam-running',
  '--vam-waiting',
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

    describe(theme.name, () => {
      it('carries text at 4.5:1 or better on every surface it is painted on', () => {
        for (const token of TEXT_TOKENS) {
          for (const ground of TEXT_GROUNDS) {
            const ratio = contrast(hex(token), hex(ground));
            expect(ratio, `${token} on ${ground}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it('reads the waiting amber against its own tint and wash', () => {
        // `StepNode` paints `bg-waiting-tint text-waiting`, and the wash is the
        // same pairing one step quieter. A status colour that fails against the
        // fill its own design pairs it with is the worst case, not a corner one.
        for (const ground of ['--vam-waiting-tint', '--vam-waiting-wash'] as const) {
          const ratio = contrast(hex('--vam-waiting'), hex(ground));
          expect(ratio, `--vam-waiting on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('marks the cursor at 3:1 against the canvas and against a grid dot', () => {
        // A non-text indicator owes 3:1 (WCAG 1.4.11), and the ring is the only
        // thing that says which node the cursor is on — the card border does not
        // vary with focus and the sidebar highlights the SESSION. The grid dot
        // is in here because the ring is 1px and is drawn across the dots.
        for (const ground of ['--vam-canvas', '--vam-dots'] as const) {
          const ratio = contrast(hex('--vam-cursor-ring'), hex(ground));
          expect(ratio, `--vam-cursor-ring on ${ground}`).toBeGreaterThanOrEqual(3);
        }
      });

      it('draws the segmented control border at 3:1 against the fill it encloses', () => {
        // `SettingsOverlay` draws `border-ink-faint` around a `bg-well` fill.
        // The ground is `well`, not `panel` — a comment there once measured the
        // wrong one and recorded a pass the border did not have.
        const ratio = contrast(hex('--vam-ink-faint'), hex('--vam-well'));
        expect(ratio, '--vam-ink-faint on --vam-well').toBeGreaterThanOrEqual(3);
      });
    });
  }
});
