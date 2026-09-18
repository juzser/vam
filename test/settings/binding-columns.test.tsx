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

/**
 * One character of the slot's face, in CSS pixels — MEASURED, not assumed.
 *
 * Read in Chromium off the shipped bundle with a `Range` over a rendered
 * `[data-settings-keys]`: `Enter` and `Mod-1`, both five characters, both
 * 36.13px wide at the `control` step's 12px. That is 7.226px per advance, or
 * 0.60217em — which is what the whole fallback stack measures as well (Geist
 * Mono, SF Mono, Menlo and Courier New are all ~0.6em), so the number holds
 * when the bundled face is missing and the fallback answers.
 *
 * The arithmetic lives here because happy-dom performs no layout and measures
 * no text; `e2e/settings-chrome-shots.mjs` does the measuring in a browser.
 */
const MONO_ADVANCE_PX = 7.226;

/** `px-2` either side and a 1px border either side, from `SLOT_BOX`. */
const SLOT_CHROME_PX = 8 * 2 + 1 * 2;

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

  it('gives every row the same three tracks, the key ones fixed at their floor', () => {
    open();
    const rendered = lines();
    const templates = new Set(rendered.map((line) => tracks(line).join('_')));
    // One template for the whole list: the key columns cannot land on two
    // different x from one row to the next.
    expect(templates.size).toBe(1);
    const [flexible, first, second] = tracks(rendered[0] as HTMLElement);
    expect(tracks(rendered[0] as HTMLElement).length).toBe(3);
    // `minmax(<floor>,max-content)`, not a bare width. The floor is what keeps
    // the two key columns on one x down the whole list; `max-content` is the
    // half that exists because a CAPTURED chord has no length bound (see the
    // test below), and a key the operator cannot read is the same defect as a
    // key that is not bound.
    expect(first).toMatch(/^minmax\(\d+px,max-content\)$/);
    expect(second).toBe(first);
    expect(flexible).toBe('1fr');
  });

  /**
   * THE COLUMN WAS SIZED FOR `r` AND `gt`, AND THE CHORDS GREW PAST IT.
   *
   * The operator: "increase the width of the shortcut column in settings".
   * Measured in Chromium on the shipped bundle before this changed, at the
   * 68px the column had been:
   *
   *   Mod-Shift-]   50.58px of ink over 2 lines   scrollHeight 36 / client 24
   *   Mod-Shift-[   43.36px of ink over 3 lines   scrollHeight 54 / client 24
   *
   * The slot is 26px tall and does not scroll, so those chords were not
   * "tight" — they were WRAPPED AND CUT, and what an operator saw of
   * `Mod-Shift-[` was its first line and nothing else. `Mod-Shift-[` / `]` and
   * `Mod-Alt-[` / `]` arrived with the pane-stepping work; nothing resized the
   * column they landed in.
   *
   * So the floor is derived from the sheet rather than chosen: the widest
   * chord the shipped tables contain, at one measured advance per character,
   * plus the slot's own padding and border. `whitespace-nowrap` is the other
   * half — without it a chord one pixel too wide goes back to wrapping into a
   * box that cannot show a second line.
   */
  it('holds the widest chord the shipped tables contain, on one line', () => {
    open();
    const chords = [...new Set(allRows.flatMap((row) => row.keys))];
    // Not decoration: every line below is vacuous over an empty list, and the
    // sheet is the corpus this column is sized for.
    expect(chords.length).toBeGreaterThan(40);
    const widest = chords.reduce((a, b) => (a.length >= b.length ? a : b));
    expect(widest.length).toBeGreaterThanOrEqual(11);
    const needed = widest.length * MONO_ADVANCE_PX + SLOT_CHROME_PX;

    const [, floor] = tracks(lines()[0] as HTMLElement);
    const floorPx = Number(/minmax\((\d+)px/.exec(floor ?? '')?.[1]);
    expect(floorPx, `${widest} needs ${needed.toFixed(1)}px`).toBeGreaterThanOrEqual(needed);

    // And the slot itself carries the same floor, so the button cannot be
    // narrower than the track it sits in.
    for (const slot of document.querySelectorAll<HTMLElement>('[data-binding-slot]')) {
      expect(slot.className, slot.outerHTML).toContain(`min-w-[${floorPx}px]`);
      // The wrap is what did the cutting, not the width on its own.
      expect(slot.className, slot.outerHTML).toContain('whitespace-nowrap');
    }
  });

  it('lets a longer chord widen its own slot rather than lose characters', () => {
    // A CAPTURED chord has no length bound: `normalizeKey` returns
    // `Mod-Alt-<event.key>` for anything non-positional, and `event.key` is
    // whatever the keyboard reports — `Mod-Alt-ArrowRight` is eighteen
    // characters and `Mod-Alt-AudioVolumeDown` is twenty-three. No fixed
    // column can hold that, so the slot grows and the row's label column
    // yields instead. THE KEY IS NEVER THE THING THAT CLIPS.
    const row = allRows.find((candidate) => candidate.byMode === null);
    expect(row).toBeDefined();
    open({ ...EMPTY_PREFS, keyBindings: { [row?.id ?? '']: ['Mod-Alt-AudioVolumeDown'] } });
    const slot = document.querySelector<HTMLElement>(`[data-binding-slot="${row?.id}:0"]`);
    expect(slot?.textContent).toBe('Mod-Alt-AudioVolumeDown');
    // No fixed `w-[Npx]` anywhere on the slot — that is what would cut it.
    expect(slot?.className).not.toMatch(/(?:^|\s)w-\[\d/);
    // And the track it sits in is allowed to follow the content.
    const [, track] = tracks((slot as HTMLElement).closest('li') as HTMLElement);
    expect(track).toContain('max-content');
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
