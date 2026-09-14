/**
 * THE DARK LADDER, THIRD PASS -- SEPARATION, NOT ANOTHER LIFT.
 *
 * Operator, a third time: "make the dark UI a bit lighter, and you may re-pick
 * the default colours." Two earlier passes both answered "too dark" -- +3 L*
 * on every grey, then raising the reading surface (`--vam-pane`) to L* 15.64.
 * The complaint came back anyway, which is the tell that it was never fully
 * about darkness. Measured before this pass touched anything:
 *
 *   ground #1c1c1c 10.27, sunken #1e1e1e 11.26 (+1.00), well #1f1f1f 11.76
 *   (+0.49), header #202020 12.25 (+0.49), panel #242424 14.20 (+1.95),
 *   sidebar/pane #272727 15.64 (+1.44 / +0.00, same by design), raised
 *   #2c2c2c 18.00 (+2.36), card #2e2e2e 18.94 (+0.93).
 *
 * SEVEN OF THE EIGHT GAPS SAT UNDER THE 2.3 L* JUST-NOTICEABLE DIFFERENCE.
 * A uniform lift preserves every pairwise L* difference exactly -- both
 * earlier passes said so of themselves -- so no uniform shift, however large,
 * could ever have closed that gap. This file replaces `dark-lift.test.ts`,
 * which held a [2.3, 6.0] PER-TOKEN band against a lift that no longer
 * describes what this pass does: this pass pins `--vam-ground` exactly and
 * widens the SPACING between the eight distinct dark surfaces instead, so the
 * claim below is about the SORTED ladder, not about the pairs a previous
 * guard happened to already have wired up.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is `describe('every distinct rung...')`
 * below: sort the eight dark surfaces by lightness and require EVERY adjacent
 * gap to clear the JND, with no exception for a "subtle" rung. A future edit
 * that walks one surface back towards its neighbour, or a fresh uniform
 * shift that (by definition) cannot touch the gaps at all, reddens here.
 *
 * `e2e/pane-colour-shots.mjs` re-measures the same ladder as PAINT, because a
 * token list cannot prove a CSS rule reached a real element.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chroma, contrast, deltaE, lightness } from '../support/contrast.js';
import { ruleBody, tokens } from '../support/css-tokens.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
const dark = tokens(ruleBody(CSS, ':root'));
const light = tokens(ruleBody(CSS, 'html.light'));

const hex = (from: Map<string, string>, name: string): string => {
  const value = from.get(name);
  expect(value, `${name} is defined`).toBeDefined();
  return value as string;
};

/** The just-noticeable difference in CIE L*, the same floor every pass here uses. */
const JND = 2.3;

/**
 * The eight distinct dark surfaces, deepest first, with the one pair that is
 * deliberately equal (`sidebar` / `pane`, split at the operator's own ask so
 * the two settings can diverge -- they still start on the same value).
 */
const SURFACE_LADDER = [
  ['--vam-ground'],
  ['--vam-sunken'],
  ['--vam-well'],
  ['--vam-header'],
  ['--vam-panel'],
  ['--vam-sidebar', '--vam-pane'],
  ['--vam-raised'],
  ['--vam-card'],
] as const;

/**
 * `--vam-segment-on` is not part of `SURFACE_LADDER`: it is not one of the
 * eight the operator's own complaint enumerated (ground through card), but it
 * IS the ninth rung `dark-lift.test.ts` used to guard, and it has to clear
 * `--vam-card` by a JND too or the top of the ladder mushes back together the
 * moment `--vam-card` moves. Held separately because its floor is looser: it
 * only has one neighbour, not two.
 */
const SEGMENT_ON = '--vam-segment-on';

/**
 * PINNED, TO THE PIXEL. Both earlier fixes to "too dark" stand; this pass
 * does not touch the deepest surface a third time. A uniform lift is now
 * structurally unable to reach through this file: any edit that moves ground
 * reddens here directly, and any edit that moves everything BUT ground by a
 * constant is still a uniform lift on the seven surfaces above it -- which
 * `keeps the light theme exactly where it was` below and the "no two rungs
 * collapse" assertion together are what would catch.
 */
const GROUND_PINNED = '#1c1c1c';

/** The two HELD tokens, unmoved across all three passes, and why is in `styles.css`. */
const HELD = {
  '--vam-ink': '#ededed',
  '--vam-on-running': '#0a0a0a',
} as const;

