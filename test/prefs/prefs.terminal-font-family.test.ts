// @vitest-environment happy-dom

/**
 * The terminal screen's own FONT, alongside its already-shipped SIZE
 * (`terminal-font.ts`). Same "store with a snapshot and a subscription"
 * shape as that file, for the reason its own header gives: the resolved
 * family reaches `TerminalStreamTab.tsx`'s xterm instance as a construction
 * option and a live `term.options.fontFamily` write, neither of which a
 * custom property on the document root can reach — `--font-mono` is
 * INLINED into the `font-mono` utility at build time (`terminal-font.ts`'s
 * own header), so there is no live value for a DOM xterm renderer to read.
 *
 * STORED AS ONE FAMILY NAME, NEVER A WHOLE STACK: an operator picks (or
 * types) the one font they want tried first, and `resolveTerminalFontFamily`
 * is what appends vam's own fallback stack (`TERMINAL_FONT_FAMILY`) behind
 * it, so a family the operating system does not actually have still leaves
 * the pane readable rather than falling through to whatever the browser
 * engine picks on its own.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setTerminalFontFamily,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import { TERMINAL_FONT_FAMILY } from '../../src/renderer/prefs/terminal-font.js';
import {
  activeTerminalFontFamily,
  DEFAULT_TERMINAL_FONT_FAMILY,
  MAX_TERMINAL_FONT_FAMILY_LENGTH,
  readTerminalFontFamily,
  resolveTerminalFontFamily,
  setActiveTerminalFontFamily,
  subscribeTerminalFontFamily,
} from '../../src/renderer/prefs/terminal-font-family.js';

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

describe('reading a stored terminal font family', () => {
  it('defaults to unset — the shipped stack, untouched', () => {
    expect(DEFAULT_TERMINAL_FONT_FAMILY).toBe('');
    expect(readTerminalFontFamily(undefined)).toBe('');
  });

  it('trims and keeps an ordinary family name', () => {
    expect(readTerminalFontFamily('  Fira Code  ')).toBe('Fira Code');
  });

  it('is total: anything that is not a sane string reads back unset', () => {
    for (const raw of [null, 42, {}, [], true, '   ']) {
      expect(readTerminalFontFamily(raw), JSON.stringify(raw)).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    }
  });

  it('strips a quote character, so a hand-edited value cannot break the CSS it is spliced into', () => {
    expect(readTerminalFontFamily(`Evil'; } * { color: red`)).not.toContain("'");
  });

  it('is capped, so a pasted essay cannot reach xterm as a font name', () => {
    const huge = 'x'.repeat(MAX_TERMINAL_FONT_FAMILY_LENGTH + 1);
    expect(readTerminalFontFamily(huge)).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    const exact = 'x'.repeat(MAX_TERMINAL_FONT_FAMILY_LENGTH);
    expect(readTerminalFontFamily(exact)).toBe(exact);
  });
});

describe('resolving the family a real renderer can use', () => {
  it('unset is the shipped stack alone', () => {
    expect(resolveTerminalFontFamily('')).toBe(TERMINAL_FONT_FAMILY);
  });

  it('a chosen family is tried FIRST, with the shipped stack still the fallback', () => {
    expect(resolveTerminalFontFamily('Fira Code')).toBe(`'Fira Code', ${TERMINAL_FONT_FAMILY}`);
  });
});

describe('the terminal font family round-trips through the store', () => {
  it('writes and reads back a chosen family, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setTerminalFontFamily(setTheme(EMPTY_PREFS, 'system'), 'JetBrains Mono'));
    const back = readPrefs(storage);
    expect(back.terminalFontFamily).toBe('JetBrains Mono');
    expect(back.theme).toBe('system');
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    const back = stored({ theme: 'light' });
    expect(back.terminalFontFamily).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });

  it('normalises on the way in as well as on the way out', () => {
    expect(setTerminalFontFamily(EMPTY_PREFS, '  Menlo  ').terminalFontFamily).toBe('Menlo');
    expect(stored({ terminalFontFamily: 42 }).terminalFontFamily).toBe(
      DEFAULT_TERMINAL_FONT_FAMILY,
    );
  });
});

describe('the family in force reaches React', () => {
  it('is what the last read put there, resolved, and tells its subscribers when it moves', () => {
    setActiveTerminalFontFamily(DEFAULT_TERMINAL_FONT_FAMILY);
    const heard = vi.fn();
    const stop = subscribeTerminalFontFamily(heard);

    readPrefs(fake(JSON.stringify({ terminalFontFamily: 'Fira Code' })));
    expect(activeTerminalFontFamily()).toBe(`'Fira Code', ${TERMINAL_FONT_FAMILY}`);
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    setActiveTerminalFontFamily(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(activeTerminalFontFamily()).toBe(TERMINAL_FONT_FAMILY);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('says nothing when a write moves some other preference', () => {
    setActiveTerminalFontFamily(DEFAULT_TERMINAL_FONT_FAMILY);
    const heard = vi.fn();
    const stop = subscribeTerminalFontFamily(heard);
    readPrefs(fake(JSON.stringify({ terminalFontFamily: '', theme: 'light' })));
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});
