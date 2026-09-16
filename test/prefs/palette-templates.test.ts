/**
 * THE COLOUR TEMPLATES, MEASURED RATHER THAN EYEBALLED.
 *
 * Operator: "add a few colour templates at the top of the appearance settings,
 * learn from some VS Code themes."
 *
 * A TEMPLATE IS A HUE AND A CHROMA ON VAM'S OWN LIGHTNESS LADDER, which is the
 * whole reason this is safe to offer at all. The dark lift spent a release
 * establishing that the surfaces a person sees at once sit at least one
 * just-noticeable difference apart (`dark-ladder.test.ts`), and a template that
 * picked its own lightnesses would throw that away silently -- the operator
 * would click "nordic" and get back the flat palette the lift was written to
 * fix. So every surface in every template keeps the L* the stylesheet gives
 * it, and only a* and b* move.
 *
 * "PRESERVED BY CONSTRUCTION" IS WHAT THIS FILE USED TO SAY, AND IT WAS WRONG
 * ABOUT ALL FOUR TEMPLATES IT COVERED. Construction is not a guarantee, it is
 * an intention, and the four tinted palettes were in fact built from two
 * REMEMBERED gaps rather than from the rungs: measured, every one of them had
 * `panel -> pane` at about 1.44 L* and `raised -> card` at 0.93, both under
 * the 2.3 JND, while this suite stayed green because it checked the two gaps
 * the prose named and never the ladder. Two tests state it properly now --
 * `puts every surface back on the rung the stylesheet gives it` and `clears a
 * JND between every adjacent rung, including the three it cannot set` -- and
 * both read `styles.css` rather than a copy of it.
 *
 * WHAT A TEMPLATE DOES NOT TOUCH, and it is the more interesting half: the six
 * tokens that carry MEANING. `running`, `waiting`, `done`, `failed`,
 * `cursor-ring` and `idle` are not decoration -- `styles.css` argues each of
 * them at the point it defines it, and amber in this app means one specific
 * thing ("a session is blocked on your answer"). A template changes the ROOM,
 * not the SIGNALS. Anything else would let a preset quietly recolour the one
 * row an operator reads to decide what to do next.
 *
 * THE TRAP THIS FILE EXISTS FOR: a template sets seven tokens and the palette
 * has far more than seven. `--vam-ink-faint`, `--vam-ink-quiet`,
 * `--vam-ink-dim` and the four line weights are NOT settable and stay at the
 * stylesheet's values -- so a template's surfaces are painted under inks it
 * did not choose and cannot see. That is exactly how a preset ships
 * unreadable. Every ink the stylesheet owns is therefore measured against
 * every surface the template sets, per template, per theme.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyPaletteTemplate,
  PALETTE_TEMPLATES,
  type PaletteTemplateId,
  templatePalette,
} from '../../src/renderer/prefs/palette-templates.js';
import {
  EMPTY_PREFS,
  PALETTE_TOKENS,
  paletteFor,
  TEMPLATE_TOKENS,
} from '../../src/renderer/prefs/prefs.js';
import { contrast, deltaE, lightness } from '../support/contrast.js';
import { ruleBody, tokens } from '../support/css-tokens.js';

/**
 * THE STYLESHEET'S OWN DARK VALUES, READ, and the one place in this file that
 * does read rather than type. `UNSETTABLE_INK` below argues the opposite case
 * for the inks and is right about them: those are a record of what the
 * templates were CHOSEN against, and a stylesheet that moves one should
 * redden here.
 *
 * `is a different palette from vam’s own` is the other kind of claim. It asks
 * whether each template is still a visible step from WHAT VAM PAINTS TODAY,
 * so it has to follow the stylesheet by construction -- its own comment said
 * "measured against what the stylesheet ACTUALLY paints" while typing a copy
 * of `#2d2d2d` underneath. That held for exactly as long as nobody moved the
 * pane. The fifth dark pass moved it to #282828, and a typed copy would have
 * gone on measuring a retired colour -- the precise failure the comment was
 * written to warn about.
 */
