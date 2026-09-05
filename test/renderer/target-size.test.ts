/**
 * Desktop target sizes, WCAG 2.2 SC 2.5.8.
 *
 * The AA floor is 24x24 CSS px, and the sidebar's heading controls are 15, 17
 * and 19 px boxes. They escaped the criterion through its undersized-target
 * exception — every neighbour is at least 24px away centre to centre — and the
 * fold/menu pair cleared it by exactly 0.0 px. Conformance by tangency is not
 * conformance anyone chose: one pixel off a `gap`, or one glyph growing, and it
 * is gone with nothing to say so. `vam-hit-24` gives each of them a centred
 * 24x24 hit area instead, and this guard is what keeps the next small control
 * from being added without one.
 *
 * `src/renderer/phone/` is excluded: the phone shell sizes its own targets to
 * 44px through `.vam-phone .vam-tap`, a different rule with a different floor.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), 'src/renderer');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'phone') continue;
      out.push(...sources(path));
    } else if (entry.name.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

/** Every fixed height a line asks for, in CSS px. `h-6` is Tailwind's 24. */
function heights(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(/\bh-\[(\d+)px\]/g)) out.push(Number(m[1]));
  for (const m of line.matchAll(/\bh-(\d+)(?![\w[-])/g)) out.push(Number(m[1]) * 4);
  return out;
}

describe('clickable controls on the desktop shell', () => {
  it('gives every sized control under 24px a 24x24 hit area', () => {
    const files = sources(ROOT);
    expect(files.length, 'no renderer sources were scanned').toBeGreaterThan(10);

    let sized = 0;
    const undersized: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('cursor-pointer')) return;
        const boxes = heights(line);
        if (boxes.length === 0) return;
        sized += 1;
        const smallest = Math.min(...boxes);
        if (smallest >= 24 || line.includes('vam-hit-24')) return;
        undersized.push(`${relative(ROOT, file)}:${i + 1} is ${smallest}px and has no hit area`);
      });
    }

    // Inside the assertion, not beside it: a sweep that matched nothing passes
    // every check about what it did not find.
    expect(sized, 'the sweep found no sized clickable controls at all').toBeGreaterThan(5);
    expect(undersized).toEqual([]);
  });

  it('defines the hit-area utility the controls name', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    expect(css).toMatch(/\.vam-hit-24\s*\{/);
    expect(css).toMatch(/\.vam-hit-24::after\s*\{[^}]*width:\s*24px/);
    expect(css).toMatch(/\.vam-hit-24::after\s*\{[^}]*height:\s*24px/);
  });
});