/**
 * Every quiet ink, and the 4.5:1 floor it owes wherever it carries text. The
 * lightest of the seven text grounds (`--vam-card`, the ceiling this exact
 * token bounds) is what matters here -- `token-contrast.test.ts` already
 * sweeps every ground per token; this file's job is narrower: prove the two
 * that moved THIS pass (`ink-faint` / `ink-quiet`, which share a value) still
 * clear the floor on the surface that climbed furthest, so a future edit that
 * quietly walks `--vam-card` up again without checking its ink cannot pass by
 * accident.
 */
const QUIET_INKS_ON_CARD = {
  '--vam-ink-dim': 4.5,
  '--vam-ink-faint': 4.5,
  '--vam-ink-quiet': 4.5,
} as const;

/**
 * The status hues this pass had to lighten so their fixed hex would keep
 * clearing 4.5:1 against the widened `--vam-card` -- new territory: neither
 * earlier pass touched a status colour. `--vam-waiting` and `--vam-running`
 * did NOT need to move and are asserted UNCHANGED below, so a future reader
 * can tell "moved because it had to" from "moved because everything did".
 */
const LIGHTENED_STATUS = ['--vam-idle', '--vam-done', '--vam-failed', '--vam-danger'] as const;
const UNCHANGED_STATUS = {
  '--vam-waiting': '#f59e0b',
  '--vam-running': '#4ade80',
  '--vam-filter-badge': '#f59e0b',
  '--vam-cursor-ring': '#f59e0b',
} as const;

