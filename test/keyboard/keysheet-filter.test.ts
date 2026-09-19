/**
 * THE `?` SHEET'S SEARCH, AS A FUNCTION.
 *
 * The operator, translated: "the shortcut table when you press `?` needs a
 * search box, clearer section separation, and a one-column layout with the
 * label on one side and the shortcut on the other."
 *
 * The search is the half with a rule in it, so it is a pure function over the
 * sheet rather than a `filter` inside the component: what it matches — the
 * action's NAME and the KEY, in both spellings — is a decision that has to be
 * assertable without a DOM, and the component is then only a box and a list.
 *
 * BOTH PLATFORMS, ALWAYS PASSED. A chord reads ⌘P on a Mac and Ctrl+P off one,
 * so `mac` is a parameter here exactly as it is in `chordSymbols`: a case that
 * read the host's platform would search a different string on ubuntu than on
 * the operator's Mac while looking identical in both.
 */

import { describe, expect, it } from 'vitest';
import {
  buildFilesSheet,
  buildKeySheet,
  filterSheet,
} from '../../src/renderer/keyboard/keysheet.js';

/** The whole sheet as the overlay assembles it: the grammar, then the Files
 *  tab's own keyboard. */
const sheet = (mac: boolean) => [...buildKeySheet(), ...buildFilesSheet(undefined, mac)];

const rowsOf = (groups: ReturnType<typeof filterSheet>) => groups.flatMap((group) => group.rows);

describe('the sheet filter', () => {
  it('returns the whole sheet for an empty query, and for whitespace', () => {
    for (const mac of [true, false]) {
      const all = sheet(mac);
      expect(filterSheet(all, '', mac)).toEqual(all);
      expect(filterSheet(all, '   ', mac)).toEqual(all);
    }
  });

  it('walks a real corpus — every case below is vacuous over an empty sheet', () => {
    expect(rowsOf(sheet(true)).length).toBeGreaterThan(80);
  });

  it('matches the action’s name', () => {
    for (const mac of [true, false]) {
      const found = rowsOf(filterSheet(sheet(mac), 'palette', mac));
      expect(found.length).toBeGreaterThan(0);
      for (const row of found) {
        expect(row.label.toLowerCase()).toContain('palette');
      }
    }
  });

  /** The operator's own example: typing the KEY finds the row, in whichever
   *  spelling this machine paints. */
  it('matches the chord as it is painted, on each platform', () => {
    const mac = rowsOf(filterSheet(sheet(true), '⌘p', true)).map((row) => row.keys);
    expect(mac).toContain('Mod-p');
    const pc = rowsOf(filterSheet(sheet(false), 'ctrl+p', false)).map((row) => row.keys);
    expect(pc).toContain('Mod-p');
    // And the two spellings do not cross: a Mac operator typing the Windows
    // rendering is not searching for anything on their own screen.
    expect(rowsOf(filterSheet(sheet(true), 'ctrl+p', true))).toEqual([]);
  });

  /** And in the grammar's own spelling, which is what the README prints. */
  it('matches the token an operator may have read in the README', () => {
    for (const mac of [true, false]) {
      expect(rowsOf(filterSheet(sheet(mac), 'mod-shift-e', mac)).map((row) => row.keys)).toContain(
        'Mod-Shift-e',
      );
    }
  });

  it('is case-insensitive, and every word has to land somewhere', () => {
    for (const mac of [true, false]) {
      const one = rowsOf(filterSheet(sheet(mac), 'PANE', mac));
      expect(one.length).toBeGreaterThan(1);
      // Two words narrow rather than widen: this is an AND, so a query that
      // reads like a sentence finds the row the sentence describes.
      const two = rowsOf(filterSheet(sheet(mac), 'reset pane', mac));
      expect(two.length).toBeGreaterThan(0);
      expect(two.length).toBeLessThan(one.length);
      for (const row of two) {
        expect(row.label.toLowerCase()).toContain('reset');
        expect(row.label.toLowerCase()).toContain('pane');
      }
    }
  });

  it('drops a group that has nothing left, rather than printing an empty heading', () => {
    for (const mac of [true, false]) {
      const groups = filterSheet(sheet(mac), 'palette', mac);
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group.rows.length, `"${group.title}" is an empty heading`).toBeGreaterThan(0);
      }
    }
  });

  it('answers nothing at all for a query nothing matches — the caller says so', () => {
    for (const mac of [true, false]) {
      expect(filterSheet(sheet(mac), 'zzzznothing', mac)).toEqual([]);
    }
  });

  it('keeps each group’s rows in the order the sheet built them', () => {
    for (const mac of [true, false]) {
      const all = sheet(mac);
      const kept = filterSheet(all, 'the', mac);
      for (const group of kept) {
        const original = all.find((each) => each.group === group.group);
        const order = (original?.rows ?? []).filter((row) => group.rows.includes(row));
        expect(group.rows).toEqual(order);
      }
    }
  });

  /**
   * THE DISCLOSURES SURVIVE THE SEARCH. `Mod-d` and `Mod-k` answer Control as
   * well on a Mac, and the captions that say so are load-bearing
   * (`test/keyboard/chords.half-page.test.ts` asserts their words). A filter
   * that matched on a truncated label, or a row that dropped its caption to
   * fit a narrower column, would take that with it.
   */
  it('carries the half-page disclosure through, caption and all', () => {
    for (const mac of [true, false]) {
      const found = rowsOf(filterSheet(sheet(mac), 'transcript', mac));
      expect(found.length).toBeGreaterThan(0);
      const both = found.filter((row) => row.label.includes('Cmd+D'));
      expect(both.length, 'the Ctrl+D / Cmd+D disclosure is gone').toBeGreaterThan(0);
      for (const row of both) {
        expect(row.label).toContain('Ctrl+D');
      }
    }
  });
});
