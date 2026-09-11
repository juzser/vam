/**
 * THE COLOUR TEMPLATES, MEASURED RATHER THAN EYEBALLED.
 *
 * Operator: "add a few colour templates at the top of the appearance settings,
 * learn from some VS Code themes."
 *
 * A TEMPLATE IS A HUE AND A CHROMA ON VAM'S OWN LIGHTNESS LADDER, which is the
 * whole reason this is safe to offer at all. The dark lift spent a release
 * establishing that the surfaces a person sees at once sit at least one
 * just-noticeable difference apart (`dark-lift.test.ts`), and a template that
 * picked its own lightnesses would throw that away silently -- the operator
 * would click "nordic" and get back the flat palette the lift was written to
 * fix. So every surface in every template keeps the L* the stylesheet gives
 * it, and only a* and b* move. Elevation ORDER and JND SEPARATION are then
 * preserved by construction, and this file checks that they actually were.
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

import { describe, expect, it } from 'vitest';
import {
  applyPaletteTemplate,
  PALETTE_TEMPLATES,
  type PaletteTemplateId,
  templatePalette,
} from '../../src/renderer/prefs/palette-templates.js';
import { EMPTY_PREFS, PALETTE_TOKENS, paletteFor } from '../../src/renderer/prefs/prefs.js';
import { contrast, deltaE, lightness } from '../support/contrast.js';

/**
 * The inks a template does NOT set and therefore has to survive, per theme,
 * read off `styles.css`'s own values.
 *
 * Written out rather than parsed, deliberately: parsing the stylesheet would
 * make this file agree with whatever the stylesheet says next, and the claim
 * is that these templates were chosen against THESE inks. A stylesheet change
 * that moves one of them should redden here and be re-derived, which is the
 * same argument `dark-lift.test.ts` makes about its own baseline table.
 */
const UNSETTABLE_INK = {
  dark: {
    '--vam-ink-dim': '#b4b4b4',
    '--vam-ink-faint': '#969696',
    '--vam-ink-quiet': '#969696',
    '--vam-running': '#4ade80',
    '--vam-waiting': '#f59e0b',
    '--vam-idle': '#a1a1aa',
    '--vam-done': '#60a5fa',
    '--vam-failed': '#f87171',
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

  it('only ever names tokens the operator could have set by hand', () => {
    // A template writing a token the swatch grid does not offer is a colour
    // with no way back: `reset <theme> colours` clears the bucket, but a
    // per-token reset needs a swatch, and `setPaletteColor` drops unknown
    // tokens on the floor anyway -- so the write would silently not happen.
    const offered = new Set(PALETTE_TOKENS.map((entry) => entry.token));
    const stray: string[] = [];
    for (const t of TINTED) {
      for (const theme of THEMES) {
        for (const token of Object.keys(templatePalette(t.id, theme))) {
          if (!offered.has(token)) stray.push(`${t.id}/${theme}: ${token}`);
        }
      }
    }
    expect(stray).toEqual([]);
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
    // 4 templates x 2 themes x 9 inks x 5 surfaces. The literal is the point:
    // it turns a shortened list into a failure rather than a quieter pass.
    expect({ pairs, failing }).toEqual({ pairs: 360, failing: [] });
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
    const flat = panes.filter((p) => deltaE(p, '#272727') < 2.3);
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
