// @vitest-environment happy-dom

/**
 * The default provider: one stored id, and everything that must survive a
 * payload that predates it or a hand-edited one that names a provider vam
 * cannot start. The rule this file exists to pin is that an unknown id costs
 * only itself -- it falls back to the working default and leaves every
 * neighbour alone, because the alternative is an app that cannot start a
 * session at all until someone clears their browser storage.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setDefaultProvider,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import { activeProviderId, setActiveProvider } from '../../src/renderer/sources/provider.js';
import { DEFAULT_PROVIDER_ID, PROVIDERS, resolveProvider } from '../../src/shared/providers.js';

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

const stored = (payload: object) => readPrefs(fake(JSON.stringify(payload)));

describe('the default provider round-trips', () => {
  it('offers only providers vam can actually start, and defaults to one of them', () => {
    expect(PROVIDERS.length).toBeGreaterThan(0);
    expect(PROVIDERS.map((provider) => provider.id)).toContain(DEFAULT_PROVIDER_ID);
    // Every offered provider carries a real command; a picker entry with
    // nothing to run is the thing this assertion exists to forbid.
    for (const provider of PROVIDERS) {
      expect(provider.command.length, provider.id).toBeGreaterThan(0);
    }
  });

  it('writes and reads back a chosen provider, disturbing no neighbour', () => {
    const storage = fake();
    const chosen = PROVIDERS[0]?.id ?? DEFAULT_PROVIDER_ID;
    writePrefs(storage, setDefaultProvider(setTheme(EMPTY_PREFS, 'system'), chosen));
    const back = readPrefs(storage);
    expect(back.defaultProvider).toBe(chosen);
    expect(back.theme).toBe('system');
  });

  it('defaults when the payload predates the field — which every shipped payload does', () => {
    const back = stored({ theme: 'light', outFontSize: 15 });
    expect(back.defaultProvider).toBe(DEFAULT_PROVIDER_ID);
    expect(back.theme).toBe('light');
    expect(back.outFontSize).toBe(15);
  });

  it('falls back for an id no provider answers to, and costs only itself', () => {
    for (const raw of ['codex-cli', '', null, 7, {}]) {
      const back = stored({ defaultProvider: raw, theme: 'light' });
      expect(back.defaultProvider, JSON.stringify(raw)).toBe(DEFAULT_PROVIDER_ID);
      expect(back.theme, 'one bad field costs only itself').toBe('light');
    }
    // And the resolver says the same thing to main, which receives whatever
    // the renderer sent rather than whatever prefs normalised.
    expect(resolveProvider('codex-cli').id).toBe(DEFAULT_PROVIDER_ID);
    expect(resolveProvider(undefined).command.length).toBeGreaterThan(0);
  });
});

describe('the stored choice is what the session-start path reads', () => {
  it('is put into force by the read path, not only by the writer', () => {
    setActiveProvider('claude-code');
    readPrefs(fake(JSON.stringify({ defaultProvider: 'nonesuch' })));
    expect(activeProviderId()).toBe(DEFAULT_PROVIDER_ID);
    readPrefs(fake(JSON.stringify({ defaultProvider: PROVIDERS[0]?.id })));
    expect(activeProviderId()).toBe(PROVIDERS[0]?.id);
  });
});
