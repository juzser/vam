// @vitest-environment happy-dom

/**
 * WHICH CARD A BEHAVIOUR ROW IS IN — the cards restructure's own split of
 * what used to be one Appearance/Behaviour divide, asserted as a fact about
 * the tree rather than as a list of strings.
 *
 * Operator: "these are Orca's appearance settings; see what vam can do and
 * add it. Split into clear, separate sections." Behaviour is SMALLER now,
 * not gone: `view width` moved on to Window & Sidebar and `streaming
 * terminal` moved on to Terminal's own Advanced disclosure (both were
 * Behaviour rows before this restructure); `file editor colours` moved IN
 * from the old Appearance, joining `file editor indent` as a small "Files"
 * sub-group beside focus view. `settings/sections.ts` carries the rule that
 * decided each row's home.
 *
 * TWO DIRECTIONS, ALWAYS. A row asserted only to be in its new card would
 * pass while it was drawn in BOTH, which is what a half-finished move
 * actually produces. Every row below is claimed present in one card and
 * absent from the cards it could be confused with.
 *
 * NAVIGATED, NOT CO-MOUNTED, now (settings-views restructure, item C: "each
 * section in Settings should be its own view, not one long scroll"). Every
 * card used to be in the document at once (folded or not), so "absent from
 * a neighbour" and "present in its own card" were two queries against ONE
 * render. Now only the SELECTED section is mounted at all, so this file
 * clicks the nav item for each card in turn and asks the identical two
 * questions of whichever one is on screen -- the "absent from a neighbour"
 * half is no longer a free fact that mounting nothing else hands it (it
 * still has to prove the ROW does not accidentally live in the neighbour's
 * OWN section block, which clicking there and querying for real still
 * catches).
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { PHONE_SECTIONS, SECTIONS } from '../../src/renderer/settings/sections.js';

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
  render(
    <SettingsOverlay
      prefs={prefs}
      theme="dark"
      onChange={vi.fn()}
      onClose={vi.fn()}
      initialSection="behaviour"
    />,
  );
}

/** The card with this id, as an element a query can be scoped to. `null`
 *  unless THIS is the section the nav is currently on -- see `goTo` below. */
const card = (id: string) => document.querySelector(`[data-settings-panel="${id}"]`);

/** How many matches a selector has INSIDE one card. `-1` for "no such card
 *  mounted", which fails both directions of every claim below rather than
 *  reading as a tidy zero. */
const countIn = (id: string, selector: string) => card(id)?.querySelectorAll(selector).length ?? -1;

/** Selects a section by clicking its nav item -- the single-section-view
 *  restructure's own way of mounting one card and unmounting whichever was
 *  selected before it. */
const goTo = (id: string) => {
  fireEvent.click(document.querySelector(`[data-settings-nav-item="${id}"]`) as HTMLElement);
};

/** Every OTHER card a row named here could plausibly be confused with —
 *  named explicitly rather than "every section but its own", so a claim
 *  about neighbours stays about the neighbours the row's own history
 *  actually touched. */
const NEIGHBOURS = ['interface', 'terminal', 'window', 'agents', 'behaviour'] as const;

const ROWS: readonly (readonly [string, string, (typeof NEIGHBOURS)[number]])[] = [
  ['focus view', '[data-switch="focus-view"]', 'behaviour'],
  ['file editor indent', 'input[aria-label="editor indent"]', 'behaviour'],
  ['file editor colours', '[data-switch="editor-highlight"]', 'behaviour'],
  ['view width', '[data-switch="narrow-views"]', 'window'],
  ['streaming terminal', '[data-switch="streaming-terminal"]', 'terminal'],
  ['the colour templates', '[data-palette-template]', 'interface'],
  ['out text', 'input[aria-label="out text size"]', 'interface'],
  ['terminal text', '[data-terminal-size-option]', 'terminal'],
];

describe('the settings nav offers Behaviour, smaller than it was', () => {
  it('lists it once, right after the Agents/Skills pair', () => {
    // POSITION IS AN ARGUMENT HERE, not a shrug (`SECTIONS` says so): the
    // rows in it are what a turn shows and what a file holds, and Agents is
    // the other section whose own rows used to share a panel with them.
    // Skills (item D, the settings-views restructure) sits between the two
    // now -- its own card moved off Agents, not off Behaviour -- so
    // Behaviour's own neighbour above is Skills, not Agents directly.
    const ids = SECTIONS.map((section) => section.id);
    expect(ids.filter((id) => id === 'behaviour')).toHaveLength(1);
    expect(ids.indexOf('behaviour')).toBe(ids.indexOf('skills') + 1);
    expect(ids.indexOf('skills')).toBe(ids.indexOf('agents') + 1);
  });

  it('is not one of the sections a phone may act on', () => {
    // `PHONE_SECTIONS`' argument applies to this section unchanged: every row
    // in it is `prefs`, which is `localStorage` ON THE DEVICE LOOKING.
    expect([...PHONE_SECTIONS]).not.toContain('behaviour');
  });

  it('draws a card with a heading and a hint of its own', () => {
    open();
    expect(card('behaviour')).not.toBeNull();
    expect(countIn('behaviour', '[data-settings-heading]')).toBe(1);
    expect(countIn('behaviour', '[data-settings-panel-hint]')).toBe(1);
  });
});

describe('every row is in exactly the one card it belongs to', () => {
  for (const [what, selector, home] of ROWS) {
    it(`${what} is in ${home}, and nowhere else it could be confused with`, () => {
      render(
        <SettingsOverlay
          prefs={EMPTY_PREFS}
          theme="dark"
          onChange={vi.fn()}
          onClose={vi.fn()}
          initialSection={home}
        />,
      );
      expect(countIn(home, selector)).toBeGreaterThan(0);
      for (const other of NEIGHBOURS) {
        if (other === home) continue;
        goTo(other);
        expect(countIn(other, selector), `${what} also drawn in ${other}`).toBe(0);
      }
    });
  }
});

describe('the move keeps every stored value', () => {
  it('an operator who had these on still has them on, in their new homes', () => {
    // THE WHOLE RISK OF A MOVE, stated as a test. Nothing here is a
    // migration: the pref keys did not change, so a stored `true` must still
    // light the switch in its new home.
    open({
      ...EMPTY_PREFS,
      focusView: true,
      narrowViews: true,
      editorIndent: 4,
      editorHighlight: true,
      streamingTerminal: false,
    });
    expect(
      card('behaviour')?.querySelector('[data-switch="focus-view"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      card('behaviour')
        ?.querySelector('[data-switch="editor-highlight"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      card('behaviour')?.querySelector<HTMLInputElement>('input[aria-label="editor indent"]')
        ?.value,
    ).toBe('4');
    goTo('window');
    expect(
      card('window')?.querySelector('[data-switch="narrow-views"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    goTo('terminal');
    expect(
      card('terminal')
        ?.querySelector('[data-switch="streaming-terminal"]')
        ?.getAttribute('aria-checked'),
    ).toBe('false');
  });
});
