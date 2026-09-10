// @vitest-environment happy-dom

/**
 * THE OTHER HALF OF `provider.test.tsx`, and the half the shipped table cannot
 * express.
 *
 * That file asserts the section draws NO picker, because `PROVIDERS`
 * (`src/shared/providers.ts`) has one row and a one-option choice is a control
 * that cannot act. On its own that assertion is satisfied by a settings panel
 * which has simply LOST its provider picker — deleting the control passes it
 * exactly as well as making the control conditional does. This file is what
 * tells those two apart: a two-row table, and the picker back, writing.
 *
 * The idiom is `test/prefs/prefs.provider-double.test.ts`'s, verbatim and for
 * its reason — `vi.mock` replaces the whole module, so the file that mocks it
 * can no longer see the shipped table, and the two files are therefore
 * separate on purpose.
 *
 * DO NOT DELETE THIS ONCE A REAL SECOND PROVIDER SHIPS. It would then be
 * testing the picker against a real table rather than a double, which is
 * strictly better; what makes it redundant is the condition itself being torn
 * out, not the table growing.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SECOND = 'vam-test-second-provider';

const TEST_TABLE = vi.hoisted(() => ({
  DEFAULT_PROVIDER_ID: 'claude-code',
  PROVIDERS: [
    { id: 'claude-code', label: 'Claude Code', command: ['claude'] },
    {
      id: 'vam-test-second-provider',
      label: 'Test-Only Second Provider',
      command: ['vam-test-second-provider-cmd'],
    },
  ],
}));

vi.mock('../../src/shared/providers.js', () => {
  const { DEFAULT_PROVIDER_ID, PROVIDERS } = TEST_TABLE;
  // The same total function the shipped module ships, reimplemented rather
  // than imported: importing it would import the one-row table with it.
  function resolveProvider(id: unknown) {
    const match = PROVIDERS.find((provider) => provider.id === id);
    return match ?? PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER_ID);
  }
  function readProviderId(id: unknown) {
    return resolveProvider(id)?.id;
  }
  return { DEFAULT_PROVIDER_ID, PROVIDERS, resolveProvider, readProviderId };
});

import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

const options = () => [...document.querySelectorAll('[data-provider-option]')];
const panel = () => document.querySelector('[data-settings-panel="sessions"]');

describe('the sessions section, once vam can start more than one agent', () => {
  it('offers every provider in the table, and only those', () => {
    open();
    expect(options().map((option) => option.getAttribute('data-provider-option'))).toEqual(
      TEST_TABLE.PROVIDERS.map((provider) => provider.id),
    );
    expect(options().map((option) => option.textContent)).toEqual(
      TEST_TABLE.PROVIDERS.map((provider) => provider.label),
    );
  });

  it('draws no fixed statement once there IS something to pick', () => {
    open();
    expect(panel()?.querySelector('[data-provider-fixed]')).toBeNull();
  });

  it('marks the stored provider as the chosen one', () => {
    open({ ...EMPTY_PREFS, defaultProvider: SECOND as Prefs['defaultProvider'] });
    const chosen = options().filter((option) => option.getAttribute('aria-pressed') === 'true');
    expect(chosen.map((option) => option.getAttribute('data-provider-option'))).toEqual([SECOND]);
  });

  it('writes the picked provider into prefs', () => {
    const { onChange } = open();
    fireEvent.click(options()[1] as HTMLElement);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [next] = onChange.mock.calls[0] ?? [];
    expect((next as Prefs | undefined)?.defaultProvider).toBe(SECOND);
  });

  it('still says what the chosen provider will run', () => {
    open({ ...EMPTY_PREFS, defaultProvider: SECOND as Prefs['defaultProvider'] });
    expect(panel()?.textContent).toContain('vam-test-second-provider-cmd');
  });
});
