// @vitest-environment happy-dom

/**
 * The default provider, at the surface the operator touches.
 *
 * The control offers exactly the providers vam can start -- one, today -- and
 * that is the assertion rather than an incidental count: a picker entry vam
 * has no command for is worse than a single honest choice, so the list is
 * derived from the provider table and the test says so by deriving it too.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { SECTIONS } from '../../src/renderer/settings/sections.js';
import { DEFAULT_PROVIDER_ID, PROVIDERS } from '../../src/shared/providers.js';

afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

const options = () => [...document.querySelectorAll('[data-provider-option]')];

describe('the sessions section chooses the default provider', () => {
  it('has a section of its own, since a provider is not paint or layout', () => {
    expect(SECTIONS.map((section) => section.id)).toContain('sessions');
    open();
    expect(document.querySelector('[data-settings-panel="sessions"]')).not.toBeNull();
    expect(document.querySelector('[data-settings-nav-item="sessions"]')).not.toBeNull();
  });

  it('offers every provider vam can start, and only those', () => {
    open();
    expect(options().map((option) => option.getAttribute('data-provider-option'))).toEqual(
      PROVIDERS.map((provider) => provider.id),
    );
    expect(options().map((option) => option.textContent)).toEqual(
      PROVIDERS.map((provider) => provider.label),
    );
  });

  it('marks the stored provider as the chosen one', () => {
    open({ ...EMPTY_PREFS, defaultProvider: DEFAULT_PROVIDER_ID });
    const chosen = options().filter((option) => option.getAttribute('aria-pressed') === 'true');
    expect(chosen.map((option) => option.getAttribute('data-provider-option'))).toEqual([
      DEFAULT_PROVIDER_ID,
    ]);
  });

  it('writes the picked provider into prefs', () => {
    const { onChange } = open();
    const first = options()[0] as HTMLElement;
    fireEvent.click(first);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [next] = onChange.mock.calls[0] ?? [];
    expect((next as Prefs | undefined)?.defaultProvider).toBe(PROVIDERS[0]?.id);
  });

  it('says in words what a new session will run, rather than only naming it', () => {
    open();
    const panel = document.querySelector('[data-settings-panel="sessions"]');
    // The command is the whole of what the choice does; showing it is what
    // makes a one-option list an answer rather than a stub.
    expect(panel?.textContent).toContain(PROVIDERS[0]?.command.join(' '));
    expect(screen.getByText('sessions')).toBeTruthy();
  });
});
