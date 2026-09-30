import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Caps from vam-ux-1 EC-25: README <= 200 lines, Features section <= 60.
it('README.md stays within its size caps', () => {
  const text = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
  // `wc -l` counts newline characters.
  const lineCount = text.split('\n').length - 1;
  const lines = text.split('\n');
  const headings = lines.filter((l) => /^## .*Features/.test(l));
  // Mirrors `awk '/^## .*Features/{f=1;next}/^## /{f=0}f' README.md | wc -l`.
  let inFeatures = false;
  let featuresLines = 0;
  for (const l of text.endsWith('\n') ? lines.slice(0, -1) : lines) {
    if (/^## .*Features/.test(l)) {
      inFeatures = true;
      continue;
    }
    if (/^## /.test(l)) inFeatures = false;
    if (inFeatures) featuresLines++;
  }
  console.log(`README.md lines=${lineCount} featuresLines=${featuresLines}`);
  expect(lineCount).toBeLessThanOrEqual(200);
  expect(headings).toHaveLength(1);
  expect(featuresLines).toBeLessThanOrEqual(60);
});
