// @vitest-environment happy-dom

/**
 * WHAT AN ICON IS, now that there are two kinds of them — and the one
 * property that outranks every other test in this file: AN ICON ALREADY ON
 * SOMEBODY'S DISK MUST KEEP DRAWING.
 *
 * Every icon stored before this change is a bare emoji: one character, no
 * prefix, written by `setIcon`/`setProjectIcon`/`setGroupIcon` straight out of
 * `EmojiGrid`. The reader added here has to keep reading those without a
 * migration, because a migration over `localStorage` is a step that can fail
 * on somebody's machine and take their choices with it — `prefs.ts` makes that
 * argument about its own buckets twice. The first `describe` below is that
 * promise, spelled as the values the old picker could actually produce.
 *
 * THE SECOND PROPERTY IS THAT AN UNREADABLE VALUE IS NOT DRAWN AS MACHINERY.
 * A stored string that names a glyph this build does not have — a newer vam
 * wrote it, or a person edited the JSON — resolves to "no icon", so the
 * fallback chain carries on to the next link. Printing `lucide:nonesuch` into
 * a sidebar heading is the failure mode worth testing for.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  describeIcon,
  ICON_GLYPH_NAMES,
  ICON_GLYPHS,
  ICON_TONE_INK,
  ICON_TONES,
  IconMark,
  type IconValue,
  parseIcon,
  storedIcon,
} from '../../src/renderer/panels/icon-value.js';

afterEach(cleanup);

describe('an icon stored before glyphs existed still reads as itself', () => {
  it('reads every shape the emoji picker could have written', () => {
    // A plain emoji, one with a variation selector, a skin-tone sequence and a
    // ZWJ family — the four shapes `emoji-picker-react` really emits, so this
    // is the old store's alphabet rather than one convenient character.
    for (const emoji of ['🔨', '🧪', '❤️', '👍🏽', '👩‍💻']) {
      expect(parseIcon(emoji)).toEqual({ kind: 'emoji', emoji });
    }
  });

  it('treats absence, and the empty string an empty pick used to mean, as no icon', () => {
    expect(parseIcon(null)).toBe(null);
    expect(parseIcon(undefined)).toBe(null);
    expect(parseIcon('')).toBe(null);
  });

  it('draws an emoji as the bare text it has always been', () => {
    // No wrapper element: every caller's layout and `textContent` were written
    // against a string sitting directly in their own span.
    const { container } = render(
      <IconMark value={parseIcon('🔨')} size={11} fallback={<span>none</span>} />,
    );
    expect(container.textContent).toBe('🔨');
    expect(container.querySelector('svg')).toBe(null);
  });
});

describe('the second kind: a named glyph, and a tone it can actually wear', () => {
  it('reads a glyph with a tone, and one without as the default tone', () => {
    expect(parseIcon('lucide:rocket:teal')).toEqual({
      kind: 'glyph',
      glyph: 'rocket',
      tone: 'teal',
    });
    expect(parseIcon('lucide:rocket')).toEqual({
      kind: 'glyph',
      glyph: 'rocket',
      tone: 'neutral',
    });
  });

  it('round-trips every glyph in every tone through the stored string', () => {
    for (const glyph of ICON_GLYPH_NAMES) {
      for (const tone of ICON_TONES) {
        const value: IconValue = { kind: 'glyph', glyph, tone };
        expect(parseIcon(storedIcon(value))).toEqual(value);
      }
    }
    // A corpus of zero passes every `for` loop ever written.
    expect(ICON_GLYPH_NAMES.length * ICON_TONES.length).toBe(192);
  });

  it('draws the glyph with its tone as a token class, never a colour of its own', () => {
    const { container } = render(
      <IconMark value={parseIcon('lucide:rocket:teal')} size={11} fallback={<span>none</span>} />,
    );
    const svg = container.querySelector('[data-icon-glyph]');
    expect(svg?.getAttribute('data-icon-glyph')).toBe('rocket');
    expect(svg?.getAttribute('data-icon-tone')).toBe('teal');
    expect(svg?.getAttribute('class')).toContain(ICON_TONE_INK.teal);
    // 13.1's rule, at the one call site that paints a chosen colour.
    expect(svg?.getAttribute('style') ?? '').not.toMatch(/#|rgb/);
  });
});

describe('an unreadable value falls through rather than printing machinery', () => {
  it('reads a glyph this build does not have as no icon at all', () => {
    expect(parseIcon('lucide:nonesuch')).toBe(null);
    expect(parseIcon('lucide:nonesuch:teal')).toBe(null);
    expect(parseIcon('lucide:')).toBe(null);
  });

  it('reads an unknown tone as the default rather than dropping the glyph', () => {
    // The glyph is the operator's choice and the tone is its decoration:
    // losing the decoration is a smaller loss than losing the icon.
    expect(parseIcon('lucide:rocket:chartreuse')).toEqual({
      kind: 'glyph',
      glyph: 'rocket',
      tone: 'neutral',
    });
  });

  it('draws the caller own placeholder when there is nothing to draw', () => {
    const { container } = render(
      <IconMark value={parseIcon(null)} size={11} fallback={<span data-ph>none</span>} />,
    );
    expect(container.querySelector('[data-ph]')).not.toBe(null);
  });
});

describe('the two lists, as data rather than as prose', () => {
  it('draws a picture for every glyph name and nothing more', () => {
    expect(Object.keys(ICON_GLYPHS).sort()).toEqual([...ICON_GLYPH_NAMES].sort());
    expect(ICON_GLYPH_NAMES.length).toBe(24);
    expect(new Set(ICON_GLYPH_NAMES).size).toBe(24);
  });

  it('names an ink for every tone, and orca eight are the eight', () => {
    expect(ICON_TONES).toEqual([
      'neutral',
      'red',
      'orange',
      'yellow',
      'green',
      'teal',
      'purple',
      'pink',
    ]);
    expect(Object.keys(ICON_TONE_INK).sort()).toEqual([...ICON_TONES].sort());
    // Every ink is a TOKEN utility. A `text-[#...]` here would pass 13.1's
    // scan of `src/` only because this file is a test, and would paint a
    // literal into the app all the same.
    for (const tone of ICON_TONES) {
      expect(ICON_TONE_INK[tone]).toBe(`text-icon-${tone}`);
    }
  });
});

describe('what the status line says it did', () => {
  it('names a glyph and its tone in words, never the stored string', () => {
    expect(describeIcon('lucide:rocket:teal')).toBe('rocket · teal');
    expect(describeIcon('lucide:rocket')).toBe('rocket · neutral');
  });

  it('shows an emoji as itself', () => {
    expect(describeIcon('🔨')).toBe('🔨');
  });
});
