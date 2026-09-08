/**
 * `tabForDigit` is the SINGLE place `Alt+<digit>` gets turned into a view.
 *
 * A5.4/A15.6: the digit names a FIXED SLOT in `TABS` — `Alt-3` is Terminal,
 * always, because that is where Terminal sits in the bar's own order — and
 * `visible` answers only whether that name is currently drawn. A digit whose
 * name is withdrawn REFUSES; it must never fall through to whatever else
 * happens to occupy that position in the shorter, drawn list. That fallthrough
 * is the exact bug this module's header records, and the guard that used to
 * live here asserted it as the wanted behaviour instead of catching it — it
 * was falsified against indexing the FULL `TABS` list (a different wrong
 * thing) and so never exercised the property A5.4 actually specifies.
 */

import { describe, expect, it } from 'vitest';
import { tabForDigit, visibleTabs } from '../../src/renderer/panels/tabs.js';

describe('tabForDigit resolves by NAME — a fixed position in TABS — never by counting the drawn list', () => {
  it('returns the Nth name in TABS, 1-based, when every tab is drawn', () => {
    const drawn = visibleTabs(true);
    expect(tabForDigit(drawn, 1)).toBe('Response');
    expect(tabForDigit(drawn, 2)).toBe('PRs');
    expect(tabForDigit(drawn, 3)).toBe('Terminal');
    expect(tabForDigit(drawn, 4)).toBe('Agents');
  });

  it('is undefined past the end of TABS, never a wrap or a clamp', () => {
    const drawn = visibleTabs(true);
    expect(tabForDigit(drawn, 5)).toBeUndefined();
    expect(tabForDigit(drawn, 0)).toBeUndefined();
  });

  /**
   * THE BUG ITSELF, falsified directly (A15.6): with Terminal withdrawn,
   * `Alt-3` must REFUSE — not silently resolve to Agents because Agents
   * happens to sit third in the shorter, drawn list. Terminal's name is what
   * digit 3 means; the source just said it has none.
   */
  it('digit 3 refuses when Terminal is withdrawn — it never becomes Agents', () => {
    const drawn = visibleTabs(false); // Terminal withdrawn
    expect(drawn).toEqual(['Response', 'PRs', 'Agents']);
    expect(tabForDigit(drawn, 3)).toBeUndefined();
  });

  /**
   * The other half of name-stability: Agents does not inherit Terminal's old
   * digit, and it does not lose its own. Agents is TABS[3] — digit 4 — with
   * or without Terminal on the bar.
   */
  it('every surviving name keeps its OWN digit when Terminal is withdrawn', () => {
    const drawn = visibleTabs(false);
    expect(tabForDigit(drawn, 1)).toBe('Response');
    expect(tabForDigit(drawn, 2)).toBe('PRs');
    expect(tabForDigit(drawn, 4)).toBe('Agents');
  });

  it('refuses every digit for a source with nothing drawn at all', () => {
    expect(tabForDigit([], 1)).toBeUndefined();
    expect(tabForDigit([], 3)).toBeUndefined();
  });

  it('agrees with the full bar when nothing is withdrawn', () => {
    const drawn = visibleTabs(true);
    expect(tabForDigit(drawn, 3)).toBe('Terminal');
  });
});
