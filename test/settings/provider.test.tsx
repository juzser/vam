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
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    expect([...(panel()?.querySelectorAll('button') ?? [])]).toEqual([]);
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
    expect(screen.getByText('sessions')).toBeTruthy();
  });

  it('writes nothing at all: there is no act left in this section', () => {
    const { onChange } = open();
    for (const node of panel()?.querySelectorAll('*') ?? []) {
      fireEvent.click(node);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});
