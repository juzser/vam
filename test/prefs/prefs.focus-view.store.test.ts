// @vitest-environment happy-dom

/**
 * FOCUS VIEW, THROUGH THE STORE — the round trip, the migration, and the seam
 * that arms the column.
 *
 * The rule itself, and the way back it is paired with, are
 * `prefs.focus-view.test.ts`. What is here is everything between a payload in
 * `localStorage` and a mode in force: that a chosen value survives a write and
 * a read, that a payload written by a vam WITHOUT this field comes back with
 * the mode that hides nothing, that an operator who chose the retired
 * `collapsed` still has their choice, and that both the read path and the
 * write path arm the module store the column subscribes to.
 *
 * THE READ PATH MATTERS AS MUCH AS THE WRITE PATH, which is the half easiest
 * to leave out. `Canvas.tsx` owns the prefs state and the column reads the
 * mode off this module rather than down a prop, so a `readPrefs` that parsed
 * the field and did not activate it would come up in the wrong mode after
 * every reload while every write-path test stayed green.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setFocusView,
  setOutFontSize,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  activeFocusView,
  DEFAULT_FOCUS_VIEW,
  setActiveFocusView,
  subscribeFocusView,
} from '../../src/renderer/prefs/progress.js';

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

describe('the focus-view choice round-trips', () => {
  it('defaults to off, so merely shipping the setting hides nothing', () => {
    expect(EMPTY_PREFS.focusView).toBe(false);
    expect(DEFAULT_FOCUS_VIEW).toBe(false);
  });

  it('writes and reads back a chosen value, disturbing no neighbour', () => {
    const store = fake();
    writePrefs(store, setOutFontSize(setFocusView(EMPTY_PREFS, true), 15));
    const back = readPrefs(store);
    expect(back.focusView).toBe(true);
    expect(back.outFontSize).toBe(15);
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    // Read per field like every line beside it: a stored object with no
    // `focusView` key is the shape in every operator's browser right now, and
    // a migration that reset an unrelated setting to get a default for a new
    // one is the defect `prefs.appearance.test.ts` exists to catch.
    const back = stored({ theme: 'light', outFontSize: 15 });
    expect(back.focusView).toBe(false);
    expect(back.theme).toBe('light');
    expect(back.outFontSize).toBe(15);
  });

  it('falls back to off for anything that is not a boolean', () => {
    for (const junk of ['yes', 1, {}, [], null]) {
      expect(stored({ focusView: junk }).focusView, JSON.stringify(junk)).toBe(false);
    }
  });

  it('carries an operator’s stored `collapsed` into the new field', () => {
    // THE MIGRATION, END TO END rather than only through `readFocusView`.
    // `turnProgress` had a settings row and a writer, so this payload is one
    // an operator really has; dropping it would silently un-set a preference
    // they made. `prefs.ts`'s header draws the line against
    // `dismissedSessions`, which needed no migration because no write path
    // could ever have produced it.
    expect(stored({ turnProgress: 'collapsed' }).focusView).toBe(true);
    expect(stored({ turnProgress: 'shown' }).focusView).toBe(false);
    // A word this vam has no mode for is not a licence to fold a screen.
    expect(stored({ turnProgress: 'folded' }).focusView).toBe(false);
  });

  it('lets the new field win wherever both are stored', () => {
    // The old word is a fallback for a payload that predates the boolean,
    // never an override of it: an operator who has since turned focus view off
    // has said so more recently than the migration has.
    expect(stored({ focusView: false, turnProgress: 'collapsed' }).focusView).toBe(false);
    expect(stored({ focusView: true, turnProgress: 'shown' }).focusView).toBe(true);
  });

  it('does not write the retired word back out', () => {
    // A payload that kept carrying `turnProgress` would migrate itself
    // forever, and the next vam to read it would have two sources of truth for
    // one preference. `writePrefs` stringifies the freshly-parsed object, so
    // the field simply stops being carried -- asserted rather than assumed,
    // because "it works because of how the writer happens to be built" is
    // exactly how a field comes back.
    const store = fake(JSON.stringify({ turnProgress: 'collapsed' }));
    const read = readPrefs(store);
    expect(read.focusView).toBe(true);
    writePrefs(store, read);
    expect(store.value).not.toContain('turnProgress');
    expect(readPrefs(store).focusView, 'and the choice survived the rewrite').toBe(true);
  });

  it('leaves the neighbouring appearance settings alone', () => {
    const both = setTheme(setOutFontSize(setFocusView(EMPTY_PREFS, true), 15), 'light');
    expect(both.focusView).toBe(true);
    expect(both.outFontSize).toBe(15);
    expect(both.theme).toBe('light');
  });
});

describe('the chosen mode reaches the column', () => {
  it('is in force after a read, not only after a write', () => {
    readPrefs(fake(JSON.stringify({ focusView: true })));
    expect(activeFocusView()).toBe(true);
    readPrefs(fake(JSON.stringify({ focusView: false })));
    expect(activeFocusView()).toBe(false);
    // And the migrated payload arms it too, or an operator who chose
    // `collapsed` comes up unfolded once and is told nothing.
    readPrefs(fake(JSON.stringify({ turnProgress: 'collapsed' })));
    expect(activeFocusView()).toBe(true);
    setActiveFocusView(DEFAULT_FOCUS_VIEW);
  });

  it('is in force after a write, and tells its readers', () => {
    setActiveFocusView(false);
    let told = 0;
    const stop = subscribeFocusView(() => {
      told += 1;
    });
    writePrefs(fake(), setFocusView(EMPTY_PREFS, true));
    expect(activeFocusView()).toBe(true);
    expect(told).toBe(1);
    // A write that changes nothing is not news: `useSyncExternalStore` calls
    // every listener it is told to, and a store that fired on every prefs
    // write would re-render the column on an unrelated theme flip.
    writePrefs(fake(), setFocusView(EMPTY_PREFS, true));
    expect(told).toBe(1);
    stop();
    setActiveFocusView(false);
    expect(told).toBe(1);
  });
});
