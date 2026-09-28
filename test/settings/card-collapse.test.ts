/**
 * Persisted open/closed state for the settings overlay's own "Advanced"
 * disclosures -- one per section that has one, read once at mount and
 * written on every toggle by `AdvancedDisclosure`.
 *
 * KEPT DIRECTLY IN `localStorage`, wrapped in try/catch, the same shape
 * `worktree-tree-collapse.ts` already proves for its own per-project fold:
 * a viewer who cannot persist this is asked again next launch, which is not a
 * broken settings dialog.
 *
 * ABSENT MEANS CLOSED -- the rows behind an Advanced disclosure are the ones
 * rarely touched, so storing only the sections an operator actually opened
 * is what keeps an untouched install writing nothing at all.
 *
 * THE CARD-LEVEL FOLD THIS FILE ALSO USED TO KEEP (`isCardCollapsed` /
 * `setCardCollapsed`) IS GONE, not renamed: the settings-views restructure
 * (item C) turned the overlay from one scrolling page of ten collapsible
 * cards into a nav that shows exactly ONE section's view at a time
 * (`primitives.tsx`'s `SettingsSectionView`) -- there is no longer an
 * accordion for a card-level fold to apply to. `last-section.ts` is what
 * replaced its whole REASON to exist: remembering which section an operator
 * cares about, so they do not have to find it again, is now "which section
 * was last viewed" rather than "which cards are folded shut".
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdvancedOpen, setAdvancedOpen } from '../../src/renderer/settings/card-collapse.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isAdvancedOpen / setAdvancedOpen', () => {
  it('is closed (not open) for a section never touched', () => {
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
