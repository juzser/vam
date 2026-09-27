/**
 * Persisted open/closed state for the settings overlay's own cards: whether a
 * SECTION's card is collapsed, and whether its "Advanced" disclosure (if it
 * has one) is open -- the two states `SettingsCard` and `AdvancedDisclosure`
 * each read once at mount and write on every toggle.
 *
 * KEPT DIRECTLY IN `localStorage`, wrapped in try/catch, the same shape
 * `worktree-tree-collapse.ts` already proves for its own per-project fold:
 * a viewer who cannot persist this is asked again next launch, which is not a
 * broken settings dialog.
 *
 * ABSENT MEANS THE DEFAULT IN BOTH DIRECTIONS, and the two defaults are
 * opposite on purpose: a card starts OPEN (an operator who has never touched
 * this dialog sees every row, exactly as the un-carded overlay showed them),
 * and Advanced starts CLOSED (the rows behind it are the ones rarely
 * touched). Storing only the state that differs from the default, in both
 * maps, is what keeps an untouched install writing nothing at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAdvancedOpen,
  isCardCollapsed,
  setAdvancedOpen,
  setCardCollapsed,
} from '../../src/renderer/settings/card-collapse.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isCardCollapsed / setCardCollapsed', () => {
  it('is open (not collapsed) for a section never touched', () => {
    expect(isCardCollapsed('terminal')).toBe(false);
  });

  it('remembers a fold, per section, and a fresh read (a relaunch) still sees it', () => {
    setCardCollapsed('terminal', true);
    expect(isCardCollapsed('terminal')).toBe(true);
    expect(isCardCollapsed('terminal')).toBe(true);
  });

  it('one section’s own fold never touches a sibling section’s', () => {
    setCardCollapsed('terminal', true);
    expect(isCardCollapsed('agents')).toBe(false);
  });

  it('unfolds, and the entry is removed rather than stored as `false`', () => {
    setCardCollapsed('terminal', true);
    setCardCollapsed('terminal', false);
    expect(isCardCollapsed('terminal')).toBe(false);
    const raw = localStorage.getItem('vam.settings.cardCollapsed');
    expect(raw === null ? {} : JSON.parse(raw)).not.toHaveProperty('terminal');
  });

  it('treats a corrupt value already in storage as "nothing folded", rather than throwing', () => {
    localStorage.setItem('vam.settings.cardCollapsed', 'not json{{{');
    expect(() => isCardCollapsed('terminal')).not.toThrow();
    expect(isCardCollapsed('terminal')).toBe(false);
  });

  it('survives a storage that throws, rather than taking the dialog down with it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => setCardCollapsed('terminal', true)).not.toThrow();
    expect(isCardCollapsed('terminal')).toBe(false);
  });

  it('survives localStorage being entirely absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => setCardCollapsed('terminal', true)).not.toThrow();
    expect(isCardCollapsed('terminal')).toBe(false);
  });
});

describe('isAdvancedOpen / setAdvancedOpen', () => {
  it('is closed (not open) for a section never touched -- the opposite default from the card itself', () => {
    expect(isAdvancedOpen('terminal')).toBe(false);
  });

  it('remembers being opened, per section, and a fresh read still sees it', () => {
    setAdvancedOpen('terminal', true);
    expect(isAdvancedOpen('terminal')).toBe(true);
    expect(isAdvancedOpen('terminal')).toBe(true);
  });

  it('one section’s own Advanced never touches a sibling section’s', () => {
    setAdvancedOpen('terminal', true);
    expect(isAdvancedOpen('interface')).toBe(false);
  });

  it('and never touches that same section’s own card-collapsed state', () => {
    setAdvancedOpen('terminal', true);
    expect(isCardCollapsed('terminal')).toBe(false);
  });

  it('closes again, and the entry is removed rather than stored as `false`', () => {
    setAdvancedOpen('terminal', true);
    setAdvancedOpen('terminal', false);
    expect(isAdvancedOpen('terminal')).toBe(false);
    const raw = localStorage.getItem('vam.settings.advancedOpen');
    expect(raw === null ? {} : JSON.parse(raw)).not.toHaveProperty('terminal');
  });

  it('treats a corrupt value already in storage as "still closed", rather than throwing', () => {
    localStorage.setItem('vam.settings.advancedOpen', 'not json{{{');
    expect(() => isAdvancedOpen('terminal')).not.toThrow();
    expect(isAdvancedOpen('terminal')).toBe(false);
  });

  it('survives a storage that throws, rather than taking the dialog down with it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => setAdvancedOpen('terminal', true)).not.toThrow();
    expect(isAdvancedOpen('terminal')).toBe(false);
  });

  it('survives localStorage being entirely absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => setAdvancedOpen('terminal', true)).not.toThrow();
    expect(isAdvancedOpen('terminal')).toBe(false);
  });
});
