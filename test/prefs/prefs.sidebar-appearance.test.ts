// @vitest-environment happy-dom

/**
 * ONE CHOICE: how the sidebar's own surface paints. `Default` (the shipped
 * `--vam-sidebar` token), `Match Terminal` (the resolved terminal scheme's
 * own background, so the two columns read as one surface), or `Tinted` (a
 * fixed, modest literal distinct from both — the same convention
 * `palette-templates.ts` uses for a preset colour rather than a computed
 * blend).
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setSidebarAppearance,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  applySidebarAppearance,
  DEFAULT_SIDEBAR_APPEARANCE,
  readSidebarAppearance,
  SIDEBAR_VAR,
  TINTED_SIDEBAR_VAR,
} from '../../src/renderer/prefs/sidebar-appearance.js';

function fake(initial: string | null): StorageLike {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

const stored = (payload: Record<string, unknown>) => readPrefs(fake(JSON.stringify(payload)));

describe('the default is "default" -- no override of the shipped token', () => {
  it('ships default, and an absent key reads as default', () => {
    expect(DEFAULT_SIDEBAR_APPEARANCE).toBe('default');
    expect(EMPTY_PREFS.sidebarAppearance).toBe('default');
    expect(stored({}).sidebarAppearance).toBe('default');
  });

  it('reads back a stored choice, and only the three words are a choice', () => {
    expect(stored({ sidebarAppearance: 'match-terminal' }).sidebarAppearance).toBe(
      'match-terminal',
    );
    expect(stored({ sidebarAppearance: 'tinted' }).sidebarAppearance).toBe('tinted');
    for (const raw of ['Default', 0, null, {}, [], 'matchTerminal']) {
      expect(readSidebarAppearance(raw), JSON.stringify(raw)).toBe(DEFAULT_SIDEBAR_APPEARANCE);
      expect(stored({ sidebarAppearance: raw }).sidebarAppearance, JSON.stringify(raw)).toBe(
        DEFAULT_SIDEBAR_APPEARANCE,
      );
    }
  });
});

describe('the setter', () => {
  it('normalises on the way in and touches nothing else', () => {
    const next = setSidebarAppearance({ ...EMPTY_PREFS, outFontSize: 15 }, 'tinted');
    expect(next.sidebarAppearance).toBe('tinted');
    expect(next.outFontSize).toBe(15);
    expect(setSidebarAppearance(EMPTY_PREFS, 'nope').sidebarAppearance).toBe(
      DEFAULT_SIDEBAR_APPEARANCE,
    );
  });

  it('survives a round trip through storage', () => {
    const storage = fake(null);
    writePrefs(storage, setSidebarAppearance(EMPTY_PREFS, 'match-terminal'));
    expect(readPrefs(storage).sidebarAppearance).toBe('match-terminal');
  });
});

describe('applySidebarAppearance -- a CSS custom property, never a hex literal outside styles.css', () => {
  function root(): HTMLElement {
    return document.createElement('div');
  }

  it('default clears any override', () => {
    const el = root();
    el.style.setProperty(SIDEBAR_VAR, '#ff0000');
    applySidebarAppearance('default', '#1e1f29', el);
    expect(el.style.getPropertyValue(SIDEBAR_VAR)).toBe('');
  });

  it('match-terminal sets the property to the caller-resolved value', () => {
    const el = root();
    applySidebarAppearance('match-terminal', '#1e1f29', el);
    expect(el.style.getPropertyValue(SIDEBAR_VAR)).toBe('#1e1f29');
  });

  it('tinted points at the styles.css token, never a literal', () => {
    const el = root();
    applySidebarAppearance('tinted', '#1e1f29', el);
    expect(el.style.getPropertyValue(SIDEBAR_VAR)).toBe(TINTED_SIDEBAR_VAR);
    expect(el.style.getPropertyValue(SIDEBAR_VAR)).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('does nothing, and does not throw, with no root (SSR/test environments)', () => {
    expect(() => applySidebarAppearance('tinted', '#1e1f29', null)).not.toThrow();
  });
});
