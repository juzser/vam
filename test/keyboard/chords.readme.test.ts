/**
 * Ties `README.md`'s "Keyboard reference" table to the bindings
 * `src/renderer/keyboard/chords.ts` actually ships, so the two can only say
 * the same thing.
 *
 * The README used to claim this table was "generated from that file, not
 * hand-maintained" while nothing generated it and nothing checked it against
 * the source -- and it had already drifted: `?` (`kind: 'help'`) is a real
 * top-level binding in `SINGLE` with no README row at all, found by a human
 * re-reading the table by eye. This test is what makes a version of that
 * claim true: it reads `BINDING_TABLES`, the same object `resolveChord` and
 * the in-app `?` sheet (`buildKeySheet`) both build off, and the table's own
 * `Key`/`Chord` columns -- never a hand-copied list standing in for either
 * side, which is exactly how the `?` row went missing the first time.
 *
 * BLIND SPOT: this reads the shipped DEFAULTS only, never an operator's
 * `KeyBindings` override, and only the `Key` and `Chord` column of the two
 * tables under "## Keyboard reference" -- a key mentioned in backticks
 * elsewhere in the README's prose is not read at all, by construction
 * (`readmeTableKeys` only ever looks inside column 1 of a matched table).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BINDING_TABLES, chordText } from '../../src/renderer/keyboard/chords.js';

const README = fileURLToPath(new URL('../../README.md', import.meta.url));

/**
 * `resolveChord` checks this before either binding table is consulted --
 * "Escape always wins" is the function's own comment -- so it is a real,
 * documented top-level keystroke that never appears in `BINDING_TABLES` and
 * has to be named here by hand, once, rather than invented by a sweep that
 * cannot see a hardcoded `if`.
 */
const ESCAPE_CANCELS = 'Escape';

/** Every chord the shipped grammar actually binds, spelled the way `chordText` spells it. */
function shippedChords(): string[] {
  const out: string[] = [];
  for (const { prefix, table } of BINDING_TABLES) {
    for (const key of Object.keys(table)) {
      out.push(chordText({ prefix, key }));
    }
  }
  out.push(ESCAPE_CANCELS);
  return out;
}

/**
 * The literal backtick-quoted tokens in one markdown table's first column --
 * the `Key` column of the single-key table, or the `Chord` column of the
 * chord-prefix table beneath it. Reads ONLY that column, never the
 * `Action`/description column beside it, so a key named in passing in the
 * prose ("`Mod-9` is always the last one") is never counted as a row.
 */
function readmeTableKeys(heading: 'Key' | 'Chord'): string[] {
  const lines = readFileSync(README, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith(`| ${heading} |`));
  if (start === -1) {
    throw new Error(`README.md has no "| ${heading} | ... |" table header`);
  }
  const out: string[] = [];
  // Row start+1 is the `|---|---|` rule; data begins at start+2 and ends at
  // the first line that is no longer a table row (a blank line, in practice).
  for (
    let i = start + 2;
    i < lines.length && (lines[i] ?? '').trimStart().startsWith('|');
    i += 1
  ) {
    const keyColumn = (lines[i] ?? '').split('|')[1] ?? '';
    for (const match of keyColumn.matchAll(/`([^`]+)`/g)) {
      out.push(match[1] as string);
    }
  }
  return out;
}

describe('README.md keyboard reference matches the shipped grammar', () => {
  it('finds a non-empty binding table in chords.ts', () => {
    // A sweep that examined nothing passes every assertion below for the
    // wrong reason -- the standing lesson this test exists to not repeat.
    expect(shippedChords().length).toBeGreaterThan(0);
  });

  it('finds a non-empty Key column and a non-empty Chord column in README.md', () => {
    expect(readmeTableKeys('Key').length).toBeGreaterThan(0);
    expect(readmeTableKeys('Chord').length).toBeGreaterThan(0);
  });

  it('gives every shipped key and chord a README row', () => {
    const documented = new Set([...readmeTableKeys('Key'), ...readmeTableKeys('Chord')]);
    const missing = shippedChords().filter((chord) => !documented.has(chord));
    expect(missing, 'bound in chords.ts but missing a README row').toEqual([]);
  });

  it('documents no key or chord the grammar does not actually bind', () => {
    const shipped = new Set(shippedChords());
    const stale = [...readmeTableKeys('Key'), ...readmeTableKeys('Chord')].filter(
      (chord) => !shipped.has(chord),
    );
    expect(stale, 'a README row names a key/chord chords.ts does not bind').toEqual([]);
  });
});
