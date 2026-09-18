/**
 * CTRL + A LETTER IS THE TERMINAL'S — EXCEPT THE TWO GESTURES FOR READING.
 *
 * The operator, on PR 361: "Ctrl + a letter applies only to the terminal, like
 * the default terminal shortcuts." Asked specifically about the two vim scroll
 * chords, they drew the line themselves: "Keep them in the Response view; drop
 * them in the terminal."
 *
 * So this is deliberately NOT one clean rule, and the tests are arranged to say
 * so rather than to smooth it over. Two of vam's eight `Mod-<letter>` chords
 * are gestures for READING A TRANSCRIPT and keep Ctrl; the other six are
 * APPLICATION COMMANDS and move to the command modifier alone:
 *
 *   Ctrl+D / Ctrl+U    half a screen of transcript      KEPT (vim's own)
 *   Ctrl+K             palette                          gone on macOS
 *   Ctrl+N             new session                      gone on macOS
 *   Ctrl+T             new tab                          gone on macOS
 *   Ctrl+W             close                            gone on macOS
 *   Ctrl+Shift+H       back to the session list         gone on macOS
 *   Ctrl+Shift+P       new project                      gone on macOS
 *
 * FOUR OF THE SIX ARE READLINE'S OWN — `Ctrl+K` kill-to-end, `Ctrl+W`
 * delete-word-back, `Ctrl+N` next-history, `Ctrl+T` transpose — and `Ctrl+U`,
 * the chord the original report was about, is readline's kill-line. That is the
 * whole argument: a keystroke a terminal has a meaning for should not also be
 * an application command.
 *
 * "GONE ON macOS" AND NOWHERE ELSE, which is the portability half. Linux and
 * Windows have no Cmd key, so Control IS the command modifier there and all
 * six keep answering it; the `PC` cases below are what stops a later reader
 * from believing the six were simply deleted.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHORD,
  type KeyAction,
  type KeyEventLike,
  normalizeKey,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';

/** macOS, where Cmd is the command modifier and Control is its own key. */
const MAC = true;
/** Linux and Windows, where Control IS the command modifier. */
const PC = false;

function press(
  event: KeyEventLike,
  mac: boolean,
): { readonly key: string | null; readonly action: KeyAction | null } {
  const key = normalizeKey(event, mac);
  return { key, action: key === null ? null : resolveChord(EMPTY_CHORD, key).action };
}

/** A letter keydown as a browser reports one: the character, and the physical
 *  key beside it. */
const letter = (value: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: value,
  code: `Key${value.toUpperCase()}`,
  ...modifiers,
});

/** The six application commands, with the keystroke each used to answer. */
const COMMANDS = [
  ['palette', letter('k', { ctrlKey: true }), { kind: 'palette' }],
  ['newSession', letter('n', { ctrlKey: true }), { kind: 'newSession' }],
  ['newTab', letter('t', { ctrlKey: true }), { kind: 'newTab' }],
  ['close', letter('w', { ctrlKey: true }), { kind: 'close' }],
  ['focusList', letter('H', { ctrlKey: true, shiftKey: true }), { kind: 'focusList' }],
  ['newProject', letter('P', { ctrlKey: true, shiftKey: true }), { kind: 'newProject' }],
] as const satisfies readonly (readonly [string, KeyEventLike, KeyAction])[];

/** The same six under the command modifier, which is where they live now. */
const withCommand = (event: KeyEventLike): KeyEventLike => {
  const { ctrlKey: _dropped, ...rest } = event;
  return { ...rest, metaKey: true };
};

