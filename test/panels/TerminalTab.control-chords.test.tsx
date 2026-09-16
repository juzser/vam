// @vitest-environment happy-dom

/**
 * WHO OWNS A MODIFIED KEY WHILE THE TERMINAL PANE HAS THE KEYBOARD.
 *
 * THE REPORT was "khong dung duoc Cmd+U de xoa dong hoac cac shortcut khac
 * trong terminal": Ctrl+U will not kill the line, and neither will anything
 * else. One line in `TerminalTab.tsx` -- `if (event.metaKey || event.ctrlKey
 * || event.altKey) return;` -- had handed every modified key back to vam since
 * the pane first learned to type, so the pane had never forwarded a single
 * chord. Ctrl+U, Ctrl+C, Ctrl+A, Ctrl+E, Ctrl+K, Ctrl+W, Ctrl+R, Ctrl+D,
 * Ctrl+L: those are what a terminal is driven with.
 *
 * THE SPLIT THESE TESTS PIN, and each third of it is a decision:
 *
 *   CTRL + A LETTER IS THE PANE'S. Every one of `C-a`..`C-z` is a real control
 *   character, and the program in the pane is what gives it meaning.
 *
 *   CTRL + ANYTHING ELSE IS STILL VAM'S. `Ctrl+1` produces no control
 *   character in any terminal, so leaving it to vam costs the operator nothing
 *   in the pane and keeps the tab switch working from inside it -- which is
 *   the casualty `TerminalTab.tsx`'s own old comment warned that a wider
 *   branch would claim first.
 *
 *   CMD IS VAM'S, ALWAYS. macOS applications own Cmd, no terminal emulator
 *   sends it, and Cmd+Q must still reach the quit guard.
 *
 *   ALT IS NOT THE PANE'S. On macOS Option is the compose key -- Option+e
 *   starts a dead-key composition -- and vam binds `Alt-<digit>`. The cost is
 *   that Meta chords (Alt+B, Alt+F) do not reach readline; the Esc prefix does
 *   the same job and Escape is already the pane's.
 *
 * THE OUTCOME IS ASSERTED, NOT `defaultPrevented`. A chord the pane claims
 * must not ALSO reach vam's window listener, or `Ctrl+W` would close the tab
 * the operator is typing in on its way to the shell; a chord the pane declines
 * must reach it. So every case here reads what a real window listener heard.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneSendResult, PaneView } from '../../src/shared/terminal.js';
import { isPaneKey } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');

const ATLAS = 'claude-code:atlas-11111111';
const ok = (): PaneView => ({
  kind: 'ok',
  name: 'vam-atlas-a1b2c3',
  text: 'the screen',
  cursor: { kind: 'unreadable' },
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

async function open(send?: ReturnType<typeof vi.fn>) {
  const fn =
    send ?? vi.fn(async (_p: string, _k: PaneKey, _r?: string) => 'sent' as PaneSendResult);
  render(
    <TerminalTab
      projectId={ATLAS}
      rowId={ATLAS}
      read={vi.fn(async () => ok())}
      resize={undefined}
      send={fn as never}
    />,
  );
  await settle();
  return fn;
}

const keys = (send: { mock: { calls: unknown[][] } }): PaneKey[] =>
  send.mock.calls.map((call) => call[1] as PaneKey);

/**
 * Press `init` on the pane and report BOTH outcomes: what the pane asked the
 * bridge to send, and what vam's own window listener heard.
 *
 * The listener is real and is attached to `window`, which is where
 * `Canvas.tsx` attaches its own. That is the only way to measure ownership as
 * an outcome: a key the pane claims has to stop here, and a key it declines
 * has to arrive here.
 */
async function press(init: Partial<KeyboardEventInit> & { key: string }) {
  const heard: string[] = [];
  const onKey = (event: KeyboardEvent) => heard.push(event.key);
  window.addEventListener('keydown', onKey);
  try {
    const send = await open();
    const notPrevented = fireEvent.keyDown(pane() as HTMLElement, init);
    await settle();
    return { sent: keys(send), heard, notPrevented };
  } finally {
    window.removeEventListener('keydown', onKey);
  }
}

describe('Ctrl belongs to the terminal, because every Ctrl+letter is a control character', () => {
  it('sends Ctrl+U, the chord the operator could not use', async () => {
    const { sent, heard, notPrevented } = await press({ key: 'u', ctrlKey: true });
    expect(sent).toEqual([{ kind: 'control', letter: 'u' }]);
    // vam never hears it: `Mod-u` is a binding in the chord table, and a
    // keystroke that both kills the line and scrolls a transcript is two
    // things happening for one press.
    expect(heard).toEqual([]);
    // The browser must not act on it either -- in a focused text control on
    // macOS, Ctrl+U is Cocoa's own delete-to-line-start.
    expect(notPrevented).toBe(false);
  });

  it('sends Ctrl+C, which is how an operator interrupts a running agent', async () => {
    const { sent, heard } = await press({ key: 'c', ctrlKey: true });
    expect(sent).toEqual([{ kind: 'control', letter: 'c' }]);
    expect(heard).toEqual([]);
  });

  it.each([
    ['a', 'start of line'],
    ['e', 'end of line'],
    ['k', 'kill to end of line'],
    ['w', 'delete the word behind'],
    ['r', 'search the history'],
    ['d', 'end of file'],
    ['l', 'clear the screen'],
    ['z', 'suspend'],
  ])('sends Ctrl+%s (%s) into the pane', async (letter) => {
    const { sent } = await press({ key: letter, ctrlKey: true });
    expect(sent).toEqual([{ kind: 'control', letter }]);
  });

  it('sends a shape main will actually accept, which is the only thing that matters', async () => {
    // The renderer may build whatever it likes; `isPaneKey` in main decides
    // what is delivered. A stroke that fails it is answered `unaimed` and the
    // tab draws a sentence about pairing for a key that was simply malformed.
    const { sent } = await press({ key: 'u', ctrlKey: true });
    expect(sent).toHaveLength(1);
    expect(isPaneKey(sent[0])).toBe(true);
  });

  it('lower-cases the letter, so CapsLock does not silently lose the chord', async () => {
    // CapsLock upper-cases a letter with `shiftKey: false` -- indistinguishable
    // at the character level from a real Shift press, and the exact hazard
    // `keyboard/chords.ts` records having shipped once. An operator with
    // CapsLock on still means Ctrl+U.
    const { sent } = await press({ key: 'U', ctrlKey: true, shiftKey: false });
    expect(sent).toEqual([{ kind: 'control', letter: 'u' }]);
  });
});

