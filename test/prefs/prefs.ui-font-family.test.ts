// @vitest-environment happy-dom

/**
 * THE APP CHROME'S OWN FONT — the sidebar, the settings dialog, every label
 * and button — separate from the terminal's own (`terminal-font-family.ts`),
 * which is a different face for a different surface entirely.
 *
 * ── WHY THIS IS A DOM SIDE EFFECT AND NOT A STORE ────────────────────────
 * Nothing in this renderer holds a live React value for "the app's own
 * font" the way `terminal-font-family.ts` holds one for xterm's construction
 * option — the whole app already reads `--font-sans` through ordinary CSS
 * inheritance from `body`, the same mechanism `outFontSize`'s custom
 * property and the palette overrides already use (`applyOutFontSize`,
 * `applyPalette`). So this is a DOM write, not a subscription.
 *
 * ── WHY `body`, AND NOT `:root` ───────────────────────────────────────────
 * `--font-sans` is INLINED into the `font-sans` utility class at Tailwind
 * build time (`terminal-font.ts`'s header argues the identical point for
 * `--font-mono`) — there is no custom property this could set that any rule
 * would actually read back. `body { font-family: var(--font-sans) }`
 * (`styles.css`) is an ordinary stylesheet rule, and an INLINE style on that
 * SAME element always outranks its own stylesheet rule, cascade-wise,
 * regardless of specificity — which is what lets this reach every ordinary
 * label through inheritance while leaving the handful of elements that wear
 * an EXPLICIT `font-sans` class of their own untouched (`ShortcutTip.tsx`'s
 * `⌘` glyph chips, kept pinned to the shipped face on purpose — that
 * exception is exactly what a `:root` override would have broken).
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setTheme,
  setUiFontFamily,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  applyUiFontFamily,
  DEFAULT_UI_FONT_FAMILY,
  MAX_UI_FONT_FAMILY_LENGTH,
  readUiFontFamily,
  resolveUiFontFamily,
  UI_FONT_FAMILY_STACK,
} from '../../src/renderer/prefs/ui-font-family.js';

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

describe('reading a stored UI font family', () => {
  it('defaults to unset — the shipped face, untouched', () => {
    expect(DEFAULT_UI_FONT_FAMILY).toBe('');
    expect(readUiFontFamily(undefined)).toBe('');
  });

  it('trims and keeps an ordinary family name', () => {
    expect(readUiFontFamily('  Inter  ')).toBe('Inter');
  });

  it('is total: anything that is not a sane string reads back unset', () => {
    for (const raw of [null, 1, {}, [], false, '   ']) {
      expect(readUiFontFamily(raw), JSON.stringify(raw)).toBe(DEFAULT_UI_FONT_FAMILY);
    }
  });

  it('strips a quote character', () => {
    expect(readUiFontFamily(`Evil'; } * { color: red`)).not.toContain("'");
  });

  it('is capped', () => {
    const huge = 'x'.repeat(MAX_UI_FONT_FAMILY_LENGTH + 1);
    expect(readUiFontFamily(huge)).toBe(DEFAULT_UI_FONT_FAMILY);
  });
});

describe('resolving the family the document can use', () => {
  it('unset is the empty string — nothing to apply, the stylesheet answers alone', () => {
    expect(resolveUiFontFamily('')).toBe('');
  });

  it('a chosen family is tried first, with the shipped stack still the fallback', () => {
    expect(resolveUiFontFamily('Inter')).toBe(`'Inter', ${UI_FONT_FAMILY_STACK}`);
  });
});

describe('applying it to the document', () => {
  function fakeBody(initial: Record<string, string> = {}) {
    const props = new Map(Object.entries(initial));
    return {
      style: {
        setProperty: (name: string, value: string) => void props.set(name, value),
        removeProperty: (name: string) => void props.delete(name),
        getPropertyValue: (name: string) => props.get(name) ?? '',
      },
    } as unknown as HTMLElement;
  }

  it('sets an inline font-family when a family is chosen', () => {
    const body = fakeBody();
    applyUiFontFamily('Inter', body);
    expect(body.style.getPropertyValue('font-family')).toBe(`'Inter', ${UI_FONT_FAMILY_STACK}`);
  });

  it('clears the inline style for unset, so the stylesheet answers again', () => {
    const body = fakeBody({ 'font-family': 'something stale' });
    applyUiFontFamily('', body);
    expect(body.style.getPropertyValue('font-family')).toBe('');
  });

  it('does nothing when there is no document to touch', () => {
    expect(() => applyUiFontFamily('Inter', null)).not.toThrow();
  });
});

describe('the UI font family round-trips through the store', () => {
  it('writes and reads back a chosen family, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setUiFontFamily(setTheme(EMPTY_PREFS, 'system'), 'Inter'));
    const back = readPrefs(storage);
    expect(back.uiFontFamily).toBe('Inter');
    expect(back.theme).toBe('system');
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    expect(stored({ theme: 'light' }).uiFontFamily).toBe(DEFAULT_UI_FONT_FAMILY);
  });

  it('normalises on the way in as well as on the way out', () => {
    expect(setUiFontFamily(EMPTY_PREFS, '  Inter  ').uiFontFamily).toBe('Inter');
    expect(stored({ uiFontFamily: 42 }).uiFontFamily).toBe(DEFAULT_UI_FONT_FAMILY);
  });
});
