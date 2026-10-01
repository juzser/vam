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
 * The PROSE, never the whole card. Old Appearance rendered 372 words and about
 * a hundred and fifteen of them were control names -- thirteen colour tokens,
 * twelve terminal schemes, eight palette templates. Those are a list the
 * operator SCANS, not a paragraph they read, and a budget over a card's whole
 * text would be a budget on how many colours vam offers. So the corpus is
 * exactly the sentences: the card's own hint, and every `<p>` inside its
 * rows -- each row's caption and each note under a switch. `[data-settings-
 * rows] p` is scoped to `data-settings-rows` and the hint is a SIBLING of that
 * element, not a descendant (`primitives.tsx`'s own note on `SettingsCard`),
 * so counting both never double-counts one paragraph as two.
 *
 * ── A CEILING, NOT A TARGET ───────────────────────────────────────────────
 * Measured in happy-dom on the commit that split Appearance into cards
 * (interface/terminal/window/agents/behaviour, `settings/sections.ts`):
 *
 *   interface      5 paragraphs   52 words (longest 14)
 *   terminal       7 paragraphs  110 words (longest 23)
 *   window         6 paragraphs   63 words (longest 33) -- re-measured when
 *                  Settings step 2B added the sidebar-appearance and
 *                  status-bar rows `settings.window.hint` already named
 *   agents        13 paragraphs  172 words (longest 54) -- re-measured when
 *                  step 2B added keep-awake, auto tab titles, agent
 *                  permissions and default agent, THEN AGAIN when a security
 *                  review found the permissions row's own gate needed to be
 *                  "the real Electron desktop shell" (`window.api`), not
 *                  viewport width -- this harness has no `window.api`, so the
 *                  permissions row and its note (2 paragraphs) never draw
 *                  here at all, same as a paired browser tab would see
 *   behaviour      6 paragraphs  103 words (longest 38)
 *   notifications  5 paragraphs   79 words (longest 28) -- unchanged by the
 *                  cards restructure, and its ceiling stays the number the
 *                  Remote-style pass (#397) already tuned it to.
 *
 * The ceilings below give each a little over its own measured total -- this
 * is copy and it will be reworded -- so what they refuse is not a typo but a
 * paragraph coming back, the same slack the original Appearance/Behaviour
 * numbers carried.
 *
 * THE CORPUS IS ASSERTED FIRST. A budget over a card that drew no paragraphs
 * at all would pass forever, and this repo has shipped four guards that were
 * green having examined zero of anything. The count of paragraphs is checked
 * before their length, so "concise" can never be satisfied by "absent" -- and
 * every fact these paragraphs carry is held, sentence by sentence, by
 * `view-width`, `focus-view`, `streaming-terminal`, `terminal-colours` and
 * `appearance` in this same directory. This file is only about the size.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import type { SectionId } from '../../src/renderer/settings/sections.js';

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
  vi.unstubAllGlobals();
});

/**
 * Opens straight to the section under test -- the single-section-view
 * restructure (item C) means a section's own paragraphs are not in the
 * document at all until its nav item is the one selected, so every
 * budget below is measured against ITS OWN OPEN rather than one shared
 * render the old always-mounted page let every section borrow.
 */
function open(id: SectionId, prefs: Prefs = EMPTY_PREFS) {
  render(
    <SettingsOverlay
      prefs={prefs}
      theme="dark"
      onChange={vi.fn()}
      onClose={vi.fn()}
      initialSection={id}
    />,
  );
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
  // SPLIT OUT OF APPEARANCE. Theme, templates, out text, and (behind
  // Advanced, still counted -- `hidden` does not remove a node from the
  // tree) the per-token colour reset row. Measured 5 paragraphs, 52 words.
  ['interface', 5, 75],
  // SPLIT OUT OF APPEARANCE, the rest of it: terminal text, the two theme
  // rows, and (behind Advanced) the colour grid, the opacity row and the
  // streaming-terminal switch moved in from Behaviour. Measured 7, 110.
  // GREW by four paragraphs for the font/preview/divider work (settings
  // step 2A): the font-family row's hint, its "none detected" fallback
  // note (this harness has no `window.api.fonts` bridge, so it always
  // draws), the live-preview row's hint, and the pane-divider row's hint
  // behind Advanced. Re-measured at 11 paragraphs, 147 words -- the two
  // longest new hints were tightened by a few words apiece to land back
  // at 144, under the same 145 ceiling rather than raising it.
  ['terminal', 7, 145],
  // NEW, and small on purpose -- one row today. Settings step 2B added
  // sidebar appearance and the status-bar sub-group (usage mode, show
  // Claude, show Codex). Re-measured 6 paragraphs, 63 words; the ceiling
  // gives the same short-sentence slack `notifications` carries.
  ['window', 6, 72],
  // RENAMED FROM SESSIONS. Step 2B added keep-awake, auto tab titles, agent
  // permissions and default agent -- but the permissions row (hint + its
  // always-on note) is gated on `isDesktopShell()` (`prefs/agent-
  // permissions.ts`) and this harness has no `window.api`, so those 2
  // paragraphs never draw here at all (the confirmation risk copy was
  // already excluded the same way, being conditional on an open dialog this
  // harness never opens). THE ADHD SKILL CARD'S OWN PROSE LEFT, for its own
  // "Skills" section (settings-views restructure, item D) -- Agents dropped
  // from 13/172 to 10/160 the moment that card's hint, credit line, copy-
  // command hint and coverage hint stopped drawing here.
  ['agents', 10, 175],
  // SMALLER THAN IT WAS: `view width` and `streaming terminal` left for
  // Window & Sidebar and Terminal, and the file editor's own two rows (one
  // of them, `file editor colours`, moved IN from Appearance) joined focus
  // view as a small Files sub-group. Measured 6, 103.
  ['behaviour', 6, 135],
  // Its own hint, the switch's hint and three-fact note, the test button's
  // hint, and -- in this harness, which has no bridge -- the one line saying
  // only the desktop app can send one. UNCHANGED by the cards restructure:
  // this section did not move. Measured at 79 words over 5 paragraphs; the
  // ceiling leaves a short sentence of slack and refuses a second note.
  ['notifications', 5, 90],
  // NEW (settings-views restructure, item D): the ADHD skill card's own
  // prose, moved off Agents into its own section -- the section's own hint,
  // the card's title-adjacent hint, the copy-command hint and the coverage
  // hint (the credit line, 'pinned to ...', is gone: the repo link and stars
  // sit in the title row now). Measured 4 paragraphs, 23 words, with the bridge
  // stubbed (see `SKILLS_BRIDGE_STUB` below) -- unlike every other row in
  // this table, Skills does not draw AT ALL without one (`isDesktopOnlySection`,
  // item D's own "hide it where window.api is absent"), so measuring it
  // bridge-less would be measuring nothing.
  ['skills', 4, 45],
];

