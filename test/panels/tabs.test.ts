/**
 * `tabForDigit` is the SINGLE place `Alt+<digit>` gets turned into a view.
 *
 * This module's own header already records the bug the whole design exists to
 * prevent: a handler that counted `TABS` while the bar drew `visibleTabs`
 * opened a view that was not there. `tabForDigit` takes the DRAWN list — never
 * `TABS` itself — so a caller cannot make that mistake by construction: there
 * is no version of this function that accepts the unfiltered constant.
 */

import { describe, expect, it } from 'vitest';
import { TABS, tabForDigit, visibleTabs } from '../../src/renderer/panels/tabs.js';

describe('tabForDigit resolves by name, never by counting TABS', () => {
  it('returns the Nth entry of the list it is given, 1-based', () => {
    expect(tabForDigit(TABS, 1)).toBe('Response');
    expect(tabForDigit(TABS, 2)).toBe('PRs');
    expect(tabForDigit(TABS, 3)).toBe('Terminal');
    expect(tabForDigit(TABS, 4)).toBe('Agents');
  });

  it('is undefined past the end of the list, never a wrap or a clamp', () => {
    expect(tabForDigit(TABS, 5)).toBeUndefined();
    expect(tabForDigit(TABS, 0)).toBeUndefined();
  });

  /**
   * THE BUG ITSELF, falsified directly: with Terminal withdrawn, digit 3 must
   * resolve to Agents (the third DRAWN view) and digit 4 must refuse — not
   * resolve to Agents-by-position-in-TABS (which would be digit 4) and not
   * silently open Terminal, which the source just said it does not have.
   */
  it('digit 3 means the third drawn view, not the third of TABS', () => {
    const drawn = visibleTabs(false); // Terminal withdrawn
    expect(drawn).toEqual(['Response', 'PRs', 'Agents']);
    expect(tabForDigit(drawn, 3)).toBe('Agents');
    expect(tabForDigit(drawn, 4)).toBeUndefined();
  });

  it('agrees with the full bar when nothing is withdrawn', () => {
    const drawn = visibleTabs(true);
    expect(tabForDigit(drawn, 3)).toBe('Terminal');
  });
});
