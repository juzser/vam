// @vitest-environment happy-dom

/**
 * THE TERMINAL'S COLOUR SETTINGS, at the surface the operator touches.
 *
 * `test/prefs/terminal-scheme.test.ts` measures the MODEL -- twelve tables,
 * the per-field fallbacks, the setters. This measures that the operator can
 * reach it: a scheme that resolves perfectly and is wired to nothing changes
 * no screen. Every write is asserted THROUGH THE SETTER'S OWN SHAPE (which
 * bucket moved, which stayed) rather than through a mocked setter, because
 * the bug this surface can have is calling the right setter with the wrong
 * mode.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE: what a swatch PAINTS. happy-dom
 * lays nothing out, so a colour read back off a rendered disc is the inline
 * string this file put there. The painted answer -- the swatch's own pixel,
 * the Terminal tab's ground after a chip is pressed, the contrast of a hex
 * field on its fill -- is `e2e/terminal-settings-shots.mjs`, in Chromium.
 *
 * The last block goes through the whole seam an operator's click really
 * travels: overlay -> `onChange` -> `writePrefs` -> `activatePrefs` -> the
 * scheme store -> a Terminal tab that was mounted before the click and was
 * handed no prop. That is the shape `view-width.test.tsx` established, and it
 * is the one assertion here that a break anywhere on the path reddens.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import {
  browserStorage,
  type EffectiveTheme,
  EMPTY_PREFS,
  type Prefs,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  DEFAULT_TERMINAL_SCHEME_PREF,
  DEFAULT_TERMINAL_THEME,
  resolveTerminalScheme,
  setActiveTerminalScheme,
  TERMINAL_BACKGROUND_OPACITY_MAX,
  TERMINAL_BACKGROUND_OPACITY_MIN,
  TERMINAL_SCHEME_KEYS,
  TERMINAL_SCHEME_LABELS,
  TERMINAL_THEMES,
  type TerminalScheme,
  type TerminalSchemeKey,
  terminalThemesFor,
} from '../../src/renderer/prefs/terminal-scheme.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import type { PaneView } from '../../src/shared/terminal.js';

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
});

const HANS = TERMINAL_THEMES.find((t) => t.id === 'hans')?.scheme as TerminalScheme;
const TANGO = TERMINAL_THEMES.find((t) => t.id === 'tango-light')?.scheme as TerminalScheme;
const DRACULA = TERMINAL_THEMES.find((t) => t.id === 'dracula')?.scheme as TerminalScheme;

/** A colour no shipped theme uses for anything, so a read-back that finds it
 *  found the override and not a coincidence. */
const PICK = `#${'3a2f5f'}`;

function open(prefs: Prefs = EMPTY_PREFS, theme: EffectiveTheme = 'dark') {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme={theme} onChange={onChange} onClose={() => {}} />);
  return { onChange };
}

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

/** Prefs with one colour moved off the theme in one bucket. */
function withOverride(on: EffectiveTheme, key: TerminalSchemeKey, hex: string): Prefs {
  return {
    ...EMPTY_PREFS,
    terminalScheme: {
      ...EMPTY_PREFS.terminalScheme,
      [on]: { ...EMPTY_PREFS.terminalScheme[on], overrides: { [key]: hex } },
    },
  };
}

