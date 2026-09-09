/**
 * `Alt+<digit>` is a BINDING now, not a literal in a caption.
 *
 * It used to be a bare `window` listener in `DetailPanel.tsx` that matched
 * `event.code` itself, and the cost of living outside `BINDING_TABLES` was
 * four separate defects: the key sheet — whose whole contract is "every
 * binding is here" — listed none of the four working chords; the operator
 * could rebind `Mod-<digit>` but not these; the chord had to be written into
 * the accessible name by hand, where a screen reader repeated it on every
 * focus and no rebind could ever correct it; and an operator override was
 * free to take `Alt-1` for something else, after which the override and the
 * listener would BOTH answer one keystroke.
 *
 * This file replaces `alt-digit-is-free.test.ts`, whose central assertion
 * ("the shipped grammar binds no `Alt-` key at all") was the pre-promotion
 * state and is now deliberately false. Its one still-live guard — that the
 * two registries a comment once cited, `DELIBERATELY_FREE` and
 * `UNREACHABLE_KEYS`, have never existed and must not be named again —
 * survives below, because a citation to nothing is the defect that made
 * promotion necessary in the first place.
 *
 * Everything here reads the GENERATED sheet and the RESOLVED chord rather
 * than the table literal, so a test cannot pass by agreeing with the line of
 * source it was written beside.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BINDING_TABLES,
  bindKey,
  defaultBindings,
  EMPTY_CHORD,
  normalizeKey,
  RESERVED_KEYS,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
import { primaryChord } from '../../src/renderer/keyboard/ShortcutTip.js';
import { TABS } from '../../src/renderer/panels/tabs.js';

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Every row of the generated sheet, flattened out of its groups. */
const sheetRows = () => buildKeySheet().flatMap((group) => group.rows);

describe('the view digits are in the binding tables, so the key sheet can find them', () => {
  it('gives every named view a row of its own in the GENERATED sheet', () => {
    const rows = sheetRows();
    // The corpus first: this file's assertions are vacuous over an empty
    // sheet, and a sweep that examined nothing is how a guard goes green for
    // the wrong reason.
    expect(rows.length).toBeGreaterThan(30);
    for (const [index, name] of TABS.entries()) {
      const row = rows.find((each) => each.keys === `Alt-${index + 1}`);
      expect(row, `no sheet row for Alt-${index + 1}`).toBeDefined();
      // The caption names the VIEW, not a digit — a row reading "position 3"
      // over a bar of icons is the caption that lies.
      expect(row?.label).toContain(name);
    }
  });

  it('binds all nine digits, so the refusal for a digit past the last view is reachable', () => {
    const keys = sheetRows().map((row) => row.keys);
    for (const digit of DIGITS) {
      expect(keys, `Alt-${digit} is unbound`).toContain(`Alt-${digit}`);
    }
  });

  it('resolves a real Alt+<digit> keydown to the view action, off the physical key', () => {
    // `event.code`, so a French layout with `&` on the `1` key still lands
    // here — the property `normalizeKey`'s digit-row exception exists for.
    const key = normalizeKey({ key: '&', code: 'Digit1', altKey: true });
    expect(key).toBe('Alt-1');
    expect(resolveChord(EMPTY_CHORD, key ?? '').action).toEqual({ kind: 'pickView', digit: 1 });
  });

  it('is primaryChord-resolvable, which is what lets a tooltip derive it', () => {
    expect(primaryChord({ kind: 'pickView', digit: 3 })).toBe('Alt-3');
  });

  it('is rebindable, and the OLD key stops working when it is rebound', () => {
    const overrides = bindKey({}, 'pickView:1', 0, 'q');
    expect(resolveChord(EMPTY_CHORD, 'q', overrides).action).toEqual({
      kind: 'pickView',
      digit: 1,
    });
    expect(resolveChord(EMPTY_CHORD, 'Alt-1', overrides).action).toBeNull();
  });
});

describe('what promotion had to leave true', () => {
  it('takes no chord another action already holds', () => {
    const seen = new Map<string, string>();
    for (const binding of defaultBindings()) {
      for (const chord of binding.chords) {
        const written = `${chord.prefix}${chord.key}`;
        const owner = seen.get(written);
        expect(owner, `${written} is bound to both ${owner} and ${binding.id}`).toBeUndefined();
        seen.set(written, binding.id);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it('leaves Mod-<digit> alone: two families, one row each, no shared spelling', () => {
    const tables = BINDING_TABLES.flatMap(({ prefix, table }) =>
      Object.entries(table).map(([key, action]) => [`${prefix}${key}`, action] as const),
    );
    for (const digit of DIGITS) {
      // The Cmd row's meaning changed under this file (it is the session tab
      // at that position now, not a context-dependent position); what this
      // guards is unchanged and is the reason the change was possible at all
      // -- the two families never share a spelling.
      expect(tables.find(([key]) => key === `Mod-${digit}`)?.[1]).toEqual({
        kind: 'selectTab',
        digit,
      });
      expect(tables.find(([key]) => key === `Alt-${digit}`)?.[1]).toEqual({
        kind: 'pickView',
        digit,
      });
    }
  });

  it('reserves nothing new — the chord doors are still the only protected keys', () => {
    expect([...RESERVED_KEYS]).toEqual(['Escape', 'g', 'y', 'z']);
  });

  it('never names a registry that does not exist', () => {
    // Both names appeared exactly once in this tree, in a comment claiming
    // they proved `Alt+<digit>` was free. An auditor following the citation
    // found nothing to read. They must not come back.
    for (const path of ['src/renderer/panels/DetailPanel.tsx', 'src/renderer/canvas/Canvas.tsx']) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(source, path).not.toContain('DELIBERATELY_FREE');
      expect(source, path).not.toContain('UNREACHABLE_KEYS');
    }
  });
});
