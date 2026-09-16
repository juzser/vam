// @vitest-environment happy-dom

/**
 * The terminal screen's text size: one stored number out of a named few, and
 * the store that puts it in force.
 *
 * WHY THIS IS NOT `outFontSize` WITH A DIFFERENT KEY, said here because the
 * two look alike from the outside. `out`'s size is a slider over a range and
 * is applied as a custom property on the document root -- nothing has to
 * re-render for it, because nothing but the paint depends on it. The terminal
 * screen's size decides HOW MANY COLUMNS TMUX IS TOLD TO COMPOSE AT
 * (`terminal-size.ts`), so a change to it has to reach React and re-run a
 * measurement. That is why this one is a store with a snapshot and a
 * subscription, the shape `useSyncExternalStore` asks for, and why the
 * assertions below are about a value MOVING rather than about a pixel.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setTerminalFontSize,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  activeTerminalFontSize,
  DEFAULT_TERMINAL_FONT_SIZE,
  readTerminalFontSize,
  setActiveTerminalFontSize,
  subscribeTerminalFontSize,
  TERMINAL_FONT_SIZES,
  TERMINAL_LINE_HEIGHT,
} from '../../src/renderer/prefs/terminal-font.js';

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

describe('the sizes the terminal offers', () => {
  it('offers four, smallest first, with the shipped one still among them', () => {
    // 10.5px is what the pane drew at before there was a setting, and it stays
    // on the list on purpose: shipping a bigger default must not take the old
    // size away from whoever preferred it.
    expect([...TERMINAL_FONT_SIZES]).toEqual([10.5, 11.5, 12.5, 14]);
    expect([...TERMINAL_FONT_SIZES].sort((a, b) => a - b)).toEqual([...TERMINAL_FONT_SIZES]);
  });

  it('defaults to a size a person can read across a room, not the old one', () => {
    // Pinned, because a changed default moves every operator who never opened
    // the dialog -- which is exactly why it should cost an edit here.
    expect(DEFAULT_TERMINAL_FONT_SIZE).toBe(12.5);
    expect(TERMINAL_FONT_SIZES).toContain(DEFAULT_TERMINAL_FONT_SIZE);
    expect(TERMINAL_LINE_HEIGHT).toBe(1.55);
  });

  it('reads back only a size it offers, and answers the default for anything else', () => {
    for (const size of TERMINAL_FONT_SIZES) {
      expect(readTerminalFontSize(size), `${size}`).toBe(size);
    }
    // EXACT OR DEFAULT, not nearest. The list is the whole vocabulary of this
    // setting: a stored 13 is a value no dialog could show as chosen, and
    // snapping it to 12.5 would leave the operator looking at a pressed button
    // they never pressed.
    for (const raw of [13, 0, -1, 999, Number.NaN, Number.POSITIVE_INFINITY, '12.5', null, {}]) {
      expect(readTerminalFontSize(raw), JSON.stringify(raw)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
    }
  });
});

describe('the terminal text size round-trips through the store', () => {
  it('writes and reads back a chosen size, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setTerminalFontSize(setTheme(EMPTY_PREFS, 'system'), 14));
    const back = readPrefs(storage);
    expect(back.terminalFontSize).toBe(14);
    expect(back.theme).toBe('system');
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    const back = stored({ theme: 'light', outFontSize: 15 });
    expect(back.terminalFontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE);
    expect(back.outFontSize).toBe(15);
  });

  it('normalises on the way in as well as on the way out', () => {
    // The dialog cannot produce a size off the list, but a future caller
    // could, and a hand-edited payload already can.
    expect(setTerminalFontSize(EMPTY_PREFS, 13).terminalFontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE);
    expect(stored({ terminalFontSize: 'big' }).terminalFontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE);
    expect(stored({ terminalFontSize: 10.5 }).terminalFontSize).toBe(10.5);
  });
});

describe('the size in force reaches React', () => {
  it('is what the last read put there, and tells its subscribers when it moves', () => {
    setActiveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    const heard = vi.fn();
    const stop = subscribeTerminalFontSize(heard);

    readPrefs(fake(JSON.stringify({ terminalFontSize: 14 })));
    expect(activeTerminalFontSize()).toBe(14);
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    setActiveTerminalFontSize(10.5);
    expect(activeTerminalFontSize()).toBe(10.5);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('says nothing when a write moves some other preference', () => {
    // `activatePrefs` runs on every write, so a theme flip would otherwise
    // re-render -- and re-measure, and re-size somebody's tmux session --
    // for a setting nobody touched.
    setActiveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    const heard = vi.fn();
    const stop = subscribeTerminalFontSize(heard);
    readPrefs(
      fake(JSON.stringify({ terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE, theme: 'light' })),
    );
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});
