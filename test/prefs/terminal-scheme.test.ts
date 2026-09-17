/**
 * THE TERMINAL'S OWN COLOUR SCHEME: twelve named themes, one stored choice per
 * app theme with an override layer on top, an opacity, and the store that puts
 * the resolved scheme in force.
 *
 * Operator, translated: "make the terminal colour setup deeper and richer,
 * like orca, then make the colour scheme I have set up for orca's terminal the
 * default on vam's terminal." That scheme is `hans`, and its twenty-three
 * values are pinned here digit for digit, because a default that moves for
 * everyone who never opened a dialog is exactly the change that should cost an
 * edit in a test.
 *
 * WHAT IS HELD. The table's integrity (every theme has all twenty-three keys,
 * every value is a six-digit hex, no id is spelled twice), that the two `vam`
 * themes really are the stylesheet's own ramp rather than a remembered copy of
 * it, every per-field fallback of the reader -- a bad shape, an unknown id, a
 * non-hex override, an opacity out of range -- each falling to ITS OWN default
 * and disturbing no neighbour, the setters, the merge, and the store's
 * "a change, not every write" rule that `terminal-font.ts` argues.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  activeTerminalScheme,
  clampTerminalBackgroundOpacity,
  clearTerminalSchemeColor,
  clearTerminalSchemeOverrides,
  DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  DEFAULT_TERMINAL_SCHEME_PREF,
  DEFAULT_TERMINAL_THEME,
  readTerminalSchemePref,
  readTerminalThemeId,
  resolveTerminalScheme,
  setActiveTerminalScheme,
  setTerminalBackgroundOpacity,
  setTerminalSchemeColor,
  setTerminalTheme,
  subscribeTerminalScheme,
  TERMINAL_BACKGROUND_OPACITY_MAX,
  TERMINAL_BACKGROUND_OPACITY_MIN,
  TERMINAL_SCHEME_KEYS,
  TERMINAL_SCHEME_LABELS,
  TERMINAL_SCHEME_VARS,
  TERMINAL_THEMES,
  type TerminalScheme,
  terminalSchemeStyle,
  terminalThemesFor,
} from '../../src/renderer/prefs/terminal-scheme.js';
import { ruleBody, THEMES, tokens } from '../support/css-tokens.js';

const KEY = 'vam.prefs.v1';
const HEX = /^#[0-9a-f]{6}$/;

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) this.value = value;
    },
  };
}

const stored = (payload: object) => readPrefs(fake(JSON.stringify(payload)));
const byId = (id: string) => TERMINAL_THEMES.find((t) => t.id === id);

/** The operator's scheme, exactly as it was handed over. */
const HANS: TerminalScheme = {
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
};

/** The light default: orca's Tango Light, four values re-picked for a white
 *  ground (the source says which and why). */
const TANGO_LIGHT: TerminalScheme = {
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
};

