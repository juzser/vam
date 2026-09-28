// Node, not happy-dom: this file reads bytes, the same reason
// `test/phone/overlay-sheets.test.ts` gives for its own read.

/**
 * A FULL-WINDOW SCREEN, NOT A SHARED MODAL SIZE.
 *
 * Operator (settings-views restructure, item A): "Make Settings (and Stats
 * & Usage) a full-width overlay -- like a separate screen, not a popup. It
 * should cover the whole app window below the title bar. No card-modal
 * look, no backdrop margins." This file used to hold that Settings and the
 * standalone `StatsScreen` shared one class, `vam-modal-lg`, sized to
 * "nearly the whole window" (`min(2000px, calc(100vw - 64px))`) -- both are
 * gone now: `StatsScreen.tsx` is deleted (item B: its content lives in
 * `StatsPanel.tsx`, mounted inside Settings' own "stats" section), and
 * `SettingsOverlay.tsx`'s host wears `inset-0` directly rather than a
 * `min(...)` ceiling that stopped a few dozen pixels short of the frame.
 *
 * This is a content scan, same limits as its sibling: it proves the host
 * carries the full-bleed class and the reading column keeps the operator's
 * own 760-900px ceiling (chosen 820px, `SettingsOverlay.tsx`'s own comment
 * on the wrapper says why), not that the painted rect is actually flush with
 * the window -- jsdom/happy-dom apply no stylesheet and lay nothing out, so
 * nothing here can measure a pixel. That half is
 * `e2e/modal-size-shots.mjs`'s job, against a real browser at 1280x800,
 * 1440x900 and 1920x1080.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const SETTINGS = read('../../src/renderer/settings/SettingsOverlay.tsx');
const CSS = read('../../src/renderer/styles.css');

describe('settings is a full-window screen', () => {
  it('fills the frame edge to edge, with no backdrop margin', () => {
    expect(SETTINGS).toMatch(/className="[^"]*\binset-0\b[^"]*"/);
  });

  it('retired the shared "nearly the whole window" modal class', () => {
    // `.vam-modal-lg` used to be the one declaration both Settings and the
    // standalone Stats & Usage screen read; there is only one full-window
    // screen now, and it needs no shared class to agree with.
    expect(CSS).not.toMatch(/\.vam-modal-lg\s*\{/);
    expect(SETTINGS).not.toMatch(/\bvam-modal-lg\b/);
  });

  it('keeps its reading column between 760 and 900px, not stretched to the frame', () => {
    const match = SETTINGS.match(/max-w-\[(\d+)px\]/);
    expect(match, 'no max-w-[Npx] column found on the section wrapper').not.toBeNull();
    const width = Number(match?.[1]);
    expect(width).toBeGreaterThanOrEqual(760);
    expect(width).toBeLessThanOrEqual(900);
  });

  it('deleted the standalone Stats & Usage screen (item B)', () => {
    expect(() => read('../../src/renderer/stats/StatsScreen.tsx')).toThrow();
  });
});
