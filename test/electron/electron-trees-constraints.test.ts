/**
 * The standing constraints for the trees THIS epic invents: `src/main`,
 * `src/preload` and `src/shared`.
 *
 * `test/canvas/topology-constraints.test.ts` is another epic's graded
 * instrument and is not widened here — new code brings its own guard. This one
 * carries the same anti-vacuity clause: a rule whose selector matches no files
 * scans nothing, reports nothing and passes forever, which is how a guard dies
 * quietly the day someone renames the directory it watched.
 *
 * BLIND SPOT, stated so it cannot be silently dropped: both rules below are
 * CONTENT SCANS over source text. They cannot tell code from prose, and the hex
 * pattern will match a pull-request number as happily as a colour.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
const TREES = ['main', 'preload', 'shared'];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(relative(SRC_DIR, full).split(sep).join('/'));
    }
  }
  return out.sort();
}

const electronTreeFiles = TREES.flatMap((tree) => listFiles(join(SRC_DIR, tree))).filter((f) =>
  ['.ts', '.tsx', '.css'].includes(extname(f)),
);
const sharedFiles = electronTreeFiles.filter((f) => f.startsWith('shared/'));

const at = (f: string, i: number, l: string) => `src/${f}:${i + 1}: ${l.trim()}`;
const IMPORT_LINE = /^\s*import\s+(?:type\s+)?.*\bfrom\s+['"]([^'"]+)['"]/;

const RULES: {
  name: string;
  files: string[];
  rule: string;
  check: (f: string, l: string, i: number) => string | null;
}[] = [
  {
    // The literal a reviewer will find if this rule is absent is
    // `backgroundColor: '#1f1f1f'` in the BrowserWindow options — the idiomatic
    // way to stop an Electron window flashing white. Main cannot read a CSS
    // custom property, so the answer is `show: false` plus `ready-to-show`,
    // which needs no colour at all.
    name: 'no literal hex colour under src/main, src/preload or src/shared',
    files: electronTreeFiles,
    rule: 'Every colour must come from a token in styles.css, never a literal hex:',
    check: (f, l, i) => (/#[0-9a-fA-F]{3,8}\b/.test(l) ? at(f, i, l) : null),
  },
  {
    // `src/shared` is imported by the renderer, which has no `electron` module
    // and no Node builtins. A shared file that reaches for either compiles in
    // the node config and breaks the browser build.
    name: 'src/shared imports neither electron nor a node builtin',
    files: sharedFiles,
    rule: 'src/shared is shared with the browser, so it stays free of electron and node:',
    check: (f, l, i) => {
      const spec = l.match(IMPORT_LINE)?.[1];
      return spec !== undefined && (spec === 'electron' || spec.startsWith('node:'))
        ? at(f, i, l)
        : null;
    },
  },
];

describe('standing constraints for the electron trees', () => {
  it.each(RULES)('$name', ({ files, rule, check }) => {
    expect(
      files.length,
      `${rule}\nThis rule matched NO files, so it checked nothing and would have passed vacuously.`,
    ).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const f of files) {
      readFileSync(join(SRC_DIR, f), 'utf8')
        .split('\n')
        .forEach((l, i) => {
          const m = check(f, l, i);
          if (m) violations.push(m);
        });
    }
    expect(violations, [rule, ...violations].join('\n')).toEqual([]);
  });
});
