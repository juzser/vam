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
import { TABS, tabForDigit, visibleTabs } from '../../src/renderer/panels/tabs.js';

describe('tabForDigit resolves by NAME — a fixed position in TABS — never by counting the drawn list', () => {
  it('returns the Nth name in TABS, 1-based, when every tab is drawn', () => {
    const drawn = visibleTabs(true, true, false);
    expect(tabForDigit(drawn, 1)).toBe('Response');
    expect(tabForDigit(drawn, 2)).toBe('PRs');
    expect(tabForDigit(drawn, 3)).toBe('Terminal');
    expect(tabForDigit(drawn, 4)).toBe('Agents');
    expect(tabForDigit(drawn, 5)).toBe('Files');
  });

  it('is undefined past the end of TABS, never a wrap or a clamp', () => {
    const drawn = visibleTabs(true, true, false);
    expect(tabForDigit(drawn, 6)).toBeUndefined();
    expect(tabForDigit(drawn, 0)).toBeUndefined();
  });

  /**
   * THE BUG ITSELF, falsified directly (A15.6): with Terminal withdrawn,
   * `Alt-3` must REFUSE — not silently resolve to Agents because Agents
   * happens to sit third in the shorter, drawn list. Terminal's name is what
   * digit 3 means; the source just said it has none.
   */
  it('digit 3 refuses when Terminal is withdrawn — it never becomes Agents', () => {
    const drawn = visibleTabs(false, true, false); // Terminal withdrawn, Files drawn
    expect(drawn).toEqual(['Response', 'PRs', 'Agents', 'Files']);
    expect(tabForDigit(drawn, 3)).toBeUndefined();
  });

  /**
   * The other half of name-stability: Agents does not inherit Terminal's old
   * digit, and it does not lose its own. Agents is TABS[3] — digit 4 — with
   * or without Terminal on the bar.
   */
  it('every surviving name keeps its OWN digit when Terminal is withdrawn', () => {
    const drawn = visibleTabs(false, true, false);
    expect(tabForDigit(drawn, 1)).toBe('Response');
    expect(tabForDigit(drawn, 2)).toBe('PRs');
    expect(tabForDigit(drawn, 4)).toBe('Agents');
    expect(tabForDigit(drawn, 5)).toBe('Files');
  });

  it('refuses every digit for a source with nothing drawn at all', () => {
    expect(tabForDigit([], 1)).toBeUndefined();
    expect(tabForDigit([], 3)).toBeUndefined();
  });

  it('agrees with the full bar when nothing is withdrawn', () => {
    const drawn = visibleTabs(true, true, false);
    expect(tabForDigit(drawn, 3)).toBe('Terminal');
  });
});

/**
 * `Files` is the fifth, APPENDED slot, and it is withdrawn the OPPOSITE way
 * Terminal is: absent unless a caller has actually confirmed there is a
 * desktop bridge behind it. See `visibleTabs`'s own header for why the two
 * arguments default in opposite directions.
 */
describe('Files — appended, and withdrawn until a caller confirms the bridge exists', () => {
  it('is drawn LAST, after Agents, keeping every earlier digit unchanged', () => {
    const drawn = visibleTabs(true, true, false);
    expect(drawn).toEqual(['Response', 'PRs', 'Terminal', 'Agents', 'Files']);
  });

  it('is withdrawn when the caller passes false, same as Terminal', () => {
    const drawn = visibleTabs(true, false, false);
    expect(drawn).toEqual(['Response', 'PRs', 'Terminal', 'Agents']);
    expect(tabForDigit(drawn, 5)).toBeUndefined();
  });

  it('withdraws independently of Terminal — neither flag leaks into the other', () => {
    expect(visibleTabs(false, false, false)).toEqual(['Response', 'PRs', 'Agents']);
    expect(visibleTabs(true, false, false)).toEqual(['Response', 'PRs', 'Terminal', 'Agents']);
    expect(visibleTabs(false, true, false)).toEqual(['Response', 'PRs', 'Agents', 'Files']);
    expect(visibleTabs(true, true, false)).toEqual([
      'Response',
      'PRs',
      'Terminal',
      'Agents',
      'Files',
    ]);
  });
});

/**
 * `PRs` IS WITHDRAWN FROM THE PHONE, and it is withdrawn HERE — the third
 * withdrawal this one function holds, in the shape of the two above it.
 *
 * The operator's instruction, after a mobile audit: vam on a phone exists to
 * send a prompt and read the answer, and the PRs view serves neither — while
 * being the only place a phone can do something irreversible to a real GitHub
 * repository (`data-pr-merge`, `data-pr-delete-branch`).
 *
 * THE THIRD ARGUMENT IS A FACT ABOUT THE SHELL, NOT A CAPABILITY, which is why
 * its polarity is the other way round from `terminal` and `files`: those two
 * ask "can this source or build offer it", and a caller passing `true` for
 * `phone` is not offering anything — it is saying which shell it is. The
 * POLICY, that a phone does not get PRs, stays inside `visibleTabs` so the
 * three callers cannot each keep their own copy of it. That is the whole
 * reason this module exists, and the reason two bugs are recorded in its
 * header.
 */
describe('PRs — withdrawn from the phone, because a phone is for prompting and reading', () => {
  it('leaves Response and Agents, and nothing else, on the shell a real phone gets', () => {
    // What a real phone actually passes: no terminal (the remote server's
    // `UNSERVED` turns it off for every remote client) and no files (there is
    // no desktop bridge behind a browser build, ever).
    expect(visibleTabs(false, false, true)).toEqual(['Response', 'Agents']);
  });

  it('withdraws PRs and ONLY PRs — the other two flags keep their own answers', () => {
    expect(visibleTabs(true, true, true)).toEqual(['Response', 'Terminal', 'Agents', 'Files']);
    expect(visibleTabs(true, false, true)).toEqual(['Response', 'Terminal', 'Agents']);
    expect(visibleTabs(false, true, true)).toEqual(['Response', 'Agents', 'Files']);
  });

  it('keeps PRs on every desktop shell, whatever the other two say', () => {
    for (const terminal of [true, false]) {
      for (const files of [true, false]) {
        expect(visibleTabs(terminal, files, false), `${terminal}/${files}`).toContain('PRs');
      }
    }
  });

  /**
   * THE TRAP THIS MODULE EXISTS TO PREVENT, re-falsified against the NEW
   * withdrawal (A5.4/A15.6). A withdrawn name must not make the names after it
   * slide up a digit. A phone has no chord layer at all — `Canvas` returns
   * before installing one — but `tabForDigit` is SHARED, so the property is
   * asserted against a phone list too: digit 2 REFUSES, and 3/4/5 still mean
   * Terminal/Agents/Files rather than sliding one place left into 2/3/4.
   */
  it('does not renumber a single digit: 2 refuses, and 3/4/5 keep their own names', () => {
    const drawn = visibleTabs(true, true, true);
    expect(tabForDigit(drawn, 1)).toBe('Response');
    expect(tabForDigit(drawn, 2)).toBeUndefined();
    expect(tabForDigit(drawn, 3)).toBe('Terminal');
    expect(tabForDigit(drawn, 4)).toBe('Agents');
    expect(tabForDigit(drawn, 5)).toBe('Files');
    expect(tabForDigit(drawn, 6)).toBeUndefined();
  });

  it('leaves the desktop digit→view mapping exactly as it was', () => {
    const desktop = visibleTabs(true, true, false);
    expect(TABS.map((_, index) => tabForDigit(desktop, index + 1))).toEqual([
      'Response',
      'PRs',
      'Terminal',
      'Agents',
      'Files',
    ]);
  });
});
