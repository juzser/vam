// @vitest-environment happy-dom

/**
 * THE PICKER, once an icon has two kinds — and one control that can only
 * refuse.
 *
 * The colour swatches are offered for a lucide glyph and for nothing else,
 * because `color` does not reach an emoji: 🔨 is a picture the font draws.
 * That leaves a control which, for one of the two kinds, cannot act — and the
 * house answer to that is written down in `ContextMenu.tsx`: "AN ITEM THAT
 * CANNOT ACT IS DRAWN, DISABLED, AND SAYS WHY... What must never happen is the
 * third option, a live-looking item that does nothing."
 *
 * SO THE SENTENCE IS THE SUBJECT HERE, not the `disabled` attribute. A row of
 * eight dimmed circles with no explanation is the failure this project keeps
 * finding in its own controls, and it would pass a test that only asked
 * whether they were disabled. The reason text is exported from the module and
 * asserted on the rendered node, so the two cannot be satisfied separately.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconPicker, toneRefusal } from '../../src/renderer/panels/IconPicker.js';
import { ICON_GLYPH_NAMES, ICON_TONES, parseIcon } from '../../src/renderer/panels/icon-value.js';

afterEach(cleanup);

function open(value: string | null, onPick = vi.fn()) {
  const view = render(
    <IconPicker title="alpha-refactor" value={value} onPick={onPick} onClose={vi.fn()} />,
  );
  return { ...view, onPick };
}

describe('the two kinds are both on offer', () => {
  it('draws every curated glyph and every tone, and no more', () => {
    const { container } = open(null);
    const glyphs = [...container.querySelectorAll('[data-icon-choice]')].map((el) =>
      el.getAttribute('data-icon-choice'),
    );
    expect(glyphs).toEqual([...ICON_GLYPH_NAMES]);
    const tones = [...container.querySelectorAll('[data-icon-tone-swatch]')].map((el) =>
      el.getAttribute('data-icon-tone-swatch'),
    );
    expect(tones).toEqual([...ICON_TONES]);
  });

  it('keeps the emoji grid, which is the unbounded half', () => {
    // Lazy, so what a synchronous render sees is its Suspense shell — the
    // point being that the shell is still there and the 300kB dataset is
    // still not in the eager chunk.
    const { container } = open(null);
    expect(container.textContent).toContain('loading icon grid');
  });
});

describe('picking a glyph', () => {
  it('stores it in the default tone when nothing was chosen', () => {
    const { container, onPick } = open(null);
    fireEvent.click(container.querySelector('[data-icon-choice="rocket"]') as HTMLElement);
    expect(onPick).toHaveBeenCalledWith('lucide:rocket:neutral');
  });

  it('keeps the tone already chosen rather than resetting it', () => {
    // Changing the picture is not changing the colour. Re-defaulting here
    // would make every glyph change a silent second edit.
    const { container, onPick } = open('lucide:bug:pink');
    fireEvent.click(container.querySelector('[data-icon-choice="rocket"]') as HTMLElement);
    expect(onPick).toHaveBeenCalledWith('lucide:rocket:pink');
  });

  it('marks the one currently chosen', () => {
    const { container } = open('lucide:bug:pink');
    expect(container.querySelector('[data-icon-choice="bug"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      container.querySelector('[data-icon-choice="rocket"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
  });
});

describe('picking a tone, when there is a glyph to paint', () => {
  it('repaints the chosen glyph and leaves it chosen', () => {
    const { container, onPick } = open('lucide:rocket:neutral');
    fireEvent.click(container.querySelector('[data-icon-tone-swatch="teal"]') as HTMLElement);
    expect(onPick).toHaveBeenCalledWith('lucide:rocket:teal');
  });

  it('offers every swatch live, with nothing to explain away', () => {
    const { container } = open('lucide:rocket:neutral');
    for (const tone of ICON_TONES) {
      const swatch = container.querySelector(`[data-icon-tone-swatch="${tone}"]`);
      expect(swatch?.hasAttribute('disabled'), `${tone} should be live`).toBe(false);
    }
    expect(container.querySelector('[data-icon-tone-refusal]')).toBe(null);
    expect(toneRefusal(parseIcon('lucide:rocket:neutral'))).toBe(null);
  });

  it('marks the tone currently worn', () => {
    const { container } = open('lucide:rocket:teal');
    expect(
      container.querySelector('[data-icon-tone-swatch="teal"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('the control that can only refuse says so', () => {
  it('explains, in a sentence, why an emoji takes no colour', () => {
    const { container, onPick } = open('🔨');
    const said = container.querySelector('[data-icon-tone-refusal]');
    expect(said, 'the swatches were dimmed with no reason given').not.toBe(null);
    // The rendered sentence IS the module's own, not a second copy that could
    // drift away from the one the `title` carries.
    expect(said?.textContent).toBe(toneRefusal(parseIcon('🔨')));
    // And it is about the thing that is actually true.
    expect(toneRefusal(parseIcon('🔨'))).toContain('emoji');

    for (const tone of ICON_TONES) {
      const swatch = container.querySelector(`[data-icon-tone-swatch="${tone}"]`);
      expect(swatch?.hasAttribute('disabled'), `${tone} should be refused`).toBe(true);
      // A pointer that never reaches the sentence still gets it, the way a
      // disabled menu item carries its own reason.
      expect(swatch?.getAttribute('title')).toBe(toneRefusal(parseIcon('🔨')));
      fireEvent.click(swatch as HTMLElement);
    }
    expect(onPick).not.toHaveBeenCalled();
  });

  it('gives the empty picker its own reason, which is a different one', () => {
    const { container } = open(null);
    const said = container.querySelector('[data-icon-tone-refusal]')?.textContent;
    expect(said).toBe(toneRefusal(null));
    expect(said).not.toBe(toneRefusal(parseIcon('🔨')));
    // "nothing is chosen yet" is not "this kind cannot be painted", and a
    // picker that said the second when it meant the first would be telling an
    // operator their emoji was the problem when they have no icon at all.
    expect(toneRefusal(null)).not.toContain('emoji');
  });
});

describe('clearing is still one press', () => {
  it('stores the empty pick that means "no icon"', () => {
    const { getByText, onPick } = open('lucide:rocket:teal');
    fireEvent.click(getByText('clear icon'));
    expect(onPick).toHaveBeenCalledWith('');
  });
});
