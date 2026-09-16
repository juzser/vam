/**
 * COLOUR TEMPLATES: a whole palette in one press.
 *
 * Operator: "add a few colour templates at the top of the appearance settings,
 * learn from some VS Code themes."
 *
 * ## What a template is, and why it is not a list of colours somebody liked
 *
 * A TEMPLATE IS A HUE AND A CHROMA APPLIED TO VAM'S OWN LIGHTNESS LADDER. Each
 * surface keeps the L* the stylesheet gives it -- its RUNG -- and moves only in
 * a* and b*. That single rule is what makes offering presets safe at all:
 *
 *   - THE ELEVATION ORDER SURVIVES. `styles.css` orders its surfaces
 *     ground < sunken < well < header/panel < sidebar/pane < raised < card
 *     and a release was spent on that order being visible rather than merely
 *     recorded. A preset that chose its own lightnesses would undo it in one
 *     click, and the operator -- who asked twice for a lighter, less flat dark
 *     theme -- would get the flat one back under a nicer name.
 *   - THE JND SEPARATIONS SURVIVE, including across the three rungs a template
 *     CANNOT set. `ground`, `sunken` and `well` are not in the swatch grid, so
 *     a preset that walks `panel` down lands it on a `well` that stayed where
 *     it was, and a recess inside a dialog stops being a recess. The ladder is
 *     therefore measured MERGED -- the four rungs a template sets dropped into
 *     the three it does not -- which is also what bounds the band it may use
 *     at all: 13.56..22.12 L*, `well` + one JND up to `segment-on` - one JND.
 *   - THE CONTRAST FLOORS SURVIVE EXACTLY, and that is arithmetic rather than
 *     luck: CIE L* is a function of relative luminance alone, so two colours
 *     at one lightness read the SAME WCAG ratio against any ink, whatever hue
 *     they wear. A template on the rungs inherits every reading
 *     `token-contrast.test.ts` holds the stylesheet to, up to 8-bit rounding.
 *     Measured rather than assumed all the same: the worst ink pair across all
 *     seven templates and both themes is 4.634:1 against WCAG 1.4.3's 4.5 --
 *     a LIGHT pair, the quiet inks on the light pane, which is where the
 *     stylesheet's own margin is thinnest too (4.642:1).
 *
 * ## The rung claim was prose, and prose drifted
 *
 * The first four tinted templates did not keep the rungs. They were built from
 * two REMEMBERED gaps -- `pane -> card` 3.30 and `pane -> raised` 2.36, the
 * numbers the third dark pass left and this comment used to quote -- instead
 * of from the ladder itself, so by the time the fifth pass moved the five
 * named surfaces the two lists had long been different lists. Measured
 * afterwards: every one of the four had `panel -> pane` at about 1.44 L* and
 * `raised -> card` at 0.93, both under the 2.3 JND. Four palettes whose
 * structure an operator could not see, passing every test in the suite,
 * because the suite checked the two gaps the prose named rather than the
 * ladder the prose claimed.
 *
 * All four are re-derived below onto today's rungs, cast held (hue within 4°,
 * chroma within 0.5), and two tests now hold what this section claims:
 * `puts every surface back on the rung the stylesheet gives it` reads the
 * rungs off `styles.css`, and `clears a JND between every adjacent rung,
 * including the three it cannot set` measures the merged ladder. Neither can
 * be satisfied by editing this comment.
 *
 * ## The seven tokens a template sets, and the six it must not
 *
 * It sets the ROOM: `panel`, `sidebar`, `pane`, `raised`, `card`, the In
 * bubble, and `ink`.
 *
 * It never sets the SIGNALS: `running`, `waiting`, `cursor-ring`, `idle`,
 * `done` and `failed`. Those are not decoration -- `styles.css` argues each
 * one where it defines it, and amber in this app means exactly one thing, "a
 * session is blocked on your answer". A preset that recoloured the status row
 * would be changing what an operator reads to decide what to do next, which is
 * not what "a colour template" asks for. They stay at the stylesheet's values
 * and every template's surfaces are measured against them.
 *
 * ## Learned from, not copied from -- and the one place that is copied
 *
 * Each entry records in `studied` where its character was read off, with the
 * exact values that were measured. Most of the VALUES here are vam's own and
 * could not be otherwise: those themes are built on their own lightness
 * ladders and their own text colours, and dropping their hexes in wholesale
 * fails this palette's contrast floors on inks they never had to carry.
 * `solarized` is the entry that proves it rather than asserting it -- it uses
 * every published value the ladder can legally take and records, at its own
 * entry, the reading that rejected each one it could not.
 *
 * ## What a template does NOT do
 *
 * It writes into the theme ON SCREEN and leaves the other one alone, exactly
 * as `clearPalette` does and for the same reason: the other theme's colours
 * were chosen on a screen this one cannot see. Applying one is an ordinary
 * palette override -- every swatch still shows it, every per-token reset still
 * clears it, and `reset <theme> colours` still puts the whole thing back.
 * There is no "current template" stored anywhere, deliberately: the operator
 * can move one swatch afterwards, and a remembered name would then be a label
 * for a palette that is no longer that template.
 */

