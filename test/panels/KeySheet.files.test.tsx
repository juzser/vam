// @vitest-environment happy-dom

/**
 * `?` NOW ANSWERS "HOW DO I FIND A FILE?".
 *
 * The defect this is the guard for: the Files tab's filter has shipped since
 * the tab did, `/` has always reached it, and the sheet an operator opens to
 * ask what a surface's keys are had NO Files section at all — grepping
 * `KeySheet.tsx` for `Files`, `filter` or `'/'` returned nothing. A real
 * feature, invisible, which is what prompted the request for a file-search
 * shortcut that already half existed.
 *
 * ASSERTED AGAINST THE KEY LISTS, NOT AGAINST A WRITTEN-OUT SET. `TREE_KEYS`
 * and `EDITOR_KEYS` are what `resolveTreeKey` and `FilesTab.tsx`'s handlers
 * actually dispatch on, so this follows a key added later instead of going
 * stale — the same bargain `Canvas.keysheet.test.tsx` holds for the app-wide
 * grammar one surface over.
 *
 * MUTATION TARGET: drop `buildFilesSheet()` out of `KeySheet.tsx`'s group list
 * and every assertion here reddens.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chordSymbols,
  NO_BINDINGS,
  setActiveBindings,
} from '../../src/renderer/keyboard/chords.js';
import { EDITOR_KEYS, TREE_KEYS } from '../../src/renderer/panels/files-tree.js';
import { KeySheet } from '../../src/renderer/panels/KeySheet.js';
import { onBothPlatforms } from '../support/platform.js';

afterEach(() => {
  cleanup();
  setActiveBindings(NO_BINDINGS);
});

/** Every keystroke chip the sheet draws, in draw order. */
const printed = () =>
  [...document.querySelectorAll('[data-key-sheet] [data-key-sheet-keys]')].map(
    (el) => el.textContent ?? '',
  );

describe('the key sheet documents the Files tab', () => {
  it('prints every key that tab answers, including the new file search', () => {
    // EACH KEY AS ITS PLATFORM SPELLS IT. The lists hold tokens — that is what
    // the handlers dispatch on — and the sheet paints `chordSymbols` of each,
    // so this asks the same question in both renderings rather than in
    // whichever one the host machine happens to produce.
    onBothPlatforms((mac) => {
      render(<KeySheet onClose={vi.fn()} />);
      const keys = printed();
      const answered = [...new Set([...TREE_KEYS, ...EDITOR_KEYS])];
      expect(answered.length).toBeGreaterThanOrEqual(10);
      for (const key of answered) {
        expect(keys, `"${key}" is answered by the Files tab but not on the sheet`).toContain(
          chordSymbols(key, mac),
        );
      }
      expect(keys, 'the operator’s ask').toContain(mac ? '⌘ P' : 'Ctrl+P');
      cleanup();
    });
  });

  it('draws them as a section of their own, so they read as one surface’s keys', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const heading = [...document.querySelectorAll('[data-key-sheet] h3')].find((h3) =>
      /files/i.test(h3.textContent ?? ''),
    );
    expect(heading, 'no Files heading on the sheet').toBeDefined();
  });

  it('leaves no row blank — a missing caption must break, not render empty space', () => {
    render(<KeySheet onClose={vi.fn()} />);
    const labels = [...document.querySelectorAll('[data-key-sheet] [data-key-sheet-label]')];
    expect(labels.length).toBeGreaterThan(printed().length - 1);
    for (const label of labels) {
      expect((label.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});
