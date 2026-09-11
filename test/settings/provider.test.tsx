// @vitest-environment happy-dom

/**
 * The default provider, at the surface the operator touches — AND THE SHAPE IT
 * TAKES WHILE THERE IS NOTHING TO PICK.
 *
 * `PROVIDERS` (`src/shared/providers.ts`) has exactly one row and will until a
 * second source exists in main. A segmented picker drawn over that row is a
 * control that cannot act: its one button is `aria-pressed` from the first
 * paint, it hovers, it takes the keyboard, and clicking it writes a `Prefs`
 * identical to the one it was handed. That is the defect `RemotePanel`'s own
 * header names in this same directory -- "A CONTROL THAT CANNOT ACT IS NOT
 * DRAWN AS ONE" -- so while the table has one row the section STATES the
 * provider instead of offering it.
 *
 * The picker is not deleted, it is conditional: `provider-double.test.tsx`
 * mocks a two-row table and asserts it comes back, with its write intact. The
 * two files together are the whole rule, and neither can pass for the other's
 * reason.
 *
 * TWO ASSERTIONS BELOW ARE SCOPED TO THE ROW, NOT TO THE SECTION, and that is
 * a correction rather than a loosening. "Nothing in here is pressable" and
 * "nothing in here writes" are claims about THE PROVIDER ROW; they were
 * addressed to `[data-settings-panel="sessions"]` because, while the panel held
 * exactly one row, the section WAS the row and the two could not be told apart.
 * They can now — the send-key picker is a second row in this section, and it is
 * a control that very much can act — so the assertions say which row they mean.
 * Anything else would make this file's subject "whatever else Sessions ever
 * grows", which is a question it was never written to answer.
 *
 * The row is found by its HEADING rather than by `[data-provider-fixed]`,
 * because that hook exists only in the no-picker state: anchoring on it would
 * make both assertions vacuous the day the picker comes back, which is the one
 * day they must still be read.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { SECTIONS } from '../../src/renderer/settings/sections.js';
import { PROVIDERS } from '../../src/shared/providers.js';

afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

const options = () => [...document.querySelectorAll('[data-provider-option]')];
const panel = () => document.querySelector('[data-settings-panel="sessions"]');
/** The provider ROW, by its heading — the one thing present in both states.
 *  `[data-settings-rows] > div` is a `Block`, the same scope
 *  `appearance.test.tsx` already reaches a single setting's row by. */
const row = () =>
  [...(panel()?.querySelectorAll('[data-settings-rows] > div') ?? [])].find(
    (block) => block.querySelector('h4')?.textContent === 'default provider',
  ) ?? null;

describe('the sessions section, while vam can start exactly one agent', () => {
  it('is measuring the one-row table this whole file is about', () => {
    // The precondition, stated rather than assumed. The day a second provider
    // ships this line reddens FIRST and names the file to revisit -- every
    // assertion below is about the one-row world, and the picker's own
    // behaviour is `provider-double.test.tsx`'s.
    expect(PROVIDERS).toHaveLength(1);
  });

  it('has a section of its own, since a provider is not paint or layout', () => {
    expect(SECTIONS.map((section) => section.id)).toContain('sessions');
    open();
    expect(panel()).not.toBeNull();
    expect(document.querySelector('[data-settings-nav-item="sessions"]')).not.toBeNull();
  });

  it('draws NO picker, because a one-option choice cannot act', () => {
    open();
    expect(options()).toEqual([]);
    // Nor anything else pressable in the row: the point is not the attribute,
    // it is that nothing here invites a click that changes nothing.
    expect(row(), 'the provider row was not found, so nothing below was read').not.toBeNull();
    expect([...(row()?.querySelectorAll('button') ?? [])]).toEqual([]);
  });

  it('still NAMES the provider, so the section reports rather than asking', () => {
    open();
    const fixed = panel()?.querySelector('[data-provider-fixed]');
    expect(fixed?.getAttribute('data-provider-fixed')).toBe(PROVIDERS[0]?.id);
    expect(fixed?.textContent).toBe(PROVIDERS[0]?.label);
  });

  it('says in words what a new session will run, rather than only naming it', () => {
    open();
    // The command is the whole of what the choice does; showing it is what
    // makes a one-provider section an answer rather than a stub.
    expect(panel()?.textContent).toContain(PROVIDERS[0]?.command.join(' '));
    // The panel heading is the section's LABEL now, matching the nav tab --
    // so it is queried as the heading rather than by text, which would find
    // both and fail on the agreement this change is for.
    expect(document.querySelector('[data-settings-panel="sessions"] h3')?.textContent).toBe(
      'Sessions',
    );
  });

  it('writes nothing at all: there is no act left in this row', () => {
    const { onChange } = open();
    expect(row(), 'the provider row was not found, so nothing was clicked').not.toBeNull();
    const clicked = [...(row()?.querySelectorAll('*') ?? [])];
    // A sweep that found nothing is a sweep that proves nothing: this row
    // carries a heading, a hint, the stated provider and the command line.
    expect(clicked.length).toBeGreaterThan(3);
    for (const node of clicked) {
      fireEvent.click(node);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});
