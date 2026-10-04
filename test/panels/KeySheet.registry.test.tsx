// @vitest-environment happy-dom

/**
 * THE `?` SHEET IS THE REGISTRY, LAID OUT IN TWO COLUMNS.
 *
 * Two questions, both asked of the rendered sheet:
 *
 *   COMPLETENESS (EC-16). The rows expected are computed here from
 *   `BINDING_TABLES` and the Files key lists by the builder's own count rule,
 *   with no hand-copied list, and the sheet must draw exactly those rows —
 *   each once, in its group, with the mode tag it is true in. Reserved keys
 *   are the Settings page's, never this sheet's.
 *
 *   LAYOUT (EC-17). happy-dom lays nothing out, so the class names are the
 *   contract: the wider panel, the `lg` two-column flow, and a section that
 *   refuses to split across the column break. The rectangles themselves are
 *   measured by `e2e/key-sheet-shots.mjs`.
 *
 * MUTATION TARGET: drop one section from the render and the completeness
 * test reddens; put back `w-[min(620px,92vw)]` and the layout test does.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BINDING_TABLES,
  chordSymbols,
  isSelectOnlyChord,
  NO_BINDINGS,
  PREFIXES,
  parseChord,
  RESERVED_KEYS,
  setActiveBindings,
} from '../../src/renderer/keyboard/chords.js';
import {
  CURSOR_MODES,
  describeAction,
  GROUP_ORDER,
  MODE_TITLES,
} from '../../src/renderer/keyboard/keysheet.js';
import { EDITOR_KEYS, TREE_KEYS } from '../../src/renderer/panels/files-tree.js';
import { KeySheet } from '../../src/renderer/panels/KeySheet.js';
import { PC_PLATFORM, withPlatform } from '../support/platform.js';

afterEach(() => {
  cleanup();
  setActiveBindings(NO_BINDINGS);
});

const SECTION_ORDER = [...GROUP_ORDER, 'files'];

/** One row as `group|mode|label|keys`; Files rows carry no caption of their own here. */
type Expected = { readonly group: string; readonly mode: string | null; readonly text: string };

/** The rows the registry says the sheet has, counted the way `buildKeySheet` emits them. */
function expectedRows(): Expected[] {
  const rows: Expected[] = [];
  for (const { prefix, table } of BINDING_TABLES) {
    for (const [key, action] of Object.entries(table)) {
      const chord = `${prefix}${key}`;
      const { group, label, byMode } = describeAction(action);
      const symbols = chordSymbols(chord, false);
      if (isSelectOnlyChord(parseChord(chord))) {
        // A bare digit: one Select row, whatever the action's captions say.
        rows.push({
          group,
          mode: 'select',
          text: `${MODE_TITLES.select} · ${label}|${symbols}`,
        });
      } else if (byMode === null) {
        // Acts in both modes: one mode-null row, counted once.
        rows.push({ group, mode: null, text: `${label}|${symbols}` });
      } else {
        for (const mode of CURSOR_MODES) {
          rows.push({
            group,
            mode,
            text: `${MODE_TITLES[mode]} · ${byMode[mode]}|${symbols}`,
          });
        }
      }
    }
  }
  for (const key of new Set([...TREE_KEYS, ...EDITOR_KEYS])) {
    rows.push({ group: 'files', mode: null, text: `|${chordSymbols(key, false)}` });
  }
  return rows;
}

const describe_ = (row: Expected) => `${row.group}|${row.text}`;

/** What the rendered sheet draws, section by section, in the same shape. */
function renderedRows(): string[] {
  const out: string[] = [];
  for (const section of document.querySelectorAll('[data-key-sheet-groups] section')) {
    const group = section.querySelector('h3')?.getAttribute('data-key-sheet-group') ?? '';
    for (const li of section.querySelectorAll('li')) {
      const label = li.querySelector('[data-key-sheet-label]')?.textContent ?? '';
      const keys = li.querySelector('[data-key-sheet-keys]')?.textContent ?? '';
      out.push(`${group}|${group === 'files' ? '' : label}|${keys}`);
    }
  }
  return out;
}

