/**
 * WHAT A CHORD LOOKS LIKE TO A PERSON — on a Mac, and on everything else.
 *
 * The operator, translated: "show shortcut keys in settings and in the
 * tooltips as symbols — `Mod` should show the ⌘ icon if macOS. On Windows show
 * `Ctrl`." So `chordSymbols` is the one place a token becomes a rendering, and
 * this file is its specification.
 *
 * BOTH BRANCHES, EVERYWHERE, AND THE FLAG IS ALWAYS PASSED. `chords.ts` states
 * the reason on `isApplePlatform` and it holds twice over here: CI runs on
 * ubuntu and the operator's machine is a Mac, so a test that read the platform
 * off its host would assert a different rendering in each place while looking
 * identical in both. The only case that reads a platform at all is the one
 * about `applePlatform`, which puts each platform string in front of it by
 * hand.
 *
 * AND IT IS A DISPLAY FUNCTION, WHICH IS THE OTHER HALF OF THE SPEC. Nothing
 * that matches a keystroke may ever see its output: `normalizeKey` still
 * answers `Mod-p`, the tables are still keyed by tokens, and the last case
 * below is the guard that says so.
 */

import { describe, expect, it } from 'vitest';
import {
  applePlatform,
  bindingChords,
  chordSegments,
  chordSymbols,
  effectiveBindings,
  NO_BINDINGS,
  normalizeKey,
} from '../../src/renderer/keyboard/chords.js';
import { MAC_PLATFORM as MAC, PC_PLATFORM as PC, withPlatform } from '../support/platform.js';

describe('the modifiers become the platform’s own symbols', () => {
  it('spells `Mod` ⌘ on a Mac and Ctrl everywhere else — the whole ask, in one case', () => {
    expect(chordSymbols('Mod-p', true)).toBe('⌘ P');
    expect(chordSymbols('Mod-p', false)).toBe('Ctrl+P');
  });

  it('gives every modifier a glyph on a Mac and a word off it', () => {
    expect(chordSymbols('Mod-k', true)).toBe('⌘ K');
    expect(chordSymbols('Shift-1', true)).toBe('⇧ 1');
    expect(chordSymbols('Alt-1', true)).toBe('⌥ 1');
    expect(chordSymbols('Ctrl-1', true)).toBe('⌃ 1');
    expect(chordSymbols('Mod-k', false)).toBe('Ctrl+K');
    expect(chordSymbols('Shift-1', false)).toBe('Shift+1');
    expect(chordSymbols('Alt-1', false)).toBe('Alt+1');
    expect(chordSymbols('Ctrl-1', false)).toBe('Ctrl+1');
  });

  it('joins Apple’s way with nothing and everyone else’s with `+`', () => {
    expect(chordSymbols('Mod-Shift-e', true)).toBe('⇧ ⌘ E');
    expect(chordSymbols('Mod-Shift-e', false)).toBe('Ctrl+Shift+E');
  });

  /**
   * APPLE'S ORDER IS NOT THE TOKEN'S ORDER, and it is not a taste: the HIG
   * prints modifiers ⌃⌥⇧⌘, command last and nearest the key, which is the
   * order every Mac menu an operator has ever read uses. The token is written
   * `Mod-Ctrl-Alt-Shift-` because that is the order `normalizeKey` builds it
   * in, and the two have no reason to agree.
   */
  it('prints a Mac’s modifiers in ⌃ ⌥ ⇧ ⌘ order, whatever order the token holds', () => {
    expect(chordSymbols('Mod-Ctrl-Alt-Shift-k', true)).toBe('⌃ ⌥ ⇧ ⌘ K');
    expect(chordSymbols('Ctrl-Alt-1', true)).toBe('⌃ ⌥ 1');
    expect(chordSymbols('Mod-Alt-[', true)).toBe('⌥ ⌘ [');
    expect(chordSymbols('Mod-Shift-[', true)).toBe('⇧ ⌘ [');
  });

  it('keeps Ctrl first off a Mac, the way that platform writes it', () => {
    expect(chordSymbols('Ctrl-Alt-1', false)).toBe('Ctrl+Alt+1');
    expect(chordSymbols('Mod-Alt-[', false)).toBe('Ctrl+Alt+[');
    expect(chordSymbols('Mod-Shift-]', false)).toBe('Ctrl+Shift+]');
  });

  /**
   * `Mod` AND `Ctrl` ARE ONE KEY OFF A MAC, and a chord holding both is
   * reachable: `normalizeKey`'s own comment writes `Cmd+Ctrl+K` down as
   * `Mod-Ctrl-k`, and a bindings file written on a Mac can be opened on a PC.
   * "Ctrl+Ctrl+K" is not a keystroke anybody can press.
   */
  it('says Ctrl once off a Mac when the token names both command and control', () => {
    expect(chordSymbols('Mod-Ctrl-k', false)).toBe('Ctrl+K');
    expect(chordSymbols('Mod-Ctrl-k', true)).toBe('⌃ ⌘ K');
  });
});

