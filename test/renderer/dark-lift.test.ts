/**
 * THE DARK LIFT, MEASURED AGAINST THE PALETTE IT REPLACED.
 *
 * Operator, on the dark theme: "make the dark UI a bit lighter". A BIT is the
 * whole specification, and this file is what turns it into a number that can
 * fail in both directions.
 *
 * THE LIFT IS +3 L*. CIE lightness only: a* and b* are carried across
 * untouched, so no hue and no chroma moves — the teal bubble is the same teal,
 * the amber tint the same amber, the greys the same neutrals. On a neutral
 * grey +3 L* is ΔE 3.0, about 1.3x the ~2.3 at which a person reliably sees a
 * difference. One visible step, not two.
 *
 * WHY A LIGHTNESS LIFT AND NOT "ADD 6 TO EVERY CHANNEL". Equal steps in 8-bit
 * sRGB are not equal steps to the eye down here: +6 lifts `--vam-ground`
 * (#0a0a0a) by 1.94 L* and `--vam-pane` (#171717) by 3.03, so the deepest
 * surfaces would have moved least and the ladder would have compressed at the
 * bottom. Adding a constant in L* preserves every pairwise L* difference in
 * the palette exactly — which is the property the rest of this repo's colour
 * guards are written against: `surface-elevation.test.ts` asserts a card is
 * lighter than the pane, `token-contrast.test.ts` asserts nine inks clear
 * 4.5:1 on seven grounds, and both had to survive this change rather than be
 * re-baselined by it.
 *
 * WHY THE TABLE BELOW IS THE OLD PALETTE AND NOT THE NEW ONE, which is the
 * whole design of this file. A guard that lists what `styles.css` says today
 * passes again tomorrow on whatever it says then: it records the code, so the
 * code can never contradict it. What is recorded here is where the palette
 * WAS — the values this branch found in the file — and every assertion is
 * about the DISTANCE travelled from there. Walk any token back and the
 * distance goes to zero and this file goes red; overshoot it and the ceiling
 * catches that too.
 *
 * `e2e/pane-colour-shots.mjs` measures the same lift as PAINT in a real
 * browser, because a token list cannot prove a rule matched anything.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deltaE, lightness } from '../support/contrast.js';
import { ruleBody, tokens } from '../support/css-tokens.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

/**
 * THE DARK PALETTE BEFORE THE LIFT, token by token — the artboard's own dark
 * values as they stood at `ace5bd7`, and the baseline every number in this
 * file is measured from.
 *
 * Every grey the theme paints is here: the ten surfaces, the five line
 * weights, the three quiet inks, the decorative ghost and the four tinted
 * grounds. Not here, deliberately, are the ones held still — see
 * `HELD` below — and the hues that are measured AGAINST these rather than
 * being surfaces themselves (status, ANSI, syntax, diff, the section rules):
 * those keep their values and their readings were re-derived against the
 * lifted grounds instead.
 */
const BEFORE_THE_LIFT = {
  // Surfaces, deepest first.
  '--vam-ground': '#0a0a0a',
  '--vam-sunken': '#0f0f0f',
  '--vam-well': '#101010',
  '--vam-header': '#111111',
  '--vam-panel': '#141414',
  '--vam-sidebar': '#171717',
  '--vam-pane': '#171717',
  '--vam-raised': '#1a1a1a',
  '--vam-card': '#1d1d1d',
  '--vam-segment-on': '#262626',
  // Lines. They separate the surfaces above, so they move with them or the
  // seams close: `line` on `pane` was 1.088:1 before the lift and would have
  // been 1.021:1 after it if it had stayed put.
  '--vam-line': '#1f1f1f',
  '--vam-line-strong': '#262626',
  '--vam-line-loud': '#2e2e2e',
  '--vam-line-loudest': '#4a4a4a',
  '--vam-line-tip': '#6b6b6b',
  // The quiet inks. Light-on-dark text LOSES contrast when its ground rises,
  // so these are not decoration: `ink-faint` measured 4.568:1 on the old card
  // and would read 4.259:1 on the lifted one — under WCAG 1.4.3. They move
  // the same 3 L* as the surfaces, which is what keeps every ratio in
  // `token-contrast.test.ts` where it was (worst pair now 4.735:1, was 4.568).
  '--vam-ink-dim': '#a1a1a1',
  '--vam-ink-faint': '#858585',
  '--vam-ink-quiet': '#858585',
  '--vam-ink-ghost': '#3f3f3f',
  // The tinted grounds, and the In bubble that is calibrated against them.
  // The bubble's whole specification is "as loud as a status tint and no
  // louder", so the tints and the bubble have to travel together or that
  // sentence stops being true of anything.
  '--vam-in-bubble': '#0f3b35',
  '--vam-waiting-tint': '#3f2f12',
  '--vam-waiting-wash': '#161208',
  '--vam-done-tint': '#24354d',
} as const;

