/**
 * The key sheet's FILES section, held against the keys that tab answers.
 *
 * WHY IT IS A SECOND BUILDER RATHER THAN A SIXTH GROUP IN `buildKeySheet`.
 * That function walks `BINDING_TABLES`, and three tests in this repo treat
 * every row it emits as a chord of the app-wide grammar —
 * `bindings.test.ts`'s "still names no key that nothing is bound to" resolves
 * each one through `resolveChord`, and `binding-clashes.test.ts` derives each
 * row's `dead` mark from what the keystroke reaches. The Files tab's keys are
 * deliberately NOT in that table (`files-tree.ts` argues the case: they are
 * hardcoded so a tooltip naming one is honest rather than a lie waiting for
 * the operator to rebind it), so folding them in would have made every one of
 * those assertions ask a question with no answer. `Mod-p` would have gone red
 * first, being precisely the chord the grammar leaves unbound.
 *
 * SO THE PROPERTY IS KEPT, NOT THE MECHANISM. `buildKeySheet`'s contract is
 * that a row exists only because a binding does; this holds the same bargain
 * against the other source of truth. `buildFilesSheet` reads `TREE_KEYS` and
 * `EDITOR_KEYS` — the lists `resolveTreeKey` and `FilesTab.tsx`'s own handlers
 * dispatch on, so a key removed from one stops working — and THROWS on a key
 * with no caption. A key added to either list without a word about it fails
 * `vitest run` rather than going undocumented, which is the defect this whole
 * change exists to fix: the filter was real and invisible for a release.
 */

import { describe, expect, it } from 'vitest';
import { buildFilesSheet } from '../../src/renderer/keyboard/keysheet.js';
import { EDITOR_KEYS, TREE_KEYS } from '../../src/renderer/panels/files-tree.js';

/** Every key the Files tab dispatches on, deduplicated — the same union
 *  `files-tab.keyboard-doc.test.ts` holds `docs/keyboard.md` against. */
const answered = () => [...new Set([...TREE_KEYS, ...EDITOR_KEYS])];

const rows = () => buildFilesSheet().flatMap((group) => group.rows);

describe('the sheet’s Files section', () => {
  it('walks a real corpus rather than going green on an empty one', () => {
    // A sweep must prove it found something: four guards in this repo have
    // passed having examined zero of anything.
    expect(answered().length).toBeGreaterThanOrEqual(10);
    expect(buildFilesSheet().length).toBe(1);
    expect(rows().length).toBe(answered().length);
  });

  it('gives every key the tab answers exactly one row', () => {
    const printed = rows().map((row) => row.keys);
    for (const key of answered()) {
      expect(printed, `"${key}" is answered by the Files tab but not on the sheet`).toContain(key);
    }
    expect(new Set(printed).size, 'a key is printed twice').toBe(printed.length);
  });

  it('names no key the tab does not answer', () => {
    const tabKeys = new Set(answered());
    for (const row of rows()) {
      expect(tabKeys, `the sheet advertises "${row.keys}"`).toContain(row.keys);
    }
  });

  it('gives every row a non-empty caption and no mode or dead mark', () => {
    for (const row of rows()) {
      expect(row.label.trim().length, `"${row.keys}" has a blank caption`).toBeGreaterThan(0);
      // These keys belong to one tab, not to a cursor mode, and nothing can
      // shadow them: the two fields the chord-derived rows carry are `null`
      // here rather than guessed at.
      expect(row.mode).toBeNull();
      expect(row.dead).toBeNull();
    }
  });

  it('throws on a key with no caption instead of rendering a blank row', () => {
    // The next key added to `TREE_KEYS` or `EDITOR_KEYS` without a word about
    // it has to break a test, not ship a row of empty space nobody notices.
    expect(() => buildFilesSheet(['Mod-Alt-nonesuch'])).toThrow(/Mod-Alt-nonesuch/);
  });

  /**
   * A CAPTION THAT NAMES A CHORD NAMES IT THE PLATFORM'S WAY TOO. The Tab row
   * discloses the OTHER half of its key — Shift+Tab outdents — and that is a
   * keystroke like any other: ⇧⇥ on a Mac, `Shift+Tab` off one. The `keys`
   * column is rendered by `KeySheet.tsx`; a caption is prose and has to carry
   * its own rendering, which is why this builder takes the platform.
   */
  it('renders a chord named inside a caption', () => {
    const tab = (mac: boolean) =>
      buildFilesSheet(['Tab'], mac)
        .flatMap((group) => group.rows)
        .find((row) => row.keys === 'Tab');
    expect(tab(true)?.label).toContain('⇧⇥');
    expect(tab(true)?.label).not.toContain('Shift+Tab');
    expect(tab(false)?.label).toContain('Shift+Tab');
    // And the row's own key is still the token the handlers dispatch on.
    expect(tab(true)?.keys).toBe('Tab');
  });

  it('says the file search is reachable from anywhere in the tab', () => {
    // The operator's ask, in the one place they go to look for a key. `/` is
    // the tree's own spelling and stays; `Mod-p` is the one that also works
    // with the caret in the editor, and the caption has to say so or the
    // sheet repeats the gap it is fixing.
    const modP = rows().find((row) => row.keys === 'Mod-p');
    expect(modP).toBeDefined();
    expect(modP?.label.toLowerCase()).toMatch(/search|find/);
    expect(
      rows()
        .find((row) => row.keys === '/')
        ?.label.toLowerCase(),
    ).toMatch(/filter|search/);
  });
});
