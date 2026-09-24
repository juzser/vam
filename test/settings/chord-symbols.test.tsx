// @vitest-environment happy-dom

/**
 * SETTINGS PRINTS THE KEY THE OPERATOR PRESSES, NOT THE TOKEN vam STORES.
 *
 * The operator, translated: "show shortcut keys in settings and in the
 * tooltips as symbols — `Mod` should show the ⌘ icon if macOS. On Windows show
 * `Ctrl`." This file is the settings half; `test/keyboard/shortcut-tip.test.tsx`
 * is the tooltip half and `test/keyboard/chord-symbols.test.ts` is the
 * rendering itself.
 *
 * EVERY CASE RUNS TWICE, ONCE PER PLATFORM, and never reads the host's:
 * `chords.ts` states the reason and `test/support/platform.ts` is the seam.
 *
 * AND THE STORE IS UNTOUCHED, which is the assertion that keeps this a paint:
 * a rebind still writes `Mod-k`, and the last case here reads it back out of
 * the prefs the editor produced.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chordSymbols } from '../../src/renderer/keyboard/chords.js';
import { buildBindingSheet } from '../../src/renderer/keyboard/keysheet.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { onBothPlatforms } from '../support/platform.js';

afterEach(cleanup);

const ROWS = buildBindingSheet({}).flatMap((group) => group.rows);

function open(prefs: Prefs = EMPTY_PREFS, onChange = vi.fn()) {
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={vi.fn()} />);
}

const slot = (id: string, index = 0) =>
  document.querySelector<HTMLElement>(`[data-binding-slot="${id}:${index}"]`);

describe('the shortcut editor paints each platform’s own keyboard', () => {
  it('prints ⌘ in a slot on a Mac and Ctrl off one', () => {
    onBothPlatforms((mac) => {
      open();
      expect(slot('palette')?.querySelector('[data-settings-keys]')?.textContent).toBe(
        mac ? '⌘K' : 'Ctrl+K',
      );
      cleanup();
    });
  });

  it('leaves no token spelling anywhere in the list', () => {
    onBothPlatforms(() => {
      open();
      const printed = [...document.querySelectorAll('[data-settings-keys]')].map(
        (each) => each.textContent ?? '',
      );
      expect(printed.length, 'the keyboard section drew no chords').toBeGreaterThan(40);
      for (const keys of printed) {
        expect(keys, `"${keys}" is a token, not a rendering`).not.toContain('Mod-');
      }
      cleanup();
    });
  });

  /**
   * THE SLOT IS A BUTTON AND ITS NAME IS ITS WHOLE ANNOUNCEMENT. A screen
   * reader never sees the `<kbd>`; it reads `aria-label`, so a label left in
   * tokens would say "Mod dash K" to the one user who cannot check the screen.
   * VoiceOver says "command" for ⌘, and the platform that gets the glyphs is
   * the only one whose screen reader is asked to read them.
   */
  it('says the same thing in the accessible name as on the face', () => {
    onBothPlatforms((mac) => {
      open();
      const row = ROWS.find((each) => each.id === 'palette');
      expect(slot('palette')?.getAttribute('aria-label')).toBe(
        `${mac ? '⌘K' : 'Ctrl+K'}, ${row?.label}`,
      );
      cleanup();
    });
  });

  /**
   * A DEAD KEY NAMES ITSELF TWICE — in the hover title and in the accessible
   * name — and both were token spellings. The map is still keyed by the token,
   * which is what `row.dead[keys]` is looked up with; only the words move.
   */
  it('renders the chord in a dead slot’s title and name', () => {
    const taken = { palette: ['Mod-k'], rename: ['Mod-k'] };
    onBothPlatforms((mac) => {
      open({ ...EMPTY_PREFS, keyBindings: taken });
      const dead = [...document.querySelectorAll<HTMLElement>('[data-binding-dead]')];
      expect(dead.length, 'no shadowed slot — the fixture stopped clashing').toBeGreaterThan(0);
      for (const cell of dead) {
        expect(cell.getAttribute('title') ?? '').toContain(mac ? '⌘K' : 'Ctrl+K');
        expect(cell.getAttribute('title') ?? '').not.toContain('Mod-k');
        expect(cell.getAttribute('aria-label') ?? '').toContain(mac ? '⌘K' : 'Ctrl+K');
      }
      cleanup();
    });
  });

  /**
   * THE REFUSAL NAMES A KEY, SO IT NAMES IT THE WAY THE OPERATOR JUST PRESSED
   * IT. `Mod-[` is reserved — it is how the prompt box is left — and an
   * operator who has just pressed Cmd+[ on a Mac is told about `⌘[`.
   */
  it('renders the chord in the reserved-key refusal', () => {
    onBothPlatforms((mac) => {
      open();
      const row = ROWS.find((each) => each.byMode === null);
      fireEvent.click(slot(row?.id ?? '') as HTMLElement);
      const box = document.querySelector<HTMLElement>('[data-binding-capture]');
      expect(box, 'the capture box did not arm').not.toBeNull();
      act(() => {
        fireEvent.keyDown(box as HTMLElement, { key: '[', code: 'BracketLeft', metaKey: true });
      });
      const said = document.body.textContent ?? '';
      expect(said).toContain(`"${mac ? '⌘[' : 'Ctrl+['}" is reserved`);
      expect(said).not.toContain('Mod-[');
      cleanup();
    });
  });

  /**
   * THE SEND KEY IS A CHORD TOO, and `SUBMIT_KEY_LABELS` already spells it as
   * one (`Enter`, `Shift-Enter`) for exactly this reason: "vam already has one
   * spelling for a modified key and this is it". So the picker renders like
   * every other key on the surface.
   */
  it('renders the prompt send keys as keys', () => {
    onBothPlatforms((mac) => {
      open();
      const option = (key: string) =>
        document.querySelector<HTMLElement>(`[data-submit-key-option="${key}"]`)?.textContent;
      expect(option('enter')).toBe(mac ? '⏎' : 'Enter');
      expect(option('shift-enter')).toBe(mac ? '⇧⏎' : 'Shift+Enter');
      cleanup();
    });
  });
});

