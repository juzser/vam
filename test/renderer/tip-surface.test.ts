/**
 * THE TOOLTIP AS A SURFACE OF ITS OWN, measured in both themes.
 *
 * Operator: "change the tooltip background to a light colour. remove the
 * border."
 *
 * THOSE TWO ARE ONE CHANGE, not two, and the order they arrive in hides it.
 * `--vam-line-tip` exists because of a wall `styles.css` records at the point
 * it defines the token: every surface vam owns sits within 1.33:1 of `panel`
 * in dark, so a tip filled with `raised` (#2c2c2c) floating over the pane
 * (#272727) was 1.07:1 against what was behind it -- a box with no edge --
 * and anything owing WCAG 1.4.11's 3:1 had to buy it with a LINE. Taking the
 * border away does not remove that debt; it moves it onto the fill. So the
 * fill has to become a colour no surface in the palette is near, and "light"
 * is exactly such a colour in the dark theme.
 *
 * WHICH FORCES THE LIGHT THEME TO INVERT, and that is not a taste either. In
 * light, `ground`, `panel` and `card` are all #ffffff: NOTHING is lighter, so
 * a light borderless tip there cannot reach 3:1 by any value at all. A
 * borderless tip is therefore a tip that is the theme turned inside out --
 * filled with the colour the theme WRITES with, written on with a colour near
 * the one the theme is MADE of. Dark gets a light tip, light gets a dark one,
 * which is also the convention every inverted tooltip on the web follows.
 *
 * WHAT IS DERIVED AND WHAT IS CHOSEN. One value is chosen: the fill, and it is
 * chosen as the theme's own ink. Everything else is derived by keeping the
 * reading it has TODAY on `raised` and re-solving it against the new fill --
 * the primary ink at 13.9:1 dark / 15.5:1 light, the dim ink at 6.9 / 6.8, the
 * key chip's edge at 1.27 / 1.26. That is the rule this file holds, so that a
 * later hand cannot quietly dim the tip's text and leave the floors passing.
 *
 * THIS FILE CANNOT SEE PAINT. It reads `styles.css` as data and measures the
 * numbers in it; whether a tooltip on screen actually carries the fill, and
 * whether its border is really gone, is `e2e/tooltip-shots.mjs` -- which
 * measures computed `border-width` and the fill against whatever the tip is
 * genuinely floating over, in a real browser, in both themes.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, lightness } from '../support/contrast.js';
import { ruleBody, THEMES, tokens } from '../support/css-tokens.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

const palette = Object.fromEntries(
  THEMES.map((theme) => [theme.name, tokens(ruleBody(CSS, theme.selector))]),
) as Record<'dark' | 'light', Map<string, string>>;

function hex(theme: 'dark' | 'light', token: string): string {
  const value = palette[theme].get(token);
  if (value === undefined) throw new Error(`${theme} defines no ${token}`);
  return value;
}

/** The four tokens the tip family is, named once. */
const TIP = '--vam-tip';
const ON_TIP = '--vam-on-tip';
const ON_TIP_DIM = '--vam-on-tip-dim';
const ON_TIP_LINE = '--vam-on-tip-line';

/**
 * Every fill a tooltip can find itself over.
 *
 * Not "the surfaces I remember": a tip is portalled to the body and positioned
 * by Radix against an arbitrary trigger, so the honest answer is EVERY surface
 * token in the palette. Listed rather than derived from a prefix match,
 * because a prefix match over `--vam-*` would sweep in the inks and the lines
 * and turn a real floor into an impossible one.
 */
const SURFACES = [
  '--vam-ground',
  '--vam-sunken',
  '--vam-well',
  '--vam-header',
  '--vam-panel',
  '--vam-sidebar',
  '--vam-pane',
  '--vam-raised',
  '--vam-card',
  '--vam-segment-on',
] as const;

/**
 * What each ink read on `raised` before the tip took a fill of its own, per
 * theme. The derivation rule in one table.
 *
 * Written out rather than computed from today's `--vam-raised`: the claim is
 * that the tip's inks were solved against THESE readings, and a later change
 * to `raised` must not silently redefine what the tip was supposed to match.
 */
const KEPT_READINGS = {
  dark: { [ON_TIP]: 13.92, [ON_TIP_DIM]: 6.89, [ON_TIP_LINE]: 1.27 },
  light: { [ON_TIP]: 15.55, [ON_TIP_DIM]: 6.78, [ON_TIP_LINE]: 1.27 },
} as const;

