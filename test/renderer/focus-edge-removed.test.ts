/**
 * The running line at the top of the focused pane is gone, and left nothing
 * behind.
 *
 * The operator asked for it off ("remove the running-line animation at the
 * top of the pane when focused"); the sidebar's copy had already gone the
 * same way, so `DetailPanel` was its last mount and the whole feature --
 * component, class, keyframe hook, and the token pair that only it read --
 * went with it.
 *
 * The reason this is a scan and not a rendering assertion is the failure mode
 * of a half-removal: a `var(--color-focus-edge)` left in a rule nobody
 * deleted resolves to nothing and paints as `currentColor` or as transparent,
 * which no test that reads text and no build that reads types will notice.
 * This repo has shipped exactly that (see `ground-token.test.ts`). So the
 * corpus is scanned for every spelling the feature had, and the corpus size
 * is asserted first -- a sweep that examined zero files passes for the wrong
 * reason.
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

/** Every spelling the feature had: token, alias, class, element, component. */
const GONE = [
  '--vam-focus-edge',
  '--color-focus-edge',
  'vam-focus-edge',
  'data-focus-edge',
  'FocusEdge',
] as const;

describe('the focus edge is gone, with no ghosts', () => {
  const files = sources(SRC);

  it('scanned a real corpus', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('styles.css'))).toBe(true);
    expect(files.some((f) => f.endsWith('DetailPanel.tsx'))).toBe(true);
  });

  it('names the feature nowhere in the renderer', () => {
    const hits = files.flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return GONE.filter((name) => text.includes(name)).map((name) => `${path}: ${name}`);
    });
    expect(hits).toEqual([]);
  });

  it('leaves no rule reading a token that no longer exists', () => {
    // Comments stripped first: this file explains its own tokens in prose,
    // and a `var(--card)` inside a sentence is not a rule reading anything.
    const css = readFileSync(resolve(SRC, 'renderer/styles.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    // The failure this catches is the orphan, not the spelling: a `var()`
    // whose custom property was deleted with the theme block.
    const declared = new Set(
      [...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1] as string),
    );
    const read = new Set(
      [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] as string),
    );
    expect(declared.size).toBeGreaterThan(30);
    expect([...read].filter((name) => !declared.has(name))).toEqual([]);
  });
});