import type { EffectiveTheme, PaletteOverrides, Prefs } from './prefs.js';
import { clearPalette, PALETTE_TOKENS, setPaletteColor } from './prefs.js';

/** The id of a shipped template. */
export type PaletteTemplateId =
  | 'default'
  | 'slate'
  | 'nordic'
  | 'ember'
  | 'plum'
  | 'midnight'
  | 'contrast'
  | 'solarized';

/**
 * WHAT A TEMPLATE DOES WHEN PRESSED, and there are exactly two answers.
 *
 *  - `values`: write this table's colours into the theme on screen.
 *  - `stylesheet`: write NOTHING and delete what is there, so every token falls
 *    back through the cascade to `styles.css`.
 *
 * THE SECOND IS NOT "a template whose values happen to be vam's". Writing
 * today's stylesheet values into the bucket would look identical on screen and
 * would FREEZE that palette against every later stylesheet -- the operator
 * would stop receiving the theme's own changes and nothing would tell them.
 * `clearPaletteColor` in `prefs.ts` makes the same argument for one token; this
 * is it for thirteen. The distinction is a discriminator rather than an empty
 * table so that a reader cannot mistake "sets nothing" for "was never filled
 * in", and so the measurement tests can say which entries they cover.
 */
export type PaletteTemplateKind = 'values' | 'stylesheet';

export interface PaletteTemplate {
  readonly id: PaletteTemplateId;
  readonly kind: PaletteTemplateKind;
  /** What the button says. Lower case, like every other label in Settings. */
  readonly label: string;
  /** One line under the row, for the template under the pointer. */
  readonly hint: string;
  /**
   * Where this palette's character was read off, with the values that were
   * measured. Usually a theme whose character was taken and whose hexes were
   * NOT; `solarized` is the one entry that takes published values too, and
   * says at its own comment which ones and why the rest could not come.
   */
  readonly studied: string;
  readonly dark: PaletteOverrides;
  readonly light: PaletteOverrides;
}

/**
 * The seven, each generated by putting its hue and chroma on the rungs above
 * and then measured. The dark chroma is in the comment on each: past about 10
 * the surfaces stop reading as "a grey with a cast" and start reading as
 * coloured panels, which is a different product -- `solarized` is over that
 * line on purpose, because Solarized's own backgrounds are (base03 carries
 * 14.50 of chroma), and it is the only entry here that is a theme rather than
 * a cast.
 */
