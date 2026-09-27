// @vitest-environment happy-dom

/**
 * THE LIVE PREVIEW CARD: a small, xterm-styled sample that updates INSTANTLY
 * as the Terminal section's font, size and colour settings change — never a
 * real `@xterm/xterm` instance (`TerminalStreamTab.tsx`'s own cost, paid for
 * a REAL session's screen, is not owed by a swatch that never receives a
 * byte). It reads the exact same three module stores that screen reads:
 * `activeTerminalFontFamily`, `activeTerminalFontSize`, `activeTerminalScheme`
 * — so "instantly" means the identical `useSyncExternalStore` wiring, not a
 * poll.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  setActiveTerminalFontSize,
  TERMINAL_FONT_FAMILY,
} from '../../src/renderer/prefs/terminal-font.js';
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  setActiveTerminalFontFamily,
} from '../../src/renderer/prefs/terminal-font-family.js';
import {
  DEFAULT_TERMINAL_SCHEME_PREF,
  setActiveTerminalScheme,
  TERMINAL_THEMES,
} from '../../src/renderer/prefs/terminal-scheme.js';
import { TerminalPreview } from '../../src/renderer/settings/TerminalPreview.js';

afterEach(() => {
  cleanup();
  setActiveTerminalFontFamily(DEFAULT_TERMINAL_FONT_FAMILY);
  setActiveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
  setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
});

const card = () => document.querySelector<HTMLElement>('[data-terminal-preview]');

/** happy-dom's CSSOM re-serialises a `font-family` value with double quotes
 *  regardless of which quote character the style carried in -- a DOM
 *  serialisation detail, not a fact about what was set, so every comparison
 *  below normalises both sides through it rather than asserting one exact
 *  quote character. */
const normalizeQuotes = (value: string) => value.replace(/"/g, "'");

describe('the Terminal section’s live preview card', () => {
  it('renders at the shipped defaults', () => {
    render(<TerminalPreview />);
    expect(card()).not.toBeNull();
    expect(normalizeQuotes(card()?.style.fontFamily ?? '')).toBe(TERMINAL_FONT_FAMILY);
    expect(card()?.style.fontSize).toBe(`${DEFAULT_TERMINAL_FONT_SIZE}px`);
  });

  it('updates instantly when the font family changes — no re-mount needed', () => {
    render(<TerminalPreview />);
    act(() => setActiveTerminalFontFamily('Fira Code'));
    expect(normalizeQuotes(card()?.style.fontFamily ?? '')).toBe(
      `'Fira Code', ${TERMINAL_FONT_FAMILY}`,
    );
  });

  it('updates instantly when the font size changes', () => {
    render(<TerminalPreview />);
    act(() => setActiveTerminalFontSize(14));
    expect(card()?.style.fontSize).toBe('14px');
  });

  it('updates instantly when the colour scheme changes', () => {
    render(<TerminalPreview />);
    const dracula = TERMINAL_THEMES.find((t) => t.id === 'dracula');
    act(() =>
      setActiveTerminalScheme(
        { ...DEFAULT_TERMINAL_SCHEME_PREF, dark: { theme: 'dracula', overrides: {} } },
        'dark',
      ),
    );
    expect(card()?.style.getPropertyValue('--vam-term-bg')).toBe(dracula?.scheme.background);
    expect(card()?.style.getPropertyValue('--vam-term-fg')).toBe(dracula?.scheme.foreground);
  });

  it('draws at least one ANSI-coloured sample, not only the default ink', () => {
    render(<TerminalPreview />);
    const coloured = card()?.querySelectorAll('[class*="text-ansi-"]') ?? [];
    expect(coloured.length).toBeGreaterThan(0);
  });
});