/**
 * THE TRAP THIS FILE EXISTS FOR. `CTRL_GESTURES` lifted the fold for the
 * letters: on a Mac `Ctrl-<letter>` is a REAL Control chord and `Mod-<letter>`
 * is Cmd, and rendering the first as ⌘ would tell an operator to press a key
 * that does something else entirely.
 */
describe('Ctrl is not Mod, and a Mac must never be told it is', () => {
  it('renders a Control chord with ⌃ on a Mac, never ⌘', () => {
    expect(chordSymbols('Ctrl-d', true)).toBe('⌃ D');
    expect(chordSymbols('Ctrl-u', true)).toBe('⌃ U');
    expect(chordSymbols('Ctrl-d', true)).not.toContain('⌘');
  });

  it('keeps the two apart on a Mac, chord for chord', () => {
    expect(chordSymbols('Mod-d', true)).toBe('⌘ D');
    expect(chordSymbols('Ctrl-d', true)).toBe('⌃ D');
    expect(chordSymbols('Mod-d', true)).not.toBe(chordSymbols('Ctrl-d', true));
  });
});

describe('the key itself', () => {
  it('gives the named keys their conventional glyphs on a Mac', () => {
    expect(chordSymbols('Enter', true)).toBe('⏎');
    expect(chordSymbols('Escape', true)).toBe('⎋');
    expect(chordSymbols('Tab', true)).toBe('⇥');
    expect(chordSymbols('Backspace', true)).toBe('⌫');
    expect(chordSymbols('Delete', true)).toBe('⌦');
    expect(chordSymbols('ArrowUp', true)).toBe('↑');
    expect(chordSymbols('ArrowDown', true)).toBe('↓');
    expect(chordSymbols('ArrowLeft', true)).toBe('←');
    expect(chordSymbols('ArrowRight', true)).toBe('→');
    expect(chordSymbols('PageUp', true)).toBe('⇞');
    expect(chordSymbols('PageDown', true)).toBe('⇟');
    expect(chordSymbols('Shift-Tab', true)).toBe('⇧ ⇥');
    expect(chordSymbols('Shift-Enter', true)).toBe('⇧ ⏎');
  });

  it('spells them in words off a Mac', () => {
    expect(chordSymbols('Enter', false)).toBe('Enter');
    expect(chordSymbols('Escape', false)).toBe('Esc');
    expect(chordSymbols('Tab', false)).toBe('Tab');
    expect(chordSymbols('Backspace', false)).toBe('Backspace');
    expect(chordSymbols('ArrowUp', false)).toBe('Up');
    expect(chordSymbols('PageDown', false)).toBe('PgDn');
    expect(chordSymbols('Shift-Tab', false)).toBe('Shift+Tab');
    expect(chordSymbols('Mod-Alt-ArrowRight', false)).toBe('Ctrl+Alt+Right');
    expect(chordSymbols('Mod-Alt-ArrowRight', true)).toBe('⌥ ⌘ →');
  });

  /**
   * A BARE LETTER IS vim's OWN SPELLING AND KEEPS ITS CASE — the one place
   * this function does nothing at all, deliberately. `G` is the key a vim user
   * reads as `G`, `gt` is two keystrokes and not a modified one, and upper
   * casing `j` would name a key that is bound to something else. Case only
   * becomes decoration once a modifier is in front of it, where ⇧ carries the
   * shift and every Mac menu prints the letter capital.
   */
  it('leaves a bare key exactly as the grammar spells it', () => {
    for (const mac of [true, false]) {
      expect(chordSymbols('j', mac)).toBe('j');
      expect(chordSymbols('G', mac)).toBe('G');
      expect(chordSymbols('?', mac)).toBe('?');
      expect(chordSymbols('/', mac)).toBe('/');
      expect(chordSymbols('<', mac)).toBe('<');
      expect(chordSymbols('1', mac)).toBe('1');
      expect(chordSymbols('gt', mac)).toBe('gt');
      expect(chordSymbols('yy', mac)).toBe('yy');
      expect(chordSymbols('zR', mac)).toBe('zR');
    }
  });

  it('upper cases a letter only once a modifier is holding it', () => {
    expect(chordSymbols('Mod-w', true)).toBe('⌘ W');
    expect(chordSymbols('Mod-w', false)).toBe('Ctrl+W');
    expect(chordSymbols('Mod-Shift-h', true)).toBe('⇧ ⌘ H');
  });

  it('survives the shapes a capture can produce', () => {
    // A hyphen is a key. Stripping tokens by splitting on `-` would leave
    // nothing at all here.
    expect(chordSymbols('Mod--', true)).toBe('⌘ -');
    expect(chordSymbols('-', true)).toBe('-');
    expect(chordSymbols('', true)).toBe('');
    expect(chordSymbols('Mod- ', true)).toBe('⌘ ␣');
    expect(chordSymbols('Mod- ', false)).toBe('Ctrl+Space');
    // A modifier token with no key behind it is not a chord; it is left alone
    // rather than rendered as a naked glyph.
    expect(chordSymbols('Mod-', true)).toBe('Mod-');
  });
});

