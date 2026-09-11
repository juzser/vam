/**
 * THE DARK LIFT, SECOND PASS — MEASURED AGAINST THE PALETTE IT REPLACED.
 *
 * Operator, on the dark theme, twice in the same words: "make the dark UI a
 * bit lighter". The first pass (PR #305) answered it with +3 CIE lightness on
 * every grey the theme owns. It shipped, and the ask came back unchanged.
 *
 * THE SECOND ASK IS NOT THE FIRST ONE REPEATED LOUDER, and the number that
 * says so is in the first pass's own design. A CONSTANT ADDED IN L* PRESERVES
 * EVERY PAIRWISE L* DIFFERENCE IN THE PALETTE EXACTLY -- the previous version
 * of this file called that out as the property it was choosing. So whatever
 * the uniform shift moved, it could not move the distances BETWEEN the
 * surfaces, and those distances were the other half of the complaint:
 *
 *   before either lift, of the eight adjacent rungs in the elevation ladder,
 *   SEVEN were under the 2.3 L* just-noticeable difference (0.49, 0.51, 1.02,
 *   1.36, 1.46, 1.48, 1.50); only `card -> segment-on` cleared it. The ladder
 *   existed in the token file and not on the screen.
 *
 * Narrowed to the pairs that really touch each other in the app, three were
 * invisible: a hover fill or a tooltip on the pane (1.48 L*), a recess inside
 * a dialog (1.52), a selected option inset in one (2.02). A pointer that does
 * not light the row under it is the loudest of those, and it is exactly the
 * kind of thing a person reports as "too dark" without being able to name.
 *
 * SO THIS PASS DOES TWO THINGS WHERE THE LAST ONE DID ONE:
 *
 *  1. THE ANCHOR RISES. `--vam-pane` / `--vam-sidebar`, the surfaces the
 *     operator reads on, go #1d1d1d -> #272727: L* 10.77 -> 15.64. That lands
 *     the reading surface above VS Code Dark Modern's editor (#1f1f1f, L*
 *     11.76) and level with GitHub dark-dimmed's canvas (#212830, L* 15.77),
 *     where before it sat below both.
 *  2. THE LADDER STRETCHES. Every rung is re-derived so that each pair that
 *     actually MEETS on screen clears a just-noticeable difference. All twelve
 *     do now, and all twelve are wider than they were -- `MEETING_PAIRS`
 *     below is the assertion, not the prose.
 *
 * WHAT IS STILL TRUE OF BOTH PASSES: lightness only. a* and b* are carried
 * across untouched, so the amber tint is the same amber; 8-bit rounding leaves
 * at most 0.5 of chroma drift anywhere in the block.
 *
 * ONE TOKEN HAS SINCE LEFT THAT RULE, deliberately and with its own guard:
 * `--vam-in-bubble` was drained towards grey at the operator's ask, AFTER the
 * lift and on top of it. See `CHROMA_MOVED` -- the lift decided the bubble's
 * rung, the drain decided its colour, and the test below the exemption holds
 * the drain to not having touched the rung.
 *
 * And every step is still inside the band the first pass set --
 * `[JND, CEILING]`, 2.3 to 6.0 -- which did NOT have to be widened to let this
 * through: the largest step here is 5.75 L* on `--vam-raised`. "A bit lighter"
 * is answered twice without ever being answered twice over.
 *
 * WHY THE TABLE BELOW IS THE OLD PALETTE AND NOT THE NEW ONE, which is the
 * whole design of this file and is unchanged. A guard that lists what
 * `styles.css` says today passes again tomorrow on whatever it says then: it
 * records the code, so the code can never contradict it. What is recorded here
 * is where the palette WAS -- the values this branch found in the file, which
 * are the first lift's own output -- and every assertion is about the DISTANCE
 * travelled from there. Walk any token back and the distance goes to zero and
 * this file goes red; overshoot it and the ceiling catches that too.
 *
 * `e2e/pane-colour-shots.mjs` measures the same lift, and the same separation,
 * as PAINT in a real browser, because a token list cannot prove a rule matched
 * anything.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chroma, contrast, deltaE, lightness } from '../support/contrast.js';
import { ruleBody, tokens } from '../support/css-tokens.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

/**
 * THE DARK PALETTE BEFORE THIS LIFT, token by token — the values as they stood
 * at `27f773a`, which is the first lift's own output, and the baseline every
 * number in this file is measured from.
 *
 * Every grey the theme paints is here: the ten surfaces, the five line
 * weights, the three quiet inks, the decorative ghost, the four tinted grounds
 * and `--vam-ansi-black`. Not here, deliberately, are the ones held still --
 * see `HELD` below -- and the hues that are measured AGAINST these rather than
 * being surfaces themselves (status, the rest of the ANSI ramp, syntax, diff,
 * the section rules): those keep their values and their readings were
 * re-derived against the lifted grounds instead.
 *
 * `--vam-ansi-black` IS IN THE TABLE, and the previous pass left it out. The
 * ramp is what the AGENT said rather than vam's choice, so it is read against
 * its ground instead of moved with it -- true of fifteen of the sixteen. ANSI
 * black is the exception the family already contains: the agent said #000000
 * and vam substituted a grey precisely so a terminal does not render
 * black-on-black. It is a value invented to be legible on a surface, and that
 * surface moved. Left at #6b6b6b it reads 2.913:1 on the lifted panel, where
 * it read 3.266:1 before; lifted, it reads 3.274:1 and the reason it exists
 * survives the change.
 */
