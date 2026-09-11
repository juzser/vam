/**
 * The two new stored fields: the palette override layer and the key bindings.
 *
 * Both are read PER FIELD, like every field beside them, because the payload
 * already in every operator's browser has neither key — and a migration that
 * resets an unrelated setting to get a default for a new one is the defect
 * this file exists to catch.
 */

import { describe, expect, it } from 'vitest';
import { bindingClashes } from '../../src/renderer/keyboard/chords.js';
import {
  applyPalette,
  clearPalette,
  clearPaletteColor,
  EMPTY_PREFS,
  PALETTE_TOKENS,
  paletteValue,
  readPrefs,
  type StorageLike,
  setKeyBindings,
  setPaletteColor,
  stylesheetPaletteValue,
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
const GREEN = `#${'3fb950'}`;

/**
 * A root whose inline custom properties can be read back, which the `fakeRoot`
 * above deliberately cannot -- it records what `applyPalette` WROTE, and the
 * question here is what a later reader SEES. Same cast, different question.
 */
function inlineRoot(initial: Record<string, string>): HTMLElement {
  const set = new Map<string, string>(Object.entries(initial));
  return {
    style: {
      getPropertyValue: (name: string) => set.get(name) ?? '',
      setProperty: (name: string, value: string) => void set.set(name, value),
      removeProperty: (name: string) => void set.delete(name),
    },
  } as unknown as HTMLElement;
}

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

  /**
   * THE ONE PATH THAT DOES NOT REFUSE A CONTESTED KEY, and why.
   *
   * The editor now judges the whole resulting map on every write (audit F3),
   * so it cannot mint one. A stored payload still can — hand-edited, or an
   * override that collides the day a later vam moves a shipped key onto it —
   * and this read deliberately keeps it: dropping a binding here would throw
   * away a choice the operator made, on load, with nothing on screen. It is
   * KEPT AND REPORTED instead: `bindingClashes` names it, and the settings
   * editor and the `?` sheet mark the dead key.
   */
  it('keeps a payload that contests a key, and hands it on reported', () => {
    const prefs = readPrefs(storage({ keyBindings: { icon: ['r'] } }));
    expect(prefs.keyBindings['icon']).toEqual(['r']);
    const clashes = bindingClashes(prefs.keyBindings);
    expect(clashes.map((clash) => clash.chord)).toEqual(['r']);
    expect(clashes[0]?.winner).toBe('icon');
    expect(clashes[0]?.shadowed).toEqual(['rename']);
  });
});

