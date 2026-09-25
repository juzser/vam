/**
 * `TERMINAL_FONT_FAMILY` -- the one JS-side copy of `styles.css`'s own
 * `--font-mono`, which `TerminalStreamTab.tsx` needs as a literal string for
 * xterm.js's `fontFamily` option (a `<canvas>` paints itself; it never reads a
 * Tailwind class). See the constant's own header for why a copy is
 * unavoidable here, the same trade `terminal-scheme.ts`'s hex tables make.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TERMINAL_FONT_FAMILY } from '../../src/renderer/prefs/terminal-font.js';

describe('TERMINAL_FONT_FAMILY', () => {
  it('carries styles.css’s own --font-mono, digit for digit', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const match = /--font-mono:\s*([^;]+);/.exec(css);
    const captured = match?.[1];
    if (captured === undefined) throw new Error('styles.css no longer defines --font-mono');
    expect(TERMINAL_FONT_FAMILY).toBe(captured.trim());
  });
});
