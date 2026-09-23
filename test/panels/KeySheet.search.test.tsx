// @vitest-environment happy-dom

/**
 * THE `?` SHEET AS THE OPERATOR ASKED FOR IT.
 *
 * Translated: "the shortcut table when you press `?` needs a search box,
 * clearer section separation, and a one-column layout with the label on one
 * side and the shortcut on the other."
 *
 * WHAT THIS FILE OWNS AND WHAT IT CANNOT: the box, what it filters, what an
 * empty result says, and where the keyboard goes — all of which are facts
 * about the DOM. Whether the label and the chord really land on opposite sides
 * of a row, whether a section boundary reads as one, and whether anything
 * leaves the panel at a narrow window are RECTANGLES, and happy-dom lays
 * nothing out: `e2e/key-sheet-shots.mjs` measures those in Chromium.
 *
 * THE FOCUS DECISION, MADE DELIBERATELY AND PINNED HERE. The box takes the
 * keyboard when the sheet opens, because a search box a keyboard-first tool
 * makes you Tab to is a control its own users cannot find. Two things follow
 * and both are asserted below:
 *
 *   `?` TYPES A QUESTION MARK. The window listener stands aside for an INPUT
 *   (`Canvas.tsx`'s `typing` guard), so the character reaches the box — which
 *   is what lets an operator search for the `?` key itself.
 *
 *   ESCAPE HAS TO BE CAUGHT HERE. That same guard means the canvas never sees
 *   an Escape typed in this box, so without a handler of its own the sheet
 *   would have no keyboard way out — a trap, not a rough edge. It is the
 *   palette's idiom, for the palette's reason.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_BINDINGS, setActiveBindings } from '../../src/renderer/keyboard/chords.js';
import { buildFilesSheet, buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
import { KeySheet } from '../../src/renderer/panels/KeySheet.js';
import { onBothPlatforms } from '../support/platform.js';

afterEach(() => {
  cleanup();
  setActiveBindings(NO_BINDINGS);
});

const search = () => document.querySelector<HTMLInputElement>('[data-key-sheet-search]');
const rows = () => [...document.querySelectorAll('[data-key-sheet] li')];
const labels = () =>
  [...document.querySelectorAll('[data-key-sheet-label]')].map((each) => each.textContent ?? '');
const chords = () =>
  [...document.querySelectorAll('[data-key-sheet-keys]')].map((each) => each.textContent ?? '');
const headings = () => [...document.querySelectorAll('[data-key-sheet-group]')];

/** Type into the box the way the operator does: a real input event. */
function type(text: string) {
  const box = search() as HTMLInputElement;
  fireEvent.change(box, { target: { value: text } });
}

describe('the sheet has a search box', () => {
  it('draws one, names it, and gives it the keyboard on open', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const box = search();
    expect(box, 'no search box on the sheet').not.toBeNull();
    // Named for a screen reader as well as placeheld for an eye.
    expect(box?.getAttribute('aria-label')).toBeTruthy();
    expect(box?.placeholder ?? '').not.toBe('');
    expect(document.activeElement).toBe(box);
  });

  it('filters by what an action is called', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const all = rows().length;
    expect(all).toBeGreaterThan(80);
    type('palette');
    expect(rows().length).toBeLessThan(all);
    expect(rows().length).toBeGreaterThan(0);
    for (const label of labels()) {
      expect(label.toLowerCase()).toContain('palette');
    }
  });

  it('filters by the key itself, in the spelling this platform paints', () => {
    onBothPlatforms((mac) => {
      render(<KeySheet onClose={vi.fn()} />);
      type(mac ? '⌘ k' : 'ctrl+k');
      expect(chords()).toContain(mac ? '⌘ K' : 'Ctrl+K');
      expect(rows().length).toBeLessThan(10);
      cleanup();
    });
  });

  it('says so rather than going blank when nothing matches', () => {
    render(<KeySheet onClose={vi.fn()} />);
    type('zzzznothing');
    expect(rows()).toHaveLength(0);
    const empty = document.querySelector('[data-key-sheet-empty]');
    expect(empty, 'an empty sheet with no sentence reads as broken').not.toBeNull();
    // It names what was searched for, so the operator can see their own typo.
    expect(empty?.textContent ?? '').toContain('zzzznothing');
    // And it is announced, not only drawn: the rows vanished under a keystroke
    // the operator made without looking at the list.
    expect(empty?.getAttribute('role')).toBe('status');
  });

  it('comes back when the box is cleared', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const all = rows().length;
    type('palette');
    expect(rows().length).toBeLessThan(all);
    type('');
    expect(rows().length).toBe(all);
    expect(document.querySelector('[data-key-sheet-empty]')).toBeNull();
  });
});