describe('the table of built-in terminal themes', () => {
  it('names twenty-three colours, and every theme spells all of them as six-digit hex', () => {
    expect(TERMINAL_SCHEME_KEYS).toHaveLength(23);
    expect(TERMINAL_THEMES.length).toBeGreaterThanOrEqual(12);
    for (const theme of TERMINAL_THEMES) {
      expect(Object.keys(theme.scheme).sort(), theme.id).toEqual([...TERMINAL_SCHEME_KEYS].sort());
      for (const key of TERMINAL_SCHEME_KEYS) {
        expect(theme.scheme[key], `${theme.id}.${key}`).toMatch(HEX);
      }
      expect(theme.label, theme.id).not.toBe('');
      expect(theme.studied, theme.id).not.toBe('');
    }
  });

  it('names every colour for a person, once, in the case the settings surface capitalises', () => {
    // The label table is what the settings grid reads; a key without one
    // would be a swatch with no name, and a label with a capital would be
    // capitalised twice. Lower, like `PALETTE_TOKENS`, and one per key.
    expect(Object.keys(TERMINAL_SCHEME_LABELS).sort()).toEqual([...TERMINAL_SCHEME_KEYS].sort());
    const labels = TERMINAL_SCHEME_KEYS.map((key) => TERMINAL_SCHEME_LABELS[key]);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toMatch(/^[a-z][a-z ]*$/);
    }
  });

  it('spells no id twice, and every id is a slug a URL or a stored payload can carry', () => {
    const ids = TERMINAL_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('offers eight for dark and four for light, in the order the brief named them', () => {
    expect(terminalThemesFor('dark').map((t) => t.id)).toEqual([
      'hans',
      'vam',
      'catppuccin-mocha',
      'dracula',
      'solarized-dark',
      'gruvbox-dark',
      'one-dark',
      'nord',
    ]);
    expect(terminalThemesFor('light').map((t) => t.id)).toEqual([
      'tango-light',
      'vam-light',
      'solarized-light',
      'github-light',
    ]);
  });

  it("defaults to the operator's own scheme in dark and Tango Light in light", () => {
    expect(DEFAULT_TERMINAL_THEME).toEqual({ dark: 'hans', light: 'tango-light' });
    expect(byId('hans')?.on).toBe('dark');
    expect(byId('tango-light')?.on).toBe('light');
  });

  it('carries the Hans scheme digit for digit', () => {
    expect(byId('hans')?.scheme).toEqual(HANS);
    expect(byId('hans')?.label).toBe('Hans');
  });

  it('carries Tango Light digit for digit -- the light default, and the guard’s own copy', () => {
    // `e2e/terminal-scheme-shots.mjs` spells this table too, because a
    // browser script cannot import from `src/`; this pin is what holds the
    // two copies to each other.
    expect(byId('tango-light')?.scheme).toEqual(TANGO_LIGHT);
    expect(byId('tango-light')?.label).toBe('Tango Light');
  });

  it('keeps the two vam themes on the stylesheet’s own ramp rather than a remembered copy of it', () => {
    // A hex table cannot follow `styles.css` the way a `var()` would, so the
    // day the stylesheet's ramp moves this is the test that says so -- the
    // exact drift `palette-templates.ts` records having shipped once.
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const ANSI: readonly (readonly [keyof TerminalScheme, string])[] = [
      ['black', '--vam-ansi-black'],
      ['red', '--vam-ansi-red'],
      ['green', '--vam-ansi-green'],
      ['yellow', '--vam-ansi-yellow'],
      ['blue', '--vam-ansi-blue'],
      ['magenta', '--vam-ansi-magenta'],
      ['cyan', '--vam-ansi-cyan'],
      ['white', '--vam-ansi-white'],
      ['brightBlack', '--vam-ansi-bright-black'],
      ['brightRed', '--vam-ansi-bright-red'],
      ['brightGreen', '--vam-ansi-bright-green'],
      ['brightYellow', '--vam-ansi-bright-yellow'],
      ['brightBlue', '--vam-ansi-bright-blue'],
      ['brightMagenta', '--vam-ansi-bright-magenta'],
      ['brightCyan', '--vam-ansi-bright-cyan'],
      ['brightWhite', '--vam-ansi-bright-white'],
    ];
    for (const [id, { selector }] of [
      ['vam', THEMES[0]],
      ['vam-light', THEMES[1]],
    ] as const) {
      const block = tokens(ruleBody(css, selector));
      const scheme = byId(id)?.scheme as TerminalScheme;
      for (const [key, token] of ANSI) {
        expect(scheme[key], `${id}.${key}`).toBe(block.get(token));
      }
      // The surface and the ink the screen wore before it had a scheme.
      expect(scheme.background).toBe(block.get('--vam-panel'));
      expect(scheme.foreground).toBe(block.get('--vam-ink'));
      expect(scheme.cursor).toBe(block.get('--vam-ink'));
      expect(scheme.cursorAccent).toBe(block.get('--vam-panel'));
      expect(scheme.selectionBackground).toBe(block.get('--vam-line-strong'));
    }
  });
});

describe('reading a theme id', () => {
  it('answers a known id offered for that app theme, and the default for anything else', () => {
    expect(readTerminalThemeId('nord', 'dark')).toBe('nord');
    expect(readTerminalThemeId('github-light', 'light')).toBe('github-light');
    // A light theme under the dark bucket is a value no dialog for that
    // bucket could show as chosen -- EXACT OR DEFAULT, as the font size is.
    expect(readTerminalThemeId('github-light', 'dark')).toBe('hans');
    expect(readTerminalThemeId('nord', 'light')).toBe('tango-light');
    for (const raw of ['', 'Hans', 'HANS', 'monokai', 0, null, undefined, {}, []]) {
      expect(readTerminalThemeId(raw, 'dark'), JSON.stringify(raw)).toBe('hans');
      expect(readTerminalThemeId(raw, 'light'), JSON.stringify(raw)).toBe('tango-light');
    }
  });
});

describe('the background opacity', () => {
  it('is bounded at [0.3, 1] and ships fully opaque', () => {
    expect(TERMINAL_BACKGROUND_OPACITY_MIN).toBe(0.3);
    expect(TERMINAL_BACKGROUND_OPACITY_MAX).toBe(1);
    expect(DEFAULT_TERMINAL_BACKGROUND_OPACITY).toBe(1);
  });

  it('clamps a number into the range and defaults anything that is not one', () => {
    expect(clampTerminalBackgroundOpacity(0.5)).toBe(0.5);
    expect(clampTerminalBackgroundOpacity(0)).toBe(0.3);
    expect(clampTerminalBackgroundOpacity(-4)).toBe(0.3);
    expect(clampTerminalBackgroundOpacity(7)).toBe(1);
    for (const raw of ['0.5', Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}]) {
      expect(clampTerminalBackgroundOpacity(raw), JSON.stringify(raw)).toBe(1);
    }
    // An infinity is not "very opaque", it is not a number a slider produced.
    expect(clampTerminalBackgroundOpacity(Number.NEGATIVE_INFINITY)).toBe(1);
  });
});

