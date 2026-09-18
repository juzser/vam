/**
 * THE TERMINAL'S OWN COLOUR SCHEME — and why it is not the app's palette.
 *
 * Operator, translated: "make the terminal colour setup deeper and richer,
 * like orca, then make the colour scheme I have set up for orca's terminal
 * the default on vam's terminal."
 *
 * ── WHAT THE SCREEN WORE BEFORE THIS FILE ────────────────────────────────
 * Sixteen global tokens (`--vam-ansi-*`, styles.css) for the agent's own
 * colours, and the app's `panel` and `ink` for everything else: the screen's
 * ground was the app's panel, its default text was the app's ink, the cursor
 * was `bg-ink text-panel`, bold was the browser's bold, and a selection was
 * whatever Chromium paints. There was no setting, because there was nothing
 * to set -- a terminal that borrows its colours from the app around it has
 * one palette, the app's, and it moves when the app's does.
 *
 * That is the wrong ownership for a terminal, and every emulator says so by
 * shipping a theme catalogue of its own: the screen is where the operator
 * reads an agent for hours, and the ground and ink a person wants THERE are
 * a preference of long standing (the operator's is `hans`, below) that has
 * nothing to do with the dashboard's greys. So the terminal gets a SCHEME --
 * twenty-three colours, the shape iTerm2 and xterm.js agree on, plus a
 * `bold` colour that xterm.js lacks and orca carries anyway for the reason
 * its own comment gives: people who have one expect it kept.
 *
 * ── ONE CHOICE PER APP THEME, WITH OVERRIDES ─────────────────────────────
 * The stored shape is `{ dark: { theme, overrides }, light: { theme,
 * overrides }, backgroundOpacity }`. Per APP theme rather than one choice,
 * for the reason the app's palette is per theme (`prefs.ts`, `ThemePalettes`):
 * a scheme is only ever chosen against the screen it will be worn on, and a
 * single choice would put a dark terminal in a light dashboard the first time
 * the OS flipped at sunset. The overrides are the "deeper" half of the ask --
 * pick a theme, then move the one colour that is wrong for you -- and they
 * are a LAYER over a named theme, not a scheme of their own, so clearing them
 * is a deletion and the theme underneath keeps answering.
 *
 * ── HEX TABLES, AND THE COST OF THAT ─────────────────────────────────────
 * The two `vam` themes are the stylesheet's own ramp COPIED, which
 * `palette-templates.ts` argues at length is the one thing a template must
 * never do: a copy freezes against every later stylesheet. It is done here
 * anyway, because a scheme has to be twenty-three plain colours -- it is
 * stored, merged with overrides, composited with an opacity and read back by
 * a picker, none of which a `var()` can do. The cost is paid with a test
 * instead: `terminal-scheme.test.ts` reads the ramp off `styles.css` and holds
 * both `vam` themes to it, so the drift is loud rather than silent.
 *
 * ── WHY A STORE AND NOT ONLY CUSTOM PROPERTIES ───────────────────────────
 * The resolved scheme reaches the screen as custom properties on the screen's
 * own element, never on `:root` -- the sixteen `--vam-ansi-*` names are the
 * ones the `text-ansi-*` utilities already read, and putting them on the root
 * would recolour any other surface that reads them. An element's inline style
 * is a React value, so the tab has to re-render for it, which is the store
 * with a snapshot and a subscription that `terminal-font.ts` already has and
 * argues for. It is fed from two places, exactly as `applyPalette` is:
 * `activatePrefs` on every read and write, and `Canvas.tsx`'s theme effect,
 * which is the only thing that hears the OS flip under `system`.
 */

import type { EffectiveTheme, Prefs } from './prefs.js';

/**
 * The twenty-three colours of a scheme.
 *
 * iTerm2's export shape, with the two names xterm.js uses for the cursor's
 * pair (`cursor`, `cursorAccent`) and the selection pair, so a scheme copied
 * from either tool lands here unedited. `bold` is iTerm2's "bold colour": the
 * ink a BOLD run takes when it has no colour of its own (`spanClasses` in
 * `terminal-ansi.ts` carries the rule).
 */
export type TerminalScheme = {
  readonly background: string;
  readonly foreground: string;
  readonly bold: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly selectionForeground: string;
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
};

