/**
 * Finding bf5198df: `src/renderer/domain/model.ts` is now a type-only
 * re-export shim over `src/shared/model.ts` (task-1). Even a TYPE-ONLY
 * dependency on that shim from `src/main`, `src/preload` or `src/shared`
 * makes the backend unbuildable without the renderer directory -- so, unlike
 * the runtime-vs-type distinction `electron-trees-constraints.test.ts` draws
 * for renderer imports in general, this guard forbids the specifier
 * `renderer/domain/model` outright, type import or value import alike.
 *
 * Detection reuses the statement-level forms
 * `electron-trees-constraints.test.ts` already documents and hardens: a
 * plain `import ... from`, a dynamic `import(...)`, a `require(...)`, and a
 * re-export `export ... from`, each scanned against the WHOLE FILE TEXT
 * (not line by line) so a biome-wrapped multi-line import is still one
 * statement. `import type` and `export type` are NOT exempted here -- that
 * is the entire point of this guard, and is exactly why it cannot reuse the
 * other file's `TYPE_ONLY_IMPORT`/`TYPE_ONLY_EXPORT` filters.
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

const scannedFiles = TREES.flatMap((tree) => listFiles(join(SRC_DIR, tree))).filter((f) =>
  ['.ts', '.tsx'].includes(extname(f)),
);

/**
 * The four import-shaped forms plus re-export, bounded the same way
 * `electron-trees-constraints.test.ts` bounds them: `[^'"]` between the
 * keyword and the opening quote so a lazy match can never cross a string
 * literal, and a negative lookahead so a doc comment mentioning "import"
 * ahead of a real statement cannot splice the two together.
 */
const STATEMENT_FROM =
  /\bimport\s+(?:type\s+)?(?:(?!\bimport\b|\brequire\b|;)[^'"])*?\bfrom\s*['"]([^'"]+)['"]/g;
const STATEMENT_BARE = /\bimport\s*['"]([^'"]+)['"]/g;
const STATEMENT_DYNAMIC = /(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]/g;
const STATEMENT_REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]/g;
const STATEMENT_EXPORT_FROM =
  /\bexport\s+(?:type\s+)?(?:(?!\bexport\b|\bimport\b|;)[^'"])*?\bfrom\s*['"]([^'"]+)['"]/g;

/**
 * Scope is the domain model module itself, not every renderer path: a
 * specifier must end in `renderer/domain/model`, optionally with a
 * `.js`/`.ts`/`.jsx`/`.tsx` extension, immediately before the closing quote.
 * `renderer/sources/port.js` (a different module) does not match; a comment
 * that merely mentions `renderer/domain/model.ts` is not a specifier at all
 * and so is never handed to this regex.
 */
const DOMAIN_MODEL_SPECIFIER = /(?:^|\/)renderer\/domain\/model(?:\.[cm]?[jt]sx?)?$/;

/** Every specifier anywhere in `text` that names the domain model module. */
function domainModelSpecifiersIn(text: string): { index: number; spec: string }[] {
  const specs: { index: number; spec: string }[] = [];
  for (const re of [
    STATEMENT_FROM,
    STATEMENT_BARE,
    STATEMENT_DYNAMIC,
    STATEMENT_REQUIRE,
    STATEMENT_EXPORT_FROM,
  ]) {
    for (const m of text.matchAll(re)) {
      const spec = m[1] as string;
      if (DOMAIN_MODEL_SPECIFIER.test(spec)) {
        specs.push({ index: m.index ?? 0, spec });
      }
    }
  }
  return specs;
}

function importsDomainModel(text: string): boolean {
  return domainModelSpecifiersIn(text).length > 0;
}

/** Zero-based line index and line text at a character offset into `content`. */
function lineAt(content: string, index: number): { i: number; l: string } {
  const i = content.slice(0, index).split('\n').length - 1;
  const l = content.split('\n')[i] as string;
  return { i, l };
}

describe('src/main, src/preload and src/shared never import the renderer domain model', () => {
  it('scans a non-empty file set including the shared and claude-code source files', () => {
    expect(
      scannedFiles.length,
      'This guard matched NO files, so it checked nothing and would have passed vacuously.',
    ).toBeGreaterThan(0);
    expect(scannedFiles).toContain('shared/preload-api.ts');
    expect(scannedFiles).toContain('main/sources/claude-code/source.ts');
  });

  it('no file imports src/renderer/domain/model, by any statement form', () => {
    const violations: string[] = [];
    for (const f of scannedFiles) {
      const content = readFileSync(join(SRC_DIR, f), 'utf8');
      for (const { index } of domainModelSpecifiersIn(content)) {
        const { i, l } = lineAt(content, index);
        violations.push(`src/${f}:${i + 1}: ${l.trim()}`);
      }
    }
    expect(
      violations,
      ['Import the shared vocabulary from src/shared/model.js instead:', ...violations].join('\n'),
    ).toEqual([]);
  });
});

describe('the domain-model guard catches every statement form, type or value', () => {
  it.each([
    ['plain import type', "import type { Session } from '../../renderer/domain/model.js';"],
    ['plain value import', "import { createModel } from '../renderer/domain/model.js';"],
    [
      'wrapped named-import list',
      "import {\n  type Project,\n} from '../renderer/domain/model.js';",
    ],
    ['type re-export', "export type { Session } from '../renderer/domain/model.js';"],
    ['value re-export', "export { Session } from '../renderer/domain/model.js';"],
    ['dynamic import', "const m = await import('../renderer/domain/model.js');"],
    ['wrapped dynamic import', "const m = await import(\n  '../renderer/domain/model.js'\n);"],
    ['require', "const { Session } = require('../renderer/domain/model.js');"],
  ])('reports a %s', (_form, line) => {
    expect(importsDomainModel(line)).toBe(true);
  });

  it.each([
    ['migrated specifier', "import type { Session } from '../shared/model.js';"],
    ['comment mentioning the old path', '// see renderer/domain/model.ts for the vocabulary table'],
    [
      'a different renderer module',
      "import type { SessionSource } from '../renderer/sources/port.js';",
    ],
  ])('does not report %s', (_form, line) => {
    expect(importsDomainModel(line)).toBe(false);
  });
});