describe('reading the stored preference', () => {
  it('answers the default for no payload, a wrong shape, or garbage', () => {
    for (const raw of [undefined, null, 4, 'hans', [], {}, { dark: 'hans' }]) {
      expect(readTerminalSchemePref(raw), JSON.stringify(raw)).toEqual(
        DEFAULT_TERMINAL_SCHEME_PREF,
      );
    }
    expect(DEFAULT_TERMINAL_SCHEME_PREF).toEqual({
      dark: { theme: 'hans', overrides: {} },
      light: { theme: 'tango-light', overrides: {} },
      backgroundOpacity: 1,
    });
  });

  it('reads a whole payload back', () => {
    const pref = readTerminalSchemePref({
      dark: { theme: 'dracula', overrides: { cursor: '#ff0000' } },
      light: { theme: 'solarized-light', overrides: { background: '#FFFFFF' } },
      backgroundOpacity: 0.8,
    });
    expect(pref).toEqual({
      dark: { theme: 'dracula', overrides: { cursor: '#ff0000' } },
      light: { theme: 'solarized-light', overrides: { background: '#FFFFFF' } },
      backgroundOpacity: 0.8,
    });
  });

  it('falls back PER FIELD, so one bad value cannot drag its neighbours to the default', () => {
    const pref = readTerminalSchemePref({
      dark: {
        theme: 'no-such-theme',
        overrides: { cursor: '#ff0000', red: 'red', bogus: '#000000' },
      },
      light: 'tango-light',
      backgroundOpacity: 'opaque',
    });
    // The unknown id costs the id and nothing else: the overrides beside it
    // survive, minus the two that are not a colour vam can draw.
    expect(pref.dark).toEqual({ theme: 'hans', overrides: { cursor: '#ff0000' } });
    // A bucket that is not an object costs that bucket alone.
    expect(pref.light).toEqual({ theme: 'tango-light', overrides: {} });
    expect(pref.backgroundOpacity).toBe(1);
  });

  it('drops an override that is not a six-digit hex, one at a time', () => {
    const pref = readTerminalSchemePref({
      dark: {
        theme: 'hans',
        overrides: {
          red: '#abc',
          green: 'rgb(0, 255, 0)',
          blue: '#0000ff',
          yellow: 12,
          cyan: null,
          __proto__: { magenta: '#ff00ff' },
        },
      },
    });
    expect(pref.dark.overrides).toEqual({ blue: '#0000ff' });
  });

  it('never throws, whatever is under the key', () => {
    for (const raw of [
      { dark: null, light: null, backgroundOpacity: null },
      { dark: { theme: null, overrides: null } },
      { dark: { overrides: [] } },
      { dark: { overrides: 'red' } },
      Object.create(null),
    ]) {
      expect(() => readTerminalSchemePref(raw)).not.toThrow();
    }
  });
});

