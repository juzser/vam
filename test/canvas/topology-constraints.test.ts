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

/**
 * THE TWO FILES WHERE A HEX IS THE POINT, and why they are not holes in 13.1.
 *
 * The rule is "every colour must come from a token". What it really catches is
 * a COMPONENT that paints `#fff` instead of reaching for one -- a call site
 * with a colour baked into it. A file whose whole job is to DEFINE colour
 * values sits at the other end of that relationship, and scanning it would be
 * asking the definitions to come from themselves.
 *
 *  - `styles.css` is where the palette lives; it was always excluded, and the
 *    rule's own comment says why.
 *  - `renderer/prefs/palette-templates.ts` is where the colour TEMPLATES live.
 *    A template is a whole palette the operator applies in one press, and it is
 *    values by definition: there is no token for it to reach for, because its
 *    entire content is the alternative set of values a token can take.
 *
 * THE EXCLUSION IS PAID FOR RATHER THAN ASSERTED, which is the half that
 * matters. `test/prefs/palette-templates.test.ts` measures every value in that
 * file against every ink the stylesheet keeps -- 360 contrast pairs, plus the
 * elevation ladder, the two JND separations and the In bubble's floors, per
 * template, per theme. That is strictly stronger than "contains no hex", so
 * the file is not leaving cover; it is moving to better cover.
 *
 * NARROW, AND CHECKED TO STILL EXIST. An exclusion by path widens silently the
 * moment somebody renames the file, so both names are asserted present below.
 */
const COLOUR_DEFINITION_FILES = ['styles.css', 'renderer/prefs/palette-templates.ts'];

const cssAndTsFiles = allSrcFiles.filter(
  (f) =>
    !COLOUR_DEFINITION_FILES.some((skip) => f === skip || f.endsWith(`/${skip}`)) &&
    ['.ts', '.tsx', '.css'].includes(extname(f)),
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

  it('excludes only files that still exist, so a rename cannot widen 13.1 in silence', () => {
    // An exclusion list is a hole with a name on it. The moment one of these
    // files moves, the name stops matching, the exclusion stops excluding --
    // and the DANGEROUS half is the other direction: a file renamed INTO one
    // of these paths would be excluded without anyone deciding that. Both are
    // caught by requiring each entry to name a real file.
    const missing = COLOUR_DEFINITION_FILES.filter(
      (skip) => !allSrcFiles.some((f) => f === skip || f.endsWith(`/${skip}`)),
    );
    expect(missing, 'a 13.1 exclusion names a file that is no longer there').toEqual([]);
    // And the exclusion actually removed something, or it is decoration.
    expect(allSrcFiles.length).toBeGreaterThan(cssAndTsFiles.length);
  });

  it('this file documents its own blind spot, so a future editor cannot silently strip it', () => {
    const contents = readFileSync(SELF_PATH, 'utf8');
    const phrases = ['CONTENT SCAN', 'cannot distinguish code from prose', 'PR #482'];
    for (const phrase of phrases) {
      expect(contents.includes(phrase), `blind-spot comment is missing "${phrase}"`).toBe(true);
    }
  });
});
