/**
 * Ties `docs/keyboard.md`'s two tables to the bindings
 * `src/renderer/keyboard/chords.ts` actually ships, so the two can only say
 * the same thing.
 *
 * THE TABLE LIVED IN `README.md` UNTIL THE README WAS CUT TO ~150 LINES; the
 * reference moved to `docs/keyboard.md` whole, and this test moved with it.
 * The claim it holds up is unchanged: the doc used to say the table was
 * "generated from that file, not hand-maintained" while nothing generated it
 * and nothing checked it against the source -- and it had already drifted:
 * `?` (`kind: 'help'`) is a real top-level binding in `SINGLE` that had no row
 * at all, found by a human re-reading the table by eye. This test is what
 * makes a version of that claim true: it reads `BINDING_TABLES`, the same
 * object `resolveChord` and the in-app `?` sheet (`buildKeySheet`) both build
 * off, and the table's own `Key`/`Chord` columns -- never a hand-copied list
 * standing in for either side, which is exactly how the `?` row went missing
 * the first time.
 *
 * THE README'S OWN TEN-ROW TABLE IS A SEPARATE SURFACE, and it is checked ONE
 * WAY ONLY -- see the last `it` below. Every chord it names must be a chord
 * vam binds, so a row cannot outlive its binding; but it is deliberately a
 * SUBSET, so "shipped and missing from the README" is not a failure there and
 * cannot be. Which ten are chosen, and the words beside them, are checked by
 * nothing.
 *
 * BLIND SPOT: this reads the shipped DEFAULTS only, never an operator's
 * `KeyBindings` override, and only the `Key` and `Chord` column of the two
 * tables in `docs/keyboard.md` -- a key mentioned in backticks elsewhere in
 * that file's prose (the "In a browser tab" list, for one) is not read at all,
 * by construction (`docTableKeys` only ever looks inside column 1 of a matched
 * table). The Files-tab table is held by its own test,
 * `files-tab.keyboard-doc.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BINDING_TABLES, chordText } from '../../src/renderer/keyboard/chords.js';

const KEYBOARD_DOC = fileURLToPath(new URL('../../docs/keyboard.md', import.meta.url));
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
function docTableKeys(heading: 'Key' | 'Chord', file = KEYBOARD_DOC): string[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith(`| ${heading} |`));
  if (start === -1) {
    throw new Error(`${file} has no "| ${heading} | ... |" table header`);
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

describe('docs/keyboard.md matches the shipped grammar', () => {
  it('finds a non-empty binding table in chords.ts', () => {
    // A sweep that examined nothing passes every assertion below for the
    // wrong reason -- the standing lesson this test exists to not repeat.
    expect(shippedChords().length).toBeGreaterThan(0);
  });

  it('finds a non-empty Key column and a non-empty Chord column in the doc', () => {
    expect(docTableKeys('Key').length).toBeGreaterThan(0);
    expect(docTableKeys('Chord').length).toBeGreaterThan(0);
  });

  it('gives every shipped key and chord a row in docs/keyboard.md', () => {
    const documented = new Set([...docTableKeys('Key'), ...docTableKeys('Chord')]);
    const missing = shippedChords().filter((chord) => !documented.has(chord));
    expect(missing, 'bound in chords.ts but missing a docs/keyboard.md row').toEqual([]);
  });

  it('documents no key or chord the grammar does not actually bind', () => {
    const shipped = new Set(shippedChords());
    const stale = [...docTableKeys('Key'), ...docTableKeys('Chord')].filter(
      (chord) => !shipped.has(chord),
    );
    expect(stale, 'a docs/keyboard.md row names a key/chord chords.ts does not bind').toEqual([]);
  });

  it("names no chord in the README's own ten-row table that the grammar does not bind", () => {
    // THE SECOND SURFACE, AND ONLY THIS DIRECTION. The README keeps ten rows
    // inline and links the rest; those ten are a subset by design, so the
    // "missing" check above cannot apply here. What can, and does: a row there
    // outliving the binding it was written for -- the same defect as a stale
    // caveat, on the page most people read instead of the reference.
    const shipped = new Set(shippedChords());
    const named = docTableKeys('Key', README);
    expect(named.length, 'a README Key table to read at all').toBeGreaterThan(0);
    expect(
      named.filter((chord) => !shipped.has(chord)),
      'a README row names a key/chord chords.ts does not bind',
    ).toEqual([]);
  });
});
