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

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
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

/**
 * The same colour one 8-bit step darker, for the question "could this rung
 * have gone lower?" -- which is the fifth pass's own claim and is otherwise
 * only assertable by typing the answer.
 */
const oneStepDarker = (value: string): string => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  expect(m, `${value} is a six-digit hex`).not.toBeNull();
  const down = (pair: string): string =>
    Math.max(0, Number.parseInt(pair, 16) - 1)
      .toString(16)
      .padStart(2, '0');
  return `#${down((m as RegExpExecArray)[1] as string)}${down((m as RegExpExecArray)[2] as string)}${down((m as RegExpExecArray)[3] as string)}`;
};

const RENDERER_DIR = resolve(process.cwd(), 'src/renderer');

/** Every `.ts`/`.tsx` file the renderer ships, for the sweep below. */
function rendererSources(dir: string = RENDERER_DIR): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...rendererSources(full));
    else if (['.ts', '.tsx'].includes(extname(e.name))) out.push(full);
  }
  return out;
}

/**
 * Source with its COMMENTS TAKEN OUT, and that is load-bearing rather than
 * tidy. The sweep below asks whether anything PAINTS `header`, and the one
 * place in the renderer that says `bg-header` is the JSX comment in
 * `DetailPanel.tsx` recording that the composer stopped painting it -- prose
 * that is evidence FOR the claim and would be read by a plain regex as
 * evidence against it. A scan that cannot tell code from prose is the repo's
 * own standing lesson; here it would fire in the direction that makes the
 * guard useless, so the prose is removed before the question is asked.
 *
 * Block comments only, plus `//` lines that start one. A `//` mid-line is
 * left alone so a URL inside a string cannot silently truncate a real call
 * site out of the corpus.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

/** The just-noticeable difference in CIE L*, the same floor every pass here uses. */
const JND = 2.3;

/**
 * The dark surfaces, deepest first, GROUPED BY RUNG rather than by token --
 * because two of the groups now hold more than one name.
 *
 * `sidebar` / `pane` were the first, split at the operator's own ask so the
 * two settings could diverge; they still start on the same value.
 *
 * `header` / `panel` are the second, and the fifth pass put them there. Eight
 * rungs became SEVEN, which is the whole reason that pass had anything to
 * spend: `--vam-header` is painted by nothing in the renderer (the test below
 * proves it, by sweep, rather than by this sentence), and an unworn fill was
 * standing on 2.45 L* of a ladder whose every other rung was arguing over
 * tenths. Sharing `panel`'s value costs nothing on screen and lets `panel`
 * and everything above it descend a rung. See `styles.css`.
 */
