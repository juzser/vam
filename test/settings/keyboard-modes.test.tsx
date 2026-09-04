// @vitest-environment happy-dom

/**
 * The shortcut editor, split by cursor mode.
 *
 * The operator's point is that Select's keys and Insert's keys do not
 * interfere: `hjkl` chooses a session in one and walks an open question's
 * options in the other, and one undifferentiated list says the opposite. So
 * the split is asserted as behaviour rather than as markup -- which bindings
 * land in which section is derived from `BindingRow.byMode`, the same field
 * the key sheet splits on, and these tests derive their expectations from it
 * too. A hand-written list of "the mode-dependent bindings" here would be the
 * fourth copy of that fact in this codebase and the one that goes stale.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBindingSheet,
  CURSOR_MODES,
  MODE_TITLES,
} from '../../src/renderer/keyboard/keysheet.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { shortcutSections } from '../../src/renderer/settings/sections.js';

afterEach(cleanup);

const SHEET = buildBindingSheet({});
const allRows = SHEET.flatMap((group) => group.rows);
const dependent = allRows.filter((row) => row.byMode !== null);
const independent = allRows.filter((row) => row.byMode === null);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

const sectionOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-shortcut-section="${id}"]`);

describe('the sections the shortcut list is cut into', () => {
  it('leads with one section per mode, then the groups', () => {
    const ids = shortcutSections(SHEET).map((section) => section.id);
    expect(ids.slice(0, CURSOR_MODES.length)).toEqual([...CURSOR_MODES]);
    expect(ids.slice(CURSOR_MODES.length)).toEqual(
      SHEET.map((group) => group.group).filter((group) =>
        SHEET.find((g) => g.group === group)?.rows.some((row) => row.byMode === null),
      ),
    );
    for (const mode of CURSOR_MODES) {
      const section = shortcutSections(SHEET).find((s) => s.id === mode);
      expect(section?.title).toBe(MODE_TITLES[mode]);
    }
  });

  it('puts every mode-dependent binding in BOTH mode sections, captioned for each', () => {
    expect(dependent.length).toBeGreaterThan(0);
    const sections = shortcutSections(SHEET);
    for (const mode of CURSOR_MODES) {
      const section = sections.find((s) => s.id === mode);
      expect(
        section?.rows.map((row) => row.id),
        mode,
      ).toEqual(dependent.map((row) => row.id));
      // The caption is the one for THIS mode -- listing the binding twice with
      // the same words would differentiate nothing.
      for (const row of section?.rows ?? []) {
        const source = dependent.find((candidate) => candidate.id === row.id);
        expect(row.label, `${row.id} in ${mode}`).toBe(source?.byMode?.[mode]);
      }
    }
    // And the two captions really do differ, or the split would be decoration.
    const [first, second] = CURSOR_MODES;
    const one = sections.find((s) => s.id === first)?.rows ?? [];
    const two = sections.find((s) => s.id === second)?.rows ?? [];
    expect(one.map((row) => row.label)).not.toEqual(two.map((row) => row.label));
  });

  it('lists a binding that means one thing in both modes exactly once', () => {
    const sections = shortcutSections(SHEET);
    const modeRows = sections
      .filter((section) => (CURSOR_MODES as readonly string[]).includes(section.id))
      .flatMap((section) => section.rows.map((row) => row.id));
    for (const row of independent) {
      expect(modeRows, `${row.id} must not be duplicated into the mode sections`).not.toContain(
        row.id,
      );
      const appearances = sections.flatMap((section) =>
        section.rows.filter((candidate) => candidate.id === row.id),
      );
      expect(appearances.length, row.id).toBe(1);
    }
    // Every binding is still reachable: the split partitions the list, it does
    // not shorten it.
    const ids = new Set(sections.flatMap((section) => section.rows.map((row) => row.id)));
    expect(ids.size).toBe(allRows.length);
  });

  it('drops a section with nothing in it rather than titling an empty one', () => {
    expect(shortcutSections([])).toEqual([]);
  });
});

describe('the keyboard panel draws that split', () => {
  it('gives each mode its own section, at the same heading level as a group', () => {
    open();
    for (const mode of CURSOR_MODES) {
      const section = sectionOf(mode);
      expect(section, mode).not.toBeNull();
      expect(section?.querySelector('h4')?.textContent).toBe(MODE_TITLES[mode]);
    }
    // One heading style, not a new one: every section in this panel, mode or
    // group, is the same element with the same classes.
    const headings = [...document.querySelectorAll<HTMLElement>('[data-shortcut-section] h4')];
    expect(headings.length).toBeGreaterThan(CURSOR_MODES.length);
    expect(new Set(headings.map((heading) => heading.className)).size).toBe(1);
  });

  it('shows each mode’s own caption for a binding that means two things', () => {
    open();
    const row = dependent[0];
    expect(row).toBeDefined();
    for (const mode of CURSOR_MODES) {
      expect(sectionOf(mode)?.textContent).toContain(row?.byMode?.[mode]);
    }
  });

  it('arms one capture box, even though the binding is drawn in both modes', () => {
    open();
    const row = dependent[0];
    const slots = [...document.querySelectorAll<HTMLElement>(`[data-binding-slot="${row?.id}:0"]`)];
    // Drawn twice on purpose -- it is one binding with two meanings.
    expect(slots.length).toBe(CURSOR_MODES.length);
    fireEvent.click(slots[0] as HTMLElement);
    // ...but armed once: two boxes each taking the next keystroke is two
    // things fighting for one keyboard.
    expect(document.querySelectorAll('[data-binding-capture]').length).toBe(1);
    expect(sectionOf(CURSOR_MODES[0])?.querySelector('[data-binding-capture]')).not.toBeNull();
  });
});
