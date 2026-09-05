/**
 * The colour overrides are stored PER THEME.
 *
 * The old shape was one flat map applied whatever the theme, so a canvas
 * colour picked in dark pinned the same colour in light — where it may be
 * unreadable. These assertions pin the two halves of the fix that a type
 * cannot: the buckets are independent, and an OLD flat payload still loads.
 */

import { describe, expect, it } from 'vitest';
import {
  applyPalette,
  clearPalette,
  clearPaletteColor,
  EMPTY_PREFS,
  effectiveTheme,
  PALETTE_TOKENS,
  paletteFor,
  readPrefs,
  setPaletteColor,
  type StorageLike,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const KEY = 'vam.prefs.v1';
const TOKEN = PALETTE_TOKENS[0]?.token ?? '';
const OTHER = PALETTE_TOKENS[1]?.token ?? '';
const BLUE = `#${'2f6feb'}`;
const AMBER = `#${'b45309'}`;

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

describe('a colour chosen in one theme stays in that theme', () => {
  it('leaves the other bucket untouched, both ways round', () => {
    const dark = setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE);
    expect(dark.palette.dark[TOKEN]).toBe(BLUE);
    expect(dark.palette.light[TOKEN]).toBeUndefined();

    const both = setPaletteColor(dark, 'light', TOKEN, AMBER);
    expect(both.palette.dark[TOKEN]).toBe(BLUE);
    expect(both.palette.light[TOKEN]).toBe(AMBER);
  });

  it('swaps which overrides reach the document when the theme changes', () => {
    const prefs = setPaletteColor(setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE), 'light', TOKEN, AMBER);
    const root = fakeRoot();
    applyPalette(paletteFor(prefs.palette, 'dark'), root.element);
    expect(root.read(TOKEN)).toBe(BLUE);
    applyPalette(paletteFor(prefs.palette, 'light'), root.element);
    expect(root.read(TOKEN)).toBe(AMBER);
  });

  it('follows the RESOLVED appearance when the stored theme is system', () => {
    const prefs = setPaletteColor(setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE), 'light', TOKEN, AMBER);
    let osLight = false;
    const resolved = () => effectiveTheme('system', () => osLight);
    const root = fakeRoot();

    applyPalette(paletteFor(prefs.palette, resolved()), root.element);
    expect(root.read(TOKEN)).toBe(BLUE);
    osLight = true;
    applyPalette(paletteFor(prefs.palette, resolved()), root.element);
    expect(root.read(TOKEN), 'the OS flipping must swap the bucket in force').toBe(AMBER);
  });

  it('leaves an unset token to the stylesheet in the theme that lacks it', () => {
    const prefs = setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE);
    const root = fakeRoot();
    applyPalette(paletteFor(prefs.palette, 'light'), root.element);
    expect(root.read(TOKEN)).toBeNull();
    expect(root.removed).toContain(TOKEN);
  });
});

describe('a reset clears only the theme it belongs to', () => {
  const seeded = () =>
    setPaletteColor(setPaletteColor(EMPTY_PREFS, 'dark', TOKEN, BLUE), 'light', TOKEN, AMBER);

  it('clears one token in one theme', () => {
    const next = clearPaletteColor(seeded(), 'dark', TOKEN);
    expect(Object.hasOwn(next.palette.dark, TOKEN)).toBe(false);
    expect(next.palette.light[TOKEN]).toBe(AMBER);
  });

  it('clears every token in one theme', () => {
    const next = clearPalette(setPaletteColor(seeded(), 'dark', OTHER, BLUE), 'dark');
    expect(next.palette.dark).toEqual({});
    expect(next.palette.light[TOKEN]).toBe(AMBER);
  });
});

describe('what is already in operators’ browsers still loads', () => {
  it('reads a stored FLAT payload into both themes, preserving the screen', () => {
    const prefs = readPrefs(storage({ palette: { [TOKEN]: BLUE } }));
    expect(prefs.palette.dark[TOKEN]).toBe(BLUE);
    expect(prefs.palette.light[TOKEN]).toBe(BLUE);
  });

  it('round-trips the per-theme shape through storage', () => {
    const store = storage();
    writePrefs(store, setPaletteColor(EMPTY_PREFS, 'light', TOKEN, AMBER));
    const back = readPrefs(store);
    expect(back.palette.light[TOKEN]).toBe(AMBER);
    expect(back.palette.dark[TOKEN]).toBeUndefined();
  });

  it('survives a missing bucket without losing the one that is there', () => {
    const prefs = readPrefs(storage({ palette: { dark: { [TOKEN]: BLUE } } }));
    expect(prefs.palette.dark[TOKEN]).toBe(BLUE);
    expect(prefs.palette.light).toEqual({});
  });

  it('drops a garbage bucket without taking a good one with it', () => {
    const prefs = readPrefs(
      storage({ palette: { dark: 'not a bucket', light: { [TOKEN]: AMBER } } }),
    );
    expect(prefs.palette.dark).toEqual({});
    expect(prefs.palette.light[TOKEN]).toBe(AMBER);
  });

  it('drops a garbage entry inside a bucket without dropping a good one', () => {
    const prefs = readPrefs(
      storage({ palette: { dark: { [TOKEN]: 'red; content: bad', [OTHER]: BLUE } } }),
    );
    expect(prefs.palette.dark[TOKEN]).toBeUndefined();
    expect(prefs.palette.dark[OTHER]).toBe(BLUE);
  });

  it('leaves an unrelated setting alone when the palette is nonsense', () => {
    const prefs = readPrefs(storage({ palette: 7, theme: 'light' }));
    expect(prefs.palette).toEqual({ dark: {}, light: {} });
    expect(prefs.theme).toBe('light');
  });
});