describe('resolving the scheme in force', () => {
  it('is the chosen theme with its overrides laid over it, for the app theme on screen', () => {
    const pref = readTerminalSchemePref({
      dark: { theme: 'hans', overrides: { cursor: '#ff0000' } },
      light: { theme: 'github-light', overrides: {} },
      backgroundOpacity: 0.6,
    });
    const dark = resolveTerminalScheme(pref, 'dark');
    expect(dark).toEqual({ ...HANS, cursor: '#ff0000', backgroundOpacity: 0.6 });
    const light = resolveTerminalScheme(pref, 'light');
    expect(light.background).toBe('#ffffff');
    expect(light.foreground).toBe('#24292e');
    expect(light.backgroundOpacity).toBe(0.6);
  });

  it('resolves the shipped default to Hans in dark and Tango Light in light', () => {
    expect(resolveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark')).toEqual({
      ...HANS,
      backgroundOpacity: 1,
    });
    const light = resolveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'light');
    expect(light).toEqual({ ...byId('tango-light')?.scheme, backgroundOpacity: 1 });
  });
});

describe('the setters', () => {
  it('choose a theme for one app theme and leave the other, and the overrides, alone', () => {
    const base = setTerminalSchemeColor(EMPTY_PREFS, 'dark', 'red', '#ff0000');
    const next = setTerminalTheme(base, 'dark', 'nord');
    expect(next.terminalScheme.dark).toEqual({ theme: 'nord', overrides: { red: '#ff0000' } });
    expect(next.terminalScheme.light).toBe(base.terminalScheme.light);
    // Normalised on the way in as well as on the way out.
    expect(setTerminalTheme(base, 'dark', 'github-light').terminalScheme.dark.theme).toBe('hans');
    expect(setTerminalTheme(base, 'light', 'nord').terminalScheme.light.theme).toBe('tango-light');
  });

  it('set one override, refuse a key or a value vam cannot draw, and clear one or all', () => {
    let prefs = setTerminalSchemeColor(EMPTY_PREFS, 'dark', 'cursor', '#123456');
    prefs = setTerminalSchemeColor(prefs, 'dark', 'red', '#ff0000');
    expect(prefs.terminalScheme.dark.overrides).toEqual({ cursor: '#123456', red: '#ff0000' });
    // A key that is not one of the twenty-three, or a value that is not a
    // colour, changes nothing -- and returns the same object, so a caller
    // with a bug cannot write a payload the reader would then have to drop.
    expect(setTerminalSchemeColor(prefs, 'dark', 'bogus', '#000000')).toBe(prefs);
    expect(setTerminalSchemeColor(prefs, 'dark', 'red', 'red')).toBe(prefs);
    expect(setTerminalSchemeColor(prefs, 'dark', 'red', '#abc')).toBe(prefs);
    // Light was never touched.
    expect(prefs.terminalScheme.light.overrides).toEqual({});

    const one = clearTerminalSchemeColor(prefs, 'dark', 'cursor');
    expect(one.terminalScheme.dark.overrides).toEqual({ red: '#ff0000' });
    const none = clearTerminalSchemeOverrides(prefs, 'dark');
    expect(none.terminalScheme.dark).toEqual({ theme: 'hans', overrides: {} });
    expect(none.terminalScheme.light).toBe(prefs.terminalScheme.light);
  });

  it('clamp the opacity on the way in', () => {
    expect(setTerminalBackgroundOpacity(EMPTY_PREFS, 0.5).terminalScheme.backgroundOpacity).toBe(
      0.5,
    );
    expect(setTerminalBackgroundOpacity(EMPTY_PREFS, 0).terminalScheme.backgroundOpacity).toBe(0.3);
    expect(setTerminalBackgroundOpacity(EMPTY_PREFS, 'x').terminalScheme.backgroundOpacity).toBe(1);
  });
});

describe('the preference round-trips through the store', () => {
  it('writes and reads back a whole choice, disturbing no neighbour', () => {
    const storage = fake();
    let prefs = setTheme(EMPTY_PREFS, 'system');
    prefs = setTerminalTheme(prefs, 'dark', 'gruvbox-dark');
    prefs = setTerminalSchemeColor(prefs, 'light', 'cursor', '#00ff00');
    prefs = setTerminalBackgroundOpacity(prefs, 0.75);
    writePrefs(storage, prefs);
    const back = readPrefs(storage);
    expect(back.terminalScheme).toEqual({
      dark: { theme: 'gruvbox-dark', overrides: {} },
      light: { theme: 'tango-light', overrides: { cursor: '#00ff00' } },
      backgroundOpacity: 0.75,
    });
    expect(back.theme).toBe('system');
  });

  it('defaults when the payload predates the field -- which every payload does', () => {
    const back = stored({ theme: 'light', terminalFontSize: 14 });
    expect(back.terminalScheme).toEqual(DEFAULT_TERMINAL_SCHEME_PREF);
    expect(back.terminalFontSize).toBe(14);
  });

  it('keeps the rest of a payload whose scheme is garbage', () => {
    const back = stored({ theme: 'light', terminalScheme: 'dracula' });
    expect(back.terminalScheme).toEqual(DEFAULT_TERMINAL_SCHEME_PREF);
    expect(back.theme).toBe('light');
  });
});