const BEFORE_THE_LIFT = {
  // Surfaces, deepest first.
  '--vam-ground': '#131313',
  '--vam-sunken': '#161616',
  '--vam-well': '#171717',
  '--vam-header': '#181818',
  '--vam-panel': '#1a1a1a',
  '--vam-sidebar': '#1d1d1d',
  '--vam-pane': '#1d1d1d',
  '--vam-raised': '#202020',
  '--vam-card': '#232323',
  '--vam-segment-on': '#2c2c2c',
  // Lines. They separate the surfaces above, so they move with them or the
  // seams close -- and one of them could not simply keep its reading against
  // the pane: at that reading `--vam-line` lands on #2e2e2e, which is the
  // CARD's own new value, and a hairline the same colour as the card it
  // divides is not a hairline. It is derived from the top of the surface
  // stack instead. `--vam-line-strong` and `--vam-line-tip` are derived from
  // their own floors, for the reasons `styles.css` records beside each.
  '--vam-line': '#252525',
  '--vam-line-strong': '#2c2c2c',
  '--vam-line-loud': '#353535',
  '--vam-line-loudest': '#515151',
  '--vam-line-tip': '#727272',
  // The quiet inks. Light-on-dark text LOSES contrast when its ground rises,
  // so these are not decoration: `ink-faint` measured 4.735:1 on the old card
  // and would read 4.091:1 on the lifted one -- under WCAG 1.4.3. They move by
  // the amount that restores the reading they had on the pane, which is what
  // `keeps the reading the quiet inks had ...` below asserts directly.
  '--vam-ink-dim': '#a9a9a9',
  '--vam-ink-faint': '#8d8d8d',
  '--vam-ink-quiet': '#8d8d8d',
  '--vam-ink-ghost': '#464646',
  // The one member of the ANSI ramp that is vam's value rather than the
  // agent's. See the block comment above.
  '--vam-ansi-black': '#6b6b6b',
  // The tinted grounds, and the In bubble that is calibrated against them.
  // The bubble's whole specification is "as loud as a status tint and no
  // louder", so the tints and the bubble have to travel together or that
  // sentence stops being true of anything.
  '--vam-in-bubble': '#17423c',
  '--vam-waiting-tint': '#463618',
  '--vam-waiting-wash': '#1c1811',
  '--vam-done-tint': '#2b3c54',
} as const;

/**
 * THE TWO VALUES THIS LIFT DELIBERATELY DID NOT TOUCH, pinned so that "not
 * lifted" is a decision on the record rather than an omission nobody noticed.
 * They are the same two the first pass held, for the same two reasons.
 *
 *  - `--vam-ink` is the brightest text in the theme and owes nothing to a
 *    floor: it reads 11.60:1 on the lifted card, where 4.5 is the
 *    requirement. Matching its old reading on the pane would have taken it to
 *    #fcfcfc, and near-white ink on a dark theme is glare, which is not what
 *    "a bit lighter" asked for. The three quiet greys moved because their
 *    floors made them move; this one had no such argument either time.
 *  - `--vam-on-running` is the near-black the Agents badge draws ON dark's
 *    bright green. It stopped agreeing with `--vam-ground` at the first lift
 *    and stays where it is here for the same reason: lifting the ink on a
 *    fill only spends the badge's contrast, and the badge has no complaint
 *    (11.36:1, unchanged, because the green under it never moved).
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
 * would be — and it is the failure the FIRST pass turned out to be for the
 * distances between surfaces, which is why `MEETING_PAIRS` exists below.
 *
 * CEILING: 6.0, about two JNDs. "A bit" is in the request, and a palette that
 * drifts up one well-meaning patch at a time ends somewhere nobody chose.
 *
 * NEITHER NUMBER MOVED FOR THIS PASS, and that is worth stating because the
 * previous version of this file invited an edit to raise the ceiling "in the
 * open, with a number on it". It was not needed: the largest step here is
 * 5.75 L* (`--vam-raised`, stretched to put a hover fill a person can see over
 * the pane) and the smallest is 3.22 (`--vam-ansi-black`). What was missing
 * was never a bigger uniform step.
 */