const chip = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-terminal-theme="${id}"]`);
const swatch = (key: TerminalSchemeKey) =>
  document.querySelector<HTMLInputElement>(`[data-terminal-swatch="${key}"]`);
const hexField = (key: TerminalSchemeKey) =>
  document.querySelector<HTMLInputElement>(`[data-terminal-hex="${key}"]`);
const row = (key: TerminalSchemeKey) =>
  document.querySelector<HTMLElement>(`[data-terminal-colour="${key}"]`);
const resetOne = (key: TerminalSchemeKey) =>
  document.querySelector<HTMLButtonElement>(`[data-terminal-reset="${key}"]`);
const resetAll = (theme: EffectiveTheme) =>
  screen.queryByRole('button', { name: `reset ${theme} terminal colours` });
const slider = () => document.querySelector<HTMLInputElement>('[data-terminal-opacity]');
const printed = () => document.querySelector<HTMLElement>('[data-terminal-opacity-value]');

describe('the terminal theme rows', () => {
  it('live in Appearance, beside the terminal text size', () => {
    open();
    expect(chip('hans')?.closest('section')?.querySelector('h2, h3')?.textContent).toBe(
      'Appearance',
    );
  });

  it('offer every dark theme in the dark row and every light theme in the light row, by name', () => {
    open();
    // The corpus first: twelve shipped, eight and four.
    expect(terminalThemesFor('dark').length).toBe(8);
    expect(terminalThemesFor('light').length).toBe(4);
    for (const theme of TERMINAL_THEMES) {
      const button = screen.getByRole('button', {
        name: `${theme.label} terminal theme, ${theme.on}`,
      });
      expect(button.getAttribute('data-terminal-theme')).toBe(theme.id);
      // In the row for its own app theme and no other: a dark scheme offered
      // under light is the black-rectangle-in-a-white-page the model refuses.
      expect(
        button.closest('[data-terminal-theme-row]')?.getAttribute('data-terminal-theme-row'),
      ).toBe(theme.on);
    }
  });

  it('mark the theme in force in each row -- Hans and Tango Light until something is chosen', () => {
    open();
    expect(chip(DEFAULT_TERMINAL_THEME.dark)?.getAttribute('aria-pressed')).toBe('true');
    expect(chip(DEFAULT_TERMINAL_THEME.light)?.getAttribute('aria-pressed')).toBe('true');
    const pressed = [...document.querySelectorAll('[data-terminal-theme][aria-pressed="true"]')];
    expect(pressed.length).toBe(2);
  });

  it('mark a stored choice, per bucket', () => {
    open({
      ...EMPTY_PREFS,
      terminalScheme: {
        ...EMPTY_PREFS.terminalScheme,
        dark: { theme: 'nord', overrides: {} },
        light: { theme: 'github-light', overrides: {} },
      },
    });
    expect(chip('nord')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip('hans')?.getAttribute('aria-pressed')).toBe('false');
    expect(chip('github-light')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip('tango-light')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('write a dark choice into the dark bucket and leave light exactly as it was', () => {
    const { onChange } = open(withOverride('dark', 'red', PICK));
    fireEvent.click(chip('dracula') as HTMLElement);
    const next = changed(onChange);
    expect(next.terminalScheme.dark.theme).toBe('dracula');
    // The overrides stay: they are the operator's colours, and a new theme
    // underneath them is what they asked for.
    expect(next.terminalScheme.dark.overrides).toEqual({ red: PICK });
    expect(next.terminalScheme.light).toEqual(EMPTY_PREFS.terminalScheme.light);
  });

  it('write a light choice into the light bucket, whichever theme is on screen', () => {
    // The overlay is open in DARK and the light row is still pressed: a chip
    // that wrote to "the theme on screen" would put a light id in the dark
    // bucket, which the reader silently defaults back to Hans.
    const { onChange } = open(EMPTY_PREFS, 'dark');
    fireEvent.click(chip('solarized-light') as HTMLElement);
    const next = changed(onChange);
    expect(next.terminalScheme.light.theme).toBe('solarized-light');
    expect(next.terminalScheme.dark.theme).toBe(DEFAULT_TERMINAL_THEME.dark);
  });

  it('say on the row which theme is the default for that mode', () => {
    open();
    const hintOf = (on: EffectiveTheme) =>
      document
        .querySelector(`[data-terminal-theme-row="${on}"]`)
        ?.closest('[data-settings-rows] > *')?.textContent ?? '';
    const label = (id: string) => TERMINAL_THEMES.find((t) => t.id === id)?.label ?? '';
    expect(hintOf('dark')).toContain(label(DEFAULT_TERMINAL_THEME.dark));
    expect(hintOf('light')).toContain(label(DEFAULT_TERMINAL_THEME.light));
  });

  it('preview each theme with its ground, its ink and its caret', () => {
    open();
    const discs = chip('hans')?.querySelectorAll('[data-theme-disc]') ?? [];
    expect([...discs].map((d) => d.getAttribute('data-theme-disc'))).toEqual([
      'background',
      'foreground',
      'cursor',
    ]);
    expect([...discs].map((d) => (d as HTMLElement).style.backgroundColor)).toEqual([
      HANS.background,
      HANS.foreground,
      HANS.cursor,
    ]);
    // A colour is not a label: the discs stay out of the accessible name.
    expect(chip('hans')?.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});

describe('the terminal colour grid', () => {
  it('draws all twenty-three colours of the theme on screen, each named', () => {
    open();
    for (const key of TERMINAL_SCHEME_KEYS) {
      const label = TERMINAL_SCHEME_LABELS[key];
      expect(screen.getByLabelText(`terminal ${label} colour, dark`)).toBe(swatch(key));
      expect(screen.getByLabelText(`terminal ${label} hex, dark`)).toBe(hexField(key));
    }
    expect(document.querySelectorAll('[data-terminal-swatch]').length).toBe(23);
  });

  it('shows the RESOLVED value in the swatch and the hex field: the theme, or the override over it', () => {
    open(withOverride('dark', 'red', PICK));
    for (const key of TERMINAL_SCHEME_KEYS) {
      const want = key === 'red' ? PICK : HANS[key];
      expect(swatch(key)?.value, key).toBe(want);
      expect(hexField(key)?.value, key).toBe(want);
    }
  });

  it('edits the light bucket when the app is light, and shows Tango Light there', () => {
    open(withOverride('dark', 'red', PICK), 'light');
    // The dark override is not on this screen: light keeps its own.
    expect(swatch('red')?.value).toBe(TANGO.red);
    expect(row('red')?.hasAttribute('data-terminal-overridden')).toBe(false);
    expect(screen.getByLabelText('terminal red colour, light')).toBe(swatch('red'));
  });

  it('follows the theme chosen for that mode', () => {
    open({
      ...EMPTY_PREFS,
      terminalScheme: {
        ...EMPTY_PREFS.terminalScheme,
        dark: { theme: 'dracula', overrides: {} },
      },
    });
    expect(swatch('background')?.value).toBe(DRACULA.background);
    expect(hexField('green')?.value).toBe(DRACULA.green);
  });

  it('writes a picked colour into the bucket on screen as an override', () => {
    const { onChange } = open();
    fireEvent.change(swatch('red') as HTMLElement, { target: { value: PICK } });
    const next = changed(onChange);
    expect(next.terminalScheme.dark.overrides).toEqual({ red: PICK });
    expect(next.terminalScheme.dark.theme).toBe('hans');
    expect(next.terminalScheme.light.overrides).toEqual({});
  });

  it('writes into light when the app is light', () => {
    const { onChange } = open(EMPTY_PREFS, 'light');
    fireEvent.change(swatch('blue') as HTMLElement, { target: { value: PICK } });
    const next = changed(onChange);
    expect(next.terminalScheme.light.overrides).toEqual({ blue: PICK });
    expect(next.terminalScheme.dark.overrides).toEqual({});
  });

  it('takes a typed hex, with or without its hash, and writes it the moment it is a colour', () => {
    const { onChange } = open();
    fireEvent.change(hexField('cyan') as HTMLElement, { target: { value: PICK } });
    expect(changed(onChange, 0).terminalScheme.dark.overrides).toEqual({ cyan: PICK });
    fireEvent.change(hexField('cyan') as HTMLElement, { target: { value: PICK.slice(1) } });
    expect(changed(onChange, 1).terminalScheme.dark.overrides).toEqual({ cyan: PICK });
  });

  it('writes nothing for a value that is not a colour, and shows the stored value again on blur', () => {
    const { onChange } = open();
    const field = hexField('cyan') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '#12' } });
    fireEvent.change(field, { target: { value: 'teal' } });
    fireEvent.change(field, { target: { value: '#12345g' } });
    expect(onChange).not.toHaveBeenCalled();
    // What was typed stays in the box while it is being typed ...
    expect(field.value).toBe('#12345g');
    // ... and is gone the moment the box is left: a value that is not a
    // colour changes nothing, and the box may not go on claiming otherwise.
    fireEvent.blur(field);
    expect(field.value).toBe(HANS.cyan);
  });

  it('marks an overridden row and offers its reset there, and nowhere else', () => {
    open(withOverride('dark', 'red', PICK));
    expect(row('red')?.hasAttribute('data-terminal-overridden')).toBe(true);
    expect(resetOne('red')).toBeTruthy();
    expect(screen.getByLabelText('reset terminal red colour, dark')).toBe(resetOne('red'));
    for (const key of TERMINAL_SCHEME_KEYS) {
      if (key === 'red') continue;
      expect(row(key)?.hasAttribute('data-terminal-overridden'), key).toBe(false);
      expect(resetOne(key), key).toBeNull();
    }
  });

  it('resets one colour by deleting the override, not by writing the theme value back', () => {
    const { onChange } = open({
      ...withOverride('dark', 'red', PICK),
      terminalScheme: {
        ...withOverride('dark', 'red', PICK).terminalScheme,
        dark: { theme: 'hans', overrides: { red: PICK, blue: PICK } },
      },
    });
    fireEvent.click(resetOne('red') as HTMLElement);
    const next = changed(onChange);
    expect(next.terminalScheme.dark.overrides).toEqual({ blue: PICK });
    expect('red' in next.terminalScheme.dark.overrides).toBe(false);
  });

  it('offers a bulk reset only while the mode on screen has overrides, and clears only that mode', () => {
    open();
    expect(resetAll('dark')).toBeNull();
    cleanup();
    // Only LIGHT has colours and the overlay is open in dark: no reset here.
    open(withOverride('light', 'red', PICK));
    expect(resetAll('dark')).toBeNull();
    cleanup();
    const both: Prefs = {
      ...EMPTY_PREFS,
      terminalScheme: {
        ...EMPTY_PREFS.terminalScheme,
        dark: { theme: 'nord', overrides: { red: PICK, bold: PICK } },
        light: { theme: 'tango-light', overrides: { red: PICK } },
      },
    };
    const { onChange } = open(both);
    fireEvent.click(resetAll('dark') as HTMLElement);
    const next = changed(onChange);
    expect(next.terminalScheme.dark).toEqual({ theme: 'nord', overrides: {} });
    expect(next.terminalScheme.light).toEqual(both.terminalScheme.light);
  });
});

describe('the terminal background opacity', () => {
  it('is a slider over the model’s own range, printed as a percentage', () => {
    open();
    const control = slider() as HTMLInputElement;
    expect(control.type).toBe('range');
    expect(Number(control.min)).toBe(TERMINAL_BACKGROUND_OPACITY_MIN);
    expect(Number(control.max)).toBe(TERMINAL_BACKGROUND_OPACITY_MAX);
    expect(Number(control.step)).toBe(0.05);
    expect(Number(control.value)).toBe(DEFAULT_TERMINAL_BACKGROUND_OPACITY);
    expect(printed()?.textContent).toBe('100%');
    expect(screen.getByLabelText('terminal background opacity')).toBe(control);
  });

  it('shows the stored value and writes the one you drag to', () => {
    const { onChange } = open({
      ...EMPTY_PREFS,
      terminalScheme: { ...EMPTY_PREFS.terminalScheme, backgroundOpacity: 0.85 },
    });
    expect(Number(slider()?.value)).toBe(0.85);
    expect(printed()?.textContent).toBe('85%');
    fireEvent.change(slider() as HTMLElement, { target: { value: '0.5' } });
    expect(changed(onChange).terminalScheme.backgroundOpacity).toBe(0.5);
  });

  it('clamps whatever the control hands it to the readable range', () => {
    // A range input sanitises its own value against `min` and `max`, so
    // what reaches the handler for a number past either end is the end --
    // and the setter clamps once more behind it. Opened at 0.5 rather than
    // the default: a controlled input already at 1 that is handed 5 lands
    // on 1 again, which is no change and fires nothing. (A non-number is the
    // setter's own case, held in `terminal-scheme.test.ts`; a range cannot
    // hold one.)
    const { onChange } = open({
      ...EMPTY_PREFS,
      terminalScheme: { ...EMPTY_PREFS.terminalScheme, backgroundOpacity: 0.5 },
    });
    fireEvent.change(slider() as HTMLElement, { target: { value: '5' } });
    fireEvent.change(slider() as HTMLElement, { target: { value: '0' } });
    expect(changed(onChange, 0).terminalScheme.backgroundOpacity).toBe(
      TERMINAL_BACKGROUND_OPACITY_MAX,
    );
    expect(changed(onChange, 1).terminalScheme.backgroundOpacity).toBe(
      TERMINAL_BACKGROUND_OPACITY_MIN,
    );
  });

  it('disturbs no neighbouring preference', () => {
    const { onChange } = open({ ...EMPTY_PREFS, outFontSize: 15, terminalFontSize: 13 });
    fireEvent.change(slider() as HTMLElement, { target: { value: '0.6' } });
    const next = changed(onChange);
    expect(next.outFontSize).toBe(15);
    expect(next.terminalFontSize).toBe(13);
    expect(next.terminalScheme.dark).toEqual(EMPTY_PREFS.terminalScheme.dark);
  });
});

const ESC = '';
const ATLAS = 'claude-code:atlas-11111111';
const view = (): PaneView => ({
  kind: 'ok',
  name: 'vam-atlas-a1b2c3',
  text: `${ESC}[31mred${ESC}[0m plain\n`,
  cursor: { kind: 'unreadable' },
});
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('a change in the overlay reaches a Terminal tab that is already open', () => {
  it('repaints the pane’s custom properties with no reload and no prop', async () => {
    // THE SEAM THIS EXISTS FOR. The tab is mounted first and handed nothing;
    // the overlay's `onChange` is the canvas's own `writePrefs`. A chip that
    // wrote the pref and stopped there would leave this pane on Hans.
    const read = vi.fn(async () => view());
    render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
    await settle();
    const pane = document.querySelector<HTMLElement>('[data-terminal-pane]');
    if (pane === null) throw new Error('the pane was not drawn');
    expect(pane.style.getPropertyValue('--vam-term-bg')).toBe(HANS.background);

    let prefs: Prefs = EMPTY_PREFS;
    const onChange = (next: Prefs) => {
      prefs = next;
      writePrefs(browserStorage(), next);
      // The canvas re-renders the overlay with the prefs it just stored; the
      // test does the same by hand, so the second click below sees the first.
      rerender();
    };
    const { rerender: swap } = render(
      <SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={() => {}} />,
    );
    const rerender = () =>
      swap(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={() => {}} />);

    act(() => {
      fireEvent.click(chip('dracula') as HTMLElement);
    });
    expect(pane.style.getPropertyValue('--vam-term-bg')).toBe(DRACULA.background);
    expect(pane.style.getPropertyValue('--vam-ansi-red')).toBe(DRACULA.red);

    act(() => {
      fireEvent.change(hexField('red') as HTMLElement, { target: { value: PICK } });
    });
    expect(pane.style.getPropertyValue('--vam-ansi-red')).toBe(PICK);
    expect(pane.style.getPropertyValue('--vam-term-bg')).toBe(DRACULA.background);

    act(() => {
      fireEvent.change(slider() as HTMLElement, { target: { value: '0.5' } });
    });
    expect(pane.style.backgroundColor).toBe('rgba(40, 42, 54, 0.5)');

    act(() => {
      fireEvent.click(resetAll('dark') as HTMLElement);
    });
    expect(pane.style.getPropertyValue('--vam-ansi-red')).toBe(DRACULA.red);
    // And what the store holds is what the overlay shows: one source.
    expect(swatch('red')?.value).toBe(resolveTerminalScheme(prefs.terminalScheme, 'dark').red);
  });
});