describe('every chord the shipped tables hold, rendered', () => {
  it('renders each one differently on each platform, or identically on purpose', () => {
    const chords = effectiveBindings(NO_BINDINGS).flatMap((binding) =>
      bindingChords(NO_BINDINGS, binding.id),
    );
    expect(chords.length).toBeGreaterThan(40);
    for (const chord of chords) {
      const mac = chordSymbols(chord, true);
      const pc = chordSymbols(chord, false);
      expect(mac, `"${chord}" rendered to nothing on a Mac`).not.toBe('');
      expect(pc, `"${chord}" rendered to nothing off a Mac`).not.toBe('');
      // No token spelling may survive into either rendering.
      expect(mac, `"${chord}" still says Mod- on a Mac`).not.toContain('Mod-');
      expect(pc, `"${chord}" still says Mod- off a Mac`).not.toContain('Mod-');
      expect(mac, `"${chord}" still says Ctrl- on a Mac`).not.toContain('Ctrl-');
      // Every chord carrying the command modifier reads differently on the two
      // platforms — that difference is the whole of what `Mod-` was hiding.
      if (chord.startsWith('Mod-')) {
        expect(mac, `"${chord}" reads the same on both platforms`).not.toBe(pc);
        expect(mac).toContain('⌘');
        expect(pc).toContain('Ctrl');
      }
      // And a bare vim key is the same keystroke everywhere, so it reads the
      // same everywhere.
      if (!chord.includes('-') && chord.length <= 2) {
        expect(mac, `the bare "${chord}" was rewritten`).toBe(chord);
        expect(pc, `the bare "${chord}" was rewritten`).toBe(chord);
      }
    }
  });

  it('never leaves a ⌘ on a chord that is not the command modifier', () => {
    expect(chordSymbols('Ctrl-Alt-3', true)).toBe('⌃ ⌥ 3');
    expect(chordSymbols('Ctrl-Alt-3', true)).not.toContain('⌘');
  });
});

/**
 * `chordSegments` IS `chordSymbols`' OWN COMPUTATION, one step short of the
 * join -- the shape a caller that draws modifiers larger than the key needs
 * (`ShortcutTip.tsx`'s `InlineChord`/`Chip`, `KeySheet.tsx`, the status
 * bar's own hint). Falsified by mutating `chordSymbols` back to computing its
 * own modifier set independently: this suite would still pass while the two
 * silently disagreed about which segment is which.
 */
describe('chordSegments: the same computation, tagged, before the join', () => {
  it('tags every held modifier and only the trailing key', () => {
    expect(chordSegments('Mod-Shift-e', true)).toEqual([
      { text: '⇧', modifier: true },
      { text: '⌘', modifier: true },
      { text: 'E', modifier: false },
    ]);
    expect(chordSegments('Mod-p', false)).toEqual([
      { text: 'Ctrl', modifier: true },
      { text: 'P', modifier: false },
    ]);
  });

  it('is exactly what chordSymbols joins — the two can never drift apart', () => {
    for (const [chord, mac] of [
      ['Mod-Ctrl-Alt-Shift-k', true],
      ['Ctrl-Alt-1', false],
      ['j', true],
      ['Mod-', true],
    ] as const) {
      const joined = chordSegments(chord, mac)
        .map((segment) => segment.text)
        .join(mac ? ' ' : '+');
      expect(joined).toBe(chordSymbols(chord, mac));
    }
  });

  it('holds a bare key with no modifier at all', () => {
    expect(chordSegments('G', true)).toEqual([{ text: 'G', modifier: false }]);
  });
});

describe('applePlatform: the runtime answer, asked of the real navigator', () => {
  it('reads the platform at the moment it is asked, so both answers are reachable', () => {
    expect(withPlatform(MAC, () => applePlatform())).toBe(true);
    expect(withPlatform(PC, () => applePlatform())).toBe(false);
  });

  it('is what a chord defaults to, so a surface needs no platform of its own', () => {
    expect(withPlatform(MAC, () => chordSymbols('Mod-p'))).toBe('⌘ P');
    expect(withPlatform(PC, () => chordSymbols('Mod-p'))).toBe('Ctrl+P');
  });

  it('answers for an iPhone too — the web build is served to one', () => {
    expect(withPlatform('iPhone', () => chordSymbols('Mod-p'))).toBe('⌘ P');
    expect(withPlatform('Linux x86_64', () => chordSymbols('Mod-p'))).toBe('Ctrl+P');
  });
});

/**
 * THE INVARIANT THE WHOLE CHANGE RESTS ON: this is a rendering, and nothing
 * that matches a keystroke may start comparing glyphs.
 */
describe('the grammar is untouched', () => {
  it('still normalises a keystroke to its token, on both platforms', () => {
    expect(normalizeKey({ key: 'p', metaKey: true }, true)).toBe('Mod-p');
    expect(normalizeKey({ key: 'p', ctrlKey: true }, false)).toBe('Mod-p');
    expect(normalizeKey({ key: 'k', ctrlKey: true }, true)).toBe('Ctrl-k');
  });

  it('still stores and looks bindings up by their token spelling', () => {
    expect(bindingChords(NO_BINDINGS, 'palette')).toContain('Mod-k');
    expect(bindingChords(NO_BINDINGS, 'palette')).not.toContain('⌘ K');
  });
});