export type TerminalSchemeKey = keyof TerminalScheme;

/**
 * THE CUSTOM PROPERTY EACH COLOUR IS HANDED TO THE SCREEN AS. One table, so
 * the key list, the property list and the validator cannot disagree about
 * how many colours there are: `TERMINAL_SCHEME_KEYS` is derived from it.
 *
 * The sixteen ANSI names are the tokens `styles.css` already defines and
 * `terminal-ansi.ts` already emits utilities for -- set on the screen's own
 * element they shadow the global pair inside it and nowhere else. The seven
 * `--vam-term-*` names are new and are read only inside the screen
 * (`TerminalTab.scheme.test.tsx` holds that by scanning the sources).
 */
export const TERMINAL_SCHEME_VARS: Readonly<Record<TerminalSchemeKey, string>> = {
  background: '--vam-term-bg',
  foreground: '--vam-term-fg',
  bold: '--vam-term-bold',
  cursor: '--vam-term-cursor',
  cursorAccent: '--vam-term-cursor-accent',
  selectionBackground: '--vam-term-selection-bg',
  selectionForeground: '--vam-term-selection-fg',
  black: '--vam-ansi-black',
  red: '--vam-ansi-red',
  green: '--vam-ansi-green',
  yellow: '--vam-ansi-yellow',
  blue: '--vam-ansi-blue',
  magenta: '--vam-ansi-magenta',
  cyan: '--vam-ansi-cyan',
  white: '--vam-ansi-white',
  brightBlack: '--vam-ansi-bright-black',
  brightRed: '--vam-ansi-bright-red',
  brightGreen: '--vam-ansi-bright-green',
  brightYellow: '--vam-ansi-bright-yellow',
  brightBlue: '--vam-ansi-bright-blue',
  brightMagenta: '--vam-ansi-bright-magenta',
  brightCyan: '--vam-ansi-bright-cyan',
  brightWhite: '--vam-ansi-bright-white',
};

export const TERMINAL_SCHEME_KEYS = Object.keys(
  TERMINAL_SCHEME_VARS,
) as readonly TerminalSchemeKey[];

/**
 * WHAT EACH COLOUR IS CALLED ON THE SETTINGS ROW. Lower case, like the labels
 * `PALETTE_TOKENS` carries, because the settings surface capitalises every
 * control name as CSS and a label stored with a capital would be capitalised
 * twice (`SettingsOverlay.tsx`, on `Block`). One table beside the property
 * table so a key cannot gain a property and no name: `terminal-scheme.test.ts`
 * holds the two key sets equal.
 *
 * `cursor accent` is xterm.js's name and is kept rather than translated to
 * "cursor text": it is the ink of the glyph UNDER a block cursor, which is
 * text only while the cursor is a block, and the name a scheme is copied
 * from is the name an operator will look for.
 */
export const TERMINAL_SCHEME_LABELS: Readonly<Record<TerminalSchemeKey, string>> = {
  background: 'background',
  foreground: 'foreground',
  bold: 'bold',
  cursor: 'cursor',
  cursorAccent: 'cursor accent',
  selectionBackground: 'selection background',
  selectionForeground: 'selection foreground',
  black: 'black',
  red: 'red',
  green: 'green',
  yellow: 'yellow',
  blue: 'blue',
  magenta: 'magenta',
  cyan: 'cyan',
  white: 'white',
  brightBlack: 'bright black',
  brightRed: 'bright red',
  brightGreen: 'bright green',
  brightYellow: 'bright yellow',
  brightBlue: 'bright blue',
  brightMagenta: 'bright magenta',
  brightCyan: 'bright cyan',
  brightWhite: 'bright white',
};

/** The ids of the shipped themes. A slug, so a stored payload and a future
 *  URL can carry it without quoting. */
export type TerminalThemeId =
  | 'hans'
  | 'vam'
  | 'catppuccin-mocha'
  | 'dracula'
  | 'solarized-dark'
  | 'gruvbox-dark'
  | 'one-dark'
  | 'nord'
  | 'tango-light'
  | 'vam-light'
  | 'solarized-light'
  | 'github-light';