describe('the paint is a paint: nothing that matches a keystroke moved', () => {
  it('still stores the token spelling when the operator rebinds on a Mac', () => {
    onBothPlatforms((mac) => {
      const onChange = vi.fn();
      open(EMPTY_PREFS, onChange);
      const row = ROWS.find((each) => each.byMode === null);
      fireEvent.click(slot(row?.id ?? '') as HTMLElement);
      const box = document.querySelector<HTMLElement>('[data-binding-capture]');
      act(() => {
        fireEvent.keyDown(box as HTMLElement, { key: 'j', metaKey: true, ctrlKey: !mac });
      });
      expect(onChange).toHaveBeenCalled();
      const next = onChange.mock.calls[0]?.[0] as Prefs;
      // THE STORE HOLDS `Mod-j`, on both platforms and whatever the screen
      // says. A glyph in here would be a binding no `normalizeKey` output can
      // ever equal.
      expect(next.keyBindings[row?.id ?? '']).toEqual(['Mod-j']);
      expect(JSON.stringify(next.keyBindings)).not.toContain('⌘');
      cleanup();
    });
  });

  it('draws the stored token as the symbol, so a round trip reads back the same key', () => {
    onBothPlatforms((mac) => {
      const row = ROWS.find((each) => each.byMode === null);
      open({ ...EMPTY_PREFS, keyBindings: { [row?.id ?? '']: ['Mod-j'] } });
      expect(slot(row?.id ?? '')?.querySelector('[data-settings-keys]')?.textContent).toBe(
        chordSymbols('Mod-j', mac),
      );
      cleanup();
    });
  });
});

describe('the reference list in the other sections', () => {
  it('prints a Control chord as ⌃ on a Mac, never as the command key', () => {
    const row = ROWS.find((each) => each.byMode === null);
    onBothPlatforms((mac) => {
      open({ ...EMPTY_PREFS, keyBindings: { [row?.id ?? '']: ['Ctrl-k'] } });
      const printed = slot(row?.id ?? '')?.querySelector('[data-settings-keys]')?.textContent;
      expect(printed).toBe(mac ? '⌃K' : 'Ctrl+K');
      cleanup();
    });
  });

  it('leaves a bare vim key exactly as the grammar spells it', () => {
    const row = ROWS.find((each) => each.byMode === null);
    onBothPlatforms(() => {
      open({ ...EMPTY_PREFS, keyBindings: { [row?.id ?? '']: ['G'] } });
      expect(slot(row?.id ?? '')?.querySelector('[data-settings-keys]')?.textContent).toBe('G');
      cleanup();
    });
  });
});

/** Nothing here renders the overlay twice in one platform pass, so a stray
 *  duplicate would be a real leak rather than a test artefact. */
it('has one settings dialog on screen per render', () => {
  open();
  expect(screen.getAllByRole('dialog').length).toBe(1);
});
