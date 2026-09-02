/**
 * Executable form of epic.md section 13 (13.1, 13.2) plus the drag/pin
 * residue instrument, so `vitest run` enforces them permanently instead of
 * as prose duplicated across task specs.
 *
 * BLIND SPOT: every rule below is a CONTENT SCAN over source text — it cannot
 * distinguish code from prose, and cannot see a dynamic import, a re-export,
 * an aliased identifier or a string-keyed lookup. Not hypothetical: the
 * residue scan reads 3 lines over src/ + test/, all prose comments (hence
 * scoped to src/ only), and 13.1's hex pattern once matched "PR #482 open",
 * a pull-request number, not a colour. No rule claims more than a regex over
 * file content can prove.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url));
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
const nodeFiles = allSrcFiles.filter((f) => f.startsWith('canvas/') && /Node\.tsx$/.test(f));
const cssAndTsFiles = allSrcFiles.filter(
  (f) => f !== 'styles.css' && ['.ts', '.tsx', '.css'].includes(extname(f)),
);

const at = (f: string, i: number, l: string) => `src/renderer/${f}:${i + 1}: ${l.trim()}`;
const isComment = (t: string) => t.startsWith('//') || t.startsWith('*');

const DRAGGABLE_ALLOWED = /draggable:\s*false\b|nodesDraggable=\{false\}/;
const IMPORT_LINE = /^\s*import\s+(?:type\s+)?.*\s+from\s+['"]([^'"]+)['"]/;

// Each rule scans one set of files, line by line; a non-null return is a violation
// with the file, line number and rule it breaks, per the honesty requirement above.
const RULES: {
  name: string;
  files: string[];
  rule: string;
  check: (f: string, l: string, i: number) => string | null;
}[] = [
  {
    // \bPin\b and case-insensitivity are load-bearing (finding b80ce28a): without
    // them a surviving `Pin` type reads clean. Scope is ALL of src/, never test/,
    // where the reading is 3 prose comments, not 0.
    name: 'RESIDUE: no file under src/ matches the removed drag/pin vocabulary',
    files: allSrcFiles,
    rule: 'Drag/pin residue under src/ (removed by task-3-undrag):',
    check: (f, l, i) =>
      /\b(pinned|unpinAll|onNodeDrag)\b|\bPin\b|\bpin\(/i.test(l) ? at(f, i, l) : null,
  },
  {
    // Shape, never a count: a count still passes when `false` flips to `true`.
    name: 'DRAGGABLE: every match under src/ is a disabling form or a comment',
    files: allSrcFiles,
    rule: 'draggable must be a disabling form or a comment:',
    check: (f, l, i) => {
      if (!/draggable/i.test(l)) return null;
      const t = l.trim();
      return !isComment(t) && !DRAGGABLE_ALLOWED.test(l) ? at(f, i, l) : null;
    },
  },
  {
    // Constrains what grid.ts READS, not who reads it; layout.ts importing FROM
    // it is fine and unaffected.
    name: '13.2(a): grid.ts has zero import or require statements — geometry stays data',
    files: ['canvas/grid.ts'],
    rule: 'grid.ts must stay pure, zero dependency edges (13.2(a)):',
    check: (f, l, i) => (/^\s*import\b/.test(l) || /\brequire\(/.test(l) ? at(f, i, l) : null),
  },
  {
    // Observes import specifiers and identifiers only — proves the narrower true
    // thing named above, not "components never compute layout". Type-only
    // ../domain/*.js imports are untouched ("domain" matches nothing forbidden).
    // layoutCanvas stays legal in Canvas.tsx, the canvas host: this rule's files
    // are *Node.tsx only, never src/canvas/*.tsx.
    name: '13.2(b)+(c): *Node.tsx imports no grid/layout/actions/source/store, never layoutCanvas',
    files: nodeFiles,
    rule: 'Node components stay props-driven, layout stays out of them:',
    check: (f, l, i) => {
      const spec = l.match(IMPORT_LINE)?.[1];
      if (spec !== undefined && /grid|layout|actions|source|store/i.test(spec)) {
        return `${at(f, i, l)} — 13.2(b) layout import`;
      }
      if (!isComment(l.trim()) && /\blayoutCanvas\b/.test(l))
        return `${at(f, i, l)} — 13.2(c) layoutCanvas`;
      return null;
    },
  },
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