describe('the six application commands come off Ctrl on macOS', () => {
  it.each(COMMANDS)('leaves Ctrl+%s to the terminal', (_name, event) => {
    expect(press(event, MAC).action).toBeNull();
  });

  it.each(COMMANDS)('keeps %s on the command modifier', (_name, event, action) => {
    expect(press(withCommand(event), MAC).action).toEqual(action);
  });

  it('spells the abandoned chord apart, so it can never answer the Cmd binding', () => {
    expect(press(letter('k', { ctrlKey: true }), MAC).key).toBe('Ctrl-k');
    expect(press(letter('w', { ctrlKey: true }), MAC).key).toBe('Ctrl-w');
    expect(press(letter('P', { ctrlKey: true, shiftKey: true }), MAC).key).toBe('Ctrl-Shift-p');
  });
});

describe('the two reading gestures keep Ctrl, because the operator asked for vim’s', () => {
  it('scrolls half a screen down on Ctrl+D and on Cmd+D alike', () => {
    for (const mac of [MAC, PC]) {
      expect(press(letter('d', { ctrlKey: true }), mac).key).toBe('Mod-d');
      expect(press(letter('d', { ctrlKey: true }), mac).action).toEqual({
        kind: 'scrollHalf',
        delta: 1,
      });
      expect(press(letter('d', { metaKey: true }), mac).action).toEqual({
        kind: 'scrollHalf',
        delta: 1,
      });
    }
  });

  it('scrolls half a screen up on Ctrl+U and on Cmd+U alike', () => {
    for (const mac of [MAC, PC]) {
      expect(press(letter('u', { ctrlKey: true }), mac).key).toBe('Mod-u');
      expect(press(letter('u', { ctrlKey: true }), mac).action).toEqual({
        kind: 'scrollHalf',
        delta: -1,
      });
      expect(press(letter('u', { metaKey: true }), mac).action).toEqual({
        kind: 'scrollHalf',
        delta: -1,
      });
    }
  });

  it('is exactly two letters, and CapsLock cannot widen it', () => {
    // The set is keyed off the lower-cased letter, the same base `normalizeKey`
    // spells a modified letter with -- so an operator with CapsLock on still
    // reaches the fold, and no third letter joins by accident.
    expect(press({ key: 'D', code: 'KeyD', ctrlKey: true }, MAC).key).toBe('Mod-d');
    for (const value of 'abcefghijklmnopqrstvwxyz') {
      expect(press(letter(value, { ctrlKey: true }), MAC).key, `Ctrl+${value}`).toBe(
        `Ctrl-${value}`,
      );
    }
  });
});

describe('Linux and Windows lose none of the eight', () => {
  it.each(COMMANDS)('still reaches %s under Ctrl, the command modifier there', (_n, event, act) => {
    expect(press(event, PC).action).toEqual(act);
  });

  it('reaches them under Super too, rather than dropping every token', () => {
    expect(press(letter('k', { metaKey: true }), PC).action).toEqual({ kind: 'palette' });
  });

  /**
   * AND SUPER IS THE ESCAPE HATCH OUT OF A FOCUSED TERMINAL THERE.
   *
   * `TerminalTab.tsx` claims every Ctrl+letter and — since the shifted chords
   * were handed to it — `Ctrl+Shift+<letter>` as well, PLATFORM-BLIND, because
   * the pane does not know which platform it is on and no terminal's wire
   * carries the difference anyway. On Linux and Windows that takes the CTRL
   * spelling of six vam commands away while a terminal holds the keyboard, and
   * the only thing stopping any of them becoming UNREACHABLE from in there is
   * this: the pane returns above its chord branch on `metaKey`, and Super
   * spells `Mod-` here exactly as Cmd does on macOS.
   *
   * THE TWO SHIFTED ONES ARE WHY THIS IS A TEST AND NOT A REMARK. The plain
   * four were already in that position and nobody wrote the hatch down;
   * `focusList` and `newProject` have now joined them, and a later reader
   * deciding to spell `command` differently on PC would take the last way back
   * out of a terminal with it and watch nothing go red.
   *
   * NOT DRIVEN ON EITHER PLATFORM. `PC` is a boolean this grammar is asked to
   * answer as, so what is proved is the SPELLING — not that a Linux browser
   * reports Super as `metaKey`, which is the web platform's own contract and
   * is taken on faith here as it is everywhere else in this file.
   */
  it('keeps the two SHIFTED commands under Super, which is the way out of a terminal', () => {
    expect(press(letter('H', { metaKey: true, shiftKey: true }), PC).key).toBe('Mod-Shift-h');
    expect(press(letter('H', { metaKey: true, shiftKey: true }), PC).action).toEqual({
      kind: 'focusList',
    });
    expect(press(letter('P', { metaKey: true, shiftKey: true }), PC).action).toEqual({
      kind: 'newProject',
    });
  });
});

