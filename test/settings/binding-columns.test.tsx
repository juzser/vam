// @vitest-environment happy-dom

/**
 * The shape of one shortcut row: label, first binding, second binding.
 *
 * The operator reads this list down the labels, so the label is the first
 * column and the two key slots follow it in slot order. happy-dom computes no
 * layout, so "the key columns stay aligned" is asserted the only way it can
 * honestly be: every row is the SAME grid with the SAME three tracks, the two
 * key tracks are fixed, and the one flexible track is marked to truncate its
 * text rather than grow with it. A row that can gain a fourth track -- the
 * reset control, say -- is the thing that would break alignment, so the child
 * count is asserted on an overridden row too.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBindingSheet, CURSOR_MODES } from '../../src/renderer/keyboard/keysheet.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { shortcutSections } from '../../src/renderer/settings/sections.js';

afterEach(cleanup);

const SHEET = buildBindingSheet({});
const allRows = SHEET.flatMap((group) => group.rows);

function open(prefs: Prefs = EMPTY_PREFS) {
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={vi.fn()} onClose={vi.fn()} />);
}

const lines = () => [...document.querySelectorAll<HTMLElement>('[data-shortcut-section] ul > li')];

/** The `grid-cols-[a_b_c]` tracks of a row, in order. */
function tracks(line: HTMLElement): readonly string[] {
  const match = /grid-cols-\[([^\]]+)\]/.exec(line.className);
  expect(match, `no grid template on ${line.className}`).not.toBeNull();
  return (match?.[1] ?? '').split('_');
}

describe('the columns of a shortcut row', () => {
  it('reads label, then the first binding, then the second', () => {
    open();
    const rendered = lines();
    expect(rendered.length).toBeGreaterThan(0);
    for (const line of rendered) {
      const cells = [...line.children];
      expect(cells.length, line.textContent ?? '').toBe(3);
      // The label leads, and it is not a key slot.
      expect(cells[0]?.querySelector('[data-binding-slot]')).toBeNull();
      expect((cells[0]?.textContent ?? '').length).toBeGreaterThan(0);
      // Then the slots, in slot order.
      for (const slot of [0, 1]) {
        const cell = cells[slot + 1] as HTMLElement;
        expect(cell.getAttribute('data-binding-slot')?.endsWith(`:${slot}`), cell.outerHTML).toBe(
          true,
        );
      }
    }
  });

  it('gives every row the same three tracks, the key ones fixed', () => {
    open();
    const rendered = lines();
    const templates = new Set(rendered.map((line) => tracks(line).join('_')));
    // One template for the whole list: the key columns cannot land on two
    // different x from one row to the next.
    expect(templates.size).toBe(1);
    const [flexible, first, second] = tracks(rendered[0] as HTMLElement);
    expect(tracks(rendered[0] as HTMLElement).length).toBe(3);
    expect(first).toBe('68px');
    expect(second).toBe('68px');
    expect(flexible).toBe('1fr');
  });

  it('truncates a long label instead of pushing the key slots along', () => {
    open();
    const longest = allRows.reduce((a, b) => (a.label.length >= b.label.length ? a : b));
    expect(longest.label.length).toBeGreaterThan(20);
    for (const line of lines()) {
      const cell = line.children[0] as HTMLElement;
      // `min-w-0` is what stops a grid item's auto minimum from widening the
      // flexible track; `truncate` is what it does instead.
      expect(cell.className, cell.className).toContain('min-w-0');
      const text = cell.querySelector<HTMLElement>('[data-binding-label]');
      expect(text, cell.outerHTML).not.toBeNull();
      expect(text?.className).toContain('truncate');
    }
  });

  it('keeps a reset control inside the label column, so the row stays three wide', () => {
    // Mode-independent, so it is drawn once under its own label rather than
    // twice under two per-mode captions.
    const row = allRows.find((candidate) => candidate.byMode === null);
    expect(row).toBeDefined();
    open({ ...EMPTY_PREFS, keyBindings: { [row?.id ?? '']: ['q'] } });
    const reset = document.querySelector<HTMLElement>(`[data-binding-reset="${row?.id}"]`);
    expect(reset).not.toBeNull();
    const line = (reset as HTMLElement).closest('li') as HTMLElement;
    expect(line.children.length).toBe(3);
    expect(line.children[0]?.contains(reset as Node)).toBe(true);
    // It shares the flexible column with the label, so the text is what yields:
    // `shrink-0` is what keeps a long label from squeezing the control out of
    // reach instead of truncating itself.
    expect(reset?.className).toContain('shrink-0');
    // #157: the override state is carried by the accessible name, not by colour
    // alone -- moving the control must not cost that.
    expect(reset?.getAttribute('aria-label')).toBe(`reset ${row?.label} shortcut`);
    // And it exists ONLY for an overridden binding.
    const untouched = allRows.find(
      (candidate) => candidate.id !== row?.id && candidate.byMode === null,
    );
    expect(document.querySelector(`[data-binding-reset="${untouched?.id}"]`)).toBeNull();
  });

  it('still offers to add a binding in the last column', () => {
    open();
    // Mode-independent, so it is drawn once and its label is the same in every
    // section -- a mode-dependent row carries its per-mode caption instead.
    const single = allRows.find(
      (candidate) => candidate.keys.length === 1 && candidate.byMode === null,
    );
    expect(single, 'every action has two bindings — nothing to add').toBeDefined();
    const empty = document.querySelector<HTMLElement>(`[data-binding-slot="${single?.id}:1"]`);
    expect(empty).not.toBeNull();
    const line = (empty as HTMLElement).closest('li') as HTMLElement;
    // Reads as an invitation, not as a broken cell: named for the act, dashed,
    // and carrying the plus mark.
    expect(empty?.getAttribute('aria-label')).toBe(`add a key for ${single?.label}`);
    expect(empty?.className).toContain('border-dashed');
    expect(empty?.querySelector('svg')).not.toBeNull();
    // And it is the third child of its row: the empty slot did not move.
    expect(line.children[2]).toBe(empty);
  });

  it('leaves the mode sectioning alone', () => {
    open();
    const sections = shortcutSections(SHEET);
    for (const mode of CURSOR_MODES) {
      const drawn = [
        ...(document
          .querySelector(`[data-shortcut-section="${mode}"]`)
          ?.querySelectorAll<HTMLElement>('li') ?? []),
      ];
      const expected = sections.find((section) => section.id === mode)?.rows ?? [];
      expect(expected.length).toBeGreaterThan(0);
      expect(
        drawn.map((line) =>
          line
            .querySelector('[data-binding-slot]')
            ?.getAttribute('data-binding-slot')
            ?.replace(/:\d+$/, ''),
        ),
        mode,
      ).toEqual(expected.map((line) => line.id));
    }
  });
});