describe('the scheme in force reaches React', () => {
  it('is what the last read put there, resolved for the app theme the read found', () => {
    setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
    const heard = vi.fn();
    const stop = subscribeTerminalScheme(heard);

    readPrefs(
      fake(
        JSON.stringify({ theme: 'light', terminalScheme: { light: { theme: 'github-light' } } }),
      ),
    );
    expect(activeTerminalScheme().background).toBe('#ffffff');
    expect(activeTerminalScheme().foreground).toBe('#24292e');
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
    expect(activeTerminalScheme()).toEqual({ ...HANS, backgroundOpacity: 1 });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('says nothing when a write moves some other preference, or re-states the same scheme', () => {
    // `activatePrefs` runs on every write. Waking every open terminal for a
    // font-size change would repaint screens for a setting nobody touched.
    setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
    const heard = vi.fn();
    const stop = subscribeTerminalScheme(heard);
    readPrefs(fake(JSON.stringify({ terminalFontSize: 14 })));
    // A fresh object with the same twenty-four values is the same scheme.
    setActiveTerminalScheme(readTerminalSchemePref({ dark: { theme: 'hans' } }), 'dark');
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it('hands React a snapshot that is stable by identity until the scheme moves', () => {
    setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
    const first = activeTerminalScheme();
    setActiveTerminalScheme(readTerminalSchemePref({}), 'dark');
    expect(activeTerminalScheme()).toBe(first);
    setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'light');
    expect(activeTerminalScheme()).not.toBe(first);
    setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
  });
});

describe('what the screen is handed to paint', () => {
  it('names one custom property per colour, the sixteen ANSI ones under the names the utilities already read', () => {
    expect(Object.keys(TERMINAL_SCHEME_VARS).sort()).toEqual([...TERMINAL_SCHEME_KEYS].sort());
    expect(TERMINAL_SCHEME_VARS.red).toBe('--vam-ansi-red');
    expect(TERMINAL_SCHEME_VARS.brightBlack).toBe('--vam-ansi-bright-black');
    expect(TERMINAL_SCHEME_VARS.background).toBe('--vam-term-bg');
    expect(TERMINAL_SCHEME_VARS.foreground).toBe('--vam-term-fg');
    expect(TERMINAL_SCHEME_VARS.bold).toBe('--vam-term-bold');
    expect(TERMINAL_SCHEME_VARS.cursor).toBe('--vam-term-cursor');
    expect(TERMINAL_SCHEME_VARS.cursorAccent).toBe('--vam-term-cursor-accent');
    expect(TERMINAL_SCHEME_VARS.selectionBackground).toBe('--vam-term-selection-bg');
    expect(TERMINAL_SCHEME_VARS.selectionForeground).toBe('--vam-term-selection-fg');
    expect(new Set(Object.values(TERMINAL_SCHEME_VARS)).size).toBe(23);
  });

  it('sets every property, and composes the background with the opacity as a plain rgba', () => {
    const style = terminalSchemeStyle({ ...HANS, backgroundOpacity: 1 }) as Record<string, string>;
    for (const key of TERMINAL_SCHEME_KEYS) {
      expect(style[TERMINAL_SCHEME_VARS[key]], key).toBe(HANS[key]);
    }
    expect(style.backgroundColor).toBe('rgba(30, 31, 41, 1)');
    const glassy = terminalSchemeStyle({ ...HANS, backgroundOpacity: 0.85 }) as Record<
      string,
      string
    >;
    expect(glassy.backgroundColor).toBe('rgba(30, 31, 41, 0.85)');
    expect(glassy['--vam-term-bg']).toBe('#1e1f29');
  });
});
