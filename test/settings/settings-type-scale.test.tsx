// @vitest-environment happy-dom

/**
 * Operator event #58: Settings text follows the Output text size, floored at
 * today's 13/12px, hierarchy kept (EC-59). `[data-settings-overlay]` re-declares
 * the same four properties as `[data-reading-pane]`; the expressions are read
 * from the stylesheet, not restated.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

afterEach(cleanup);

const CSS = readFileSync(join(__dirname, '../../src/renderer/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const PROPS = [
  '--text-body',
  '--text-body--line-height',
  '--text-control',
  '--text-control--line-height',
] as const;

/** Declarations of the rule whose selector is exactly `selector`. */
function declarations(selector: string): Record<string, string> | null {
  for (const m of CSS.matchAll(/(^|\n)([^{}]+)\{([^{}]*)\}/g)) {
    if ((m[2] ?? '').trim() !== selector) continue;
    const out: Record<string, string> = {};
    for (const d of (m[3] ?? '').matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
      out[d[1] as string] = (d[2] as string).trim();
    }
    return out;
  }
  return null;
}

/** Resolve `var(--vam-pane-size)` and `calc(...)` of the form `p * a / b`. */
function resolve(expr: string, pane: number): number {
  if (expr === 'var(--vam-pane-size)') return pane;
  const m = expr.match(/^calc\(var\(--vam-pane-size\) \* (\d+) \/ (\d+)\)$/);
  if (!m) throw new Error(`unexpected expression: ${expr}`);
  return (pane * Number(m[1])) / Number(m[2]);
}

describe('the [data-settings-overlay] rule', () => {
  const settings = declarations('[data-settings-overlay]');
  const pane = declarations('[data-reading-pane]');

  it('exists and re-declares the four properties like the reading pane', () => {
    expect(settings).not.toBeNull();
    expect(pane).not.toBeNull();
    for (const p of PROPS) {
      expect(settings?.[p], p).toBeDefined();
      expect(settings?.[p], p).toBe(pane?.[p]);
    }
  });

  it('resolves to a floor of 13/12 and grows with out, label > description', () => {
    const sizes = (out: number) => {
      const paneSize = Math.max(13, out);
      return {
        body: resolve(settings?.['--text-body'] ?? '', paneSize),
        control: resolve(settings?.['--text-control'] ?? '', paneSize),
      };
    };
    for (const out of [10, 13, 18]) {
      const s = sizes(out);
      expect(s.body).toBeGreaterThanOrEqual(13);
      expect(s.control).toBeGreaterThanOrEqual(12);
      expect(s.control).toBeLessThan(s.body);
    }
    expect(sizes(10)).toEqual({ body: 13, control: 12 });
    expect(sizes(13)).toEqual({ body: 13, control: 12 });
    expect(sizes(18).body).toBe(18);
    expect(sizes(18).control).toBeCloseTo(16.615, 2);
  });
});

describe('the Settings root', () => {
  it('matches the selector and holds a text-body label and a text-control hint', () => {
    const { container } = render(
      <SettingsOverlay
        prefs={EMPTY_PREFS}
        theme="dark"
        onChange={vi.fn()}
        onClose={vi.fn()}
        initialSection="interface"
      />,
    );
    const root = container.querySelector('[data-settings-overlay]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.matches('[data-settings-overlay]')).toBe(true);
    expect(root.querySelector('h4.text-body')).not.toBeNull();
    expect(root.querySelector('[data-settings-panel-hint].text-control')).not.toBeNull();
  });
});
