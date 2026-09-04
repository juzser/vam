// @vitest-environment happy-dom

/**
 * The layout picker as an image choice: a shape diagram above, a label below.
 *
 * The diagram's job is not decoration — it is the only thing on the surface
 * that says `focusResponse` REORDERS the columns rather than removing one. So
 * the assertions below read the drawn order, not merely which blocks are
 * present: a picture that showed the same three blocks for `full` and
 * `focusResponse` would be a picture of nothing.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { columnOrder, LAYOUTS } from '../../src/renderer/prefs/panes.js';
import { EMPTY_PREFS, setLayout, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { LAYOUT_CHOICES, LAYOUT_DESCRIPTION } from '../../src/renderer/settings/sections.js';
import { currentLayout, SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} onChange={onChange} onClose={onClose} />);
  fireEvent.click(document.querySelector('[data-settings-nav-item="layout"]') as HTMLElement);
  return { onChange };
}
const onClose = () => {};

const tile = (choice: string) =>
  document.querySelector<HTMLElement>(`[data-layout-option="${choice}"]`) as HTMLElement;
/** The column blocks the tile's diagram draws, in the order they are drawn. */
const drawn = (choice: string) =>
  [...tile(choice).querySelectorAll('[data-diagram-column]')].map(
    (el) => el.getAttribute('data-diagram-column') ?? '',
  );
const at = (choice: string, column: string) =>
  Number(
    tile(choice)
      .querySelector(`[data-diagram-column="${column}"]`)
      ?.getAttribute('x') ?? Number.NaN,
  );

describe('the picker is a radiogroup of image choices', () => {
  it('offers every layout, once, most columns first', () => {
    open();
    const group = screen.getByRole('radiogroup', { name: 'layout' });
    const options = [...group.querySelectorAll('[data-layout-option]')].map(
      (el) => el.getAttribute('data-layout-option') ?? '',
    );
    expect(options).toEqual(['full', 'focusResponse', 'noCanvas', 'responseOnly']);
    expect(options.length).toBe(Object.keys(LAYOUTS).length + 1);
    expect([...LAYOUT_CHOICES].sort()).toEqual([...options].sort());
    for (const el of group.querySelectorAll('[data-layout-option]')) {
      expect(el.getAttribute('role')).toBe('radio');
    }
  });

  it('names each choice by its visible label first, then the column order', () => {
    open();
    for (const choice of LAYOUT_CHOICES) {
      const name = tile(choice).getAttribute('aria-label') ?? '';
      expect(name).toContain(LAYOUT_DESCRIPTION[choice]);
      expect(name.startsWith(tile(choice).textContent?.trim() ?? 'x')).toBe(true);
    }
  });

  it('checks the current layout and nothing else', () => {
    open({ ...EMPTY_PREFS, paneVisibility: LAYOUTS.noCanvas });
    const checked = [...document.querySelectorAll('[data-layout-option][aria-checked="true"]')].map(
      (el) => el.getAttribute('data-layout-option'),
    );
    expect(checked).toEqual(['noCanvas']);
  });

  it('checks nothing when the panes match no named layout', () => {
    open({ ...EMPTY_PREFS, paneVisibility: { sidebar: false, canvas: true, detail: false } });
    expect(document.querySelector('[data-layout-option][aria-checked="true"]')).toBeNull();
    // The roving tabindex has to park somewhere, and the first tile is it.
    expect(tile('full').tabIndex).toBe(0);
  });
});

describe('picking a tile really applies the layout', () => {
  for (const choice of ['full', 'focusResponse', 'noCanvas', 'responseOnly'] as const) {
    it(`applies ${choice}, not merely marks it`, () => {
      const start: Prefs = setLayout(EMPTY_PREFS, 'responseOnly');
      const { onChange } = open(choice === 'responseOnly' ? EMPTY_PREFS : start);
      fireEvent.click(tile(choice));
      const next = onChange.mock.calls[0]?.[0] as Prefs;
      expect(next, 'the pick wrote nothing').toBeDefined();
      expect(currentLayout(next.paneVisibility)).toBe(choice);
      if (choice !== 'full') {
        expect(columnOrder(next.paneVisibility)).toEqual(columnOrder(LAYOUTS[choice]));
      }
    });
  }

  it('moves and selects with the arrows, wrapping', () => {
    const { onChange } = open();
    fireEvent.keyDown(tile('full'), { key: 'ArrowRight' });
    expect((onChange.mock.calls[0]?.[0] as Prefs).paneVisibility).toEqual(
      setLayout(EMPTY_PREFS, 'focusResponse').paneVisibility,
    );
    fireEvent.keyDown(tile('full'), { key: 'ArrowLeft' });
    expect((onChange.mock.calls[1]?.[0] as Prefs).paneVisibility).toEqual(
      setLayout(EMPTY_PREFS, 'responseOnly').paneVisibility,
    );
  });

  it('selects on Space, the explicit path a screen-reader user takes', () => {
    const { onChange } = open();
    fireEvent.keyDown(tile('noCanvas'), { key: ' ' });
    expect(currentLayout((onChange.mock.calls[0]?.[0] as Prefs).paneVisibility)).toBe('noCanvas');
  });
});

describe('the diagram draws the columns in their real order', () => {
  it('shows the canvas after the response in focusResponse and before it in full', () => {
    open();
    expect(drawn('full')).toEqual(['sidebar', 'canvas', 'detail']);
    expect(drawn('focusResponse')).toEqual(['sidebar', 'detail', 'canvas']);
    expect(at('full', 'canvas')).toBeLessThan(at('full', 'detail'));
    expect(at('focusResponse', 'canvas')).toBeGreaterThan(at('focusResponse', 'detail'));
  });

  it('tells focusResponse from noCanvas by more than a missing block', () => {
    open();
    expect(drawn('noCanvas')).toEqual(['sidebar', 'detail']);
    expect(drawn('responseOnly')).toEqual(['detail']);
    // Same blocks as `full`, different order — the reordering IS the difference.
    expect([...drawn('focusResponse')].sort()).toEqual([...drawn('full')].sort());
    expect(drawn('focusResponse')).not.toEqual(drawn('full'));
  });

  it('draws the canvas glyph wherever the canvas sits, and only there', () => {
    open();
    for (const choice of ['full', 'focusResponse'] as const) {
      expect(tile(choice).querySelectorAll('circle').length).toBeGreaterThan(3);
    }
    expect(tile('noCanvas').querySelectorAll('circle').length).toBe(0);
  });

  it('emphasises the column the layout is built around', () => {
    open();
    const fill = (choice: string, column: string) =>
      tile(choice).querySelector(`[data-diagram-column="${column}"]`)?.getAttribute('fill');
    expect(fill('full', 'canvas')).toBe('var(--color-ink-dim)');
    expect(fill('full', 'sidebar')).toBe('var(--color-ink-faint)');
    // Demoted to a strip on the right, the canvas stops being the main column.
    expect(fill('focusResponse', 'detail')).toBe('var(--color-ink-dim)');
    expect(fill('focusResponse', 'canvas')).toBe('var(--color-ink-faint)');
  });

  it('hides the picture from the accessibility tree', () => {
    open();
    const svg = tile('full').querySelector('[data-layout-diagram]');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.textContent).toBe('');
  });
});