export const PALETTE_TEMPLATES: readonly PaletteTemplate[] = [
  {
    /**
     * VAM'S OWN, AND THE WAY BACK. First in the row because it is the state
     * every other entry is a departure from, and because without it the row
     * was a one-way door: `reset <theme> colours` only appears once something
     * is overridden, which is exactly when an operator is least likely to be
     * looking for it -- they pressed a template, they want the old one back,
     * and the control that does that is somewhere else and shaped differently.
     *
     * It CLEARS rather than writes. See `PaletteTemplateKind`.
     */
    id: 'default',
    kind: 'stylesheet',
    label: 'default',
    hint: "vam's own palette — clears every colour back to the stylesheet",
    studied: 'the ADE session-canvas mockup, artboards 1a and 1b',
    dark: {},
    light: {},
  },
  {
    id: 'slate',
    kind: 'values',
    label: 'slate',
    hint: 'a cool blue-grey room — the quietest of the four',
    studied: 'GitHub Dark Dimmed, One Dark Pro',
    // hue 255°, chroma 5 (dark) / 2.5 (light). The dark surfaces were
    // re-derived onto today's rungs -- see "the rung claim was prose" above;
    // the cast is the one this palette shipped with, the lightness is not.
    dark: {
      '--vam-panel': '#1c242a',
      '--vam-sidebar': '#22292f',
      '--vam-pane': '#22292f',
      '--vam-raised': '#282f35',
      '--vam-card': '#2e353b',
      '--vam-in-bubble': '#3a444d',
      '--vam-ink': '#ebedf0',
    },
    light: {
      '--vam-panel': '#fbffff',
      '--vam-sidebar': '#ebeff3',
      '--vam-pane': '#ebeff3',
      '--vam-raised': '#ecf0f4',
      '--vam-card': '#fbffff',
      '--vam-in-bubble': '#fffaf4',
      '--vam-ink': '#17181a',
    },
  },
  {
    id: 'nordic',
    kind: 'values',
    label: 'nordic',
    hint: 'the same blue, taken further — cold and low-contrast',
    studied: 'Nord',
    // hue 260°, chroma 9 (dark) / 4 (light). Dark re-derived onto the rungs.
    dark: {
      '--vam-panel': '#19242f',
      '--vam-sidebar': '#1e2935',
      '--vam-pane': '#1e2935',
      '--vam-raised': '#252f3b',
      '--vam-card': '#2a3541',
      '--vam-in-bubble': '#3b444d',
      '--vam-ink': '#ebedf0',
    },
    light: {
      '--vam-panel': '#faffff',
      '--vam-sidebar': '#e9eff6',
      '--vam-pane': '#e9eff6',
      '--vam-raised': '#ebf1f7',
      '--vam-card': '#faffff',
      '--vam-in-bubble': '#fdf9f4',
      '--vam-ink': '#17181a',
    },
  },
  {
    id: 'ember',
    kind: 'values',
    label: 'ember',
    hint: 'warm brown-grey, for a screen that is on after dark',
    studied: 'Monokai, Solarized Dark',
    // hue 65°, chroma 6 (dark) / 3 (light). Dark re-derived onto the rungs.
    dark: {
      '--vam-panel': '#28221b',
      '--vam-sidebar': '#2e2720',
      '--vam-pane': '#2e2720',
      '--vam-raised': '#342d26',
      '--vam-card': '#3a332c',
      '--vam-in-bubble': '#4b4139',
      '--vam-ink': '#efedea',
    },
    light: {
      '--vam-panel': '#fffefa',
      '--vam-sidebar': '#f3ede9',
      '--vam-pane': '#f3ede9',
      '--vam-raised': '#f5efeb',
      '--vam-card': '#fffefa',
      '--vam-in-bubble': '#f4faff',
      '--vam-ink': '#1a1816',
    },
  },
  {
    id: 'plum',
    kind: 'values',
    label: 'plum',
    hint: 'a violet cast, the warmest of the cool three',
    studied: 'Dracula, Tokyo Night',
    // hue 320°, chroma 6 (dark) / 3 (light). Dark re-derived onto the rungs.
    dark: {
      '--vam-panel': '#272128',
      '--vam-sidebar': '#2c262e',
      '--vam-pane': '#2c262e',
      '--vam-raised': '#322c34',
      '--vam-card': '#38323a',
      '--vam-in-bubble': '#48404a',
      '--vam-ink': '#eeecef',
    },
    light: {
      '--vam-panel': '#fffeff',
      '--vam-sidebar': '#f1edf2',
      '--vam-pane': '#f1edf2',
      '--vam-raised': '#f3eff4',
      '--vam-card': '#fffeff',
      '--vam-in-bubble': '#f8fcf7',
      '--vam-ink': '#19181a',
    },
  },
  {
    /**
     * MIDNIGHT: THE OPERATOR ASKED FOR EMERALD, AND THE THEMES THAT PROMISE IT
     * DO NOT PAINT IT.
     *
     * Everforest and Night Owl are the two usually named when somebody wants a
     * green room, and both were measured before anything was written here.
     * Everforest's `bg0` (#2d353b) sits at Lab hue 250 and Night Owl's
     * background (#011627) at 266: those are BLUES. What is green in either
     * theme is the accents, not the room -- a dark surface at 16 L* can carry
     * so little chroma that the eye reads its hue off the whole page, and both
     * themes spend that budget on blue. Naming one of them in `studied` would
     * have recorded a source this palette does not actually come from.
     *
     * SO THE HUE IS READ OFF THE TWO GREENS VAM ITSELF ALREADY MEANS SOMETHING
     * BY: `--vam-icon-teal` (#2dd4bf, hue 181.7) and `--vam-running` (#4ade80,
     * hue 149.6). This room sits at 176 -- five degrees off the teal an
     * operator can already put on an icon, and well clear of the running
     * green, so a session's status never reads as part of the furniture.
     *
     * CHROMA 8, which is nordic's 9 without quite reaching it: teal is the
     * most visible cast at a given chroma (the eye's b* axis is weaker here
     * than its a*), and at 10 these surfaces stopped reading as a dark room
     * and started reading as a pale green one.
     */
    id: 'midnight',
    kind: 'values',
    label: 'midnight',
    hint: 'a deep teal-green room, the coolest of the warm greens',
    studied:
      "vam's own --vam-icon-teal (#2dd4bf, hue 181.7) and --vam-running (#4ade80, hue 149.6); Everforest and Night Owl were read first and measure blue at this lightness (hue 250 and 266)",
    // hue 176°, chroma 8 (dark) / 5 (light).
    dark: {
      '--vam-panel': '#162622',
      '--vam-sidebar': '#1c2b27',
      '--vam-pane': '#1c2b27',
      '--vam-raised': '#21312d',
      '--vam-card': '#273732',
      '--vam-in-bubble': '#324540',
      '--vam-ink': '#e6eeec',
    },
    light: {
      '--vam-panel': '#fbffff',
      '--vam-sidebar': '#e4f1ed',
      '--vam-pane': '#e4f1ed',
      '--vam-raised': '#e6f3ef',
      '--vam-card': '#fbffff',
      // Warm, against a cool pane: see the light-bubble note under the table.
      '--vam-in-bubble': '#fffbf6',
      '--vam-ink': '#16191a',
    },
  },
  {
    /**
     * HIGH CONTRAST, AND THE HALF OF THE ASK THAT IS NOT AVAILABLE.
     *
     * The operator asked for "near-absolute black, maximum separation". The
     * second half is here. The first half cannot be, and the arithmetic is
     * worth keeping because it is the kind of thing that otherwise gets
     * re-attempted every six months:
     *
     *   - `--vam-ground` (#141414) IS NOT SETTABLE BY A TEMPLATE. It left the
     *     swatch grid at the operator's own ask and lives in `RETIRED_TOKENS`;
     *     `applyPaletteTemplate` puts every value through `setPaletteColor`,
     *     which drops what the grid does not offer. So the app's outermost
     *     background stays at 6.32 L* whatever this entry says.
     *   - `--vam-panel` IS ALREADY AT ITS FLOOR. `well` (11.26 L*) is pinned
     *     too, so the darkest legal panel is 13.56, and the stylesheet paints
     *     13.71 -- one 8-bit step above it. `dark-ladder.test.ts` asserts
     *     exactly that, by taking the step and measuring the collapse.
     *   - SO A TEMPLATE CANNOT GO BLACKER, only inverted: a panel under `well`
     *     is a dialog darker than the recess inside it, which is not a
     *     high-contrast theme but a broken one.
     *
     * WHAT MAXIMUM SEPARATION IS WORTH, MEASURED, and it is almost nothing.
     * Both ends of the band are pinned -- `well` below, `segment-on` above --
     * and the rungs between them are already spread about as far as 8-bit
     * sRGB allows. This entry's gaps are `panel -> pane` 2.69 and
     * `pane -> raised` 2.43 against the stylesheet's 2.40 and 2.83, so the
     * TIGHTEST gap in the merged ladder goes 2.40 -> 2.43 L*. Three
     * hundredths of a just-noticeable difference, and there is no more to
     * take: `ground -> sunken` is 2.44 and no template can touch it, so 2.44
     * is the ceiling on any preset's tightest gap whatever it does with the
     * four rungs it owns. The fifth dark pass got there first. The room is
     * not where a high-contrast palette can live in this app, which is worth
     * knowing before the next one is attempted.
     *
     * SO IT SPENDS ITS BUDGET WHERE THERE IS SOME.
     *
     *   - THE INK GOES TO PURE WHITE, which is the one token here not bounded
     *     by a rung: on this palette's own pane vam's #ededed would read
     *     12.491:1 and #ffffff reads 14.623:1, and in light #000000 reads
     *     21:1 on the card where vam's #18181b reads 15.290:1 on its own.
     *     `styles.css` deliberately stops at #ededed with "near-white ink on a
     *     dark theme is glare, not lift" -- true, and the exact trade an
     *     operator asking for high contrast is asking to make. It is offered
     *     as a preset rather than taken as a default for that reason.
     *   - THE BUBBLE GOES UP 4.52 L* OFF ITS RUNG, the one deliberate rung
     *     departure in this file. The In bubble is not a ladder rung -- it is
     *     solved against the pane by ratio and ΔE -- and it carries no border,
     *     so nothing is riding on its exact value. At 32.05 L* it reads
     *     1.686:1 against the pane where the stylesheet reads 1.459:1, and
     *     `--vam-ink-dim`, which a template does not set, still clears 1.4.3
     *     on it at 5.183:1. It is the element the operator reads most.
     *   - THE CAST IS THE COLDEST THING HERE AND THE FAINTEST: hue 199,
     *     chroma 3. Not decoration -- a template whose pane lands within a JND
     *     of the stylesheet's is a button that does nothing, and the pane is
     *     boxed into 1.66 L* of legal lightness, so a departure this palette
     *     can be recognised by has to be bought with chroma. Three is the
     *     least that buys it with room (ΔE 3.25 against a 2.3 floor), and a
     *     cold near-black is what a high-contrast theme looks like anyway.
     *
     * IN LIGHT THERE IS NO SUCH CEILING on the ink, so it takes all of it.
     */
    id: 'contrast',
    kind: 'values',
    label: 'high contrast',
    hint: 'pure white on near-black — the widest steps this ladder allows',
    studied:
      "VS Code's Dark High Contrast (#000000 background, #ffffff foreground), bounded by vam's own pinned ground",
    // hue 199°, chroma 3 (dark) / 2 (light).
    dark: {
      '--vam-panel': '#1f2424',
      '--vam-sidebar': '#232a2a',
      '--vam-pane': '#232a2a',
      '--vam-raised': '#292f2f',
      '--vam-card': '#2f3535',
      '--vam-in-bubble': '#454d4d',
      '--vam-ink': '#ffffff',
    },
    light: {
      // White is white: the light theme's own panel is already the brightest
      // value there is, and moving it would be moving away from contrast.
      '--vam-panel': '#ffffff',
      '--vam-sidebar': '#eaefef',
      '--vam-pane': '#eaefef',
      '--vam-raised': '#ebf1f1',
      '--vam-card': '#ffffff',
      '--vam-in-bubble': '#fffbf2',
      '--vam-ink': '#000000',
    },
  },
  {
    /**
     * SOLARIZED: THE ENTRY THAT USES PUBLISHED VALUES, AND THE READINGS THAT
     * DECIDED WHICH ONES COULD COME.
     *
     * Ethan Schoonover's palette, the sixteen values published with the
     * project. What is taken VERBATIM, and why each one is legal here:
     *
     *   - `base2` #eee8d5 as the DARK ink (92.00 L*). Solarized's own dark
     *     body ink is `base0` #839496, and it cannot be used: at 60.08 L* it
     *     reads 3.934:1 on this palette's card, under WCAG 1.4.3, because
     *     vam's card (21.70 L*) is lighter than the background Solarized
     *     measured its inks against (`base03`, 15.46). `base1` #93a1a1 clears
     *     at 4.651:1 -- legal, and 0.151 over the floor, which is the margin
     *     three dark passes have refused to ship. So the ink is the value
     *     Solarized itself reserves for emphasised content on a dark ground.
     *   - `base02` #073642 as the LIGHT ink, which is Solarized Light's own
     *     background used as text: 10.6:1 on this palette's pane.
     *   - `base3` #fdf6e3 as the LIGHT panel and card (96.96 L*). The light
     *     theme is not a JND ladder, so a value 3.04 L* under `--vam-panel`'s
     *     own is free here; it still clears `well` by 3.54.
     *
     * WHAT COULD NOT COME, measured rather than asserted -- this is the entry
     * the file header's "dropping their hexes in wholesale fails this palette's
     * floors" paragraph is about:
     *
     *   - `base03` #002b36 AS THE PANE. It lands 0.65 L* under vam's pane rung,
     *     which sounds like nothing and is fatal: `panel` would then have to
     *     sit at 13.16 or lower to keep its JND, and `well` + one JND is
     *     13.56. There is no legal panel under a base03 pane. It is instead
     *     the cast this whole room is built from -- hue 230, chroma 14.5, both
     *     read off base03 and base02 -- which puts the pane 1.87 ΔE from
     *     base03 itself, under the 2.3 a person can see.
     *   - `base2` #eee8d5 AS THE LIGHT PANE (92.00 L*). It reads 4.390:1
     *     against `--vam-ink-quiet`, the caption ink a template does not set
     *     and cannot fix -- a WCAG failure by 0.11, on a value that is
     *     perfectly safe in Solarized's own theme because Solarized's captions
     *     are its own. The light pane is base2's cast on vam's rung instead.
     *
     * AND IT IS THE ONE ENTRY OVER THE CHROMA LINE the table's header draws at
     * about 10. Solarized's backgrounds are not greys with a cast: base03
     * carries 14.50 and base02 15.59. A version of this at chroma 8 would have
     * been a blue-grey nobody would recognise, which is a worse outcome than
     * an honest departure from a guideline written for the other six.
     */
    id: 'solarized',
    kind: 'values',
    label: 'solarized',
    hint: 'Ethan Schoonover’s palette, on vam’s ladder — the only coloured room here',
    studied:
      'Solarized (Ethan Schoonover): base03 #002b36 and base02 #073642 for the dark cast (hue 230, chroma 14.5), base2 #eee8d5 and base3 #fdf6e3 for the light',
    // hue 230°, chroma 14.5 (dark) / 10 (light).
    dark: {
      '--vam-panel': '#002732',
      '--vam-sidebar': '#042c39',
      '--vam-pane': '#042c39',
      '--vam-raised': '#07333c',
      '--vam-card': '#103943',
      '--vam-in-bubble': '#214652',
      '--vam-ink': '#eee8d5',
    },
    light: {
      '--vam-panel': '#fdf6e3',
      '--vam-sidebar': '#f4eedb',
      '--vam-pane': '#f4eedb',
      '--vam-raised': '#f6f0dd',
      '--vam-card': '#fdf6e3',
      // Cool, against the warmest pane in the table: 12.95 ΔE off it.
      '--vam-in-bubble': '#f3fdff',
      '--vam-ink': '#073642',
    },
  },
];