describe('what the letter unfold deliberately did NOT touch', () => {
  it('keeps Ctrl-[ leaving the prompt box — vim’s own way out of insert mode', () => {
    for (const mac of [MAC, PC]) {
      expect(normalizeKey({ key: '[', code: 'BracketLeft', ctrlKey: true }, mac)).toBe('Mod-[');
    }
  });

  it('keeps a bare letter a bare letter', () => {
    expect(press(letter('k'), MAC).action).toEqual({ kind: 'move', direction: 'up' });
    expect(press(letter('x'), MAC).action).toEqual({ kind: 'close' });
  });

  it('keeps Alt+<letter> unspelled by Ctrl, so macOS composition is untouched', () => {
    // Option+e opens a dead-key composition. Nothing in this grammar binds an
    // `Alt-<letter>` and nothing here changes which keystroke produces one.
    expect(press({ key: 'ˆ', code: 'KeyI', altKey: true }, MAC).key).toBe('Alt-ˆ');
  });
});

/**
 * THE DOUBLE MEANING THIS CLOSES, MEASURED BEFORE AND AFTER.
 *
 * With the terminal pane holding the keyboard, `TerminalTab.tsx` claims every
 * PLAIN Ctrl+letter and stops it, so `Ctrl+K`/`Ctrl+W`/`Ctrl+U` reached tmux
 * and vam never heard them -- that half was already right.
 *
 * `Ctrl+Shift+<letter>` was the hole. The pane's rule is `ctrlKey && !altKey &&
 * !shiftKey`, so a shifted control chord is handed back unsent, and vam's
 * grammar answered two of them: measured on the base revision, Ctrl+Shift+H in
 * a focused terminal moved the keyboard to the session list and Ctrl+Shift+P
 * opened a directory picker, while tmux received nothing. No terminal
 * distinguishes `Ctrl+Shift+P` from `Ctrl+P` -- both are 0x10 -- so the
 * operator was pressing a terminal gesture and getting an application command.
 *
 * BOTH HALVES ARE FIXED NOW, in two commits and in two files, and this one
 * only ever owned the first. Here: vam stopped answering either chord on
 * macOS, so the keystroke stopped doing the wrong thing -- and for a while did
 * nothing at all, because `TerminalTab.tsx` still did not FORWARD it. There:
 * the pane's rule lost its `!shiftKey` clause and `Ctrl+Shift+P` became `C-p`
 * on the wire, which is what every terminal has always sent for it.
 *
 * WHAT STAYS THIS GRAMMAR'S BUSINESS is the assertion below, and it is worth
 * more now than it was when it was written: while the pane has the keyboard a
 * shifted control chord never reaches vam at all, but the moment focus is
 * anywhere ELSE on macOS these two must still answer nothing, or the operator
 * gets a directory picker from a chord they meant for a shell.
 * `test/panels/TerminalTab.control-chords.test.tsx` owns the other half, and
 * `Mod-Shift-h`/`Mod-Shift-p` under Super above own what Linux and Windows
 * pay for it.
 */
describe('the shifted control chords a terminal would have wanted', () => {
  it('answers neither of them on macOS now', () => {
    expect(press(letter('H', { ctrlKey: true, shiftKey: true }), MAC).action).toBeNull();
    expect(press(letter('P', { ctrlKey: true, shiftKey: true }), MAC).action).toBeNull();
  });
});