export interface TerminalTheme {
  readonly id: TerminalThemeId;
  /** What the picker will say. Proper names keep their case: these are the
   *  names the palettes are published under, not vam's own labels. */
  readonly label: string;
  /**
   * WHICH APP THEME IT IS OFFERED FOR. A dark scheme in a light dashboard is
   * a black rectangle in a white page, so each bucket of the preference
   * accepts only the themes offered for it -- "exact or default", the rule
   * `terminal-font.ts` gives for a value no dialog for that bucket could show
   * as chosen. One line to relax if an operator ever asks for the cross.
   */
  readonly on: EffectiveTheme;
  /** Where the values were read off, the way `palette-templates.ts` records
   *  it -- and, for the keys a palette does not publish, how they were
   *  derived. */
  readonly studied: string;
  readonly scheme: TerminalScheme;
}

/**
 * The twelve, dark first and in the order the picker will show them.
 *
 * KEYS A PUBLISHED PALETTE DOES NOT DEFINE are derived by one rule each,
 * stated in `studied` where it applies:
 *   - `bold` is the foreground, which is what iTerm2 paints when no bold
 *     colour is set -- except where the palette names an emphasised text
 *     colour of its own (Solarized's base1 / base01).
 *   - `cursorAccent` is the background, so the glyph under a block cursor
 *     is drawn as the ground showing through it, which is what a block
 *     cursor has always been.
 *   - the selection pair is the palette's own where it publishes one, and
 *     otherwise the theme's next surface step over the background with the
 *     foreground kept on it.
 */