const JND = 2.3;
const CEILING = 6;

/**
 * THE ONE TOKEN ALLOWED TO MOVE ITS CHROMA, and the only exemption in this
 * file.
 *
 * Operator, after the lift landed: "for the In bubble, pick the option leaning
 * towards grey." That is a request about CHROMA, which the lift's own rule --
 * lightness only, a* and b* carried across untouched -- forbids by design. The
 * two are not in conflict; they are two decisions stacked in order. The lift
 * put the bubble on its rung (L* 24.97 -> 28.40) and the drain took the colour
 * out of it at that rung (chroma 16.65 -> 7.07, L* 28.40 -> 28.33).
 *
 * So `moves lightness only` skips this one name, and the test underneath it
 * pays for the skip: the chroma must have actually fallen, it must not have
 * fallen to neutral, and the lightness must NOT have moved. An exemption that
 * asserted nothing would be the hole this file exists to prevent.
 */
const CHROMA_MOVED = '--vam-in-bubble';

/**
 * What the lift left the bubble at, before the drain — the rung the drain was
 * not allowed to move it off. Recorded here rather than read from the file for
 * the reason the table above is: a guard that reads today's value cannot
 * notice tomorrow's.
 */
const LIFTED_BUBBLE = '#1f4a44';

/**
 * The surface ladder `styles.css` documents, deepest first, with the one pair
 * that is deliberately equal. Order is the thing a lift most easily breaks:
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

/**
 * THE PAIRS THAT ACTUALLY MEET ON SCREEN, and the L* distance each of them
 * measured before this lift. This is the half the first pass could not have
 * fixed and the reason the operator asked twice.
 *
 * ADJACENT IN THE TOKEN LIST IS NOT THE SAME QUESTION. `--vam-header` and
 * `--vam-panel` are neighbours in the ladder and never touch; `--vam-ground`
 * and `--vam-card` are four rungs apart and touch constantly. So each row here
 * was read off a call site rather than off the ladder, and the last field
 * names the call site so a reader can check the claim rather than take it.
 *
 * `was` IS THE POINT, again. Asserting only "clears a JND today" would pass on
 * a palette that was already fine; asserting the distance GREW as well is what
 * makes this a record of a fix. Three of the twelve were under the threshold
 * (1.48, 1.52, 2.02) and all twelve are wider now.
 */
const MEETING_PAIRS = [
  ['--vam-ground', '--vam-sidebar', 4.88, 'the sidebar column against the main column'],
  ['--vam-ground', '--vam-pane', 4.88, 'a code fence inside the detail pane'],
  ['--vam-ground', '--vam-panel', 3.38, 'a dialog over the scrimmed app'],
  ['--vam-sunken', '--vam-panel', 2.02, 'a selected option inset in a dialog'],
  ['--vam-well', '--vam-panel', 1.52, 'a recess inside a dialog'],
  ['--vam-well', '--vam-segment-on', 10.26, 'the selected pill in its own well'],
  ['--vam-panel', '--vam-raised', 2.99, 'a selected slot in a dialog'],
  ['--vam-pane', '--vam-raised', 1.48, 'an inline code chip, a hover fill, a tooltip'],
  ['--vam-sidebar', '--vam-raised', 1.48, 'a hovered row in the sidebar'],
  ['--vam-pane', '--vam-card', 2.95, 'a card on the detail pane'],
  ['--vam-sidebar', '--vam-card', 2.95, 'a popover row on the sidebar'],
  ['--vam-card', '--vam-line-strong', 4.29, 'a touched option inside a card'],
] as const;