describe('the tooltip surface', () => {
  it('is defined in both themes, as a fill and the three inks that go on it', () => {
    // The corpus first. A missing token throws in `hex`, so a sweep that found
    // nothing would still have to say so.
    const missing: string[] = [];
    for (const theme of ['dark', 'light'] as const) {
      for (const token of [TIP, ON_TIP, ON_TIP_DIM, ON_TIP_LINE]) {
        if (!palette[theme].has(token)) missing.push(`${theme}: ${token}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('identifies itself by its fill alone, over every surface in the palette', () => {
    // THE ASSERTION THE BORDER USED TO CARRY. WCAG 1.4.11 asks 3:1 of a
    // boundary that identifies a component; with no line left, the fill is the
    // boundary. `segment-on` is the worst case in both themes -- the lightest
    // surface in dark and the darkest in light -- and it is not special-cased
    // here, because the next surface someone adds should be measured too.
    const failing: string[] = [];
    let measured = 0;
    for (const theme of ['dark', 'light'] as const) {
      const fill = hex(theme, TIP);
      for (const surface of SURFACES) {
        measured += 1;
        const ratio = contrast(fill, hex(theme, surface));
        if (ratio < 3) failing.push(`${theme}: over ${surface} = ${ratio.toFixed(2)}:1`);
      }
    }
    expect({ measured, failing }).toEqual({ measured: SURFACES.length * 2, failing: [] });
  });

  it('is the theme turned inside out, and stays on that side of every surface', () => {
    // A ratio alone does not say WHICH WAY. A dark theme whose tip drifted
    // darker than the ground would still pass 3:1 and would read as a hole in
    // the screen rather than as something floating over it -- and it would
    // stop being the "light" the operator asked for while every number stayed
    // green.
    const wrongSide: string[] = [];
    for (const theme of ['dark', 'light'] as const) {
      const fill = lightness(hex(theme, TIP));
      for (const surface of SURFACES) {
        const behind = lightness(hex(theme, surface));
        const inverted = theme === 'dark' ? fill > behind : fill < behind;
        if (!inverted) wrongSide.push(`${theme}: ${surface}`);
      }
    }
    expect(wrongSide).toEqual([]);
  });

  it('keeps every reading its inks had before the fill moved under them', () => {
    // The derivation, held as an assertion. Half a point of tolerance: these
    // were solved over 8-bit greys, so the nearest value is not the exact one.
    const drifted: string[] = [];
    for (const theme of ['dark', 'light'] as const) {
      const fill = hex(theme, TIP);
      for (const [token, was] of Object.entries(KEPT_READINGS[theme])) {
        const now = contrast(hex(theme, token), fill);
        if (Math.abs(now - was) > 0.5) {
          drifted.push(`${theme}: ${token} reads ${now.toFixed(2)}:1, was ${was}:1`);
        }
      }
    }
    expect(drifted).toEqual([]);
  });

  it('carries text at 4.5:1 on its own fill, both inks, both themes', () => {
    // The floors, stated separately from the derivation above: if someone
    // re-derives the readings one day, WCAG 1.4.3 still has to hold, and a
    // table of remembered numbers is not that argument.
    const failing: string[] = [];
    for (const theme of ['dark', 'light'] as const) {
      const fill = hex(theme, TIP);
      for (const token of [ON_TIP, ON_TIP_DIM]) {
        const ratio = contrast(hex(theme, token), fill);
        if (ratio < 4.5) failing.push(`${theme}: ${token} = ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failing).toEqual([]);
  });

  it('does not route the tip through an ink the rest of the app is using', () => {
    // The tip's inks are NOT `ink`/`ink-dim` under another name. If they were,
    // the fill would have moved out from under them and the readings above
    // would be coincidences waiting to be broken by an unrelated ink change.
    const shared: string[] = [];
    for (const theme of ['dark', 'light'] as const) {
      for (const token of [TIP, ON_TIP, ON_TIP_DIM, ON_TIP_LINE]) {
        for (const other of ['--vam-ink-dim', '--vam-ink-faint', '--vam-ink-quiet']) {
          if (hex(theme, token) === hex(theme, other)) shared.push(`${theme}: ${token} = ${other}`);
        }
      }
    }
    expect(shared).toEqual([]);
  });
});

describe('the tooltip components', () => {
  const SOURCES = ['src/renderer/panels/Note.tsx', 'src/renderer/keyboard/ShortcutTip.tsx'].map(
    (path) => ({ path, text: readFileSync(resolve(process.cwd(), path), 'utf8') }),
  );

  it('draws its tips with the tip fill', () => {
    // A NEGATIVE SCAN IS THE ONLY SAFE KIND HERE. An earlier guard in this
    // repo checked that a class string was PRESENT in a file and was satisfied
    // by finding it inside a comment -- prose passed it while nothing painted.
    // The inverse cannot fail that way: prose containing a forbidden class
    // makes this redder, never greener. What it cannot prove is that the tip
    // paints at all, which is why `e2e/tooltip-shots.mjs` measures computed
    // `border-width` and the fill in a real browser.
    const stale: string[] = [];
    for (const { path, text } of SOURCES) {
      for (const match of text.matchAll(/className="([^"]*)"/g)) {
        const classes = match[1] as string;
        if (!classes.includes('shadow-tip')) continue;
        if (/\bborder\b/.test(classes)) stale.push(`${path}: the tip still draws a border`);
        if (!classes.includes('bg-tip')) stale.push(`${path}: the tip is not filled with bg-tip`);
        if (/\btext-ink(-|\b)/.test(classes)) stale.push(`${path}: the tip still uses a page ink`);
      }
    }
    // The corpus, because a regex that matched nothing would pass the above
    // forever: both files carry exactly one tip.
    const found = SOURCES.flatMap(({ text }) =>
      [...text.matchAll(/className="([^"]*shadow-tip[^"]*)"/g)].map((m) => m[1]),
    );
    expect({ tips: found.length, stale }).toEqual({ tips: 2, stale: [] });
  });
});
