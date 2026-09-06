// @vitest-environment happy-dom

/**
 * A SECOND, discriminating test for the same read path `prefs.provider.test.ts`
 * covers (issue 166). That file is real and correct, but it cannot fail on
 * its own: `PROVIDERS` (`src/shared/providers.ts`) has exactly one row, and
 * its id IS `DEFAULT_PROVIDER_ID`, so a stored id read back and a stored id
 * ignored in favour of the default land on the identical string either way.
 *
 * A SEPARATE FILE, RATHER THAN EDITING THE ORIGINAL, so the original keeps
 * exercising `readProviderId`/`resolveProvider` as vam actually ships them --
 * `vi.mock` here replaces the whole module, so a test using it can no longer
 * see whether the SHIPPED one-entry fallback logic is itself correct. This
 * file trades that away on purpose, for a table that CAN discriminate: it
 * reimplements the same total-function algorithm (find by id, else the
 * default) against a two-entry table with a second, obviously fictitious
 * provider (`vam-test-second-provider`) whose id and command differ from the
 * default's. `DEFAULT_PROVIDER_ID` and `PROVIDERS` are kept consistent with
 * each other inside the double -- the default id above IS a row in the table
 * below -- so the fallback path resolves to a real entry, not an impossible
 * state.
 *
 * DO NOT DELETE THIS ONCE A REAL SECOND PROVIDER SHIPS. It tests the READ
 * PATH in `prefs.ts` and the write-to-force wiring in `provider.ts`, neither
 * of which becomes redundant just because the shipped table grows a row --
 * it only becomes redundant if that read path itself is torn out.
 */

import { describe, expect, it, vi } from 'vitest';

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
  function resolveProvider(id: unknown) {
    const match = PROVIDERS.find((provider) => provider.id === id);
    return match ?? PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER_ID);
  }
  function readProviderId(id: unknown) {
    return resolveProvider(id)?.id;
  }
  return { DEFAULT_PROVIDER_ID, PROVIDERS, resolveProvider, readProviderId };
});

import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setDefaultProvider,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import { activeProviderId, setActiveProvider } from '../../src/renderer/sources/provider.js';
import { DEFAULT_PROVIDER_ID } from '../../src/shared/providers.js';

const SECOND_PROVIDER_ID = 'vam-test-second-provider';
const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) this.value = value;
    },
  };
}

describe('a stored NON-DEFAULT provider round-trips (issue 166)', () => {
  it('writes and reads back the second provider, not the default', () => {
    const storage = fake();
    writePrefs(storage, setDefaultProvider(setTheme(EMPTY_PREFS, 'system'), SECOND_PROVIDER_ID));
    const back = readPrefs(storage);
    expect(back.defaultProvider).toBe(SECOND_PROVIDER_ID);
    expect(back.theme).toBe('system');
  });

  it('is put into force by the read path, distinctly from the default', () => {
    setActiveProvider(DEFAULT_PROVIDER_ID);
    readPrefs(fake(JSON.stringify({ defaultProvider: SECOND_PROVIDER_ID })));
    expect(activeProviderId()).toBe(SECOND_PROVIDER_ID);
  });
});
