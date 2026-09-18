// @vitest-environment happy-dom

/**
 * WHICH PANEL A CONTROL IS IN — the operator's own split, asserted as a fact
 * about the tree rather than as a list of strings.
 *
 * Operator, translated: "can you separate the appearance and colour settings
 * from the feature settings?" So Appearance keeps the rows that choose a
 * COLOUR or a TYPE SIZE, and everything whose subject is what vam DOES moved
 * into Behaviour.
 *
 * THE RULE THAT DECIDES A ROW, written here because a split nobody can
 * re-derive is a split that drifts: NAME THE THING THE OPERATOR IS CHOOSING,
 * NOT THE MACHINERY IT MOVES. `terminal text` is a type size and stays in
 * Appearance even though tmux is told a new column count; `file editor
 * colours` is a colour and stays even though the switch also stops a scanner
 * running. `view width` is a width -- the width IS the choice -- so it moved,
 * and so did `file editor indent`, whose value is bytes in the operator's own
 * file.
 *
 * TWO DIRECTIONS, ALWAYS. A row asserted only to be in its new panel would
 * pass while it was drawn in BOTH, which is what a half-finished move actually
 * produces. Every row below is claimed present in one panel and absent from
 * the other.
 */

import { cleanup, render } from '@testing-library/react';
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
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={vi.fn()} onClose={vi.fn()} />);
}

/** The panel with this id, as an element a query can be scoped to. */
const panel = (id: string) => document.querySelector(`[data-settings-panel="${id}"]`);

/** How many matches a selector has INSIDE one panel. `-1` for "no such panel",
 *  which fails both directions of every claim below rather than reading as a
 *  tidy zero. */
const countIn = (id: string, selector: string) =>
  panel(id)?.querySelectorAll(selector).length ?? -1;

/**
 * The rows that moved, and the rows that did not, named by a selector that
 * picks out the CONTROL rather than its caption: a label can be reworded, and
 * this claim is about where the switch is.
 */
const MOVED: readonly (readonly [string, string])[] = [
  ['view width', '[data-switch="narrow-views"]'],
  ['focus view', '[data-switch="focus-view"]'],
  ['file editor indent', 'input[aria-label="editor indent"]'],
];

const STAYED: readonly (readonly [string, string])[] = [
  ['the colour templates', '[data-palette-template]'],
  ['the colour swatches', '[data-palette-swatch]'],
  ['out text', 'input[aria-label="out text size"]'],
  ['terminal text', '[data-terminal-size-option]'],
  ['the terminal colours', '[data-terminal-swatch]'],
  ['file editor colours', '[data-switch="editor-highlight"]'],
];

describe('the settings nav offers Behaviour beside Appearance', () => {
  it('lists it, once, immediately after Appearance', () => {
    // POSITION IS AN ARGUMENT HERE, not a shrug (`SECTIONS` says so): the rows
    // in it were in Appearance yesterday, so an operator hunting for focus
    // view finds it one step from where it was.
    const ids = SECTIONS.map((section) => section.id);
    expect(ids.filter((id) => id === 'behaviour')).toHaveLength(1);
    expect(ids.indexOf('behaviour')).toBe(ids.indexOf('appearance') + 1);
  });

  it('is not one of the sections a phone may act on', () => {
    // `PHONE_SECTIONS`' argument applies to this section unchanged: every row
    // in it is `prefs`, which is `localStorage` ON THE DEVICE LOOKING.
    expect([...PHONE_SECTIONS]).not.toContain('behaviour');
  });

  it('draws a panel with a heading and a hint of its own', () => {
    open();
    expect(panel('behaviour')).not.toBeNull();
    expect(countIn('behaviour', '[data-settings-heading]')).toBe(1);
    expect(countIn('behaviour', '[data-settings-panel-hint]')).toBe(1);
  });
});

describe('every row is in exactly one panel', () => {
  for (const [what, selector] of MOVED) {
    it(`${what} is in Behaviour and nowhere in Appearance`, () => {
      open();
      expect(countIn('behaviour', selector)).toBeGreaterThan(0);
      expect(countIn('appearance', selector)).toBe(0);
    });
  }

  for (const [what, selector] of STAYED) {
    it(`${what} is in Appearance and nowhere in Behaviour`, () => {
      open();
      expect(countIn('appearance', selector)).toBeGreaterThan(0);
      expect(countIn('behaviour', selector)).toBe(0);
    });
  }
});

describe('the move keeps every stored value', () => {
  it('an operator who had focus view on still has it on', () => {
    // THE WHOLE RISK OF A MOVE, stated as a test. Nothing here is a migration:
    // the pref keys did not change, so a stored `true` must still light the
    // switch in its new home.
    open({ ...EMPTY_PREFS, focusView: true, narrowViews: true, editorIndent: 4 });
    expect(
      panel('behaviour')?.querySelector('[data-switch="focus-view"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      panel('behaviour')
        ?.querySelector('[data-switch="narrow-views"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      panel('behaviour')?.querySelector<HTMLInputElement>('input[aria-label="editor indent"]')
        ?.value,
    ).toBe('4');
  });
});