describe('a payload written before either field existed', () => {
  it('loads, uses the defaults for both, and resets nothing else', () => {
    const old = {
      theme: 'light',
      panes: { sidebar: 300, detail: 400 },
      filters: { hideAgentStarted: false, onlyPrompted: true },
    };
    const prefs = readPrefs(storage(old));
    expect(prefs.palette).toEqual({ dark: {}, light: {} });
    expect(prefs.keyBindings).toEqual({});
    expect(prefs.theme).toBe('light');
    expect(prefs.panes.sidebar).toBe(300);
    expect(prefs.filters.hideAgentStarted).toBe(false);
    expect(prefs.filters.onlyPrompted).toBe(true);
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

  /**
   * THE DEFAULT TEMPLATE'S PREVIEW, and the trap it walks into.
   *
   * `applyPalette` writes every override onto `document.documentElement`'s
   * INLINE style, and custom properties inherit -- so once an operator has a
   * palette in force there is no element anywhere on the page whose computed
   * `--vam-pane` is the stylesheet's. `getComputedStyle` would hand the
   * `default` chip the very palette it exists to leave, and the chip would
   * preview `ember` while promising vam. The read therefore lifts the inline
   * property, asks, and puts it back -- synchronously, so no frame is drawn in
   * between and the restore cannot be skipped by an early return.
   */
  it('reads a token past whatever is currently overriding it, and puts it back', () => {
    const root = inlineRoot({ [TOKEN]: BLUE });
    const seen: string[] = [];
    const value = stylesheetPaletteValue(TOKEN, root, () => {
      seen.push(root.style.getPropertyValue(TOKEN));
      return GREEN;
    });
    // The stylesheet's answer, taken while the override was lifted...
    expect({ value, whileReading: seen }).toEqual({ value: GREEN, whileReading: [''] });
    // ...and the operator's colour is back on the document afterwards.
    expect(root.style.getPropertyValue(TOKEN)).toBe(BLUE);
  });

  it('restores the override even when the read throws', () => {
    // A `finally`, not a trailing statement. The failure mode of getting this
    // wrong is not a wrong preview -- it is an operator's palette silently
    // falling off the screen because a settings row asked a question.
    const root = inlineRoot({ [TOKEN]: BLUE });
    expect(() =>
      stylesheetPaletteValue(TOKEN, root, () => {
        throw new Error('no cascade here');
      }),
    ).toThrow('no cascade here');
    expect(root.style.getPropertyValue(TOKEN)).toBe(BLUE);
  });

  it('leaves the document alone when nothing is overriding the token', () => {
    // The common case by far, and it must not touch the DOM at all: a
    // remove/restore pair on a property that was never set still invalidates
    // style, once per disc, per render.
    const root = inlineRoot({});
    const touched: string[] = [];
    root.style.removeProperty = (token: string) => {
      touched.push(`remove ${token}`);
      return '';
    };
    root.style.setProperty = (token: string, value: string) => {
      touched.push(`set ${token}=${value}`);
    };
    expect(stylesheetPaletteValue(TOKEN, root, () => GREEN)).toBe(GREEN);
    expect(touched).toEqual([]);
  });

  it('costs an empty string where there is no document, like the picker does', () => {
    expect(stylesheetPaletteValue(TOKEN, null, () => '')).toBe('');
  });
});

/**
 * The `canvas` → `ground` rename, from the operator's side.
 *
 * `writePrefs` `JSON.stringify`s the freshly-parsed object, so a top-level
 * key this version does not read is destroyed on the first save — and a
 * palette entry under a token name `readBucket` no longer recognises is
 * dropped even before that. Either way a customised colour would vanish on
 * upgrade, silently, which is the one outcome a rename may not have.
 */
describe('a colour customised under the old `canvas` name survives the rename', () => {
  // Byte-for-byte the shape the shipped build writes: both theme buckets,
  // the old token name, beside a token whose name did not change.
  const SHIPPED = {
    theme: 'dark',
    panes: { sidebar: 300, detail: 400 },
    palette: {
      dark: { '--vam-canvas': '#101820', '--vam-panel': '#181818' },
      light: { '--vam-canvas': '#fdfdfb' },
    },
  };

  it('reads the old key into the new one, in both themes', () => {
    const prefs = readPrefs(storage(SHIPPED));
    expect(prefs.palette.dark['--vam-ground']).toBe('#101820');
    expect(prefs.palette.light['--vam-ground']).toBe('#fdfdfb');
    // The neighbour is untouched, and the retired name is not carried along.
    expect(prefs.palette.dark['--vam-panel']).toBe('#181818');
    expect(prefs.palette.dark['--vam-canvas']).toBeUndefined();
  });

  it('rewrites the payload under the new name on the next save', () => {
    const store = storage(SHIPPED);
    const prefs = readPrefs(store);
    writePrefs(store, prefs);
    const written = JSON.parse(store.getItem(KEY) ?? '{}');
    expect(written.palette.dark['--vam-ground']).toBe('#101820');
    expect(written.palette.dark['--vam-canvas']).toBeUndefined();
  });

  it('migrates the pre-buckets flat palette too, into both themes', () => {
    // The oldest shape: one flat token → colour map, read into both buckets.
    const prefs = readPrefs(storage({ palette: { '--vam-canvas': '#222233' } }));
    expect(prefs.palette.dark['--vam-ground']).toBe('#222233');
    expect(prefs.palette.light['--vam-ground']).toBe('#222233');
  });

  it('lets a real `--vam-ground` entry win over a stale `--vam-canvas` one', () => {
    // Both present means the file was written by two versions. The current
    // name is the one the operator last picked with.
    const prefs = readPrefs(
      storage({ palette: { dark: { '--vam-canvas': '#111111', '--vam-ground': '#999999' } } }),
    );
    expect(prefs.palette.dark['--vam-ground']).toBe('#999999');
    // Both key orders: a JSON object preserves insertion order, and the
    // migration must not depend on which version wrote its key first.
    const reversed = readPrefs(
      storage({ palette: { dark: { '--vam-ground': '#999999', '--vam-canvas': '#111111' } } }),
    );
    expect(reversed.palette.dark['--vam-ground']).toBe('#999999');
  });

  it('never offers the retired name as a swatch, under either spelling', () => {
    // The `ground` swatch has since gone too (the block below), so what this
    // pins is the half that has not changed: the OLD name is a storage key and
    // nothing else, and it must never reach the grid under either spelling.
    expect(PALETTE_TOKENS.map((t) => t.token)).not.toContain('--vam-canvas');
    expect(PALETTE_TOKENS.map((t) => t.label)).not.toContain('canvas');
  });
});

/**
 * THE PANE GETS ITS OWN COLOUR, AND `ground` STOPS BEING ONE THE OPERATOR SETS.
 *
 * Two operator asks, one migration, because they land on the same table.
 *
 * 1. "Split the pane's colour setting from the sidebar." The detail pane was
 *    painted `bg-sidebar` -- the mockup gives them the same value -- so the
 *    sidebar swatch moved the whole right-hand pane with it. `--vam-pane` is
 *    that fill's own token now, and it is SEEDED from a stored sidebar
 *    override on load: an operator who has already customised the sidebar must
 *    not open this build to find the pane a different colour than they left it.
 *    The split is invisible until they move one of the two.
 *
 * 2. "The ground setting is unnecessary." It is gone from the swatch grid. The
 *    token is NOT gone -- it still paints the page behind the panes, the code
 *    fence and the modal scrims -- so a stored override for it is still read
 *    and still applied. Dropping it would be the silent change on upgrade this
 *    file exists to catch, and carrying it onto the pane would be worse: it is
 *    the deepest surface in the palette and the pane is two steps up, so an
 *    operator's near-black `ground` would arrive as a near-black PANE they
 *    never asked for.
 */
describe('the pane takes its own colour, and ground stops being a swatch', () => {
  const paneToken = '--vam-pane';
  const groundToken = '--vam-ground';
  const sidebarToken = '--vam-sidebar';

  it('offers a pane swatch and no ground swatch', () => {
    const tokens = PALETTE_TOKENS.map((t) => t.token);
    expect(tokens).toContain(paneToken);
    expect(tokens).not.toContain(groundToken);
    expect(PALETTE_TOKENS.find((t) => t.token === paneToken)?.label).toBe('pane');
    expect(PALETTE_TOKENS.map((t) => t.label)).not.toContain('ground');
  });

  it('seeds the pane from a stored sidebar override, per theme', () => {
    const prefs = readPrefs(
      storage({
        palette: {
          dark: { '--vam-sidebar': '#202024' },
          light: { '--vam-sidebar': '#eae7e0' },
        },
      }),
    );
    expect(prefs.palette.dark[paneToken]).toBe('#202024');
    expect(prefs.palette.light[paneToken]).toBe('#eae7e0');
    // The sidebar keeps its own: this is a split, not a move.
    expect(prefs.palette.dark[sidebarToken]).toBe('#202024');
  });

  it('leaves the pane unset when the sidebar was never customised', () => {
    // Seeding an unset token would freeze the pane on the stylesheet's
    // current value -- a theme change would then move the sidebar and leave
    // the pane behind.
    const prefs = readPrefs(storage({ palette: { dark: { '--vam-panel': '#181818' } } }));
    expect(prefs.palette.dark[paneToken]).toBeUndefined();
    expect(prefs.palette.dark['--vam-panel']).toBe('#181818');
  });

  it('never overwrites a pane colour the operator has already picked', () => {
    const prefs = readPrefs(
      storage({
        palette: { dark: { '--vam-sidebar': '#202024', '--vam-pane': '#333344' } },
      }),
    );
    expect(prefs.palette.dark[paneToken]).toBe('#333344');
  });

  it('keeps a stored ground override, reads it back, and still paints it', () => {
    const store = storage({ palette: { dark: { '--vam-ground': '#101820' } } });
    const prefs = readPrefs(store);
    expect(prefs.palette.dark[groundToken]).toBe('#101820');
    // On the document, or "kept" means kept in a file nobody reads.
    const root = fakeRoot();
    applyPalette(prefs.palette.dark, root.element);
    expect(root.read(groundToken)).toBe('#101820');
    // And it survives the next save, which stringifies whatever was parsed.
    writePrefs(store, prefs);
    expect(JSON.parse(store.getItem(KEY) ?? '{}').palette.dark[groundToken]).toBe('#101820');
  });

  it('does not carry a ground override onto the pane', () => {
    const prefs = readPrefs(storage({ palette: { dark: { '--vam-ground': '#101820' } } }));
    expect(prefs.palette.dark[paneToken]).toBeUndefined();
  });

  it('still lets a reset clear the retired colour', () => {
    // The swatch is gone, so per-token reset is out of reach: "reset colours"
    // has to reach it, or the operator has a colour they cannot undo.
    const prefs = readPrefs(storage({ palette: { dark: { '--vam-ground': '#101820' } } }));
    const cleared = clearPalette(prefs, 'dark');
    expect(cleared.palette.dark[groundToken]).toBeUndefined();
    const root = fakeRoot();
    applyPalette(cleared.palette.dark, root.element);
    expect(root.removed).toContain(groundToken);
  });

  it('still migrates the oldest `canvas` name, onto the retired token', () => {
    // The rename that came before this one still has to land somewhere: the
    // colour is the same colour, and it is applied even though nothing offers
    // it any more.
    const prefs = readPrefs(storage({ palette: { '--vam-canvas': '#222233' } }));
    expect(prefs.palette.dark[groundToken]).toBe('#222233');
    expect(prefs.palette.light[groundToken]).toBe('#222233');
  });
});

/**
 * THE CARD AND THE IN BUBBLE JOIN THE GRID — and only one of them is seeded.
 *
 * Both are new surfaces (`styles.css`), and both were carved out of a token
 * the operator could already set. That is what puts them here rather than in
 * the stylesheet alone: a colour that used to answer to a swatch and quietly
 * stops is a setting taken away by a refactor, which is the thing the pane
 * split above went to some trouble not to do.
 *
 * `--vam-card` IS SEEDED FROM `--vam-panel`, for exactly the pane split's reason.
 * Every card on the detail pane and in the sidebar painted `bg-panel` until
 * this change; an operator who had picked a panel colour was looking at cards
 * in it, and the repoint alone would have handed them back to the
 * stylesheet's grey in front of them.
 *
 * `--vam-in-bubble` IS NOT SEEDED, and the asymmetry is the point rather than
 * an omission. The bubble wore `raised` — which also paints session rows and
 * hovers all over the app, so a stored `raised` is a choice about those, not
 * about this bubble. Worse, carrying it here would restore the exact defect
 * being fixed: `raised` against the pane band is the 1.03:1 the operator came
 * back about. A migration must not silently change what somebody sees; it
 * also must not silently re-break what they asked to have fixed.
 */
describe('the card and the In bubble are colours the operator can set', () => {
  const cardToken = '--vam-card';
  const bubbleToken = '--vam-in-bubble';
  const panelToken = '--vam-panel';

  it('offers both as swatches, with their own labels', () => {
    const tokens = PALETTE_TOKENS.map((t) => t.token);
    expect(tokens).toContain(cardToken);
    expect(tokens).toContain(bubbleToken);
    expect(PALETTE_TOKENS.find((t) => t.token === cardToken)?.label).toBe('card');
    expect(PALETTE_TOKENS.find((t) => t.token === bubbleToken)?.label).toBe('in bubble');
  });

  it('seeds the card from a stored panel override, per theme', () => {
    const prefs = readPrefs(
      storage({
        palette: {
          dark: { '--vam-panel': '#181818' },
          light: { '--vam-panel': '#fbfbf9' },
        },
      }),
    );
    expect(prefs.palette.dark[cardToken]).toBe('#181818');
    expect(prefs.palette.light[cardToken]).toBe('#fbfbf9');
    // A split, not a move: `panel` still paints the dialogs and the phone's
    // own headers, and keeps whatever it was set to.
    expect(prefs.palette.dark[panelToken]).toBe('#181818');
  });

  it('leaves the card unset when the panel was never customised', () => {
    // Same argument as the pane: seeding from the stylesheet's current value
    // would freeze the card on one theme's grey and stop it following a theme
    // change at all.
    const prefs = readPrefs(storage({ palette: { dark: { '--vam-sidebar': '#202024' } } }));
    expect(prefs.palette.dark[cardToken]).toBeUndefined();
  });

  it('never overwrites a card colour the operator has already picked', () => {
    const prefs = readPrefs(
      storage({ palette: { dark: { '--vam-panel': '#181818', '--vam-card': '#242430' } } }),
    );
    expect(prefs.palette.dark[cardToken]).toBe('#242430');
  });

  it('does not seed the In bubble from anything', () => {
    const prefs = readPrefs(
      storage({
        palette: {
          dark: { '--vam-raised': '#1a1a1a', '--vam-panel': '#181818', '--vam-pane': '#171717' },
        },
      }),
    );
    expect(prefs.palette.dark[bubbleToken]).toBeUndefined();
  });

  it('stores, applies and resets a picked In bubble colour like any other', () => {
    const picked = setPaletteColor(EMPTY_PREFS, 'dark', bubbleToken, '#0f3b35');
    expect(picked.palette.dark[bubbleToken]).toBe('#0f3b35');
    const root = fakeRoot();
    applyPalette(picked.palette.dark, root.element);
    expect(root.read(bubbleToken)).toBe('#0f3b35');
    const cleared = clearPaletteColor(picked, 'dark', bubbleToken);
    expect(cleared.palette.dark[bubbleToken]).toBeUndefined();
  });
});
