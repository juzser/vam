/**
 * Pins that the cache-timer screenshots stay deleted (EC-116).
 *
 * Closes f-vam-ux-3/followup-7c1a35d5-7c1a35d5. task-26 deleted
 * `e2e/cache-timer-shots.mjs`, which orphaned `docs/ui/cache-timer-light.png`
 * and `docs/ui/cache-timer-dark.png`; 60cea719 deleted both PNGs. This keeps
 * them gone and keeps anything under e2e/, src/ or docs/ from naming them.
 * A generic "every docs/ui PNG is referenced" check is out of scope: many
 * before-after PNGs have no literal reference, so it would be red on day one.
 *
 * Files are read from the working tree, never from a git revision: CI clones
 * one commit deep.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const TEXT = /\.(md|mjs|cjs|js|ts|tsx|json|html|css)$/;
const NAMED = /cache-timer-(light|dark)/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) {
      const skip = entry.name === 'node_modules' || entry.name === 'test-results';
      return skip || entry.name.startsWith('.') ? [] : files(path);
    }
    return TEXT.test(entry.name) ? [path] : [];
  });
}

describe('cache-timer screenshots stay deleted (EC-116)', () => {
  it('has neither PNG on disk', () => {
    expect(existsSync(root('docs/ui/cache-timer-light.png'))).toBe(false);
    expect(existsSync(root('docs/ui/cache-timer-dark.png'))).toBe(false);
  });

  it('names neither PNG anywhere under e2e/, src/ or docs/', () => {
    const hits = ['e2e', 'src', 'docs'].flatMap((dir) =>
      files(root(dir)).flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((line, index) => (NAMED.test(line) ? [`${path}:${index + 1}`] : [])),
      ),
    );
    expect(hits).toEqual([]);
  });
});