/**
 * THE TWO VALUES THE LIFT DELIBERATELY DID NOT TOUCH, pinned so that "not
 * lifted" is a decision on the record rather than an omission nobody noticed.
 *
 *  - `--vam-ink` is the brightest text in the theme and owes nothing to a
 *    floor: it reads 13.42:1 on the lifted card, where 4.5 is the
 *    requirement. Lifting the brightest ink on a dark theme adds glare, and
 *    glare is not what "a bit lighter" asked for. The two quiet greys moved
 *    because their floors made them move; this one had no such argument.
 *  - `--vam-on-running` is the near-black the Agents badge draws ON dark's
 *    bright green, and its own comment in `styles.css` always said it was a
 *    separate decision that happened to agree with `--vam-ground`. They stop
 *    agreeing here: the ground lifted to #131313 and the ink on the green did
 *    not, because lifting it would only cost the badge contrast (11.36:1).
 */
const HELD = {
  '--vam-ink': '#ededed',
  '--vam-on-running': '#0a0a0a',
} as const;

/**
 * The step, in CIE lightness.
 *
 * FLOOR: 2.3 is the classic just-noticeable ΔE. A lift smaller than one JND
 * is a lift the operator cannot see, which is the failure this whole change
 * would be.
 *
 * CEILING: 6.0, about two JNDs and twice the step taken. "A bit" is in the
 * request, and a palette that drifts up one well-meaning patch at a time
 * ends somewhere nobody chose. An edit that genuinely wants more lift can
 * raise this line, in the open, with a number on it.
 */
const JND = 2.3;
const CEILING = 6;

/**
 * The surface ladder `styles.css` documents, deepest first, with the one pair
 * that is deliberately equal. Order is the thing the lift most easily breaks:
 * every surface's relationship to the surfaces above and below it has to
 * survive, not just its absolute value.
 */
const LADDER = [
  ['--vam-ground'],
  ['--vam-sunken'],
  ['--vam-well'],
  ['--vam-header'],
  ['--vam-panel'],
  // Split from `sidebar` at the operator's ask; the two still start equal.
  ['--vam-sidebar', '--vam-pane'],
  ['--vam-raised'],
  ['--vam-card'],
  ['--vam-segment-on'],
] as const;

const dark = tokens(ruleBody(CSS, ':root'));
const light = tokens(ruleBody(CSS, 'html.light'));

const hex = (from: Map<string, string>, name: string): string => {
  const value = from.get(name);
  expect(value, `${name} is defined`).toBeDefined();
  return value as string;
};

