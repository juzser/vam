/**
 * The two fields the settings overlay writes: the theme (now with a third,
 * `system`, that follows the OS instead of a stored pick) and the focus zoom
 * share that `Canvas.tsx` carried as a constant with a comment promising it
 * would become a setting.
 *
 * The half of this worth testing is not the setters — it is `readPrefs`
 * meeting a payload written by a vam that had neither field, which is every
 * payload in every browser today.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  clampFocusShare,
  FOCUS_SHARE_OFF,
  nudgeFocusShare,
  DEFAULT_FOCUS_SHARE,
  EMPTY_PREFS,
  FOCUS_SHARE_MAX,
  FOCUS_SHARE_MIN,
  readPrefs,
  type StorageLike,
  setFocusShare,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) {
        this.value = value;
      }
    },
  };
}

describe('the settings fields round-trip', () => {
  it('has a real range to clamp into', () => {
    // Without this, every `toBe(DEFAULT_FOCUS_SHARE)` below would pass against
    // an undefined field compared with an undefined constant.
    expect(DEFAULT_FOCUS_SHARE).toBe(0.6);
    expect(FOCUS_SHARE_MIN).toBeGreaterThan(0);
    expect(FOCUS_SHARE_MIN).toBeLessThan(DEFAULT_FOCUS_SHARE);
    expect(FOCUS_SHARE_MAX).toBeGreaterThan(DEFAULT_FOCUS_SHARE);
  });

  it('writes and reads back a theme and a focus share', () => {
    const storage = fake();
    writePrefs(storage, setFocusShare(setTheme(EMPTY_PREFS, 'system'), 0.9));
    const back = readPrefs(storage);
    expect(back.theme).toBe('system');
    expect(back.focusViewportShare).toBe(0.9);
  });

  it('defaults both from a payload written before either field existed', () => {
    // Today's shipped shape: no theme-vs-system, no focus share, and a pane
    // width that must come back untouched.
    const storage = fake(JSON.stringify({ icons: {}, panes: { sidebar: 300, detail: 420 } }));
    const back = readPrefs(storage);
    expect(back.theme).toBe(EMPTY_PREFS.theme);
    expect(back.focusViewportShare).toBe(DEFAULT_FOCUS_SHARE);
    expect(back.panes).toEqual({ sidebar: 300, detail: 420 });
  });

  it('defends per field: one garbage value does not cost the other', () => {
    const storage = fake(
      JSON.stringify({ theme: 'light', focusViewportShare: 'loud', colorScheme: 42 }),
    );
    const back = readPrefs(storage);
    expect(back.theme).toBe('light');
    expect(back.focusViewportShare).toBe(DEFAULT_FOCUS_SHARE);
  });

  it('clamps a stored share into the legal range instead of taking it', () => {
    expect(readPrefs(fake(JSON.stringify({ focusViewportShare: 40 }))).focusViewportShare).toBe(
      FOCUS_SHARE_MAX,
    );
    expect(readPrefs(fake(JSON.stringify({ focusViewportShare: 0.05 }))).focusViewportShare).toBe(
      FOCUS_SHARE_MIN,
    );
  });

  it('clamping one field does not touch the ones beside it', () => {
    const back = readPrefs(
      fake(JSON.stringify({ theme: 'light', focusViewportShare: 40, outFontSize: 15 })),
    );
    expect(back.focusViewportShare).toBe(FOCUS_SHARE_MAX);
    expect(back.theme).toBe('light');
    expect(back.outFontSize).toBe(15);
  });

  /**
   * Zero is OFF, and not a very small share.
   *
   * The operator asked for the automatic framing to be removed once already,
   * so the setting that brings it back has to be able to be turned off again
   * without another round trip. Zero is the value that says so -- it reads
   * literally as "the session takes none of the canvas", which is not a
   * framing anyone could want and so is free to mean "do not frame".
   *
   * A stored 0 used to clamp up to the minimum; that assertion is now the
   * 0.05 above, which is a genuinely out-of-range share rather than the
   * sentinel.
   */
  it('keeps zero as the off value rather than clamping it up', () => {
    expect(clampFocusShare(FOCUS_SHARE_OFF)).toBe(FOCUS_SHARE_OFF);
    expect(readPrefs(fake(JSON.stringify({ focusViewportShare: 0 }))).focusViewportShare).toBe(
      FOCUS_SHARE_OFF,
    );
    expect(setFocusShare(EMPTY_PREFS, 0).focusViewportShare).toBe(FOCUS_SHARE_OFF);
  });

  /**
   * There is nothing between off and the smallest useful share, so a step into
   * the gap crosses it. Without this the control would be a one-way door: the
   * minus button at 30% would produce 25%, clamp back to 30%, and off would be
   * reachable only by typing a zero.
   */
  it('steps across the gap between off and the smallest share, both ways', () => {
    expect(nudgeFocusShare(FOCUS_SHARE_MIN, FOCUS_SHARE_MIN - 0.05)).toBe(FOCUS_SHARE_OFF);
    expect(nudgeFocusShare(FOCUS_SHARE_OFF, 0.05)).toBe(FOCUS_SHARE_MIN);
    // And a value in range is simply itself, clamped.
    expect(nudgeFocusShare(FOCUS_SHARE_MIN, 0.75)).toBe(0.75);
    expect(nudgeFocusShare(0.75, 40)).toBe(FOCUS_SHARE_MAX);
  });

  it('clamps totally — no input produces NaN, which would blank the canvas', () => {
    expect(clampFocusShare(Number.NaN)).toBe(DEFAULT_FOCUS_SHARE);
    expect(clampFocusShare(Number.POSITIVE_INFINITY)).toBe(FOCUS_SHARE_MAX);
    expect(clampFocusShare(-3)).toBe(FOCUS_SHARE_MIN);
    expect(clampFocusShare(0.75)).toBe(0.75);
  });
});

describe('applyTheme resolves system against the OS', () => {
  function el(): Element {
    const set = new Set<string>();
    return {
      classList: {
        toggle: (name: string, on: boolean) => (on ? set.add(name) : set.delete(name)),
        contains: (name: string) => set.has(name),
      },
      // exposed for the assertions below
      names: set,
    } as unknown as Element;
  }

  function names(node: Element): Set<string> {
    return (node as unknown as { names: Set<string> }).names;
  }

  it('puts light on the document for an explicit light pick', () => {
    const node = el();
    applyTheme('light', node, () => false);
    expect(names(node).has('light')).toBe(true);
  });

  it('removes light for an explicit dark pick, whatever the OS says', () => {
    const node = el();
    applyTheme('light', node, () => true);
    applyTheme('dark', node, () => true);
    expect(names(node).has('light')).toBe(false);
  });

  it('follows the OS for system, in both directions', () => {
    const node = el();
    applyTheme('system', node, () => true);
    expect(names(node).has('light')).toBe(true);
    applyTheme('system', node, () => false);
    expect(names(node).has('light')).toBe(false);
  });
});
