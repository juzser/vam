/**
 * THE TWO CURATED LISTS AGREE, MECHANICALLY -- `shared/fonts.ts`'s own
 * header explains why there are two copies at all (a renderer-safe module
 * cannot import `src/main/`, and a main-only scan predicate cannot import
 * `src/shared/` the other way without becoming renderer-reachable): this
 * file is what keeps a hand edit to one from silently drifting from the
 * other.
 */
import { describe, expect, it } from 'vitest';
import { SANS_HINTS } from '../../src/main/fonts/list-sans.js';
import { TERMINAL_FONT_CURATED, UI_FONT_CURATED } from '../../src/shared/fonts.js';

describe('UI_FONT_CURATED', () => {
  it('is the exact same eight names list-sans.ts scans for, in the same order', () => {
    expect(UI_FONT_CURATED).toEqual(SANS_HINTS);
  });

  it('names none of them the empty string — that sentinel is "System default", drawn separately', () => {
    expect(UI_FONT_CURATED.every((name) => name.trim().length > 0)).toBe(true);
  });
});

describe('TERMINAL_FONT_CURATED', () => {
  it('has at least the operator-named five, no duplicates', () => {
    expect(TERMINAL_FONT_CURATED).toEqual([...new Set(TERMINAL_FONT_CURATED)]);
    for (const name of ['SF Mono', 'Menlo', 'Monaco', 'Courier New', 'Andale Mono']) {
      expect(TERMINAL_FONT_CURATED).toContain(name);
    }
  });
});
