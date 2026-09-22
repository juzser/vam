// @vitest-environment happy-dom

/**
 * HOW MUCH PROSE A PANEL ASKS THE OPERATOR TO READ, as a number rather than as
 * a feeling.
 *
 * Operator, translated: "in the settings sections, apart from the Remote part,
 * the explanatory content for each item is quite long — it needs to be written
 * concisely and tightly."
 *
 * Remote is the exception because it has already had this pass (PR #397): its
 * rendered copy went from 313 words to 215 and every load-bearing fact
 * survived. That is the house style the other panels are held to here.
 *
 * ── WHAT IS COUNTED, AND WHY IT IS THE PARAGRAPHS ONLY ────────────────────
 * The PROSE, never the whole panel. Appearance renders 372 words and about a
 * hundred and fifteen of them are control names -- thirteen colour tokens,
 * twelve terminal schemes, eight palette templates. Those are a list the
 * operator SCANS, not a paragraph they read, and a budget over the panel's
 * whole text would be a budget on how many colours vam offers. So the corpus
 * is exactly the sentences: the panel's own hint, and every `<p>` inside its
 * rows -- each row's caption and each note under a switch.
 *
 * ── A CEILING, NOT A TARGET ───────────────────────────────────────────────
 * Measured in a browser at 1280px on the commit before this one: Appearance
 * 257 prose words over 12 paragraphs, Behaviour 266 over 7. The ceilings below
 * are those numbers with roughly a quarter to a third cut off, which is the
 * size of the Remote pass. They leave a few words of slack on purpose -- this
 * is copy and it will be reworded -- so what they refuse is not a typo but a
 * paragraph coming back.
 *
 * THE CORPUS IS ASSERTED FIRST. A budget over a panel that drew no paragraphs
 * at all would pass forever, and this repo has shipped four guards that were
 * green having examined zero of anything. The count of paragraphs is checked
 * before their length, so "concise" can never be satisfied by "absent" -- and
 * every fact these paragraphs carry is held, sentence by sentence, by
 * `view-width`, `focus-view`, `concise-output`, `terminal-colours` and
 * `appearance` in this same directory. This file is only about the size.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function open(prefs: Prefs = EMPTY_PREFS) {
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={vi.fn()} onClose={vi.fn()} />);
}

/**
 * Every paragraph the panel draws, in the order they are painted: its own hint
 * first, then one per row.
 */
function paragraphs(id: string): readonly string[] {
  const panel = document.querySelector(`[data-settings-panel="${id}"]`);
  if (panel === null) return [];
  return [
    ...(panel.querySelector('[data-settings-panel-hint]') === null
      ? []
      : [panel.querySelector('[data-settings-panel-hint]')]),
    ...panel.querySelectorAll('[data-settings-rows] p'),
  ].map((el) => (el?.textContent ?? '').trim());
}

const words = (text: string) => text.split(/\s+/).filter((word) => word.length > 0).length;

/** id, the fewest paragraphs it may draw, the most words they may add up to. */
const BUDGET: readonly (readonly [string, number, number])[] = [
  ['appearance', 10, 180],
  // 210 is the seven-row panel with a quarter cut off. The desktop
  // notifications row lived here for one release (#440 raised this to 8/255
  // for it, 244 measured) and then moved to a section of its own; the
  // numbers go back to what they were before it.
  ['behaviour', 7, 210],
  // Its own hint, the switch's hint and three-fact note, the test button's
  // hint, and -- in this harness, which has no bridge -- the one line saying
  // only the desktop app can send one. Measured at 79 words over 5
  // paragraphs; the ceiling leaves a short sentence of slack and refuses a
  // second note. (Behaviour re-measured at 202 over 7 without the row.)
  ['notifications', 5, 90],
];

describe('a settings panel says what a row does without arguing for it', () => {
  for (const [id, floor, ceiling] of BUDGET) {
    it(`draws at least ${floor} paragraphs in ${id}, so the budget is about something`, () => {
      open();
      const drawn = paragraphs(id);
      expect(drawn.length).toBeGreaterThanOrEqual(floor);
      // And none of them is empty: a row whose caption is '' would shrink the
      // number below while telling the operator nothing at all.
      expect(drawn.filter((text) => words(text) < 3)).toEqual([]);
    });

    it(`keeps ${id}'s prose inside ${ceiling} words`, () => {
      open();
      const drawn = paragraphs(id);
      const total = drawn.reduce((sum, text) => sum + words(text), 0);
      const longest = [...drawn].sort((a, b) => words(b) - words(a))[0] ?? '';
      expect(
        total,
        `${id} reads ${total} words over ${drawn.length} paragraphs; the longest is ${words(longest)}: ${JSON.stringify(longest)}`,
      ).toBeLessThanOrEqual(ceiling);
    });

    /**
     * AND NO SINGLE PARAGRAPH IS AN ESSAY. The total can be met by one wall of
     * text under a switch and six one-liners, which is the shape the operator
     * actually complained about: they do not read a panel, they read the row
     * they are standing on. 60 is the concise-output disclosure, which is the
     * longest for a reason -- it is the only switch whose "on" position types
     * vam's own words into somebody's session, and it owes four facts.
     */
    it(`gives no row in ${id} a paragraph longer than 60 words`, () => {
      open();
      const essays = paragraphs(id)
        .filter((text) => words(text) > 60)
        .map((text) => `${words(text)}: ${text.slice(0, 48)}…`);
      expect(essays).toEqual([]);
    });
  }
});
