/**
 * FONT ENUMERATION, THE "SAFE LOCAL MECHANISM" THE BRIEF ASKED FOR.
 *
 * There is no Electron or Node API that lists installed fonts, and Chromium's
 * own `queryLocalFonts()` (the Local Font Access API) is a RENDERER-side,
 * permission-gated web API aimed at a page asking a person for consent —
 * wrong shape for a desktop app's own Settings row, and unavailable at all
 * over Tailscale Serve on a browser that has not granted it. So this reads
 * the filesystem instead: the well-known font directories for the platform
 * it is running on, filtered to filenames that LOOK monospace by name.
 *
 * A HEURISTIC, NAMED AS ONE. There is no reliable way to ask a filename alone
 * whether the font it names is fixed-pitch without parsing the font's own
 * `post` table — out of scope for a Settings row whose whole other half is a
 * free-text fallback for exactly the fonts this misses. `MONOSPACE_HINTS` is
 * a curated list of terms every mainstream monospace family's name carries;
 * anything this does not recognise is still reachable by typing it in.
 *
 * INJECTED `fs`, NEVER THE REAL ONE, so this is testable without a real
 * filesystem and without `vi.mock('node:fs')` — the same `ZoomLockable`-shaped
 * narrow interface every main-process module in this repo takes for the
 * identical reason.
 */

import { describe, expect, it } from 'vitest';
import {
  fontDirectoriesFor,
  listMonospaceFontFamilies,
  MONOSPACE_HINTS,
} from '../../../src/main/fonts/list-monospace.js';

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

describe('fontDirectoriesFor', () => {
  it('names macOS’s three system/user font directories', () => {
    const dirs = fontDirectoriesFor('darwin', '/Users/op');
    expect(dirs).toContain('/System/Library/Fonts');
    expect(dirs).toContain('/Library/Fonts');
    expect(dirs).toContain('/Users/op/Library/Fonts');
  });

  it('names Linux’s system and per-user font directories', () => {
    const dirs = fontDirectoriesFor('linux', '/home/op');
    expect(dirs).toContain('/usr/share/fonts');
    expect(dirs).toContain('/home/op/.local/share/fonts');
  });

  it('names Windows’s font directory', () => {
    const dirs = fontDirectoriesFor('win32', 'C:\\Users\\op');
    expect(dirs.some((dir) => dir.includes('Fonts'))).toBe(true);
  });

  it('falls back to the Linux list for a platform it does not otherwise know', () => {
    expect(fontDirectoriesFor('sunos', '/home/op')).toEqual(
      fontDirectoriesFor('linux', '/home/op'),
    );
  });
});

describe('listMonospaceFontFamilies', () => {
  it('is total: a directory that does not exist costs nothing', () => {
    const fs = fakeFs({});
    expect(listMonospaceFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs })).toEqual([]);
  });

  it('finds a monospace family by its filename and cleans up the name', () => {
    const fs = fakeFs({
      '/System/Library/Fonts': ['Menlo.ttc', 'Helvetica.ttc'],
      '/Library/Fonts': [],
      '/Users/op/Library/Fonts': ['JetBrainsMono-Regular.ttf', 'FiraCode-Bold.otf'],
    });
    const families = listMonospaceFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs });
    expect(families).toContain('Menlo');
    expect(families).not.toContain('Helvetica');
    expect(families).toContain('JetBrainsMono');
    expect(families).toContain('FiraCode');
  });

  it('de-duplicates a family whose regular/bold/italic all shipped as separate files', () => {
    const fs = fakeFs({
      '/System/Library/Fonts': ['Menlo-Regular.ttf', 'Menlo-Bold.ttf', 'Menlo-Italic.ttf'],
      '/Library/Fonts': [],
      '/Users/op/Library/Fonts': [],
    });
    const families = listMonospaceFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs });
    expect(families.filter((name) => name === 'Menlo')).toHaveLength(1);
  });

  it('ignores a non-font file sitting in a font directory', () => {
    const fs = fakeFs({
      '/System/Library/Fonts': ['Menlo.ttc', 'readme.txt', '.DS_Store'],
      '/Library/Fonts': [],
      '/Users/op/Library/Fonts': [],
    });
    expect(listMonospaceFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs })).toEqual([
      'Menlo',
    ]);
  });

  it('is sorted, so the picker is not at the mercy of directory order', () => {
    const fs = fakeFs({
      '/System/Library/Fonts': ['Monaco.ttf', 'Consolas.ttf'],
      '/Library/Fonts': [],
      '/Users/op/Library/Fonts': [],
    });
    const families = listMonospaceFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs });
    expect(families).toEqual([...families].sort((a, b) => a.localeCompare(b)));
  });

  it('recognises every curated hint at least once against a synthetic filename', () => {
    // A SWEEP THAT PROVES IT EXAMINED THE WHOLE LIST — the standing lesson
    // this repo keeps re-learning: a guard that cannot fail on its own
    // corpus is not a guard.
    expect(MONOSPACE_HINTS.length).toBeGreaterThan(5);
    for (const hint of MONOSPACE_HINTS) {
      // Spaces become HYPHENS, never removed outright: `familyFromFilename`
      // turns a filename's `-`/`_` back into spaces, so this is what a real
      // font vendor's own filename convention looks like ("Anonymous-Pro-
      // Regular.ttf"), not a word-mashing that would defeat its own test.
      const filename = `${hint.replace(/\s+/g, '-')}-Regular.ttf`;
      const fs = fakeFs({
        '/System/Library/Fonts': [filename],
        '/Library/Fonts': [],
        '/Users/op/Library/Fonts': [],
      });
      const families = listMonospaceFontFamilies({ platform: 'darwin', homedir: '/Users/op', fs });
      expect(families.length, `hint "${hint}" matched nothing from "${filename}"`).toBeGreaterThan(
        0,
      );
    }
  });
});