export const TERMINAL_THEMES: readonly TerminalTheme[] = [
  {
    /**
     * THE OPERATOR'S OWN, AND THE DARK DEFAULT. Handed over as twenty-three
     * values from their orca custom theme and carried here digit for digit;
     * it is the whole reason the setting exists, and `terminal-scheme.test.ts`
     * pins every value so nobody re-picks one by eye.
     *
     * It is not measured against vam's contrast floors and is not going to
     * be: the operator chose these on the screen they read agents on, and a
     * default that is "their scheme, adjusted" would not be their scheme.
     */
    id: 'hans',
    label: 'Hans',
    on: 'dark',
    studied: "the operator's own scheme, as set up in orca's terminal; taken verbatim",
    scheme: {
      background: '#1e1f29',
      foreground: '#9a9b97',
      bold: '#dba780',
      cursor: '#ae7af7',
      cursorAccent: '#1e1f29',
      selectionBackground: '#0f0e19',
      selectionForeground: '#9a9b97',
      black: '#343648',
      red: '#fc3b44',
      green: '#48ff68',
      yellow: '#eefc7a',
      blue: '#645036',
      magenta: '#fc5dba',
      cyan: '#7ce4fc',
      white: '#f6f6ef',
      brightBlack: '#505d93',
      brightRed: '#fc555b',
      brightGreen: '#5eff82',
      brightYellow: '#ffff95',
      brightBlue: '#cb97ff',
      brightMagenta: '#fc78d7',
      brightCyan: '#96ffff',
      brightWhite: '#ffffff',
    },
  },
  {
    /**
     * WHAT THE SCREEN WORE BEFORE IT HAD A SCHEME, so the old look is one
     * press away and not gone. The sixteen are `:root`'s `--vam-ansi-*`, the
     * ground and ink are `--vam-panel` and `--vam-ink` (the `bg-panel
     * text-ink` the pane carried), the cursor pair is the `bg-ink text-panel`
     * the caret carried, and the selection is `--vam-line-strong`: the
     * strongest neutral in the ladder, 2.13:1 over the panel so it can be
     * seen and 6.67:1 under the ink so the text on it can be read. Held to
     * the stylesheet by test, see the file header -- which is why the
     * background here follows every move of `--vam-panel` (#1e1e1e since the
     * sixth dark pass) rather than keeping a copy of an older one; the
     * selection's two readings improve on their own as the panel descends,
     * because neither `line-strong` nor `ink` is on the ladder.
     */
    id: 'vam',
    label: 'vam',
    on: 'dark',
    studied:
      "vam's own styles.css `:root` block: the ANSI ramp, panel, ink and line-strong; bold = foreground, cursor = ink, cursorAccent = panel",
    scheme: {
      background: '#1e1e1e',
      foreground: '#ededed',
      bold: '#ededed',
      cursor: '#ededed',
      cursorAccent: '#1e1e1e',
      selectionBackground: '#525252',
      selectionForeground: '#ededed',
      black: '#808080',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#e879f9',
      cyan: '#22d3ee',
      white: '#d4d4d4',
      brightBlack: '#a3a3a3',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#93c5fd',
      brightMagenta: '#f0abfc',
      brightCyan: '#67e8f9',
      brightWhite: '#fafafa',
    },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    on: 'dark',
    // Catppuccin's ports disagree about the selection: the Alacritty and
    // kitty files paint it rosewater-on-base (the cursor's own pair), the
    // Windows Terminal and orca tables paint surface2 under the text. The
    // second is taken -- a selection that is the cursor's colour makes a
    // selected cell and the caret indistinguishable.
    studied:
      'the Catppuccin Mocha palette (base, text, rosewater cursor, surface1/surface2 for the two blacks, subtext1/subtext0 for the two whites); selection = surface2 under text, bold = foreground',
    scheme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      bold: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorAccent: '#1e1e2e',
      selectionBackground: '#585b70',
      selectionForeground: '#cdd6f4',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    on: 'dark',
    studied:
      "the Dracula specification's terminal table (spec.draculatheme.com): background, foreground, the sixteen, and `Selection` #44475a; cursor = foreground, bold = foreground",
    scheme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      bold: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: '#44475a',
      selectionForeground: '#f8f8f2',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },
  {
    /**
     * THE ONE THEME THAT PUBLISHES A BOLD COLOUR. Schoonover's palette names
     * base1 as "emphasized content" on the dark ground, which is precisely
     * what iTerm2's bold colour is for, so it is taken rather than derived.
     * The selection is the palette's own "background highlights" (base02)
     * under base1, the same emphasised ink.
     */
    id: 'solarized-dark',
    label: 'Solarized Dark',
    on: 'dark',
    studied:
      'Solarized (Ethan Schoonover): base03 ground, base0 body text, base1 emphasised text as bold and as the selected ink, base02 background highlights as the selection; the sixteen as published',
    scheme: {
      background: '#002b36',
      foreground: '#839496',
      bold: '#93a1a1',
      cursor: '#839496',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      selectionForeground: '#93a1a1',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    on: 'dark',
    // bg2 is the palette's own third background step (bg0 #282828, bg1
    // #3c3836, bg2 #504945): two steps up is the least that reads as a
    // selection on a ground this warm, with fg kept on it.
    studied:
      'gruvbox (morhetz), the medium-contrast dark set: bg0 ground, fg text, the sixteen as published; selection = bg2 under fg, cursor = fg, bold = fg',
    scheme: {
      background: '#282828',
      foreground: '#ebdbb2',
      bold: '#ebdbb2',
      cursor: '#ebdbb2',
      cursorAccent: '#282828',
      selectionBackground: '#504945',
      selectionForeground: '#ebdbb2',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2',
    },
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    on: 'dark',
    studied:
      "Atom's One Dark as its terminal ports carry it: #282c34 ground, #abb2bf text, the editor's own #528bff caret and #3e4451 selection; bold = foreground",
    scheme: {
      background: '#282c34',
      foreground: '#abb2bf',
      bold: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#282c34',
      selectionBackground: '#3e4451',
      selectionForeground: '#abb2bf',
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    on: 'dark',
    // Nord's own ports keep the cell's colour on a selection ("CellForeground"
    // in the Alacritty file); `::selection` can name only one ink, so it is
    // nord4, the body text, which is what most selected cells wear anyway.
    studied:
      'Nord (nordtheme): nord0 ground, nord4 text and cursor, nord2 selection, the sixteen from the official terminal ports; bold = foreground',
    scheme: {
      background: '#2e3440',
      foreground: '#d8dee9',
      bold: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: '#434c5e',
      selectionForeground: '#d8dee9',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },
  {
    /**
     * THE LIGHT DEFAULT, and it is orca's "Builtin Tango Light" rather than
     * GNOME's Tango as published, deliberately: it is the Tango Light the
     * operator has been reading agents on, and the difference is not
     * cosmetic. GNOME's ramp was drawn for a dark ground -- its yellow is
     * #c4a000, its bright cyan #34e2e2, its white #d3d7cf -- and an agent
     * that colours a heading yellow on a white page is writing in
     * invisible ink. The four values re-picked deeper (yellow, cyan, white,
     * and the bright half of each) are what makes the ramp legible as TEXT
     * on #ffffff, which is the whole use here.
     */
    id: 'tango-light',
    label: 'Tango Light',
    on: 'light',
    studied:
      "orca's built-in Tango Light: GNOME's Tango ramp on a white ground with yellow, cyan, white and their bright halves re-picked deep enough to read as text; bold = foreground",
    scheme: {
      background: '#ffffff',
      foreground: '#2e3434',
      bold: '#2e3434',
      cursor: '#2e3434',
      cursorAccent: '#ffffff',
      selectionBackground: '#accef7',
      selectionForeground: '#2e3434',
      black: '#2e3436',
      red: '#cc0000',
      green: '#4e9a06',
      yellow: '#8e7700',
      blue: '#3465a4',
      magenta: '#75507b',
      cyan: '#05727e',
      white: '#6a6a6a',
      brightBlack: '#555753',
      brightRed: '#ef2929',
      brightGreen: '#1b7a1b',
      brightYellow: '#6d5a00',
      brightBlue: '#204a87',
      brightMagenta: '#ad7fa8',
      brightCyan: '#034b50',
      brightWhite: '#3d3d3d',
    },
  },
  {
    /** The light half of what the screen wore before; see `vam` above. */
    id: 'vam-light',
    label: 'vam Light',
    on: 'light',
    studied:
      "vam's own styles.css `html.light` block: the remapped ANSI ramp, panel, ink and line-strong; bold = foreground, cursor = ink, cursorAccent = panel",
    scheme: {
      background: '#ffffff',
      foreground: '#18181b',
      bold: '#18181b',
      cursor: '#18181b',
      cursorAccent: '#ffffff',
      selectionBackground: '#d6d6d2',
      selectionForeground: '#18181b',
      black: '#3f3f46',
      red: '#b91c1c',
      green: '#15803d',
      yellow: '#a16207',
      blue: '#1d4ed8',
      magenta: '#a21caf',
      cyan: '#0e7490',
      white: '#52525b',
      brightBlack: '#71717a',
      brightRed: '#dc2626',
      brightGreen: '#16a34a',
      brightYellow: '#ca8a04',
      brightBlue: '#2563eb',
      brightMagenta: '#c026d3',
      brightCyan: '#0891b2',
      brightWhite: '#27272a',
    },
  },
  {
    /** Solarized's light half: the same sixteen, the roles of the base tones
     *  mirrored exactly as Schoonover specifies them. */
    id: 'solarized-light',
    label: 'Solarized Light',
    on: 'light',
    studied:
      'Solarized (Ethan Schoonover): base3 ground, base00 body text, base01 emphasised text as bold and as the selected ink, base2 background highlights as the selection; the sixteen as published',
    scheme: {
      background: '#fdf6e3',
      foreground: '#657b83',
      bold: '#586e75',
      cursor: '#657b83',
      cursorAccent: '#fdf6e3',
      selectionBackground: '#eee8d5',
      selectionForeground: '#586e75',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    on: 'light',
    studied:
      "GitHub's light terminal palette as its ports carry it: #24292e text on white, the Primer blues for the caret (#044289) and selection (#c8c8fa); bold = foreground",
    scheme: {
      background: '#ffffff',
      foreground: '#24292e',
      bold: '#24292e',
      cursor: '#044289',
      cursorAccent: '#ffffff',
      selectionBackground: '#c8c8fa',
      selectionForeground: '#24292e',
      black: '#24292e',
      red: '#d73a49',
      green: '#28a745',
      yellow: '#dbab09',
      blue: '#0366d6',
      magenta: '#5a32a3',
      cyan: '#0598bc',
      white: '#6a737d',
      brightBlack: '#959da5',
      brightRed: '#cb2431',
      brightGreen: '#22863a',
      brightYellow: '#b08800',
      brightBlue: '#005cc5',
      brightMagenta: '#5a32a3',
      brightCyan: '#3192aa',
      brightWhite: '#d1d5da',
    },
  },
];

/** The theme each bucket starts on: the operator's own in dark, and the
 *  Tango Light they read on in light. */
export const DEFAULT_TERMINAL_THEME: Readonly<Record<EffectiveTheme, TerminalThemeId>> = {
  dark: 'hans',
  light: 'tango-light',
};

const BY_ID = new Map(TERMINAL_THEMES.map((theme) => [theme.id, theme]));

/** The themes offered for one app theme, in the picker's order. */
export function terminalThemesFor(on: EffectiveTheme): readonly TerminalTheme[] {
  return TERMINAL_THEMES.filter((theme) => theme.on === on);
}

/**
 * A stored id, reduced to one offered for that bucket -- or that bucket's
 * default. EXACT OR DEFAULT, the rule `readTerminalFontSize` gives: an id
 * vam does not ship, or one shipped for the other app theme, is a value no
 * dialog for this bucket could show as chosen.
 */
export function readTerminalThemeId(raw: unknown, on: EffectiveTheme): TerminalThemeId {
  const theme = typeof raw === 'string' ? BY_ID.get(raw as TerminalThemeId) : undefined;
  return theme !== undefined && theme.on === on ? theme.id : DEFAULT_TERMINAL_THEME[on];
}

/** Only a plain six-digit colour, the shape a colour input can hold and the
 *  one `prefs.ts` accepts for the app palette. Case is kept as written: the
 *  browser reads both and a picker writes lower case anyway. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export type TerminalSchemeOverrides = Readonly<Partial<TerminalScheme>>;

/** One bucket: a named theme and the colours moved off it. */
export type TerminalSchemeChoice = {
  readonly theme: TerminalThemeId;
  readonly overrides: TerminalSchemeOverrides;
};

export type TerminalSchemePref = {
  readonly dark: TerminalSchemeChoice;
  readonly light: TerminalSchemeChoice;
  /** How much of the scheme's ground is painted over the pane, 0.3..1. */
  readonly backgroundOpacity: number;
};

/**
 * The floor is where the screen stops being readable rather than where it
 * stops being pretty: under 0.3 the pane's own grey shows through more than
 * the scheme's ground does, and every ANSI colour was chosen against the
 * ground, not against the pane.
 */
export const TERMINAL_BACKGROUND_OPACITY_MIN = 0.3;
export const TERMINAL_BACKGROUND_OPACITY_MAX = 1;
/** The slider's step: fourteen stops between the floor and opaque, which is
 *  a difference an eye can see at each one and not a number worth typing. */
export const TERMINAL_BACKGROUND_OPACITY_STEP = 0.05;
/** Opaque, which is what every scheme was designed at. */
export const DEFAULT_TERMINAL_BACKGROUND_OPACITY = 1;

/** Total, like `clampOutFontSize`: a string, a `NaN`, an infinity -- none of
 *  them is "very transparent", none may reach the screen, and a number is
 *  clamped rather than defaulted because a slider produced it. */
export function clampTerminalBackgroundOpacity(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_TERMINAL_BACKGROUND_OPACITY;
  }
  return Math.min(TERMINAL_BACKGROUND_OPACITY_MAX, Math.max(TERMINAL_BACKGROUND_OPACITY_MIN, raw));
}

export const DEFAULT_TERMINAL_SCHEME_PREF: TerminalSchemePref = {
  dark: { theme: DEFAULT_TERMINAL_THEME.dark, overrides: {} },
  light: { theme: DEFAULT_TERMINAL_THEME.light, overrides: {} },
  backgroundOpacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
};

const KEY_SET = new Set<string>(TERMINAL_SCHEME_KEYS);

/**
 * Whatever is under `overrides`, reduced to colours vam can draw -- PER ENTRY,
 * so one hand-edited value cannot drag the others back to the theme with it.
 * A key that is not one of the twenty-three is dropped: it is either a typo
 * or a key a later vam knows and this one does not, and neither may reach
 * the screen as a property.
 */
export function readTerminalSchemeOverrides(raw: unknown): TerminalSchemeOverrides {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Partial<Record<TerminalSchemeKey, string>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (KEY_SET.has(key) && typeof value === 'string' && HEX_COLOUR.test(value)) {
      out[key as TerminalSchemeKey] = value;
    }
  }
  return out;
}

function readChoice(raw: unknown, on: EffectiveTheme): TerminalSchemeChoice {
  const shaped =
    typeof raw === 'object' && raw !== null
      ? (raw as { theme?: unknown; overrides?: unknown })
      : {};
  return {
    theme: readTerminalThemeId(shaped.theme, on),
    overrides: readTerminalSchemeOverrides(shaped.overrides),
  };
}

/**
 * The stored preference, reduced to one this vam can draw. Never throws, and
 * every field falls back ALONE: an unknown theme costs the theme, a bad
 * override costs that override, a string where the opacity should be costs
 * the opacity -- and none of them costs a neighbour, because a payload an
 * older or a hand-editing vam wrote is still mostly the operator's choices.
 */
export function readTerminalSchemePref(raw: unknown): TerminalSchemePref {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DEFAULT_TERMINAL_SCHEME_PREF;
  }
  const shaped = raw as { dark?: unknown; light?: unknown; backgroundOpacity?: unknown };
  return {
    dark: readChoice(shaped.dark, 'dark'),
    light: readChoice(shaped.light, 'light'),
    backgroundOpacity: clampTerminalBackgroundOpacity(shaped.backgroundOpacity),
  };
}

/** A scheme with the opacity it is to be painted at: everything the screen
 *  needs, in one value the store can hand to React. */
export type ResolvedTerminalScheme = TerminalScheme & { readonly backgroundOpacity: number };

/**
 * The theme merged with its overrides, for the app theme ON SCREEN. `on` is
 * the EFFECTIVE theme: resolve `system` through `effectiveTheme` before you
 * get here, or you are asking for the colours of a screen nobody is looking
 * at -- the same rule `paletteFor` states.
 */
export function resolveTerminalScheme(
  pref: TerminalSchemePref,
  on: EffectiveTheme,
): ResolvedTerminalScheme {
  const choice = pref[on];
  const theme = BY_ID.get(choice.theme) ?? (BY_ID.get(DEFAULT_TERMINAL_THEME[on]) as TerminalTheme);
  return { ...theme.scheme, ...choice.overrides, backgroundOpacity: pref.backgroundOpacity };
}

/* ---------------------------------------------------------------------------
 * The setters. `Prefs` in, `Prefs` out, like every setter in `prefs.ts`, and
 * normalised on the way in as well as on the way out for the reason each of
 * those gives: the dialog can only offer what is on the list, but a future
 * caller could store anything.
 * ------------------------------------------------------------------------ */

function withChoice(prefs: Prefs, on: EffectiveTheme, choice: TerminalSchemeChoice): Prefs {
  return { ...prefs, terminalScheme: { ...prefs.terminalScheme, [on]: choice } };
}

/** Choose a theme for one app theme. The overrides stay: they are the
 *  operator's colours, and a new theme underneath them is what they asked
 *  for, not a reason to throw them away. */
export function setTerminalTheme(prefs: Prefs, on: EffectiveTheme, id: unknown): Prefs {
  return withChoice(prefs, on, {
    ...prefs.terminalScheme[on],
    theme: readTerminalThemeId(id, on),
  });
}

/** One colour moved off the theme, in one app theme. A key vam does not
 *  offer, or a value that is not a colour, changes nothing and returns the
 *  same object -- a caller that sends either has a bug, not a preference. */
export function setTerminalSchemeColor(
  prefs: Prefs,
  on: EffectiveTheme,
  key: string,
  value: string,
): Prefs {
  if (!KEY_SET.has(key) || !HEX_COLOUR.test(value)) {
    return prefs;
  }
  const choice = prefs.terminalScheme[on];
  return withChoice(prefs, on, {
    ...choice,
    overrides: { ...choice.overrides, [key]: value },
  });
}

/** Back to the theme for one colour -- by DELETING the override, for the
 *  reason `clearPaletteColor` gives: writing the theme's value back would
 *  look identical and would survive a change of theme. */
export function clearTerminalSchemeColor(prefs: Prefs, on: EffectiveTheme, key: string): Prefs {
  const choice = prefs.terminalScheme[on];
  const { [key as TerminalSchemeKey]: _dropped, ...rest } = choice.overrides;
  return withChoice(prefs, on, { ...choice, overrides: rest });
}

/** Back to the theme for every colour, in ONE app theme. */
export function clearTerminalSchemeOverrides(prefs: Prefs, on: EffectiveTheme): Prefs {
  return withChoice(prefs, on, { ...prefs.terminalScheme[on], overrides: {} });
}

/** Clamped on the way in as well, like `setOutFontSize`. */
export function setTerminalBackgroundOpacity(prefs: Prefs, value: unknown): Prefs {
  return {
    ...prefs,
    terminalScheme: {
      ...prefs.terminalScheme,
      backgroundOpacity: clampTerminalBackgroundOpacity(value),
    },
  };
}

/* ---------------------------------------------------------------------------
 * The store: the resolved scheme in force, for `useSyncExternalStore`.
 * ------------------------------------------------------------------------ */

let active: ResolvedTerminalScheme = resolveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
const listeners = new Set<() => void>();

/** The snapshot React compares by identity. It is replaced only when a value
 *  in it moves, so it is stable by construction (see `setActiveTerminalScheme`). */
export function activeTerminalScheme(): ResolvedTerminalScheme {
  return active;
}

function sameScheme(a: ResolvedTerminalScheme, b: ResolvedTerminalScheme): boolean {
  return (
    a.backgroundOpacity === b.backgroundOpacity &&
    TERMINAL_SCHEME_KEYS.every((key) => a[key] === b[key])
  );
}

/**
 * Put a scheme in force: the preference, resolved for the app theme on
 * screen. Called by `activatePrefs` on every read and write, and by
 * `Canvas.tsx`'s theme effect, which is the one place that hears the OS flip
 * under `system` (the same two callers `applyPalette` has).
 *
 * A CHANGE, NOT EVERY WRITE, compared by VALUE rather than by identity: a
 * reload builds a fresh preference object holding the same colours, and a
 * font-size write rebuilds `prefs` around an unchanged one. Either would
 * otherwise wake every open terminal to repaint a screen that has not moved.
 */
export function setActiveTerminalScheme(pref: TerminalSchemePref, on: EffectiveTheme): void {
  const next = resolveTerminalScheme(pref, on);
  if (sameScheme(next, active)) return;
  active = next;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  contract, and the shape `subscribeTerminalFontSize` already has. */
export function subscribeTerminalScheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ---------------------------------------------------------------------------
 * What the screen paints.
 * ------------------------------------------------------------------------ */

/**
 * The inline style for the screen's root: every colour as its custom
 * property, and the ground already composited with the opacity.
 *
 * THE GROUND IS COMPOSITED HERE, AS A PLAIN `rgba()`, rather than left to a
 * `color-mix()` in the stylesheet, and the reason is what the browser reads
 * back. Measured in the guards' Chromium (153.0.8010.12): a `color-mix(in
 * srgb, #1e1f29 85%, transparent)` background computes to `color(srgb
 * 0.117647 0.121569 0.160784 / 0.85)`, where an `rgba(30, 31, 41, 0.85)`
 * computes to itself. Every guard in this repo parses the second form with
 * one regex; the first would need a parser of its own for a result that is
 * the same pixels. The mix is four lines of arithmetic, so it lives here.
 *
 * `--vam-term-bg` is still set, unmixed, beside it: it is the scheme's own
 * ground for anything that needs the colour rather than the paint.
 */
export function terminalSchemeStyle(
  scheme: ResolvedTerminalScheme,
): Readonly<Record<string, string>> {
  const style: Record<string, string> = {};
  for (const key of TERMINAL_SCHEME_KEYS) {
    style[TERMINAL_SCHEME_VARS[key]] = scheme[key];
  }
  style.backgroundColor = withAlpha(scheme.background, scheme.backgroundOpacity);
  return style;
}

/** `#rrggbb` at an alpha, spelled the way `getComputedStyle` spells it. */
function withAlpha(hex: string, alpha: number): string {
  const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
  return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, ${alpha})`;
}
