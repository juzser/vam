// Node, not happy-dom: this file reads bytes, the same reason
// `test/phone/overlay-sheets.test.ts` gives for its own read.

/**
 * ONE SHARED SIZE, NOT TWO MATCHING NUMBERS.
 *
 * Operator: "Make the Settings popup bigger. The Stats & Usage screen should
 * be the same size." The two panels are two different components
 * (`SettingsOverlay.tsx`, `StatsScreen.tsx`) that used to carry their own
 * arbitrary Tailwind width/height (`w-[min(880px,94vw)]` and
 * `w-[min(920px,94vw)]` respectively) -- close, never identical, and only
 * accidentally close at that. `vam-modal-lg` (`styles.css`) is the one
 * declaration both now read, so "the same size" is a fact about the
 * stylesheet rather than an invariant a future edit to either file could
 * quietly break by typing a fresh number.
 *
 * This is a content scan, same limits as its sibling: it proves the class is
 * TYPED on both panels and that no per-file width/height escaped back in
 * beside it. That the two panels' PAINTED rects are actually identical, and
 * actually close to the whole window, is `e2e/modal-size-shots.mjs`'s job,
 * against a real browser at 1280x800 and 1920x1080 -- jsdom/happy-dom apply
 * no stylesheet and lay nothing out, so nothing here can measure a pixel.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const CSS = read('../../src/renderer/styles.css');
const SETTINGS = read('../../src/renderer/settings/SettingsOverlay.tsx');
const STATS = read('../../src/renderer/stats/StatsScreen.tsx');

describe('the shared large-modal size', () => {
  it('declares one class both panels can read', () => {
    expect(CSS).toMatch(/\.vam-modal-lg\s*\{[^}]*width:\s*min\(/);
    expect(CSS).toMatch(/\.vam-modal-lg\s*\{[^}]*height:\s*min\(/);
  });

  it('is the class Settings wears on its own panel', () => {
    expect(SETTINGS).toMatch(/className="[^"]*\bvam-modal-lg\b[^"]*"/);
  });

  it('is the class Stats & Usage wears on its own panel', () => {
    expect(STATS).toMatch(/className="[^"]*\bvam-modal-lg\b[^"]*"/);
  });

  it('leaves no per-file width/height beside the shared class, in either panel', () => {
    // The two literals this repo shipped before this class existed --
    // `w-[min(880px,94vw)]` (Settings) and `w-[min(920px,94vw)]` (Stats) --
    // must not have merely grown a second, freshly-typed pair beside the
    // shared class.
    expect(SETTINGS).not.toMatch(/w-\[min\(\d+px/);
    expect(STATS).not.toMatch(/w-\[min\(\d+px/);
    expect(SETTINGS).not.toMatch(/h-\[min\(\d+px/);
    expect(STATS).not.toMatch(/max-h-\[\d+/);
  });
});
