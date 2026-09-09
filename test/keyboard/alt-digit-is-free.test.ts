/**
 * What actually keeps `Alt+<digit>` from colliding with the chord grammar.
 *
 * `DetailPanel.tsx`'s view-switch listener used to justify itself by citing
 * `DELIBERATELY_FREE` and `UNREACHABLE_KEYS` in `chords.ts`. NEITHER HAS EVER
 * EXISTED: both names appear exactly once in the tree, in that sentence. So
 * shipped code claimed a registry promised the combination was free, and an
 * auditor following the citation found nothing to read.
 *
 * This is the guard for the corrected claim, which is weaker than the one it
 * replaces and says so:
 *
 *   - the SHIPPED grammar binds no `Alt-` key at all. `BINDING_TABLES` is the
 *     one enumeration of its surface (the shortcut sheet is built by walking
 *     it), so scanning it is scanning the whole grammar.
 *   - `normalizeKey` really does spell the combination `Alt-<digit>` off
 *     `event.code`, so a collision would be a collision of equal names rather
 *     than two spellings passing each other.
 *   - and nothing FORBIDS one. `RESERVED_KEYS` is `['Escape', ...PREFIXES]`;
 *     it protects the chord doors, not this. An operator override may bind
 *     `Alt-1`, and then both the override and the pane's own listener would
 *     answer one keystroke. That is a real hole, it is not what this PR is
 *     for, and the comment now says so instead of citing a registry that
 *     would have closed it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BINDING_TABLES, normalizeKey, RESERVED_KEYS } from '../../src/renderer/keyboard/chords.js';

describe('Alt+<digit> is free, for the reasons the comment now gives', () => {
  it('names no registry that does not exist', () => {
    const panel = readFileSync(
      resolve(process.cwd(), 'src/renderer/panels/DetailPanel.tsx'),
      'utf8',
    );
    expect(panel).not.toContain('DELIBERATELY_FREE');
    expect(panel).not.toContain('UNREACHABLE_KEYS');
  });

  it('binds no Alt- key anywhere in the shipped grammar', () => {
    const keys = BINDING_TABLES.flatMap(({ prefix, table }) =>
      Object.keys(table).map((key) => `${prefix}${key}`),
    );
    // The corpus first: this assertion is vacuous over an empty table list,
    // and a sweep that examined nothing is how a guard passes for the wrong
    // reason.
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((key) => key.includes('Alt-'))).toEqual([]);
  });

  it('spells the combination Alt-<digit>, off the physical key', () => {
    // `event.code`, so a French or Dvorak layout that puts a symbol on the
    // `1` key still produces `Alt-1` -- which is what makes the name above a
    // name and not a coincidence of layout.
    expect(normalizeKey({ key: '&', code: 'Digit1', altKey: true })).toBe('Alt-1');
    expect(normalizeKey({ key: '9', code: 'Digit9', altKey: true })).toBe('Alt-9');
  });

  it('is not protected by RESERVED_KEYS, which is the weak half', () => {
    // Written down as an assertion rather than as a hope: if a later change
    // DOES reserve it, this test is where the comment gets corrected.
    expect([...RESERVED_KEYS]).toEqual(['Escape', 'g', 'y', 'z']);
    expect(RESERVED_KEYS.some((key) => key.startsWith('Alt-'))).toBe(false);
  });
});
