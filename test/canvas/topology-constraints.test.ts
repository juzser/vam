/**
 * Executable form of epic.md section 13.1, so `vitest run` enforces it
 * permanently instead of as prose duplicated across task specs.
 *
 * BLIND SPOT: the rule below is a CONTENT SCAN over source text — it cannot
 * distinguish code from prose, and cannot see a dynamic import, a re-export,
 * an aliased identifier or a string-keyed lookup. Not hypothetical: 13.1's
 * hex pattern once matched "PR #482 open", a pull-request number, not a
 * colour. No rule claims more than a regex over file content can prove.
 *
 * 0.2 migration, step 2: sections 13.2(a)/(b)/(c) and the drag/pin residue
 * instrument retired here, along with `grid.ts`, `canvas/*Node.tsx` and
 * `layoutCanvas` — the geometry, the props-only node contract and the
 * drag/pin vocabulary those rules pinned all left with the graph. 13.1 (no
 * literal hex colour) is not a graph rule; it survives verbatim.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
const SELF_PATH = fileURLToPath(import.meta.url);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function listSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSrcFiles(full));
    else out.push(relative(SRC_DIR, full).split(sep).join('/'));
  }
  return out.sort();
}

const allSrcFiles = listSrcFiles(SRC_DIR);
const cssAndTsFiles = allSrcFiles.filter(
  (f) => !f.endsWith('styles.css') && ['.ts', '.tsx', '.css'].includes(extname(f)),
);

const at = (f: string, i: number, l: string) => `src/${f}:${i + 1}: ${l.trim()}`;

// Each rule scans one set of files, line by line; a non-null return is a violation
// with the file, line number and rule it breaks, per the honesty requirement above.
const RULES: {
  name: string;
  files: string[];
  rule: string;
  check: (f: string, l: string, i: number) => string | null;
}[] = [
  {
    // epic.md 13.1's recorded target ("one line", SessionList.tsx:69, a "PR #482"
    // comment) is stale: removed at b7bb3c8 by task-8-sidebar-row while
    // rebuilding the row, not to force a zero. Zero is the correct reading now.
    // styles.css is excluded: it is where the tokens are defined.
    name: '13.1: no literal hex colour under src/ *.ts, *.tsx or *.css, excluding styles.css',
    files: cssAndTsFiles,
    rule: 'Every colour must come from a token, never a literal hex (13.1):',
    check: (f, l, i) => (/#[0-9a-fA-F]{3,8}\b/.test(l) ? at(f, i, l) : null),
  },
];

describe('epic.md section 13: standing constraints, made permanent and checkable', () => {
  it.each(RULES)('$name', ({ files, rule, check }) => {
    // A rule whose selector matches nothing scans nothing and reports no
    // violations, so it passes -- silently, forever, and most likely right
    // after someone renames or moves the files it was watching. That is the
    // exact failure this file was written to end (finding b80ce28a: a
    // case-sensitive grep that printed 0 and read clean), so it must not be
    // reachable from inside the instrument itself. If this fires, fix the
    // selector; deleting the rule is how the check dies quietly.
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

  it('this file documents its own blind spot, so a future editor cannot silently strip it', () => {
    const contents = readFileSync(SELF_PATH, 'utf8');
    const phrases = ['CONTENT SCAN', 'cannot distinguish code from prose', 'PR #482'];
    for (const phrase of phrases) {
      expect(contents.includes(phrase), `blind-spot comment is missing "${phrase}"`).toBe(true);
    }
  });
});
