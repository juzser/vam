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
    // THE SHIFTED CTRL KEYSTROKES THAT ARE STILL VAM'S, and they are rows
    // rather than a sentence because they are what `!event.shiftKey` was
    // SUSPECTED of protecting when it came out of the chord branch. It was
    // protecting none of them: `controlStrokeFor` answers `null` for every key
    // that is not one of the twenty-six letters, so a shifted Ctrl press of a
    // named key, a digit, a bracket or an arrow goes back to vam by the
    // LETTERS rule now exactly as it went back by the SHIFT rule before. Each
    // of these was green before the branch widened and is green after, which
    // is the only way to say that out loud rather than argue it from the shape
    // of a condition.
    [
      'Ctrl+Shift and Tab, which still steps the settings overlay backwards',
      { key: 'Tab', ctrlKey: true, shiftKey: true },
    ],
    [
      'Ctrl+Shift and a digit, which arrives as the symbol above it',
      { key: '!', ctrlKey: true, shiftKey: true },
    ],
    // `Mod-Shift-[` is vam's previous-tab gesture and `Mod-` IS Ctrl on Linux
    // and Windows, so this row is what keeps stepping the tab ring reachable
    // from inside a terminal on those platforms.
    [
      'Ctrl+Shift and a bracket, which vam binds to the previous session tab',
      { key: '{', ctrlKey: true, shiftKey: true },
    ],
    ['Ctrl+Shift and an arrow', { key: 'ArrowUp', ctrlKey: true, shiftKey: true }],
    [
      'Ctrl+Alt+Shift and a letter, because Alt is still the compose key',
      { key: 'E', ctrlKey: true, altKey: true, shiftKey: true },
    ],
    // THE ESCAPE HATCH, AT THE PANE'S OWN LEVEL. This element does not know
    // which platform it is on and does not ask: it declines the COMMAND
    // modifier, which `normalizeKey` spells `Mod-` from Cmd on macOS and from
    // Super on Linux and Windows alike. So the two chords the pane now takes
    // the Ctrl spelling of keep a spelling that still reaches vam from inside
    // a terminal, on every platform.
    [
      'Cmd+Shift and a letter, which is how `focusList` is still reached from here',
      { key: 'H', metaKey: true, shiftKey: true },
    ],
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

/**
 * THE SHIFTED CONTROL CHORD, AND THE HOLE IT CLOSES.
 *
 * MEASURED, on the revision before PR 366, by driving this component with a
 * real window listener attached:
 *
 *   Ctrl+k        pane sent [control k], vam heard nothing      clean
 *   Ctrl+w        pane sent [control w], vam heard nothing      clean
 *   Ctrl+Shift+H  pane sent NOTHING,     vam fired focusList    double meaning
 *   Ctrl+Shift+P  pane sent NOTHING,     vam fired newProject   double meaning
 *
 * PR 366 took Ctrl off vam's six application commands on macOS, so the second
 * half of those two rows stopped happening -- and the first half never
 * started, because the pane's rule was `ctrlKey && !altKey && !shiftKey`. The
 * keystroke went from doing the WRONG thing to doing NOTHING AT ALL, inside a
 * surface whose entire job is carrying a keystroke to a shell.
 *
 * NO TERMINAL DISTINGUISHES `Ctrl+Shift+P` FROM `Ctrl+P` -- both are 0x10, and
 * `Ctrl+Shift+U` and `Ctrl+U` are both 0x15. A terminal that swallows a
 * shifted control chord is simply wrong about what the wire carries, so the
 * pane takes it and sends the same control character the unshifted chord
 * sends. `controlStrokeFor` already lower-cases, which is what makes `'P'` a
 * `ControlLetter` without a second rule being written anywhere.
 *
 * WHAT THE OLD `!event.shiftKey` TURNED OUT TO BE PROTECTING: nothing else.
 * With Ctrl held, no branch BELOW the chord branch is reachable -- the next
 * line returns on `ctrlKey || altKey` -- so the clause only ever decided who
 * got `Ctrl+Shift+<letter>`, and every OTHER shifted Ctrl keystroke behaves
 * identically under both spellings of the handler. That is a claim about
 * behaviour, so the `leaves ... alone` table above carries it as rows:
 * Ctrl+Shift+Tab, Ctrl+Shift and a digit, Ctrl+Shift and a bracket.
 *
 * LINUX AND WINDOWS PAY FOR IT, AND THE BILL IS THE ONE PR 361 ALREADY SENT.
 * `Mod-` is Ctrl there, so `Ctrl+Shift+H` is `focusList` and `Ctrl+Shift+P` is
 * `newProject` -- and the pane now claims both while it holds the keyboard,
 * exactly as it has claimed `Ctrl+K`/`Ctrl+W`/`Ctrl+N`/`Ctrl+T` there since PR
 * 361. The pane does not ask which platform it is on, and giving it a platform
 * branch would make one surface answer one keystroke two ways for no
 * terminal's benefit. The escape hatch is the same one macOS has: the COMMAND
 * modifier returns above this branch, and on Linux and Windows `normalizeKey`
 * spells Super as `Mod-` too, so Super+Shift+H still reaches the session list
 * from inside a terminal -- `test/keyboard/ctrl-letters.test.ts` pins that,
 * and the `Cmd+Shift and a letter` row below pins the pane's half of it.
 */
