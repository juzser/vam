/**
 * The viewport meta, read as content.
 *
 * A content scan that knows it is one. Nothing else in `test/` reads
 * `index.html`, and this line is now load-bearing twice over: without
 * `viewport-fit=cover` the safe-area inset resolves to zero and the record
 * button sits under the iOS home indicator, and a `maximum-scale` added to it
 * would take pinch-zoom away from a screen whose content is code (SC 1.4.4).
 * Both failures are invisible on a desktop, which is why they need a test.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(
  fileURLToPath(new URL('../../src/renderer/index.html', import.meta.url)),
  'utf8',
);

describe('the renderer viewport meta', () => {
  it('covers the safe area, so the composer clears the home indicator', () => {
    expect(HTML).toContain('viewport-fit=cover');
  });

  it('does not take pinch-zoom away', () => {
    expect(HTML).not.toMatch(/maximum-scale|user-scalable/);
  });
});