describe('the dark palette sits one visible step above the palette it replaced', () => {
  it('read a real corpus: every lifted token is a six-digit hex in both theme blocks', () => {
    // The assertions below are relative, and a missing token compares against
    // nothing at all. So the count and the shape come first -- this repo has
    // shipped four guards that passed having examined zero files.
    const names = Object.keys(BEFORE_THE_LIFT);
    expect(names).toHaveLength(23);
    expect(
      names.filter(
        (n) =>
          !/^#[0-9a-f]{6}$/i.test(dark.get(n) ?? '') || !/^#[0-9a-f]{6}$/i.test(light.get(n) ?? ''),
      ),
    ).toEqual([]);
  });

  it('lifts every one of them by at least a just-noticeable step, and by no more than a bit', () => {
    const moved = Object.entries(BEFORE_THE_LIFT).map(([name, was]) => {
      const now = hex(dark, name);
      const step = lightness(now) - lightness(was);
      return { name, was, now, step: Number(step.toFixed(2)) };
    });
    // Reported as a list of the ones that fell outside the band, with their
    // numbers, so a failure names the token and the distance rather than
    // saying `false`.
    expect({
      measured: moved.length,
      outside: moved.filter((m) => m.step < JND || m.step > CEILING),
    }).toEqual({ measured: 23, outside: [] });
  });

  it('moves lightness only — no hue, no chroma', () => {
    // ΔE is the whole distance travelled; the L* step is the part that was
    // asked for. Whatever is left is hue and chroma drift, and it may only be
    // 8-bit rounding: the teal bubble must still be that teal, the amber tint
    // still that amber. sqrt(ΔE² - ΔL²) is that residue.
    const drift = Object.entries(BEFORE_THE_LIFT).map(([name, was]) => {
      const now = hex(dark, name);
      const dl = lightness(now) - lightness(was);
      const de = deltaE(was, now);
      return { name, drift: Number(Math.sqrt(Math.max(0, de * de - dl * dl)).toFixed(2)) };
    });
    expect({
      measured: drift.length,
      drifted: drift.filter((d) => d.drift > 1),
    }).toEqual({ measured: 23, drifted: [] });
  });

  it('keeps the two values it deliberately held', () => {
    expect(Object.fromEntries(Object.keys(HELD).map((n) => [n, hex(dark, n)]))).toEqual(HELD);
  });

  it('keeps the surface ladder in the order the stylesheet documents', () => {
    // Each rung strictly above the one below it, and the pair that is
    // deliberately equal still equal. `pane` was split off `sidebar` so the
    // two can diverge; until someone moves one they are the same colour, and
    // a lift that quietly separated them would be a split nobody asked for.
    const rungs = LADDER.map((names) => ({
      names: names.join('='),
      light: Number(lightness(hex(dark, names[0])).toFixed(2)),
      sameValue: names.every((n) => hex(dark, n) === hex(dark, names[0])),
    }));
    expect(rungs.every((r) => r.sameValue)).toBe(true);
    expect(rungs.map((r) => r.light)).toEqual([...rungs.map((r) => r.light)].sort((a, b) => a - b));
    // And strictly: no two rungs may collapse onto one another.
    expect(new Set(rungs.map((r) => r.light)).size).toBe(LADDER.length);
  });

  it('leaves the light theme exactly where the artboard put it', () => {
    // The operator asked about DARK. This is the pin that makes "and light
    // did not move" a measurement instead of a promise: the same 23 tokens,
    // read out of `html.light`, against the values that block has carried
    // since the reskin. A deliberate light change edits this table and says
    // why in the commit.
    expect(Object.fromEntries(Object.keys(BEFORE_THE_LIFT).map((n) => [n, hex(light, n)]))).toEqual(
      {
        '--vam-ground': '#ffffff',
        '--vam-sunken': '#fafaf9',
        '--vam-well': '#eeece7',
        '--vam-header': '#f4f4f2',
        '--vam-panel': '#ffffff',
        '--vam-sidebar': '#f0eeea',
        '--vam-pane': '#f0eeea',
        '--vam-raised': '#f0f0ee',
        '--vam-card': '#ffffff',
        '--vam-segment-on': '#e2e0da',
        '--vam-line': '#e4e4e1',
        '--vam-line-strong': '#d6d6d2',
        '--vam-line-loud': '#c9c7c1',
        '--vam-line-loudest': '#8f8f8a',
        '--vam-line-tip': '#86868b',
        '--vam-ink-dim': '#52525b',
        '--vam-ink-faint': '#6a6a6f',
        '--vam-ink-quiet': '#6a6a6f',
        '--vam-ink-ghost': '#a8a8a3',
        '--vam-in-bubble': '#eafff9',
        '--vam-waiting-tint': '#f6dcae',
        '--vam-waiting-wash': '#fdf6e8',
        '--vam-done-tint': '#c0d3f4',
      },
    );
  });
});
