/**
 * `font-scan.ts`'s own three pieces, apart from the two callers
 * (`list-monospace.ts`, `list-sans.ts`) that already exercise the directory
 * walk end to end: `matchesHint`, the space-insensitive comparison a real
 * macOS filename needs (`HelveticaNeue.ttc` carries no separator at all
 * between its two words, unlike a hyphenated test fixture).
 */

import { describe, expect, it } from 'vitest';
import { familyFromFilename, matchesHint } from '../../../src/main/fonts/font-scan.js';

describe('matchesHint', () => {
  it('matches a hyphen-separated family the same way a plain substring check would', () => {
    expect(matchesHint('Andale Mono', 'andale mono')).toBe(true);
  });

  it('matches a REAL macOS filename with no separator between its two words at all', () => {
    // `familyFromFilename('AndaleMono.ttf')` -- see the test right below --
    // leaves the family run together; the hint is still spelled with a
    // space, which is the exact mismatch this function exists to bridge.
    expect(matchesHint('AndaleMono', 'andale mono')).toBe(true);
    expect(matchesHint('HelveticaNeue', 'helvetica neue')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesHint('MENLO', 'menlo')).toBe(true);
  });

  it('is false when the hint is genuinely absent', () => {
    expect(matchesHint('Helvetica', 'andale mono')).toBe(false);
  });
});

describe('familyFromFilename', () => {
  it('leaves two camel-cased words run together, exactly as macOS ships them', () => {
    expect(familyFromFilename('HelveticaNeue.ttc')).toBe('HelveticaNeue');
    expect(familyFromFilename('AndaleMono.ttf')).toBe('AndaleMono');
  });
});