describe('the sheet is the registry (EC-16)', () => {
  it('draws every registered row exactly once, in its group, and no more', () => {
    withPlatform(PC_PLATFORM, () => {
      render(<KeySheet onClose={() => {}} />);
      const expected = expectedRows().map(describe_).sort();
      expect(expected.length).toBeGreaterThan(80);
      expect(renderedRows().sort()).toEqual(expected);
      expect(document.querySelectorAll('[data-key-sheet-groups] li')).toHaveLength(expected.length);
    });
  });

  it('draws one section per group, in GROUP_ORDER and then files', () => {
    render(<KeySheet onClose={() => {}} />);
    const headings = [...document.querySelectorAll('h3[data-key-sheet-group]')].map((h3) =>
      h3.getAttribute('data-key-sheet-group'),
    );
    expect(headings).toEqual(SECTION_ORDER);
  });

  it('keeps the reserved keys off the sheet', () => {
    withPlatform(PC_PLATFORM, () => {
      render(<KeySheet onClose={() => {}} />);
      // The criterion allows PREFIXES chords; every other RESERVED_KEYS entry
      // may appear in no row. ONE NARROWER EXEMPTION, stated and pinned: the
      // files section paints Escape and Mod-[ because they are that tab's own
      // way out (EDITOR_KEYS) — no other row anywhere may, and no other
      // reserved chord may appear in the files section either.
      const reserved = RESERVED_KEYS.filter(
        (key) => !(PREFIXES as readonly string[]).includes(key),
      );
      expect(reserved.length).toBeGreaterThan(0);
      const filesOwn = ['Escape', 'Mod-['];
      expect(filesOwn.every((key) => reserved.includes(key) && EDITOR_KEYS.includes(key))).toBe(
        true,
      );
      let rows = 0;
      for (const section of document.querySelectorAll('[data-key-sheet-groups] section')) {
        const group = section.querySelector('h3')?.getAttribute('data-key-sheet-group');
        for (const k of section.querySelectorAll('[data-key-sheet-keys]')) {
          rows++;
          for (const key of reserved) {
            if (group === 'files' && filesOwn.includes(key)) continue;
            expect(k.textContent, `${group}: reserved ${key}`).not.toBe(chordSymbols(key, false));
          }
        }
      }
      expect(rows).toBeGreaterThan(80);
      expect(document.querySelector('[data-reserved]')).toBeNull();
    });
  });
});

describe('the sheet lays out in two columns (EC-17)', () => {
  it('is wide and tall, and flows its sections in two columns from lg', () => {
    render(<KeySheet onClose={() => {}} />);
    const panel = document.querySelector('[data-key-sheet] > div:not([aria-label])');
    expect(panel?.classList.contains('w-[min(1040px,94vw)]')).toBe(true);
    expect(panel?.classList.contains('max-h-[85vh]')).toBe(true);
    expect(panel?.classList.contains('w-[min(620px,92vw)]')).toBe(false);
    expect(panel?.classList.contains('max-h-[80vh]')).toBe(false);
    const groups = document.querySelector('[data-key-sheet-groups]');
    expect(groups?.classList.contains('lg:grid-cols-2')).toBe(true);
    expect(groups?.classList.contains('lg:gap-x-8')).toBe(true);
    // Below lg the default single column applies: no unprefixed grid/column class.
    expect([...(groups?.classList ?? [])].filter((c) => /^(columns-|grid)/.test(c))).toEqual([]);
  });

  it('keeps every section whole across the column break', () => {
    render(<KeySheet onClose={() => {}} />);
    const sections = [...document.querySelectorAll('[data-key-sheet-groups] section')];
    expect(sections).toHaveLength(SECTION_ORDER.length);
    for (const section of sections) {
      expect(section.classList.contains('break-inside-avoid')).toBe(true);
    }
  });

  it('drops the top rule on the first section of each column, keeps it on the rest', () => {
    render(<KeySheet onClose={() => {}} />);
    const sections = [...document.querySelectorAll('[data-key-sheet-groups] section')];
    expect(sections[0]?.classList.contains('border-t')).toBe(false);
    expect(sections.filter((s) => s.classList.contains('lg:border-0'))).toHaveLength(1);
    // Every section but the very first keeps its rule below lg.
    expect(sections.filter((s) => s.classList.contains('border-t'))).toHaveLength(
      sections.length - 1,
    );
  });
});
