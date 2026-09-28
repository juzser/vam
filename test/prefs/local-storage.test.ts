/**
 * THE SHARED FAIL-OPEN `localStorage` POLICY -- PROVEN ONCE, FOR ALL THREE
 * STORES THAT LEAN ON IT.
 *
 * `worktree-tree-collapse.ts`, `settings/card-collapse.ts` and
 * `prefs/foreign-hidden-note.ts` used to each hand-copy their own accessor
 * and their own try/catch fail-open wrapping. This file proves two things:
 * that the one shared policy behaves the way all three used to (part 1),
 * and that no module other than this one still defines that accessor for
 * itself (part 2) -- a scan that, run against the pre-fix tree, names the
 * three files above.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readItem, store, writeItem } from '../../src/renderer/prefs/local-storage.js';

afterEach(() => {
  // `test/support/storage.ts` reinstalls a fresh `localStorage` before every
  // test; unstub FIRST, the same order the three stores' own tests use.
  vi.unstubAllGlobals();
});

describe('the shared fail-open policy', () => {
  it('the accessor returns null when localStorage access itself throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    expect(store()).toBeNull();
  });

  it('a read falls back to the caller default when access itself throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    expect(readItem('k', 'fallback', (raw) => raw)).toBe('fallback');
  });

  it('a write returns without throwing when access itself throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    expect(() => writeItem('k', 'v')).not.toThrow();
  });

  it('a read falls back to the caller default when the stored value fails to parse', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'not-json{{{',
      setItem: () => undefined,
    });
    expect(
      readItem('k', 'fallback', (raw) => {
        const parsed: unknown = JSON.parse(raw);
        return String(parsed);
      }),
    ).toBe('fallback');
  });

  it('a write returns without throwing when setItem throws (quota)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    expect(() => writeItem('k', 'v')).not.toThrow();
  });

  it('a read returns the fallback when the key is absent, and the parsed value otherwise', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'present' ? 'value' : null),
      setItem: () => undefined,
    });
    expect(readItem('absent', 'fallback', (raw) => raw)).toBe('fallback');
    expect(readItem('present', 'fallback', (raw) => raw)).toBe('value');
  });
});

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'src/renderer');
const HELPER = resolve(SRC, 'prefs/local-storage.ts');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return ['.ts', '.tsx'].includes(extname(name)) ? [path] : [];
  });
}

const FILES = sources(SRC);
const rel = (path: string): string => relative(SRC, path).split('\\').join('/');

/** Matches `function store(): Storage | null`, whatever whitespace it uses. */
const STORE_ACCESSOR = /function\s+store\s*\(\s*\)\s*:\s*Storage\s*\|\s*null/;

describe('the accessor is defined exactly once', () => {
  it('scanned a real corpus', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.map(rel)).toContain('prefs/local-storage.ts');
  });

  it('names no module other than local-storage.ts that defines its own `store(): Storage | null`', () => {
    const definers = FILES.filter((path) => STORE_ACCESSOR.test(readFileSync(path, 'utf8'))).map(
      rel,
    );
    expect(definers).toEqual(['prefs/local-storage.ts']);
    expect(resolve(SRC, definers[0]!)).toBe(HELPER);
  });
});