describe('the keyboard, with the box holding it', () => {
  it('closes on Escape typed in the box — the canvas never hears that one', () => {
    const onClose = vi.fn();
    render(<KeySheet onClose={onClose} />);
    const prevented = !fireEvent.keyDown(search() as HTMLInputElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Cancelled, so the window listener cannot also act on it: two handlers on
    // one Escape is how a press closes two layers at once.
    expect(prevented).toBe(true);
  });

  it('lets `?` be typed rather than treating it as the sheet’s own key', () => {
    const onClose = vi.fn();
    render(<KeySheet onClose={onClose} />);
    const notPrevented = fireEvent.keyDown(search() as HTMLInputElement, { key: '?' });
    expect(notPrevented, 'the sheet swallowed a character the box was owed').toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    // And it really is searchable: `?` is a binding of its own.
    type('?');
    expect(chords()).toContain('?');
  });

  it('still gives the keyboard back to where it came from', () => {
    const away = document.createElement('button');
    document.body.append(away);
    away.focus();
    const { unmount } = render(<KeySheet onClose={vi.fn()} />);
    expect(document.activeElement).toBe(search());
    unmount();
    expect(document.activeElement).toBe(away);
    away.remove();
  });
});

describe('one column, label left and key right', () => {
  it('lays the rows out in a single column', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const list = document.querySelector('[data-key-sheet-groups]');
    expect(list, 'no group container to hold one column').not.toBeNull();
    // The two-column grid is what the operator asked to be rid of. Asserted as
    // the absence of the class that made it two, plus the rectangles in
    // `e2e/key-sheet-shots.mjs` — a class alone proves only that somebody
    // typed it.
    expect(list?.className ?? '').not.toMatch(/grid-cols-2/);
  });

  it('puts the label before the key in every row, in reading order', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const drawn = rows();
    expect(drawn.length).toBeGreaterThan(80);
    for (const row of drawn) {
      const label = row.querySelector('[data-key-sheet-label]');
      const keys = row.querySelector('[data-key-sheet-keys]');
      expect(label, row.outerHTML).not.toBeNull();
      expect(keys, row.outerHTML).not.toBeNull();
      // DOCUMENT ORDER is what a screen reader reads and what the flex row
      // paints: the action first, the keystroke last.
      expect(
        (label as Element).compareDocumentPosition(keys as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        row.textContent ?? '',
      ).toBeTruthy();
    }
  });

  it('gives every group a heading of its own, and none an empty one', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const built = [...buildKeySheet(), ...buildFilesSheet()];
    expect(headings()).toHaveLength(built.length);
    for (const heading of headings()) {
      expect((heading.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('drops a heading whose rows the search took away', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const before = headings().length;
    type('palette');
    expect(headings().length).toBeLessThan(before);
    expect(headings().length).toBeGreaterThan(0);
  });
});

/**
 * THE DISCLOSURES ARE LOAD-BEARING AND THE NEW ROW KEEPS THEM WHOLE.
 * `Mod-k` and `Mod-d` answer Control as well on a Mac and the captions say so;
 * `test/keyboard/chords.half-page.test.ts` asserts their words. A row that put
 * the caption and the chord on one line is exactly the shape that tempts a
 * truncation, so this reads the caption back off the rendered sheet.
 */
describe('the captions that disclose a second key survive the new row', () => {
  it('prints the half-page caption in full, both spellings named', () => {
    render(<KeySheet onClose={vi.fn()} />);
    type('transcript');
    const printed = labels();
    expect(printed.length).toBeGreaterThan(0);
    const disclosing = printed.filter((label) => label.includes('Cmd+D'));
    expect(disclosing.length, 'the Ctrl+D / Cmd+D disclosure is gone').toBeGreaterThan(0);
    for (const label of disclosing) {
      expect(label).toContain('Ctrl+D');
    }
    // Nothing is elided: the row prints the whole caption rather than a
    // truncation with an ellipsis in it.
    expect(printed.some((label) => label.endsWith('…'))).toBe(false);
  });

  it('still shows a dead key’s mark beside its own row', () => {
    // Two actions on one chord: the sheet keeps both rows and marks the one
    // the keystroke does not reach.
    setActiveBindings({ palette: ['r'] });
    render(<KeySheet onClose={vi.fn()} />);
    const dead = document.querySelector('[data-key-sheet-dead]');
    expect(dead, 'no dead mark for a contested key').not.toBeNull();
    expect(dead?.textContent ?? '').toContain('has this key');
    // The mark rides with the LABEL, not in place of the chord: the chord
    // column is the one thing every row has.
    const row = dead?.closest('li');
    expect(row?.querySelector('[data-key-sheet-keys]')?.textContent).toBe('r');
  });
});

describe('the sheet is still the dialog it was', () => {
  it('keeps its marker, its role and its way out', () => {
    const onClose = vi.fn();
    render(<KeySheet onClose={onClose} />);
    const sheet = document.querySelector('[data-key-sheet]');
    expect(sheet?.getAttribute('role')).toBe('dialog');
    expect(sheet?.getAttribute('aria-modal')).toBe('true');
    fireEvent.mouseDown(screen.getByLabelText('close keyboard shortcuts'));
    expect(onClose).toHaveBeenCalled();
  });
});
