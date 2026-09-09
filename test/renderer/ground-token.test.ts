/**
 * The surface a pane paints on is called `ground`, everywhere, once.
 *
 * It used to be called `canvas`, after the column vam deleted in 0.2. The
 * colour never went anywhere — it is the detail pane's own fill, and the
 * sticky prompt block leans on it to stop the transcript bleeding through
 * (`DetailPanel.tsx`, `data-detail-block="in"`) — but the Appearance
 * section offered a swatch called "canvas" for a thing no operator could
 * point at.
 *
 * A rename across a dozen files is exactly where one stale spelling
 * survives and quietly resolves to nothing: a Tailwind utility whose token
 * does not exist emits no class, breaks no build, and fails no assertion
 * that reads text. So this scans the real source rather than trusting the
 * diff, and asserts on the corpus size first — a sweep that examined zero
 * files is a sweep that passes for the wrong reason.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

/**
 * Every spelling the old token had: the custom property, the Tailwind
 * `@theme` alias, and the three utility families built on it.
 */
const STALE = [
  '--vam-canvas',
  '--color-canvas',
  'bg-canvas',
  'text-canvas',
  'border-canvas',
] as const;

describe('the ground token has one name and no ghosts', () => {
  const files = sources(SRC);

  it('scanned a real corpus', () => {
    // Not decoration: the two assertions below are vacuously true over an
    // empty list, and this repo has shipped a guard that examined nothing.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('styles.css'))).toBe(true);
  });

  it('spells the surface `ground` in the stylesheet, in both themes', () => {
    const css = readFileSync(resolve(SRC, 'renderer/styles.css'), 'utf8');
    expect(css).toContain('--color-ground: var(--vam-ground);');
    // One declaration per theme block, dark and light.
    expect([...css.matchAll(/^ {2}--vam-ground:/gm)]).toHaveLength(2);
  });

  it('carries no occurrence of the retired `canvas` spellings', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const stale of STALE) {
        // `prefs.ts` names the old key once, on purpose, to migrate a
        // stored colour off it. That line says so; nothing else may.
        for (const line of text.split('\n')) {
          if (line.includes(stale) && !line.includes('LEGACY_GROUND_TOKEN')) {
            offenders.push(`${file}: ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