/**
 * What each quiet ink READ on the pane before the lift, to three decimals.
 *
 * This is the rule they were moved by, stated as a measurement: lifting a
 * ground costs light-on-dark text its contrast, and the operator asked for a
 * lighter UI, not for dimmer text. Each of these moved by exactly the amount
 * that puts its reading back where it was, so "the lift spent no legibility"
 * is a number rather than a hope — and an edit that lifts a surface while
 * leaving its ink behind reddens here rather than in a complaint.
 *
 * `--vam-ink` is not here: matching its old 14.399:1 would have taken it to
 * #fcfcfc. See `HELD`.
 */
const INK_READINGS_ON_THE_PANE = {
  '--vam-ink-dim': 7.173,
  '--vam-ink-faint': 5.079,
  '--vam-ink-quiet': 5.079,
  '--vam-ink-ghost': 1.786,
} as const;

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
    expect(names).toHaveLength(24);
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
    }).toEqual({ measured: 24, outside: [] });
  });

  it('moves lightness only — no hue, no chroma', () => {
    // ΔE is the whole distance travelled; the L* step is the part that was
    // asked for. Whatever is left is hue and chroma drift, and it may only be
    // 8-bit rounding: the amber tint must still be that amber. sqrt(ΔE² - ΔL²)
    // is that residue.
    const drift = Object.entries(BEFORE_THE_LIFT)
      .filter(([name]) => name !== CHROMA_MOVED)
      .map(([name, was]) => {
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

  it('drains the one token the operator asked to lean grey, and only that one', () => {
    // THE EXEMPTION ABOVE, PAID FOR. Dropping a token out of a guard is how a
    // guard quietly stops covering the thing it was written for, so the
    // exclusion buys an assertion rather than a hole: the chroma this token is
    // allowed to move must actually have moved, and DOWN, and its lightness
    // must not have moved with it -- the elevation ladder is the lift's
    // business and a colour decision is not allowed to touch it.
    const was = BEFORE_THE_LIFT[CHROMA_MOVED];
    const now = hex(dark, CHROMA_MOVED);
    expect({
      chromaFell: chroma(now) < chroma(was) * 0.75,
      // STILL A HUE, NOT A NEUTRAL. A bubble drained all the way to grey is
      // the "in practice, not drawn" complaint that created the token, arriving
      // again a release later -- and a near-neutral fill measured ΔE 4.4 from
      // `--vam-line-loud`, which is what that would look like.
      stillCarriesItsHue: chroma(now) >= 4,
      // The rung it sits on is the LIFT's decision. This change moved L* by
      // 0.07; anything that moves it by a JND is a different change wearing
      // this one's name.
      stayedOnItsRung: Math.abs(lightness(now) - lightness(LIFTED_BUBBLE)) < JND,
      inTheBand: contrast(now, hex(dark, '--vam-pane')) >= 1.446,
    }).toEqual({
      chromaFell: true,
      stillCarriesItsHue: true,
      stayedOnItsRung: true,
      inTheBand: true,
    });
  });

  it('separates every pair of surfaces a person sees at once', () => {
    // THE ASSERTION THIS FILE WAS REWRITTEN FOR. A uniform lift preserves
    // every one of these distances exactly, which is why the first pass could
    // not have moved them and why the ask came back.
    const seen = MEETING_PAIRS.map(([a, b, was, where]) => {
      const now = Math.abs(lightness(hex(dark, a)) - lightness(hex(dark, b)));
      return {
        pair: `${a} / ${b}`,
        where,
        was,
        now: Number(now.toFixed(2)),
        seen: now >= JND,
        wider: now > was,
      };
    });
    expect({
      measured: seen.length,
      invisible: seen.filter((p) => !p.seen),
      narrowed: seen.filter((p) => !p.wider),
    }).toEqual({ measured: 12, invisible: [], narrowed: [] });
  });

  it('keeps the reading the quiet inks had on the surface they are read on', () => {
    const pane = hex(dark, '--vam-pane');
    const read = Object.entries(INK_READINGS_ON_THE_PANE).map(([name, was]) => ({
      name,
      was,
      now: Number(contrast(hex(dark, name), pane).toFixed(3)),
    }));
    expect({
      measured: read.length,
      drifted: read.filter((r) => Math.abs(r.now - r.was) > 0.05),
    }).toEqual({ measured: 4, drifted: [] });
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
    // did not move" a measurement instead of a promise: the same 24 tokens,
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
        '--vam-ansi-black': '#3f3f46',
        '--vam-in-bubble': '#f1fefe',
        '--vam-waiting-tint': '#f6dcae',
        '--vam-waiting-wash': '#fdf6e8',
        '--vam-done-tint': '#c0d3f4',
      },
    );
  });
});