describe('Ctrl+Shift and a letter is the terminal’s too, because the wire cannot tell', () => {
  it('sends Ctrl+Shift+P as C-p, the chord that had stopped doing anything at all', async () => {
    const { sent, heard, notPrevented } = await press({
      key: 'P',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(sent).toEqual([{ kind: 'control', letter: 'p' }]);
    // vam must not ALSO hear it. On Linux and Windows this keystroke is
    // `newProject`, and a directory picker opening over a terminal the
    // operator was typing into is the double meaning this closes.
    expect(heard).toEqual([]);
    // Cancelled, for the same reason the unshifted chord is: in a focused text
    // control on macOS Chromium honours Cocoa's own bindings, and the shifted
    // spellings are the selection-extending half of that family -- they would
    // edit the hidden composition box on the way to the agent.
    expect(notPrevented).toBe(false);
  });

  it('sends Ctrl+Shift+H as C-h, which a terminal reads as backspace', async () => {
    const { sent, heard } = await press({ key: 'H', ctrlKey: true, shiftKey: true });
    expect(sent).toEqual([{ kind: 'control', letter: 'h' }]);
    expect(heard).toEqual([]);
  });

  it('sends the same control character the unshifted chord sends, for all 26', async () => {
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const { sent } = await press({
        key: letter.toUpperCase(),
        ctrlKey: true,
        shiftKey: true,
      });
      expect(sent, `Ctrl+Shift+${letter.toUpperCase()}`).toEqual([{ kind: 'control', letter }]);
      cleanup();
    }
  });

  it('claims it by the CHARACTER, so a CapsLock+Shift press is the same chord', async () => {
    // CapsLock and Shift cancel: the browser hands back a LOWERCASE letter
    // with `shiftKey: true`. `controlStrokeFor` reads the character and folds
    // the case, so both spellings of one physical press arrive as `C-p`.
    const { sent } = await press({ key: 'p', ctrlKey: true, shiftKey: true });
    expect(sent).toEqual([{ kind: 'control', letter: 'p' }]);
  });

  it('still loses to a composing input method, which pages with modified keys', async () => {
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, {
      key: 'P',
      ctrlKey: true,
      shiftKey: true,
      isComposing: true,
    });
    await settle();
    expect(keys(send)).toEqual([]);
  });

  it('goes back to vam when there is no bridge to deliver it', async () => {
    // The browser build has no main process, and a key vam cannot deliver is
    // not vam's to eat -- the rule the plain letters and the plain chords both
    // already keep.
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
      expect(
        fireEvent.keyDown(pane() as HTMLElement, { key: 'P', ctrlKey: true, shiftKey: true }),
      ).toBe(true);
      await settle();
      expect(heard).toEqual(['P']);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });
});