/** The one bridge call `AdhdSkillCard` reads on mount -- just enough for the
 *  section to exist at all in a harness with no real Electron shell, on the
 *  same minimal-stub idiom `terminal-colours.test.tsx`'s own font-family
 *  probes use. `'not-installed'`: the shortest-copy state, and the state
 *  every fresh install actually starts in. */
const SKILLS_BRIDGE_STUB = {
  adhdSkill: { status: vi.fn(async () => ({ overall: 'not-installed' as const, agents: [] })) },
};

/** Skills draws nothing at all without a bridge (`isDesktopOnlySection`,
 *  item D) -- every other section in `BUDGET` is measured bridge-less on
 *  purpose (several of their own rows fold away without one too, and that
 *  is the harness this table already tunes to), so only this one id stubs
 *  it, right before the render that needs it. */
function openForBudget(id: SectionId): void {
  if (id === 'skills') {
    vi.stubGlobal('window', Object.assign(globalThis.window, { api: SKILLS_BRIDGE_STUB }));
  }
  open(id);
}

describe('a settings panel says what a row does without arguing for it', () => {
  for (const [id, floor, ceiling] of BUDGET) {
    it(`draws at least ${floor} paragraphs in ${id}, so the budget is about something`, () => {
      openForBudget(id as SectionId);
      const drawn = paragraphs(id);
      expect(drawn.length).toBeGreaterThanOrEqual(floor);
      // And none of them is empty: a row whose caption is '' would shrink the
      // number below while telling the operator nothing at all.
      expect(drawn.filter((text) => words(text) < 3)).toEqual([]);
    });

    it(`keeps ${id}'s prose inside ${ceiling} words`, () => {
      openForBudget(id as SectionId);
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
      openForBudget(id as SectionId);
      const essays = paragraphs(id)
        .filter((text) => words(text) > 60)
        .map((text) => `${words(text)}: ${text.slice(0, 48)}…`);
      expect(essays).toEqual([]);
    });
  }
});
