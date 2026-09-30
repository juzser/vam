import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `e2e/shell-first-ctrlc-survives.mjs` bundles `resume.ts` with esbuild and no
 * externals, so anything `resume.ts` reaches that imports `electron` breaks it
 * (and every other Node-only harness). Only `index.ts` and `menu.ts` import
 * electron; every other main module gets what it needs injected.
 */
const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const ROOTS = ['main/sources/claude-code/resume.ts', 'main/sources/claude-code/statusline.ts'];
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(from), spec.replace(/\.js$/, ''));
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function closure(roots: string[]): { files: string[]; electron: string[] } {
  const seen = new Set<string>();
  const electron: string[] = [];
  const queue = roots.map((r) => join(SRC, r));
  while (queue.length > 0) {
    const f = queue.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(SPEC)) {
      const spec = m[1] as string;
      if (spec === 'electron' || spec.startsWith('electron/')) {
        electron.push(relative(SRC, f));
      }
      const next = resolveLocal(f, spec);
      if (next !== null) queue.push(next);
    }
  }
  return { files: [...seen], electron };
}

describe('resume.ts and statusline.ts stay electron-free', () => {
  it('nothing they import, transitively, imports electron', () => {
    const { files, electron } = closure(ROOTS);
    expect(files.length).toBeGreaterThan(2);
    expect(electron, `electron is imported by: ${electron.join(', ')}`).toEqual([]);
  });
});
