/**
 * THE UI FONT PICKER'S OWN SCAN (settings-views restructure, item G):
 * "UI Font ... becomes a dropdown ... desktop shows only installed fonts
 * (extend scan for sans names)."
 *
 * THE SAME MECHANISM `list-monospace.ts` ALREADY HAD, `font-scan.ts` now
 * shares between them -- what differs is the word list. `MONOSPACE_HINTS`
 * is generic substrings ("mono", "code") every mainstream monospace family
 * carries; a UI/display font has no such shared vocabulary (nothing links
 * "Optima" and "Futura" by name), so `SANS_HINTS` is the CURATED list
 * itself, spelled once here and reused by `shared/fonts.ts` as the browser
 * build's own fallback when no scan is possible at all.
 */

import { describe, expect, it } from 'vitest';
import { listSansFontFamilies, SANS_HINTS } from '../../../src/main/fonts/list-sans.js';

function fakeFs(byDir: Record<string, readonly string[]>) {
  return {
    readdirSync(path: string): string[] {
      const entries = byDir[path];
      if (entries === undefined) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      }
      return [...entries];
    },
  };
}

describe('listSansFontFamilies', () => {
  it('is total: a directory that does not exist costs nothing', () => {
    const fs = fakeFs({});
    expect(listSansFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs })).toEqual([]);
  });

  it('finds a curated UI family by its filename and cleans up the name', () => {
    const fs = fakeFs({
      '/System/Library/Fonts': ['HelveticaNeue.ttc', 'Menlo.ttc'],
      '/Library/Fonts': [],
      '/Users/op/Library/Fonts': ['GillSans.ttc', 'AvenirNext-Regular.ttf'],
    });
    const families = listSansFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs });
    // NOT "Helvetica Neue" (a space) -- `familyFromFilename` only turns
    // `-`/`_` back into spaces, and Apple's own filename has neither, the
    // same reason `list-monospace.test.ts`'s own "Menlo.ttc" case never
    // gained a space either. The hint still matches: `looksSans` compares
    // against the RUN-TOGETHER form too (see `SANS_HINTS`'s own comment).
    expect(families).toContain('HelveticaNeue');
    expect(families).not.toContain('Menlo');
    expect(families).toContain('GillSans');
    expect(families).toContain('AvenirNext');
  });

  it('de-duplicates a family whose regular/bold/italic all shipped as separate files', () => {
    const fs = fakeFs({
      '/System/Library/Fonts': ['Optima-Regular.ttf', 'Optima-Bold.ttf', 'Optima-Italic.ttf'],
      '/Library/Fonts': [],
      '/Users/op/Library/Fonts': [],
    });
    const families = listSansFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs });
    expect(families.filter((name) => name === 'Optima')).toHaveLength(1);
  });

  it('ignores a non-font file, and a font that is not on the curated list', () => {
    const fs = fakeFs({
      '/System/Library/Fonts': ['Futura.ttc', 'readme.txt', 'Menlo.ttc'],
      '/Library/Fonts': [],
      '/Users/op/Library/Fonts': [],
    });
    expect(listSansFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs })).toEqual([
      'Futura',
    ]);
  });

  it('is sorted, so the picker is not at the mercy of directory order', () => {
    const fs = fakeFs({
      '/System/Library/Fonts': ['Verdana.ttf', 'Futura.ttc'],
      '/Library/Fonts': [],
      '/Users/op/Library/Fonts': [],
    });
    const families = listSansFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs });
    expect(families).toEqual([...families].sort((a, b) => a.localeCompare(b)));
  });

  it('recognises every curated hint at least once against a synthetic filename', () => {
    // THE SAME SWEEP `list-monospace.test.ts` HOLDS, for the identical
    // reason: a guard that cannot fail on its own corpus is not a guard.
    expect(SANS_HINTS.length).toBeGreaterThanOrEqual(8);
    for (const hint of SANS_HINTS) {
      const filename = `${hint.replace(/\s+/g, '-')}-Regular.ttf`;
      const fs = fakeFs({
        '/System/Library/Fonts': [filename],
        '/Library/Fonts': [],
        '/Users/op/Library/Fonts': [],
      });
      const families = listSansFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs });
      expect(families.length, `hint "${hint}" matched nothing from "${filename}"`).toBeGreaterThan(
        0,
      );
    }
  });
});