describe('everything else modified is still vam’s, and reaches vam', () => {
  it.each([
    ['Ctrl and a digit, which is no control character', { key: '1', ctrlKey: true }],
    // THE VIEW CHORD, which has to cross this pane to reach the grammar: it is
    // `Ctrl-Alt-<digit>` since the operator asked for a three-key chord, and
    // the pane declines it here on the `altKey` half of the rule rather than on
    // the letters half. Without this row, a branch that claimed every Ctrl+Alt
    // keystroke would take the one chord that switches a view from inside a
    // terminal and type a control character into somebody's agent instead.
    ['Ctrl+Alt and a digit, which vam binds to a view', { key: '1', ctrlKey: true, altKey: true }],
    ['Ctrl and an arrow', { key: 'ArrowUp', ctrlKey: true }],
    ['Ctrl and Tab, which is how the settings overlay steps', { key: 'Tab', ctrlKey: true }],
    ['Ctrl+Shift and a letter', { key: 'P', ctrlKey: true, shiftKey: true }],
    // A BRACKET FOR VAM'S OWN `Mod-Alt-[`, AND A LETTER FOR THE RULE ITSELF.
    // Only the second can catch a branch that stopped checking `altKey`: `[`
    // is not a control letter under any modifier, so the bracket case stayed
    // green through a mutation that claimed every Ctrl+Alt+letter. And the
    // letter is the one with real meaning -- Ctrl+Alt+E in a terminal is Meta
    // and Ctrl together, which `C-e` alone would silently drop the Meta from.
    [
      'Ctrl+Alt and a bracket, which vam binds to stepping a split',
      { key: '[', ctrlKey: true, altKey: true },
    ],
    [
      'Ctrl+Alt and a LETTER, which is Meta and Ctrl at once',
      { key: 'e', ctrlKey: true, altKey: true },
    ],
    ['Cmd and a letter', { key: 'k', metaKey: true }],
    ['Cmd and a digit', { key: '1', metaKey: true }],
    ['Cmd+Ctrl together, where Cmd wins', { key: 'u', metaKey: true, ctrlKey: true }],
    ['Alt and a digit, which vam binds to nothing at all now', { key: '1', altKey: true }],
    ['Alt and a letter, which macOS composes with', { key: 'e', altKey: true }],
  ])('leaves %s alone', async (_why, init) => {
    const { sent, heard } = await press(init);
    expect(sent).toEqual([]);
    expect(heard).toEqual([init.key]);
  });

  it('still types a SHIFTED character, because that is how a capital is made', async () => {
    const { sent } = await press({ key: 'K', shiftKey: true });
    expect(sent).toEqual([{ kind: 'text', text: 'K' }]);
  });

  it('still leaves plain Tab alone, so the focus order gets out of the pane', async () => {
    const { sent, notPrevented } = await press({ key: 'Tab' });
    expect(sent).toEqual([]);
    // NOT prevented: Tab's default IS the focus move, and this surface eats
    // every other key.
    expect(notPrevented).toBe(true);
  });

  it('still leaves Shift+Tab alone, so the way back out is intact too', async () => {
    const { sent, notPrevented } = await press({ key: 'Tab', shiftKey: true });
    expect(sent).toEqual([]);
    expect(notPrevented).toBe(true);
  });
});

describe('a composing input method still wins, chord or not', () => {
  it('sends nothing for a chord while a candidate is in flight', async () => {
    // Some input methods page their candidate list with modified keys, so
    // while a composition is live EVERY key is the method's. The guard is
    // first in the handler and this is what keeps it there.
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'u', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(pane() as HTMLElement, { key: 'c', ctrlKey: true, isComposing: true });
    await settle();
    expect(keys(send)).toEqual([]);
  });
});

describe('a chord vam cannot deliver goes back to vam rather than being eaten', () => {
  it('does not consume Ctrl+U when there is no bridge behind the tab', async () => {
    // The browser build has no main process. A key vam cannot deliver is not
    // vam's to swallow: it goes back to the window listener, where the chords
    // still work. This is the rule `onKeyDown` already keeps for letters, and
    // the one a new branch is most likely to forget.
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      render(
        <TerminalTab
          projectId={ATLAS}
          rowId={ATLAS}
          read={vi.fn(async () => ok())}
          resize={undefined}
          send={undefined}
        />,
      );
      await settle();
      expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'u', ctrlKey: true })).toBe(true);
      await settle();
      expect(heard).toEqual(['u']);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });
});
