/**
 * The two new stored fields: the palette override layer and the key bindings.
 *
 * Both are read PER FIELD, like every field beside them, because the payload
 * already in every operator's browser has neither key — and a migration that
 * resets an unrelated setting to get a default for a new one is the defect
 * this file exists to catch.
 */

import { describe, expect, it } from 'vitest';
import {
  applyPalette,
  clearPalette,
  clearPaletteColor,
  DEFAULT_FOCUS_SHARE,
  EMPTY_PREFS,
  PALETTE_TOKENS,
  paletteValue,
  readPrefs,
  type StorageLike,
  setKeyBindings,
  setPaletteColor,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const KEY = 'vam.prefs.v1';

function storage(seed?: unknown): StorageLike {
  const map = new Map<string, string>();
  if (seed !== undefined) {
    map.set(KEY, JSON.stringify(seed));
  }
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as StorageLike;
}

/** A `style` with the two methods `applyPalette` uses, and a record of both. */
function fakeRoot() {
  const set = new Map<string, string>();
  const removed: string[] = [];
  return {
    removed,
    read: (token: string) => set.get(token) ?? null,
    element: {
      style: {
        setProperty: (name: string, value: string) => void set.set(name, value),
        removeProperty: (name: string) => {
          removed.push(name);
          set.delete(name);
        },
      },
    } as unknown as HTMLElement,
  };
}

const TOKEN = PALETTE_TOKENS[0]?.token ?? '';
const BLUE = `#${'2f6feb'}`;

describe('the palette override layer', () => {
  it('exposes a named, non-empty set of tokens', () => {
    expect(PALETTE_TOKENS.length).toBeGreaterThan(3);
    for (const entry of PALETTE_TOKENS) {
      expect(entry.token.startsWith('--vam-')).toBe(true);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('reaches the document as a custom property on the root', () => {
    const root = fakeRoot();
    applyPalette(setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE).palette.dark, root.element);
    expect(root.read(TOKEN)).toBe(BLUE);
  });

  it('clears the override rather than writing the current value back', () => {
    const root = fakeRoot();
    const set = setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE);
    applyPalette(set.palette.dark, root.element);
    const cleared = clearPaletteColor(set, 'dark', TOKEN);
    expect(cleared.palette.dark[TOKEN]).toBeUndefined();
    applyPalette(cleared.palette.dark, root.element);
    expect(root.read(TOKEN)).toBeNull();
    expect(root.removed).toContain(TOKEN);
  });

  it('clears every override at once', () => {
    const both = setPaletteColor(
      setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE),
      'dark',
      '--vam-ink',
      BLUE,
    );
    expect(Object.keys(clearPalette(both, 'dark').palette.dark)).toEqual([]);
  });

  it('refuses a value that is not a colour, and a token vam does not own', () => {
    expect(
      setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, 'red; content: bad').palette.dark[TOKEN],
    ).toBeUndefined();
    expect(
      setPaletteColor(EMPTY_PREFS, 'dark', '--vam-not-a-token', BLUE).palette.dark[
        '--vam-not-a-token'
      ],
    ).toBeUndefined();
  });

  it('round-trips through storage', () => {
    const store = storage();
    writePrefs(store, setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE));
    expect(readPrefs(store).palette.dark[TOKEN]).toBe(BLUE);
  });

  it('drops a garbage entry without dropping a good one', () => {
    // A flat payload, which is what a browser upgraded from the pre-per-theme
    // build still holds — it lands in both themes (`prefs.palette-theme`).
    const prefs = readPrefs(storage({ palette: { [TOKEN]: BLUE, '--vam-ink': 42 } }));
    expect(prefs.palette.dark[TOKEN]).toBe(BLUE);
    expect(prefs.palette.dark['--vam-ink']).toBeUndefined();
  });
});

describe('key bindings in storage', () => {
  it('round-trips, and keeps at most two per action', () => {
    const store = storage();
    writePrefs(store, setKeyBindings(EMPTY_PREFS, { rename: ['p', 'u'] }));
    expect(readPrefs(store).keyBindings['rename']).toEqual(['p', 'u']);
    expect(
      readPrefs(storage({ keyBindings: { rename: ['p', 'u', 'q'] } })).keyBindings['rename'],
    ).toEqual(['p', 'u']);
  });

  it('drops a garbage entry without dropping a good one', () => {
    const prefs = readPrefs(storage({ keyBindings: { rename: ['p'], icon: 'nope' } }));
    expect(prefs.keyBindings['rename']).toEqual(['p']);
    expect(prefs.keyBindings['icon']).toBeUndefined();
  });
});

describe('a payload written before either field existed', () => {
  it('loads, uses the defaults for both, and resets nothing else', () => {
    const old = {
      theme: 'light',
      focusViewportShare: 0.45,
      panes: { sidebar: 300, detail: 400 },
      filters: { hideAgentStarted: false, onlyPrompted: true },
    };
    const prefs = readPrefs(storage(old));
    expect(prefs.palette).toEqual({ dark: {}, light: {} });
    expect(prefs.keyBindings).toEqual({});
    expect(prefs.theme).toBe('light');
    expect(prefs.focusViewportShare).toBe(0.45);
    expect(prefs.panes.sidebar).toBe(300);
    expect(prefs.filters.hideAgentStarted).toBe(false);
    expect(prefs.filters.onlyPrompted).toBe(true);
    expect(EMPTY_PREFS.focusViewportShare).toBe(DEFAULT_FOCUS_SHARE);
  });

  it('survives a garbage value in either field, per field', () => {
    const prefs = readPrefs(storage({ theme: 'light', palette: 7, keyBindings: 'no' }));
    expect(prefs.palette).toEqual({ dark: {}, light: {} });
    expect(prefs.keyBindings).toEqual({});
    expect(prefs.theme).toBe('light');
  });
});

describe('what the picker shows', () => {
  it('prefers the override, falls back to the stylesheet, and shows nothing else', () => {
    const overridden = setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE).palette.dark;
    expect(paletteValue(overridden, TOKEN, () => `#${'000000'}`)).toBe(BLUE);
    expect(paletteValue({}, TOKEN, () => ` ${BLUE} `)).toBe(BLUE);
    expect(paletteValue({}, TOKEN, () => 'oklch(0.2 0 0)')).toBe('');
    expect(paletteValue({}, TOKEN, () => '')).toBe('');
  });
});