const DARK_STYLESHEET = tokens(
  ruleBody(readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8'), ':root'),
);

/**
 * Every `.tsx` the renderer ships, as one string, for the one question below
 * that is genuinely about the source text: what alpha does a ground scrim
 * declare. A sweep that read no files would answer it with silence, so the
 * corpus size is asserted at the point it is used.
 */
const RENDERER_TEXT = ((dir: string): string => {
  const read = (at: string): string[] =>
    readdirSync(at, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? read(join(at, e.name))
        : e.name.endsWith('.tsx')
          ? [readFileSync(join(at, e.name), 'utf8')]
          : [],
    );
  return read(dir).join('\n');
})(resolve(process.cwd(), 'src/renderer'));

/**
 * The inks a template does NOT set and therefore has to survive, per theme,
 * read off `styles.css`'s own values.
 *
 * Written out rather than parsed, deliberately: parsing the stylesheet would
 * make this file agree with whatever the stylesheet says next, and the claim
 * is that these templates were chosen against THESE inks. A stylesheet change
 * that moves one of them should redden here and be re-derived, which is the
 * same argument `dark-ladder.test.ts` makes about its own baseline table.
 */
const UNSETTABLE_INK = {
  dark: {
    '--vam-ink-dim': '#c8c8c8',
    '--vam-ink-faint': '#b0b0b0',
    '--vam-ink-quiet': '#b0b0b0',
    '--vam-running': '#4ade80',
    '--vam-waiting': '#f59e0b',
    '--vam-idle': '#b2b1bb',
    '--vam-done': '#75b7ff',
    '--vam-failed': '#ff9592',
  },
  light: {
    '--vam-ink-dim': '#52525b',
    '--vam-ink-faint': '#6a6a6f',
    '--vam-ink-quiet': '#6a6a6f',
    '--vam-running': '#166534',
    '--vam-waiting': '#92400e',
    '--vam-idle': '#52525b',
    '--vam-done': '#1d4ed8',
    '--vam-failed': '#b91c1c',
  },
} as const;

/** The surfaces a template sets that carry text. */
const TEXT_SURFACES = [
  '--vam-panel',
  '--vam-sidebar',
  '--vam-pane',
  '--vam-raised',
  '--vam-card',
] as const;

/** The six a template may never touch. See the header. */
const MEANING_TOKENS = [
  '--vam-running',
  '--vam-waiting',
  '--vam-cursor-ring',
  '--vam-idle',
  '--vam-done',
  '--vam-failed',
] as const;

const THEMES = ['dark', 'light'] as const;

/**
 * THE TEMPLATES THAT ACTUALLY CARRY COLOURS, which is every entry except the
 * one that carries none on purpose.
 *
 * `default` sets no tokens: pressing it DELETES the bucket so the cascade
 * falls through to `styles.css` (see `PaletteTemplateKind`). Every measurement
 * below asks "is this table of colours safe", and a table with no colours in
 * it answers that question vacuously -- so the sweeps run over the tinted ones
 * and `default`'s behaviour is asserted separately, and directly, further
 * down. Splitting rather than skipping, because a `continue` inside each loop
 * would let a SECOND empty template ship unnoticed.
 */
const TINTED = PALETTE_TEMPLATES.filter((t) => t.kind === 'values');

describe('palette templates', () => {
  it('offers exactly one way back, and puts it first', () => {
    // The row's shape is load-bearing: `reset <theme> colours` only appears
    // once a colour is overridden, so without a "default" entry the row is a
    // one-way door -- an operator who pressed `ember` and wants vam back has
    // to find a different control, in a different block, that is not shaped
    // like the thing they just pressed.
    const stylesheet = PALETTE_TEMPLATES.filter((t) => t.kind === 'stylesheet');
    expect(stylesheet.map((t) => t.id)).toEqual(['default']);
    expect(PALETTE_TEMPLATES[0]?.id).toBe('default');
    // And it is genuinely empty in BOTH themes. An entry that clears the
    // bucket and also carries values is a contradiction the UI would render
    // as a preview of colours that never get applied.
    for (const theme of THEMES) {
      expect(templatePalette('default', theme)).toEqual({});
    }
  });

  it('puts the palette back exactly as the stylesheet left it', () => {
    // Not "writes vam's current hexes back" -- CLEARS. Writing today's values
    // would look identical on screen and would freeze that palette against
    // every later stylesheet, which is the argument `clearPaletteColor` makes
    // for one token and this makes for thirteen.
    const tinted = TINTED[0]?.id as PaletteTemplateId;
    const painted = applyPaletteTemplate(EMPTY_PREFS, 'dark', tinted);
    expect(Object.keys(paletteFor(painted.palette, 'dark')).length).toBeGreaterThan(0);

    const back = applyPaletteTemplate(painted, 'dark', 'default');
    expect(paletteFor(back.palette, 'dark')).toEqual({});
  });

  it('clears only the theme on screen', () => {
    // Same argument the apply path makes: the other theme was chosen on a
    // screen this one cannot see.
    const both = applyPaletteTemplate(
      applyPaletteTemplate(EMPTY_PREFS, 'dark', TINTED[0]?.id as PaletteTemplateId),
      'light',
      TINTED[1]?.id as PaletteTemplateId,
    );
    const cleared = applyPaletteTemplate(both, 'dark', 'default');
    expect(paletteFor(cleared.palette, 'dark')).toEqual({});
    expect(paletteFor(cleared.palette, 'light')).toEqual(
      templatePalette(TINTED[1]?.id as PaletteTemplateId, 'light'),
    );
  });

  it('offers a real corpus of them, each with both themes filled in', () => {
    // A sweep over an empty table passes every assertion below. Four guards in
    // this repo have gone green having examined zero of anything.
    expect(TINTED.length).toBeGreaterThanOrEqual(3);
    const broken = TINTED.filter(
      (t) =>
        t.id.length === 0 ||
        t.label.length === 0 ||
        t.studied.length === 0 ||
        THEMES.some((theme) => Object.keys(templatePalette(t.id, theme)).length < 6),
    );
    expect(broken.map((t) => t.id)).toEqual([]);
    // And the ids are unique, or the picker has two buttons that do one thing.
    expect(new Set(PALETTE_TEMPLATES.map((t) => t.id)).size).toBe(PALETTE_TEMPLATES.length);
  });

  it('only ever names tokens a template is allowed to write', () => {
    // A template naming a token nothing will write is a colour with no way to
    // arrive: `applyPaletteTemplate` walks a list, and a value outside that
    // list is dropped on the floor with no error anywhere. The list is
    // `TEMPLATE_TOKENS`, which is the swatch grid PLUS the ground -- see the
    // next test for why those are two different questions.
    const allowed = new Set(TEMPLATE_TOKENS);
    const stray: string[] = [];
    for (const t of TINTED) {
      for (const theme of THEMES) {
        for (const token of Object.keys(templatePalette(t.id, theme))) {
          if (!allowed.has(token)) stray.push(`${t.id}/${theme}: ${token}`);
        }
      }
    }
    expect(stray).toEqual([]);
  });

  /**
   * THE GROUND: SETTABLE BY A PALETTE, STILL NOT A SWATCH, AND THOSE ARE TWO
   * CLAIMS RATHER THAN ONE.
   *
   * The operator asked for the ground SWATCH to go -- "the ground setting is
   * unnecessary" -- and it is still gone. What they asked for afterwards is a
   * palette that can reach near-absolute black, which no preset could do while
   * `applyPaletteTemplate` walked the grid: `--vam-ground` is the token that
   * decides whether a dark theme is dark, and `contrast` was pinned at 6.32 L*
   * by a list that was answering a different question.
   *
   * SO BOTH HALVES ARE ASSERTED HERE, in one place, because the failure mode is
   * that one of them quietly becomes the other. A grid that grows a ground
   * swatch back gives the operator the control they rejected; a template list
   * that shrinks to the grid takes the black room away again, and the only
   * symptom either way is a colour that does or does not appear.
   *
   * AND THE THIRD CLAIM IS THE ONE WITH TEETH: that the value actually lands.
   * `setPaletteColor` would have accepted a ground all along -- `PALETTE_KEYS`
   * has carried it since it was retired, so a stored one is still read and
   * still applied -- and it was the template apply loop, not the setter, that
   * dropped it. A test that only compared the two lists would have passed
   * against the broken loop.
   */
  it('lets a palette set the ground, and still keeps it out of the swatch grid', () => {
    expect(PALETTE_TOKENS.map((entry) => entry.token)).not.toContain('--vam-ground');
    expect(TEMPLATE_TOKENS).toContain('--vam-ground');
    // Every swatch is still writable by a template: the ground is an addition
    // to that list, never a replacement for it.
    for (const { token } of PALETTE_TOKENS) expect(TEMPLATE_TOKENS).toContain(token);

    const chosen = templatePalette('contrast', 'dark')['--vam-ground'];
    expect(chosen, 'the high-contrast template names a ground').toMatch(/^#[0-9a-f]{6}$/i);
    const applied = paletteFor(
      applyPaletteTemplate(EMPTY_PREFS, 'dark', 'contrast').palette,
      'dark',
    );
    expect(applied['--vam-ground']).toBe(chosen);
  });

  it('writes every colour a template names, and nothing else', () => {
    // THE SILENT DROP, STATED ONCE FOR THE WHOLE TABLE. The apply loop walking
    // the wrong list is invisible: the press still works, the other six tokens
    // still land, and the one that did not is a colour nobody goes looking
    // for. So what the table SAYS and what the bucket GETS are compared
    // exactly, per template, per theme, rather than trusting the loop to have
    // iterated the list this file happens to know about.
    const wrong: string[] = [];
    let compared = 0;
    for (const t of TINTED) {
      for (const theme of THEMES) {
        compared += 1;
        // BY KEY, NOT BY `JSON.stringify`, which compares key ORDER: the
        // apply loop writes in `TEMPLATE_TOKENS` order and the table is
        // written in ladder order, so a stringify comparison reports all
        // fourteen as wrong while every colour is in fact identical. That was
        // this test's first form and it would have been a finding about
        // nothing.
        const named = templatePalette(t.id, theme);
        const landed = paletteFor(applyPaletteTemplate(EMPTY_PREFS, theme, t.id).palette, theme);
        const sorted = (o: Record<string, string | undefined>): string =>
          JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
        if (sorted(landed) !== sorted(named)) {
          wrong.push(`${t.id}/${theme}: named ${sorted(named)}, landed ${sorted(landed)}`);
        }
      }
    }
    // 7 templates x 2 themes, as a literal for the reason the sweeps below
    // record: a count derived from the corpus shrinks with the corpus.
    expect({ compared, wrong }).toEqual({ compared: 14, wrong: [] });
  });

  it('changes the room and never the signals', () => {
    const touched: string[] = [];
    for (const t of TINTED) {
      for (const theme of THEMES) {
        const values = templatePalette(t.id, theme);
        for (const token of MEANING_TOKENS) {
          if (values[token] !== undefined) touched.push(`${t.id}/${theme}: ${token}`);
        }
      }
    }
    expect(touched).toEqual([]);
  });

  it('keeps every ink the operator cannot see readable on every surface it sets', () => {
    // THE ASSERTION THIS FILE EXISTS FOR. The template picks surfaces; the
    // stylesheet keeps the quiet inks. Nothing else in the codebase compares
    // the two.
    const failing: string[] = [];
    let pairs = 0;
    for (const t of TINTED) {
      for (const theme of THEMES) {
        const values = templatePalette(t.id, theme);
        const inks: Record<string, string> = {
          ...UNSETTABLE_INK[theme],
          // The template's OWN ink, which it does set, on its own surfaces.
          '--vam-ink': values['--vam-ink'] as string,
        };
        for (const [inkName, ink] of Object.entries(inks)) {
          for (const surface of TEXT_SURFACES) {
            const ground = values[surface];
            if (ground === undefined) continue;
            pairs += 1;
            const ratio = contrast(ink, ground);
            if (ratio < 4.5) {
              failing.push(`${t.id}/${theme}: ${inkName} on ${surface} = ${ratio.toFixed(3)}`);
            }
          }
        }
      }
    }
    // 7 templates x 2 themes x 9 inks x 5 surfaces. The literal is the point:
    // it turns a shortened list into a failure rather than a quieter pass.
    expect({ pairs, failing }).toEqual({ pairs: 630, failing: [] });
  });

  it('keeps the elevation ladder the dark lift established', () => {
    // A template that re-tints without re-laddering is the whole design. If a
    // preset could reorder these, clicking one would undo a release of work
    // and nothing would say so.
    const wrong: string[] = [];
    for (const t of TINTED) {
      const dark = templatePalette(t.id, 'dark');
      const rungs = ['--vam-panel', '--vam-sidebar', '--vam-raised', '--vam-card'];
      for (let i = 1; i < rungs.length; i += 1) {
        const below = dark[rungs[i - 1] as string];
        const above = dark[rungs[i] as string];
        if (below === undefined || above === undefined) continue;
        if (lightness(above) <= lightness(below)) {
          wrong.push(`${t.id}: ${rungs[i]} is not above ${rungs[i - 1]}`);
        }
      }
      // And in light, where the card is the lightest thing there is, the only
      // claim that survives is the one the light theme actually makes.
      const light = templatePalette(t.id, 'light');
      if (lightness(light['--vam-card'] as string) <= lightness(light['--vam-pane'] as string)) {
        wrong.push(`${t.id}: light card is not above the pane`);
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * THE RUNG CLAIM, WHICH THIS FILE MADE IN PROSE AND NOTHING CHECKED.
   *
   * `palette-templates.ts` opens with "each surface keeps the exact L* the
   * stylesheet gives it and moves only in a* and b*", and that sentence is the
   * entire safety argument for offering presets: it is what makes a template
   * inherit the ladder, the separations AND the contrast readings instead of
   * re-deriving all three by hand. L* is a function of relative luminance
   * alone, so a surface on the stylesheet's rung reads the SAME ratio against
   * every ink the stylesheet keeps, whatever hue it wears.
   *
   * IT WAS FALSE FOR FOUR TEMPLATES WHEN THIS TEST WAS WRITTEN, which is the
   * reason the test exists. The four shipped tinted palettes were built from
   * two REMEMBERED gaps -- `pane -> card` 3.30 and `pane -> raised` 2.36, the
   * numbers this file's own header quotes from the THIRD dark pass -- rather
   * than from the rungs. So `slate`'s card sat 2.73 L* below the stylesheet's,
   * `nordic`'s 2.88, `ember`'s 2.59 and `plum`'s 2.79, and the test after this
   * one shows what that cost: `raised -> card` had closed to 0.94 L*, well
   * under the 2.3 JND, in every one of them. Two lists of the same ladder,
   * drifting -- which is the failure this repo has now paid for five times.
   *
   * 0.5 L* OF TOLERANCE, NOT ZERO, and the number is derived rather than
   * liked: 8-bit sRGB does not offer an exact L* at every hue, so a value has
   * to be allowed to land near its rung rather than on it. The widest miss in
   * the shipped table is 0.29 (`contrast`, which spends it to buy a wider
   * `panel -> pane` -- see its entry) and every other template is inside 0.15.
   * Half a JND is invisible by construction and still an eighth of the drift
   * that was here.
   */
  it('puts every surface back on the rung the stylesheet gives it', () => {
    const LADDER_SURFACES = [
      '--vam-panel',
      '--vam-sidebar',
      '--vam-pane',
      '--vam-raised',
      '--vam-card',
    ] as const;
    const off: string[] = [];
    let measured = 0;
    for (const t of TINTED) {
      const values = templatePalette(t.id, 'dark');
      for (const surface of LADDER_SURFACES) {
        const rung = DARK_STYLESHEET.get(surface);
        expect(rung, `styles.css defines ${surface} in :root`).toMatch(/^#[0-9a-f]{6}$/i);
        measured += 1;
        const drift = lightness(values[surface] as string) - lightness(rung as string);
        if (Math.abs(drift) > 0.5) {
          off.push(`${t.id}: ${surface} is ${drift.toFixed(2)} L* off the rung`);
        }
      }
    }
    // 7 templates x 5 ladder surfaces, as a LITERAL rather than as
    // `TINTED.length * 5`. A count derived from the corpus shrinks with it: a
    // template that quietly stopped being tinted would leave this sweep
    // measuring six palettes and still reporting a full house. The standing
    // lesson in this repo is that a sweep has to prove it found its corpus.
    expect({ measured, off }).toEqual({ measured: 35, off: [] });
  });

  /**
   * THE LADDER, MERGED WITH THE RUNGS A TEMPLATE CANNOT REACH.
   *
   * `dark-ladder.test.ts` holds the stylesheet to "every ADJACENT pair of the
   * sorted ladder clears a JND, whether or not the two surfaces are ever
   * adjacent on screen". A template inherits that claim and can break it in a
   * way the stylesheet cannot: it sets four of the seven rungs and CANNOT set
   * `ground`, `sunken` or `well` -- `--vam-ground` was retired from the swatch
   * grid at the operator's own ask (`prefs.ts`, `RETIRED_TOKENS`) and the
   * other two were never offered. So a preset that walks `panel` down lands it
   * on a `well` that stayed where it was, and a recess inside a dialog stops
   * being a recess.
   *
   * MEASURED ON THE MERGED LADDER FOR EXACTLY THAT REASON. The four settable
   * rungs are dropped into the three pinned ones, sorted by lightness, and
   * every adjacent gap owes the JND -- which is also what bounds the two ends:
   * `panel` may go no lower than `well` + 2.3 and `card` no higher than
   * `segment-on` - 2.3, so the whole band a template may use is 13.56..22.12
   * L*, about 8.6 of lightness for three gaps. That is why no template can be
   * blacker than vam already is, and `contrast` says so at its own entry
   * rather than pretending otherwise.
   *
   * DARK ONLY, and the omission is a measurement rather than an oversight: the
   * light theme is not a JND ladder and never was. Its `pane` and `raised` sit
   * 0.60 L* apart and its `panel`, `card` and `ground` share one value --
   * light separates surfaces with hue and with ΔE (see the In bubble note in
   * `palette-templates.ts`), which the bubble test below is what measures.
   */
  it('clears a JND between every adjacent rung, including the three it cannot set', () => {
    // `sunken` and `well` are the two no template may write. `ground` USED to
    // be a third and is not any more, so it is resolved through the template
    // like any other surface: reading the stylesheet's #141414 while
    // `contrast` paints #000000 would be measuring a ladder that palette does
    // not have -- the stale-copy failure this suite has already been caught by
    // once, one token to the left.
    const PINNED = ['--vam-sunken', '--vam-well'] as const;
    const narrow: string[] = [];
    let measured = 0;
    for (const t of TINTED) {
      const values = templatePalette(t.id, 'dark');
      const groundValue = values['--vam-ground'] ?? DARK_STYLESHEET.get('--vam-ground');
      expect(groundValue, `${t.id} resolves a ground`).toMatch(/^#[0-9a-f]{6}$/i);
      const rungs = [
        { label: '--vam-ground', light: lightness(groundValue as string) },
        ...PINNED.map((token) => {
          const value = DARK_STYLESHEET.get(token);
          expect(value, `styles.css defines ${token} in :root`).toMatch(/^#[0-9a-f]{6}$/i);
          return { label: token, light: lightness(value as string) };
        }),
        { label: '--vam-panel', light: lightness(values['--vam-panel'] as string) },
        { label: '--vam-sidebar/pane', light: lightness(values['--vam-pane'] as string) },
        { label: '--vam-raised', light: lightness(values['--vam-raised'] as string) },
        { label: '--vam-card', light: lightness(values['--vam-card'] as string) },
      ].sort((a, b) => a.light - b.light);
      for (let i = 1; i < rungs.length; i += 1) {
        measured += 1;
        const gap = (rungs[i]?.light as number) - (rungs[i - 1]?.light as number);
        if (gap < 2.3) {
          narrow.push(
            `${t.id}: ${rungs[i - 1]?.label} -> ${rungs[i]?.label} is ${gap.toFixed(2)} L*`,
          );
        }
      }
      // AND THE RUNG ABOVE THE BAND, which is not part of the ladder above and
      // is held by `dark-ladder.test.ts` for the stylesheet: the ON segment of
      // the segmented control is the first fill over `card`, and a card that
      // climbs onto it is a card with no lid.
      const segment = DARK_STYLESHEET.get('--vam-segment-on');
      expect(segment, 'styles.css defines --vam-segment-on in :root').toMatch(/^#[0-9a-f]{6}$/i);
      measured += 1;
      const lid = lightness(segment as string) - lightness(values['--vam-card'] as string);
      if (lid < 2.3) narrow.push(`${t.id}: card is ${lid.toFixed(2)} L* under segment-on`);
    }
    // 7 templates x 7 gaps -- six in the merged ladder and the lid above it.
    // A literal, for the reason the sweep above records.
    expect({ measured, narrow }).toEqual({ measured: 49, narrow: [] });
  });

  /**
   * THE CEILING, AND WHAT PINS IT NOW.
   *
   * Before the ground could be written, the tightest gap any preset could have
   * was 2.44 L* -- `ground -> sunken`, a pair it could not touch, so no amount
   * of care with the four rungs it owned could beat it. That was the whole
   * measured answer to "maximum separation" and it is now stale: the ground
   * moves, so `ground -> sunken` is a template's own business, and the
   * tightest pair NOBODY can write is `sunken -> well` at 2.51.
   *
   * SO THE CEILING ROSE BY 0.07 L*, which sounds like nothing and is the
   * difference between a claim and a slogan: `contrast` now clears 2.51 on
   * every gap it owns, so the tightest step in its whole ladder is the one
   * pair it is not allowed to widen. "As separated as this app can be" is a
   * statement that can be true, and for exactly one template it is.
   *
   * THE CEILING IS DERIVED, NOT TYPED. Both values are read off `styles.css`,
   * so the day something makes `sunken` or `well` settable -- the obvious next
   * ask -- this test moves with it instead of going quietly wrong.
   */
  it('cannot out-separate the one pair no template may write', () => {
    const sunken = DARK_STYLESHEET.get('--vam-sunken');
    const well = DARK_STYLESHEET.get('--vam-well');
    expect(sunken, 'styles.css defines --vam-sunken').toMatch(/^#[0-9a-f]{6}$/i);
    expect(well, 'styles.css defines --vam-well').toMatch(/^#[0-9a-f]{6}$/i);
    const ceiling = lightness(well as string) - lightness(sunken as string);
    // The pinned pair is a gap, not a floor: if it ever fell under the JND the
    // stylesheet itself would be broken and `dark-ladder.test.ts` would say so.
    expect(ceiling).toBeGreaterThanOrEqual(2.3);

    const tightest = (id: PaletteTemplateId): number => {
      const v = templatePalette(id, 'dark');
      const ground = v['--vam-ground'] ?? (DARK_STYLESHEET.get('--vam-ground') as string);
      const rungs = [
        lightness(ground),
        lightness(sunken as string),
        lightness(well as string),
        lightness(v['--vam-panel'] as string),
        lightness(v['--vam-pane'] as string),
        lightness(v['--vam-raised'] as string),
        lightness(v['--vam-card'] as string),
      ].sort((a, b) => a - b);
      return Math.min(...rungs.slice(1).map((l, i) => l - (rungs[i] as number)));
    };

    // Nobody beats it, because the pair is in every template's ladder.
    const over = TINTED.filter((t) => tightest(t.id) > ceiling + 1e-9).map((t) => t.id);
    expect(over).toEqual([]);
    // And the palette whose whole argument is separation REACHES it. This is
    // the assertion that reddens if `contrast`'s ladder drifts: it would stop
    // being the maximum and nothing else would notice.
    expect(Number(tightest('contrast').toFixed(2))).toBe(Number(ceiling.toFixed(2)));
  });

  /**
   * WHAT A BLACK GROUND COSTS, MEASURED RATHER THAN PREDICTED.
   *
   * `--vam-shadow-node` is a BLACK shadow -- `rgb(0 0 0 / 0.4)` -- and five
   * modal panels wear it (`ProjectPicker`, `GroupPicker`, `IconPicker` and the
   * two confirmations), each sitting on a `bg-ground/70` scrim. A black shadow
   * on a black ground is not a shadow. Measured on today's #141414 the darkest
   * composite a node's shadow can reach is 3.00 L* under the ground, which is
   * just over the JND; ONE 8-BIT STEP DARKER it is 1.94 and already invisible,
   * and at #000000 it is 0.00. There is no near-black ground that keeps it.
   *
   * SO THE SHADOW IS SPENT, DELIBERATELY, AND SOMETHING HAS TO REPLACE IT.
   * What does is the fill step: the same scrim that hides the shadow also
   * darkens, so the panel's own contrast against what is behind it grows by
   * more than the halo was worth -- 4.45 L* to 10.48 on `contrast`, ratio
   * 1.107 to 1.248. This test holds that trade to a number rather than to this
   * paragraph: a template may only lose the shadow if the panel it leaves
   * still clears its own scrim by a JND. `e2e/pane-colour-shots.mjs` measures the
   * same pair as paint, because a composite computed here is still arithmetic.
   */
  it('only spends the drop shadow when the panel still clears its scrim', () => {
    const shadow = DARK_STYLESHEET.get('--vam-shadow-node');
    expect(shadow, 'styles.css defines --vam-shadow-node').toBeDefined();
    const alpha = Number(/rgb\(0 0 0 \/ ([0-9.]+)\)/.exec(shadow as string)?.[1]);
    expect(alpha, '--vam-shadow-node is black at some alpha').toBeGreaterThan(0);

    // The scrim's alpha is READ from the renderer rather than typed: the
    // question is "what does the markup declare", which the markup is direct
    // evidence of. What it PAINTS is the e2e guard's job.
    const scrimAlphas = [...RENDERER_TEXT.matchAll(/bg-ground\/(\d{2})\b/g)].map((m) =>
      Number(m[1]),
    );
    expect(scrimAlphas.length, 'the renderer draws at least one ground scrim').toBeGreaterThan(0);
    // THE WEAKEST SCRIM, NOT THE STRONGEST, and that was a mutation finding
    // rather than a choice: this read `Math.max` first, so turning ONE of the
    // seven scrims down to `bg-ground/10` changed nothing here -- the other
    // six still declared 70 and the test went on measuring them. A dialog
    // behind the faintest scrim is the one whose panel has least to clear, so
    // it is the case this floor has to be about.
    const scrimAlpha = Math.min(...scrimAlphas) / 100;

    const over = (top: string, under: string, a: number): string => {
      const mix = (i: number): number =>
        Math.round(
          Number.parseInt(top.slice(1 + i * 2, 3 + i * 2), 16) * a +
            Number.parseInt(under.slice(1 + i * 2, 3 + i * 2), 16) * (1 - a),
        );
      return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
    };

    const behind = DARK_STYLESHEET.get('--vam-pane') as string;

    const failing: string[] = [];
    let measured = 0;
    for (const t of TINTED) {
      const v = templatePalette(t.id, 'dark');
      const ground = v['--vam-ground'];
      if (ground === undefined) continue; // it keeps vam's, and vam's shadow with it
      measured += 1;
      const halo = lightness(ground) - lightness(over('#000000', ground, alpha));
      if (halo >= 2.3) continue; // the shadow still reads; nothing is being spent
      const step =
        lightness(v['--vam-panel'] as string) - lightness(over(ground, behind, scrimAlpha));
      // A JND, ABSOLUTELY, not "wider than the one vam ships". The relative
      // form was the first version of this line and a mutation walked
      // straight through it: turning the scrim down to `bg-ground/10` darkens
      // the template's scrim AND vam's reference by the same amount, so the
      // comparison held while the dialog became 0.70 L* DARKER than the veil
      // over the app. A baseline computed from the mutated input cannot
      // measure the mutation.
      if (step < 2.3) {
        failing.push(
          `${t.id}: shadow reads ${halo.toFixed(2)} L* and the panel clears its scrim by only ${step.toFixed(2)}`,
        );
      }
    }
    // Exactly one template writes a ground today. The literal is the point: a
    // second one has to come here and be measured rather than inheriting a
    // sweep that happens to be empty.
    expect({ measured, failing }).toEqual({ measured: 1, failing: [] });
  });

  it('keeps the two separations the operator complained about', () => {
    // `pane -> card` and `pane -> raised` are the pairs the dark lift widened
    // after the second "too dark" report. A template inherits them because it
    // inherits the lightness ladder -- asserted rather than assumed, because
    // adding chroma moves luminance and could in principle close one.
    const narrow: string[] = [];
    for (const t of TINTED) {
      const v = templatePalette(t.id, 'dark');
      const pane = v['--vam-pane'] as string;
      for (const [token, floor] of [
        ['--vam-card', 2.3],
        ['--vam-raised', 2.3],
      ] as const) {
        const step = Math.abs(lightness(v[token] as string) - lightness(pane));
        if (step < floor) narrow.push(`${t.id}: ${token} is ${step.toFixed(2)} L* off the pane`);
      }
    }
    expect(narrow).toEqual([]);
  });

  it('draws an In bubble that is still drawn', () => {
    // The token the operator has now asked about three times. A template that
    // tints the pane towards the bubble's own hue takes away the very thing
    // the light bubble uses to clear its floor, so each template's bubble is
    // measured against ITS OWN pane rather than against the stylesheet's.
    const invisible: string[] = [];
    for (const t of TINTED) {
      for (const theme of THEMES) {
        const v = templatePalette(t.id, theme);
        const bubble = v['--vam-in-bubble'] as string;
        const pane = v['--vam-pane'] as string;
        const ratioFloor = theme === 'dark' ? 1.4 : 1.1;
        const inkDim = UNSETTABLE_INK[theme]['--vam-ink-dim'];
        if (lightness(bubble) <= lightness(pane)) invisible.push(`${t.id}/${theme}: not raised`);
        if (contrast(bubble, pane) < ratioFloor) {
          invisible.push(`${t.id}/${theme}: ratio ${contrast(bubble, pane).toFixed(3)}`);
        }
        if (deltaE(bubble, pane) < 6.24) {
          invisible.push(`${t.id}/${theme}: ΔE ${deltaE(bubble, pane).toFixed(2)}`);
        }
        if (contrast(inkDim, bubble) < 4.5) {
          invisible.push(`${t.id}/${theme}: prompt reads ${contrast(inkDim, bubble).toFixed(3)}`);
        }
      }
    }
    expect(invisible).toEqual([]);
  });

  it('is a different palette from vam’s own, in every template', () => {
    // A "template" that lands on the stylesheet's values is a button that does
    // nothing. Each one must differ from the others AND be a visible step from
    // the default, measured as ΔE on the pane -- the surface with the most
    // screen area.
    const panes = TINTED.map((t) => templatePalette(t.id, 'dark')['--vam-pane'] as string);
    expect(new Set(panes).size).toBe(TINTED.length);
    // `--vam-pane`'s own dark value, READ from the stylesheet rather than
    // copied here -- #363636, then #2d2d2d after the fourth dark pass, and
    // #282828 after the fifth. Measured against what the stylesheet ACTUALLY
    // paints: a template compared against a retired colour is a step away
    // from nothing, and a typed copy retires quietly.
    const vamsOwn = DARK_STYLESHEET.get('--vam-pane');
    expect(vamsOwn, 'styles.css defines --vam-pane in :root').toMatch(/^#[0-9a-f]{6}$/i);
    const flat = panes.filter((p) => deltaE(p, vamsOwn as string) < 2.3);
    expect(flat).toEqual([]);
  });

  it('applies into the theme on screen and leaves the other one alone', () => {
    const id = TINTED[0]?.id as PaletteTemplateId;
    const next = applyPaletteTemplate(EMPTY_PREFS, 'dark', id);
    expect(paletteFor(next.palette, 'dark')).toEqual(templatePalette(id, 'dark'));
    // The other theme was chosen on a screen this one cannot see -- the same
    // argument `clearPalette` makes about reset.
    expect(paletteFor(next.palette, 'light')).toEqual({});
  });

  it('replaces a previous template rather than merging with it', () => {
    // Two templates applied in a row must not leave half of the first behind:
    // a palette that is two presets blended is a palette nobody designed and
    // nobody measured.
    const [first, second] = TINTED;
    const once = applyPaletteTemplate(EMPTY_PREFS, 'dark', first?.id as PaletteTemplateId);
    const twice = applyPaletteTemplate(once, 'dark', second?.id as PaletteTemplateId);
    expect(paletteFor(twice.palette, 'dark')).toEqual(
      templatePalette(second?.id as PaletteTemplateId, 'dark'),
    );
  });

  it('ignores an id it does not know, rather than clearing the palette', () => {
    const applied = applyPaletteTemplate(
      EMPTY_PREFS,
      'dark',
      'not-a-template' as PaletteTemplateId,
    );
    expect(applied).toBe(EMPTY_PREFS);
  });
});