/**
 * THE LIGHT BUBBLE IS THE ONE VALUE NOT ON THE TEMPLATE'S OWN HUE, and the
 * reason is worth keeping next to the table.
 *
 * vam's light In bubble clears its ΔE floor by differing from a WARM pane in
 * HUE -- that theme's pane sits at 86% relative luminance, so nothing lighter
 * than it can buy distance with lightness. A template that tints the pane
 * towards the bubble's own hue takes that away, and the bubble stops being
 * drawn: the exact complaint, reported twice, that created the token. So each
 * template's light bubble is rotated off its pane and then solved against the
 * floor, which is why `ember` (warm) has a cool bubble and `slate` (cool) has
 * a warm one.
 */

const BY_ID = new Map(PALETTE_TEMPLATES.map((t) => [t.id, t]));

/** The overrides one template writes in one theme, or `{}` for an unknown id. */
export function templatePalette(id: PaletteTemplateId, theme: EffectiveTheme): PaletteOverrides {
  const template = BY_ID.get(id);
  return template === undefined ? {} : template[theme];
}

/**
 * Apply a template to the theme on screen.
 *
 * REPLACES, rather than merging: two presets half-applied over each other is a
 * palette nobody designed and nobody measured. Every offered token is cleared
 * first, so a template that does not set `running` leaves `running` at the
 * stylesheet's value even if the operator had picked one by hand -- which is
 * what "apply this template" means, and is undone by `reset <theme> colours`
 * the same as any other palette state.
 *
 * An id this file does not know changes NOTHING and returns the same object, so
 * a caller with a stale id cannot blank somebody's palette. Every value still
 * goes through `setPaletteColor`, which drops tokens vam does not offer -- the
 * table above is checked against `PALETTE_TOKENS` by the test, but the runtime
 * does not take that on trust either.
 */
export function applyPaletteTemplate(
  prefs: Prefs,
  theme: EffectiveTheme,
  id: PaletteTemplateId,
): Prefs {
  const template = BY_ID.get(id);
  if (template === undefined) {
    return prefs;
  }
  if (template.kind === 'stylesheet') {
    return clearPalette(prefs, theme);
  }
  const values = template[theme];
  let next: Prefs = { ...prefs, palette: { ...prefs.palette, [theme]: {} } };
  for (const { token } of PALETTE_TOKENS) {
    const value = values[token];
    if (value !== undefined) {
      next = setPaletteColor(next, theme, token, value);
    }
  }
  return next;
}