describe('the dark ladder: eight surfaces, seven gaps, every one a JND', () => {
  it('read a real corpus: every ladder token is a six-digit hex in both theme blocks', () => {
    const names = SURFACE_LADDER.flat();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(hex(dark, n), n).toMatch(/^#[0-9a-f]{6}$/i);
      expect(hex(light, n), n).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('pins --vam-ground to the exact value both earlier passes left it at', () => {
    expect(hex(dark, '--vam-ground')).toBe(GROUND_PINNED);
  });

  it('keeps the two held tokens exactly as they were', () => {
    for (const [name, value] of Object.entries(HELD)) {
      expect(hex(dark, name), name).toBe(value);
    }
  });

  it('climbs strictly, sidebar and pane still equal, and no two rungs collapse', () => {
    const rungs = SURFACE_LADDER.map((names) => ({
      names: names.join('='),
      light: lightness(hex(dark, names[0])),
      sameValue: names.every((n) => hex(dark, n) === hex(dark, names[0])),
    }));
    expect(rungs.every((r) => r.sameValue)).toBe(true);
    expect(rungs.map((r) => r.light)).toEqual([...rungs.map((r) => r.light)].sort((a, b) => a - b));
    expect(new Set(rungs.map((r) => Number(r.light.toFixed(2)))).size).toBe(SURFACE_LADDER.length);
  });

  /**
   * THE ASSERTION THIS FILE WAS WRITTEN FOR. Sorted, not "the pairs a
   * previous pass happened to check" -- every adjacent gap in the ladder,
   * whether or not the two surfaces are ever adjacent on screen, has to clear
   * a JND. A flat ladder -- the defect that survived two lifts -- is
   * mathematically unable to pass this: `MUTATE one rung back to its second-
   * pass value and this test is what reddens (see the commit message for the
   * exact mutation and the exact name).
   */
  it('clears a JND between every adjacent rung, sorted by lightness', () => {
    const rungs = SURFACE_LADDER.map((names) => ({
      label: names.join('/'),
      light: lightness(hex(dark, names[0])),
    }));
    const gaps = rungs.slice(1).map((r, i) => ({
      pair: `${rungs[i]?.label} -> ${r.label}`,
      gap: Number((r.light - (rungs[i]?.light as number)).toFixed(3)),
    }));
    expect({
      measured: gaps.length,
      tooNarrow: gaps.filter((g) => g.gap < JND),
    }).toEqual({ measured: SURFACE_LADDER.length - 1, tooNarrow: [] });
  });

  it('spans 16-18 L* from ground to card, the shape eight genuinely distinct rungs needs', () => {
    const span = lightness(hex(dark, '--vam-card')) - lightness(hex(dark, '--vam-ground'));
    expect(span).toBeGreaterThanOrEqual(16);
    expect(span).toBeLessThanOrEqual(18.5);
  });

  it('keeps segment-on a JND clear of the widened card, and the lightest rung there is', () => {
    const card = lightness(hex(dark, '--vam-card'));
    const segmentOn = lightness(hex(dark, SEGMENT_ON));
    expect(segmentOn - card).toBeGreaterThanOrEqual(JND);
    const allOthers = SURFACE_LADDER.flat().map((n) => lightness(hex(dark, n)));
    expect(Math.max(...allOthers)).toBeLessThan(segmentOn);
  });

  it('leaves the light theme exactly where the artboard put it', () => {
    // The operator asked about DARK. Every token this pass could have moved,
    // read out of `html.light` and compared against the values that block
    // carried before this pass -- which are also the values it has carried
    // since the reskin, since neither earlier pass touched light either.
    const LIGHT_UNCHANGED = {
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
      '--vam-ansi-black': '#3f3f46',
      '--vam-in-bubble': '#f1fefe',
      '--vam-waiting-tint': '#f6dcae',
      '--vam-waiting-wash': '#fdf6e8',
      '--vam-done-tint': '#c0d3f4',
      '--vam-waiting': '#92400e',
      '--vam-running': '#166534',
      '--vam-idle': '#52525b',
      '--vam-done': '#1d4ed8',
      '--vam-failed': '#b91c1c',
      '--vam-danger': '#be123c',
      '--vam-rule-progress': '#6d28d9',
      '--vam-rule-out': '#be185d',
    } as const;
    expect(Object.fromEntries(Object.keys(LIGHT_UNCHANGED).map((n) => [n, hex(light, n)]))).toEqual(
      LIGHT_UNCHANGED,
    );
  });

  it('keeps every quiet ink at 4.5:1 or better on the surface that climbed furthest', () => {
    const card = hex(dark, '--vam-card');
    const measured = Object.entries(QUIET_INKS_ON_CARD).map(([name, floor]) => ({
      name,
      ratio: Number(contrast(hex(dark, name), card).toFixed(3)),
      floor,
    }));
    expect(measured.filter((m) => m.ratio < m.floor)).toEqual([]);
  });

  it('lightens exactly the status hues that needed it, hue held, and leaves the rest alone', () => {
    const card = hex(dark, '--vam-card');
    for (const name of LIGHTENED_STATUS) {
      expect(contrast(hex(dark, name), card), name).toBeGreaterThanOrEqual(4.5);
    }
    for (const [name, value] of Object.entries(UNCHANGED_STATUS)) {
      expect(hex(dark, name), name).toBe(value);
    }
  });

  it('keeps the In bubble on the band this palette can still buy: ratio, distance, and its own ink', () => {
    const bubble = hex(dark, '--vam-in-bubble');
    const pane = hex(dark, '--vam-pane');
    expect(contrast(bubble, pane)).toBeGreaterThanOrEqual(1.4);
    expect(deltaE(bubble, pane)).toBeGreaterThanOrEqual(6.24);
    expect(contrast(hex(dark, '--vam-ink'), bubble)).toBeGreaterThanOrEqual(4.5);
    // NO LONGER a hue: the operator's next round dropped the teal for a
    // plain grey ("a colour that contrasts with the panel background", read
    // against the surface the bubble is actually drawn on, `--vam-pane`).
    // What this assertion used to hold -- "still reads as the In region's
    // own colour" -- is exactly the property that stopped being true, so it
    // now asserts the opposite: a chroma this close to zero is what "grey"
    // means, and a future edit that reaches for a hue again fails here.
    expect(chroma(bubble)).toBeLessThan(1);
  });

  it('reads the waiting amber at 4.5:1 or better on its own tint and wash', () => {
    // THE FLOOR THAT COST `--vam-waiting-tint` ITS "KEEP THE PANE READING"
    // RULE THIS PASS. See its own comment in `styles.css`: this is the
    // assertion that made that trade necessary, held directly so a future
    // edit that reaches for "restore the old reading" cannot silently drop
    // it again.
    const waiting = hex(dark, '--vam-waiting');
    expect(contrast(waiting, hex(dark, '--vam-waiting-tint'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(waiting, hex(dark, '--vam-waiting-wash'))).toBeGreaterThanOrEqual(4.5);
  });

  it('holds the ANSI black clear of 3:1 on the panel, and clear of ANSI bright black', () => {
    const ansiBlack = hex(dark, '--vam-ansi-black');
    expect(contrast(ansiBlack, hex(dark, '--vam-panel'))).toBeGreaterThanOrEqual(3);
    expect(lightness(ansiBlack)).toBeLessThan(lightness(hex(dark, '--vam-ansi-bright-black')));
  });
});