const SURFACE_LADDER = [
  ['--vam-ground'],
  ['--vam-sunken'],
  ['--vam-well'],
  ['--vam-header', '--vam-panel'],
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
/**
 * THE GROUND MOVED, on the operator's own fourth ask -- "cả nền cũng cần tối
 * hơn", the ground needs to be darker too -- and this constant moves with it
 * rather than being deleted.
 *
 * The third pass pinned #1c1c1c and this file asserted it, for a reason worth
 * keeping: two passes in a row had answered "flat" with a uniform lift, and a
 * uniform lift moves the anchor first. Pinning the anchor is what made a
 * fourth uniform lift structurally unable to pass as a fix for separation.
 * That reasoning is about DRIFT, not about the value -- so the pin follows
 * the deliberate move and still refuses the accidental one.
 */
const GROUND_PINNED = '#141414';

/**
 * THE FIFTH PASS'S ASK, AND THE ONLY ASSERTION IN THIS FILE THAT ENCODES IT.
 *
 * Operator: make the pane, the panel, the sidebar, the card and the bubble
 * darker. FIVE NAMES, and every one of them is in the upper half of a ladder
 * whose rungs sit a bare JND apart -- so the shape assertions above cannot
 * express this request at all. They are satisfied by a ladder that is well
 * spaced ANYWHERE, including exactly where it already was, and they would go
 * on passing through a re-balance that moved four of the five and left the
 * fifth. That is the failure mode this test exists for: it names the five,
 * records where the FOURTH pass left each one, and requires each to have come
 * DOWN by a real step.
 *
 * `DARKENED_BY` IS 2 L*, NOT THE 2.3 JND EVERY GAP OWES, and the difference is
 * deliberate rather than slack. A gap is a claim about two surfaces being told
 * APART; this is a claim about one surface having MOVED, and the ladder's own
 * arithmetic caps what is available: with `--vam-ground` pinned and every gap
 * still owing a JND, the lowest legal value for `panel` is 2.40 L* under where
 * it was, and the bubble -- held up by the multiple `surface-elevation.
 * test.ts` measures it off `raised` by -- can only reach 2.19. A floor of 2.3
 * here would have demanded more than the ladder can pay, and the only way to
 * pay it is to spend a gap. That is the one thing the operator has complained
 * about twice, so the floor is set under it on purpose. `styles.css` carries
 * the arithmetic; `e2e/pane-colour-shots.mjs` re-asks the same question of the
 * PAINT, which is the half a token list cannot answer.
 */
const FOURTH_PASS_NAMED = {
  '--vam-panel': '#282828',
  '--vam-sidebar': '#2d2d2d',
  '--vam-pane': '#2d2d2d',
  '--vam-card': '#393939',
  '--vam-in-bubble': '#464646',
} as const;
const DARKENED_BY = 2;

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

  it('pins --vam-ground to the value the fourth pass placed it at', () => {
    expect(hex(dark, '--vam-ground')).toBe(GROUND_PINNED);
  });

  it('takes all five surfaces the operator named below where the fourth pass left them', () => {
    // Read as a table rather than a loop of bare expectations, so a failure
    // names WHICH of the five stood still and by how much the other four
    // moved -- the shape of this request's one likely wrong answer.
    const moved = Object.entries(FOURTH_PASS_NAMED).map(([name, before]) => ({
      name,
      by: Number((lightness(before) - lightness(hex(dark, name))).toFixed(2)),
    }));
    expect(moved.length).toBe(5);
    expect(moved.filter((m) => m.by < DARKENED_BY)).toEqual([]);
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

  /**
   * THE SPAN, DERIVED FROM THE RUNG COUNT RATHER THAN TYPED.
   *
   * It used to read "16 to 18.5 L*, the shape eight genuinely distinct rungs
   * needs" -- a pair of literals that were correct for eight rungs and said
   * nothing about why. The fifth pass merged two of them, and a literal band
   * cannot tell "a rung was removed on purpose" from "a rung collapsed by
   * accident": it just goes red at a number nobody can re-derive.
   *
   * So the band is computed. The FLOOR is one JND per gap, which is the same
   * claim the gap test above makes, restated end to end. The CEILING is what
   * this pass is actually about: a ladder whose average gap runs far over the
   * JND is spending lightness it does not need, and lightness is exactly what
   * the operator keeps asking to have back. 1.25 leaves real room -- the
   * fourth pass ran at 1.096 JND per gap and this one at 1.115 -- while still
   * failing a ladder that has quietly inflated.
   */
  it('spans one JND per gap, and not much more than one — measured, not typed', () => {
    const gaps = SURFACE_LADDER.length - 1;
    const span = lightness(hex(dark, '--vam-card')) - lightness(hex(dark, '--vam-ground'));
    expect(gaps).toBe(6);
    expect(span).toBeGreaterThanOrEqual(gaps * JND);
    expect(span).toBeLessThanOrEqual(gaps * JND * 1.25);
  });

  /**
   * THE CLAIM THAT MAKES THIS PASS FINISHED RATHER THAN PARTIAL.
   *
   * "Darker" has no natural stopping point, and the honest answer to it is
   * not a number somebody liked but the FLOOR: `panel` and `pane` are as dark
   * as this ladder can legally paint them with `--vam-ground` pinned, because
   * one 8-bit step further puts each of them inside a JND of the rung below.
   * Asserted by actually taking that step and measuring it, so the statement
   * survives a future edit to `JND`, to the rungs beneath, or to the values
   * themselves -- and so an edit that walks either one back UP has to come
   * here and explain itself rather than quietly passing the gap test with
   * room to spare.
   *
   * Only these two. `raised`, `card` and `segment-on` sit above their JND
   * floors on purpose (see `styles.css`): each is held up by a second
   * constraint -- a `pane-colour-shots.mjs` ratchet, or a refusal to ship a
   * gap that clears by a hundredth -- and a floor test would read those
   * reasons as slack.
   */
  it('leaves panel and pane at the darkest value the ladder can legally give them', () => {
    const below = { '--vam-panel': '--vam-well', '--vam-pane': '--vam-panel' } as const;
    const measured = Object.entries(below).map(([rung, under]) => {
      const floor = lightness(hex(dark, under)) + JND;
      return {
        rung,
        clearsItsFloor: lightness(hex(dark, rung)) >= floor,
        oneStepLowerWouldNot: lightness(oneStepDarker(hex(dark, rung))) < floor,
      };
    });
    expect(measured).toEqual([
      { rung: '--vam-panel', clearsItsFloor: true, oneStepLowerWouldNot: true },
      { rung: '--vam-pane', clearsItsFloor: true, oneStepLowerWouldNot: true },
    ]);
  });

  /**
   * WHY `header` MAY SHARE `panel`'S VALUE, ASKED OF THE RENDERER RATHER THAN
   * ASSUMED. The merge is what paid for this pass, and it is only sound while
   * nothing paints the fill: two names on one rung are free when one of them
   * is never drawn, and a bug the moment it is. The day something wears
   * `header` again it needs its own rung back and the five surfaces above it
   * have to be re-derived to pay for it -- this is the test that says so.
   *
   * THE SWEEP IS OVER SOURCE TEXT AND THAT IS THE RIGHT CORPUS HERE. The
   * question is "does any file NAME this fill", which the file's own text is
   * direct evidence of -- the same distinction `token-contrast.test.ts` draws
   * for its marker scan. It is not standing in for a rendered measurement:
   * there is nothing to render, which is the point.
   */
  it('shares panel’s value with header only for as long as nothing paints header', () => {
    const files = rendererSources();
    // A SWEEP THAT READ NO FILES REPORTS NO PAINTERS. Four guards in this
    // repo have already gone green having examined zero of them.
    expect(files.length).toBeGreaterThan(20);
    const painters = files.filter((file) =>
      /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow)-header\b|--(?:color|vam)-header\b/.test(
        withoutComments(readFileSync(file, 'utf8')),
      ),
    );
    expect(painters.map((f) => f.slice(RENDERER_DIR.length + 1))).toEqual([]);
    expect(hex(dark, '--vam-header')).toBe(hex(dark, '--vam-panel'));
  });

  /**
   * `html.light` IS `:root`, WHICH MAKES A FORGOTTEN PAIR INVISIBLE RATHER
   * THAN BROKEN. The light block overrides the dark one; a surface whose dark
   * value moves and whose light value is left pointing at it does not vanish,
   * it FALLS THROUGH, and every assertion in this file that only reads `dark`
   * goes on passing while the light theme paints a dark room.
   *
   * `leaves the light theme exactly where the artboard put it` above pins the
   * light values one by one and would catch that today. This is the same
   * claim made structurally instead of by table: it cannot go stale when a
   * token is added, and it states the property -- the two themes are
   * different colours on every surface -- rather than a list of colours.
   */
  it('gives every surface a value of its own in each theme, so none falls through', () => {
    const names = [...SURFACE_LADDER.flat(), SEGMENT_ON, '--vam-in-bubble'];
    expect(names.length).toBe(11);
    expect(names.filter((n) => hex(dark, n) === hex(light, n))).toEqual([]);
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
