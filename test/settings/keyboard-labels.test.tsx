// @vitest-environment happy-dom

/**
 * Settings -> Keyboard says what every bound key does (events #12 and #14).
 *
 * The Insert rows for Cmd-D / Cmd-U used to read 'nothing here', and Esc had no
 * row at all. The expected reserved set is derived from `RESERVED_KEYS` and
 * `PREFIXES`, never hand-copied.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  chordText,
  defaultBindings,
  EMPTY_CHORD,
  PREFIXES,
  RESERVED_KEYS,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildBindingSheet, buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { shortcutSections } from '../../src/renderer/settings/sections.js';

afterEach(cleanup);

const sections = () => shortcutSections(buildBindingSheet({}));
const rowsIn = (id: string) => sections().find((s) => s.id === id)?.rows ?? [];
const reservedKeys = RESERVED_KEYS.filter((key) => !(PREFIXES as readonly string[]).includes(key));
const HALF_PAGE =
  /^vam does not scroll here — the key stays with whatever holds the keyboard\. To scroll half a screen (down|up), leave Insert, then press the same key$/;

describe('EC-19: the Insert rows for Cmd-D and Cmd-U', () => {
  it('carries no "nothing here" label in the Insert section', () => {
    const insert = rowsIn('insert');
    expect(insert.length).toBeGreaterThan(0);
    for (const row of insert) expect(row.label, row.id).not.toMatch(/nothing here/i);
  });

  it('gives Mod-d and Mod-u two distinct, spec-verbatim labels', () => {
    const insert = rowsIn('insert');
    const down = insert.find((row) => row.keys.includes('Mod-d'))?.label;
    const up = insert.find((row) => row.keys.includes('Mod-u'))?.label;
    expect(down).toMatch(HALF_PAGE);
    expect(up).toMatch(HALF_PAGE);
    expect(down).toContain('half a screen down');
    expect(up).toContain('half a screen up');
    expect(down).not.toBe(up);
  });

  it('keeps the ? sheet free of "nothing here" too', () => {
    for (const group of buildKeySheet({})) {
      for (const row of group.rows) expect(row.label).not.toMatch(/nothing here/i);
    }
  });
});

describe('EC-20: reserved keys have read-only rows', () => {
  it('derives the reserved set from RESERVED_KEYS minus PREFIXES', () => {
    expect(reservedKeys).toEqual(['Escape', 'Mod-[']);
    const all = buildBindingSheet({}).flatMap((group) => [
      ...group.rows,
      ...(group.reserved ?? []),
    ]);
    const rowKeys = new Set(all.flatMap((row) => row.keys));
    const expected = [
      ...defaultBindings().flatMap((binding) => binding.chords.map(chordText)),
      ...reservedKeys,
    ];
    for (const key of expected) expect(rowKeys.has(key), key).toBe(true);
    for (const prefix of PREFIXES) {
      const reserved = all.filter((row) => row.reserved === true && row.keys.includes(prefix));
      expect(reserved, prefix).toEqual([]);
    }
  });

  it('puts Escape in Select and Insert, and Mod-[ only where it acts (Insert)', () => {
    expect(resolveChord(EMPTY_CHORD, 'Escape').action).toEqual({ kind: 'cancel' });
    expect(resolveChord(EMPTY_CHORD, 'Mod-[').action).toBeNull();
    const reserved = (id: string) => rowsIn(id).filter((row) => row.reserved === true);
    expect(reserved('select').map((row) => row.keys[0])).toEqual(['Escape']);
    expect(reserved('insert').map((row) => row.keys[0])).toEqual(['Escape', 'Mod-[']);
  });

  it('reads the uiux copy and never "nothing here"', () => {
    const label = (id: string, key: string) =>
      rowsIn(id).find((row) => row.reserved === true && row.keys[0] === key)?.label;
    expect(label('select', 'Escape')).toBe(
      'close whatever is open — palette, settings, filter, rename — and return to the session list',
    );
    expect(label('insert', 'Escape')).toBe('Leave Insert');
    expect(label('insert', 'Mod-[')).toBe('Leave Insert');
    for (const section of sections())
      for (const row of section.rows) expect(row.label).not.toMatch(/nothing here/i);
  });

  it('places reserved rows after the ordinary rows of their section', () => {
    for (const id of ['select', 'insert']) {
      const rows = rowsIn(id);
      const first = rows.findIndex((row) => row.reserved === true);
      expect(first).toBeGreaterThan(0);
      expect(rows.slice(first).every((row) => row.reserved === true)).toBe(true);
    }
  });

  it('keeps the ? sheet free of reserved rows', () => {
    const rows = buildKeySheet({}).flatMap((group) => group.rows);
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) {
      expect(row).not.toHaveProperty('reserved');
      expect(row.keys).not.toBe('Escape');
      expect(row.keys).not.toBe('Mod-[');
    }
  });

  it('keeps reserved rows fixed under an unbound action and out of the group sections', () => {
    const unbound = shortcutSections(buildBindingSheet({ 'scrollHalf:1': [] }));
    const reservedOf = (id: string) =>
      (unbound.find((s) => s.id === id)?.rows ?? []).filter((row) => row.reserved === true);
    expect(reservedOf('select').map((row) => row.keys[0])).toEqual(['Escape']);
    expect(reservedOf('insert').map((row) => row.keys[0])).toEqual(['Escape', 'Mod-[']);
    for (const section of sections().filter((s) => s.id !== 'select' && s.id !== 'insert'))
      for (const row of section.rows)
        expect(row.reserved, `${section.id}/${row.id}`).toBeUndefined();
  });

  it('renders no rebind control on a reserved row, but keeps one on Mod-d', () => {
    render(
      <SettingsOverlay
        prefs={EMPTY_PREFS}
        theme="dark"
        onChange={() => {}}
        onClose={() => {}}
        initialSection="keyboard"
      />,
    );
    const lines = (section: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-shortcut-section="${section}"] li`));
    const reservedLines = [...lines('select'), ...lines('insert')].filter((li) =>
      li.querySelector('[data-binding-label^="reserved:"]'),
    );
    expect(reservedLines).toHaveLength(3);
    for (const li of reservedLines) {
      expect(li.querySelectorAll('[data-binding-slot]')).toHaveLength(0);
      expect(li.querySelectorAll('[data-binding-capture]')).toHaveLength(0);
      expect(li.querySelectorAll('[data-binding-reset]')).toHaveLength(0);
    }
    const ordinary = lines('insert').find((li) =>
      li.querySelector('[data-binding-label="scrollHalf:1"]'),
    );
    expect(ordinary?.querySelectorAll('[data-binding-slot]').length).toBeGreaterThan(0);
  });
});
