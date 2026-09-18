// @vitest-environment happy-dom

/**
 * Typing into the Terminal tab.
 *
 * The tab was read-only, and its focus stop existed for ONE reason: the pane
 * is a scroll region with a hidden scrollbar, so without a focus stop nothing
 * below the fold was reachable by any key. Keys are consumed now, and these
 * tests pin the three things that makes true and dangerous.
 *
 * WHAT MUST STILL WORK: the arrows and the Page keys still scroll, because
 * that is what the focus stop was for and losing it silently would be the
 * regression nobody notices.
 *
 * WHO OWNS A KEY: an unmodified key belongs to the pane and stops there, so
 * `j` does not also move vam's cursor. A CMD chord belongs to vam and is never
 * typed -- the canvas already exempts chords from its typing guard, and a
 * chord is not text on any layout. CTRL AND A LETTER belongs to the pane, and
 * that split has a file of its own (`TerminalTab.control-chords.test.tsx`):
 * every `C-a`..`C-z` is a real control character and the program in the pane
 * is what gives it meaning, while `Ctrl+1` is no control character at all and
 * stays vam's, which is what keeps the tab switch working from in here.
 *
 * THE WAY OUT: Escape leaves. A focus stop that eats every key and cannot be
 * left from the keyboard is the trap the old comment promised this was not.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cursorModeAt } from '../../src/renderer/keyboard/focus-scope.js';
import { ECHO_MS, REFRESH_MS, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneSendResult, PaneView } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');

/**
 * WHETHER THE PANE HAS THE KEYBOARD -- and it is `contains` rather than an
 * identity test for a reason worth stating, because the identity test is still
 * spelled correctly and is now VACUOUS. Since the pane grew a hidden box for
 * an input method to compose into (`TerminalTab.ime.test.tsx`), focus lands
 * one element deeper: `document.activeElement !== pane()` is true whether the
 * pane has the keyboard or not, so every "it did not grab focus back" case
 * below would pass with the latch deleted.
 */
const holdsKeyboard = () => pane()?.contains(document.activeElement) === true;

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';
/** A screen with no cursor answer -- what a stub that never asked tmux knows. */
const NO_CURSOR = { kind: 'unreadable' } as const;
const ok = (text = 'the screen'): PaneView => ({
  kind: 'ok',
  name: 'vam-atlas-a1b2c3',
  text,
  cursor: NO_CURSOR,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** A tab showing a real pane, with a send path that records what it is asked. */
async function open(view: PaneView = ok(), sent: PaneSendResult = 'sent') {
  const send = vi.fn(async (_project: string, _key: PaneKey, _row?: string) => sent);
  render(
    <TerminalTab
      projectId={ATLAS}
      rowId={ATLAS}
      read={vi.fn(async () => view)}
      resize={undefined}
      send={send}
    />,
  );
  await settle();
  return send;
}

const keys = (send: { mock: { calls: unknown[][] } }): PaneKey[] =>
  send.mock.calls.map((call) => call[1] as PaneKey);

describe('the Terminal tab takes focus when it is opened', () => {
  it('focuses the pane as soon as there is a pane to focus', async () => {
    await open();
    // IN THE PANE, on the hidden box that an input method can compose into --
    // `TerminalTab.ime.test.tsx` owns why that box exists. What this asserts
    // is unchanged: the tab the operator opened to type in is ready to type
    // in, and the keyboard is inside this pane and not on the body.
    expect(pane()?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('does not take focus while the window is hidden', async () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await open();
      // Nothing is being read either, so there is no pane to focus and no
      // reason to pull focus out of whatever the operator last touched.
      expect(document.activeElement).toBe(document.body);
    } finally {
      spy.mockRestore();
    }
  });

  it('takes no focus when there is no pane, only a sentence', async () => {
    await open({ kind: 'not-vam' });
    expect(pane()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('a keystroke in the pane reaches tmux, exactly once', () => {
  it('types a printable character literally, with no Return behind it', async () => {
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'h' });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ATLAS, { kind: 'text', text: 'h' }, ATLAS);
  });

  it('sends Enter as the key that must be interpreted, not as a newline', async () => {
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter' });
    await settle();
    expect(keys(send)).toEqual([{ kind: 'enter' }]);
  });

  it('sends Backspace as a key, because a terminal you cannot correct is not usable', async () => {
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Backspace' });
    await settle();
    // Never `{ kind: 'text', text: 'Backspace' }`: that types the word.
    expect(keys(send)).toEqual([{ kind: 'backspace' }]);
  });

  it('does not also fire vam’s own keyboard, so `j` is a letter here', async () => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      fireEvent.keyDown(pane() as HTMLElement, { key: 'j' });
      await settle();
      expect(keys(send)).toEqual([{ kind: 'text', text: 'j' }]);
      expect(heard).toEqual([]);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  /**
   * AND A DIGIT IS A DIGIT HERE, WHICH IS NEWLY WORTH ASSERTING. A bare
   * `1`..`9` picks a VIEW in Select now (`SELECT_DIGITS`, `keyboard/
   * chords.ts`) — the operator asked for a one-key view switch — and this pane
   * is the surface where that could have gone worst: it is a `section`, so
   * `Canvas.tsx`'s INPUT|TEXTAREA typing guard cannot see it, and what it
   * consumes goes into somebody's running agent.
   *
   * TWO THINGS, AND THE SECOND IS THE ONE A VIEW BAR COULD NOT TELL YOU: the
   * digit is SENT, and vam's own window listener never hears it. A test that
   * only checked the view had not changed would pass on a keystroke that was
   * silently eaten and never typed.
   *
   * `isSelectOnlyChord` is the belt behind this brace, for the build where
   * `send` is undefined and the pane hands its keys back — driven in
   * `test/canvas/Canvas.select-digit-view.test.tsx`.
   */
  it('types a bare digit rather than letting it pick a view', async () => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      fireEvent.keyDown(pane() as HTMLElement, { key: '3', code: 'Digit3' });
      await settle();
      expect(keys(send)).toEqual([{ kind: 'text', text: '3' }]);
      expect(heard).toEqual([]);
      // The two facts the stand-down is derived from, asserted where they are
      // true rather than assumed: this is no text box, and it is Insert.
      //
      // "No text box" was spelled `tagName === 'SECTION'`, which stopped being
      // true when the pane became the scroller that also takes the keyboard --
      // a `div` with `role="region"`, which is what a named `<section>` already
      // was. The tag was a PROXY for the property; the property is the one
      // `Canvas.tsx`'s `typing` guard actually reads, so it is asserted
      // directly here and survives the next change of element.
      expect(pane()?.getAttribute('role')).toBe('region');
      expect(/^(INPUT|TEXTAREA)$/.test(pane()?.tagName ?? '')).toBe(false);
      expect(cursorModeAt(pane())).toBe('insert');
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });
});

describe('the pane declines the keys that are not its own', () => {
  it('leaves a Cmd chord to vam and types nothing', async () => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      fireEvent.keyDown(pane() as HTMLElement, { key: '1', metaKey: true });
      // A LETTER UNDER CMD, WHICH IS THE CASE THAT CHANGED MEANING. `Ctrl+K`
      // stood here and is the pane's now (`TerminalTab.control-chords
      // .test.tsx`); `Cmd+K` is still vam's, and it is the spelling a macOS
      // operator reaches for. Cmd is where the whole grammar stays reachable
      // from inside a pane that has taken Ctrl.
      fireEvent.keyDown(pane() as HTMLElement, { key: 'k', metaKey: true });
      await settle();
      expect(send).not.toHaveBeenCalled();
      // Reaching vam is the point: `Cmd+1` picks a tab from anywhere,
      // including from inside a box that is capturing letters.
      expect(heard).toEqual(['1', 'k']);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  /**
   * `Ctrl-D` AND `Ctrl-U` ARE THE PANE'S NOW, AND THIS TEST USED TO SAY THE
   * OPPOSITE. It is kept, inverted, rather than deleted, because the fact it
   * was written about has not gone away and is the sharpest reason the split
   * had to move.
   *
   * WHAT IT SAID. The pane handed every Ctrl chord back, and `Mod-d`/`Mod-u`
   * are bound in the grammar those keys reach — so "handed back" would have
   * meant "scrolled a transcript that is not on screen", except that this
   * element carries `data-insert-scope` and `isSelectOnly` stood the grammar
   * down. Both halves were true, and together they meant `Ctrl+U` in a
   * terminal did NOTHING AT ALL: not the kill-line the operator pressed it
   * for, and not the scroll vam binds it to either.
   *
   * WHAT IS TRUE NOW. The chord reaches the pane, and vam's own listener never
   * hears it — which is what stops one keystroke doing two things. The insert
   * scope is still asserted here because it is still load-bearing for every
   * OTHER modified key: `cursorModeAt` is asked of the REAL element, and its
   * role beside it, because a named region is invisible to any
   * `INPUT|TEXTAREA` test and a scope-based rule is the only kind that can see
   * this surface.
   */
  it('sends Ctrl-D and Ctrl-U to the pane, and lets vam hear neither', async () => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      fireEvent.keyDown(pane() as HTMLElement, { key: 'd', ctrlKey: true });
      fireEvent.keyDown(pane() as HTMLElement, { key: 'u', ctrlKey: true });
      await settle();
      expect(keys(send)).toEqual([
        { kind: 'control', letter: 'd' },
        { kind: 'control', letter: 'u' },
      ]);
      expect(heard).toEqual([]);
      expect(pane()?.getAttribute('role')).toBe('region');
      expect(cursorModeAt(pane())).toBe('insert');
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  it('leaves an Alt chord to vam, which genuinely binds that space', async () => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      // `normalizeKey` has an `Alt-` token, so these are vam's to answer.
      // A one-character `event.key` was the whole test for "printable", and
      // it let `Alt+1` and `Alt+k` be typed into the agent instead.
      fireEvent.keyDown(pane() as HTMLElement, { key: '1', altKey: true });
      fireEvent.keyDown(pane() as HTMLElement, { key: 'k', altKey: true });
      await settle();
      expect(send).not.toHaveBeenCalled();
      expect(heard).toEqual(['1', 'k']);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  it('still types a SHIFTED character, which is how capitals are made', async () => {
    // Shift is not a chord modifier: exempting it would make the pane refuse
    // every capital letter and every symbol on a number row.
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'K', shiftKey: true });
    fireEvent.keyDown(pane() as HTMLElement, { key: '!', shiftKey: true });
    await settle();
    expect(keys(send)).toEqual([
      { kind: 'text', text: 'K' },
      { kind: 'text', text: '!' },
    ]);
  });

  /**
   * THE SCROLLING KEYS STILL SCROLL, AND THE PANE IS NOW WHAT DOES IT.
   *
   * This test used to assert that these six were NOT cancelled, on the
   * reasoning that the browser's scrolling of a focused overflow element is
   * the default and vam must not take it. That reasoning died with the hidden
   * box: the keyboard is on a text control now, and a text control takes these
   * keys for its own caret before any scroll container sees them. Measured in
   * Chromium with an empty one-by-one `<textarea>` focused inside a scrolling
   * `<section>`: `PageDown`, `PageUp`, `Home` and `End` moved the pane not at
   * all, and the arrows only sometimes.
   *
   * So the assertion moved from the MECHANISM to the OUTCOME, which is the
   * stronger of the two and the one the operator has: the pane moves. A test
   * that only checked `defaultPrevented` would have gone green through exactly
   * the regression that made this rewrite necessary.
   */
  it('scrolls the pane itself, because a focused text control eats those keys', async () => {
    const send = await open();
    const box = pane() as HTMLElement;
    // happy-dom lays nothing out, so the geometry the scroll is computed from
    // is written here: a screenful of 200px over 1000px of content, and a
    // 16px row measured off the ruler.
    Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 1_000, configurable: true });
    const ruler = q<HTMLElement>('[data-terminal-ruler]');
    if (ruler !== null) {
      ruler.getBoundingClientRect = () => ({ width: 66, height: 16 }) as DOMRect;
    }

    const moved = (key: string, from: number): number => {
      box.scrollTop = from;
      // CANCELLED, and that is now the correct answer: the pane performed the
      // scroll, so leaving the default on would be a second one.
      expect(fireEvent.keyDown(box, { key })).toBe(false);
      return box.scrollTop;
    };
    expect(moved('ArrowDown', 0)).toBe(16);
    expect(moved('ArrowUp', 100)).toBe(84);
    // A page overlaps by one row, the way every pager does: the line at the
    // fold is the line the next screen starts on.
    expect(moved('PageDown', 0)).toBe(184);
    expect(moved('PageUp', 500)).toBe(316);
    expect(moved('Home', 500)).toBe(0);
    expect(moved('End', 0)).toBe(1_000);
    // Never below the top: a negative scroll offset is not a position.
    expect(moved('ArrowUp', 0)).toBe(0);
    expect(moved('PageUp', 10)).toBe(0);

    await settle();
    // And none of them is typed into the agent, which was always the other
    // half: scrolling the transcript is scrolling, not a keypress in the shell.
    expect(send).not.toHaveBeenCalled();
  });

  it('DOES prevent the default for the keys it takes, so the page cannot act on them too', async () => {
    const send = await open();
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'h' })).toBe(false);
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter' })).toBe(false);
    // Backspace above all: unprevented it is the browser's history-back.
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Backspace' })).toBe(false);
    await settle();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('leaves Tab alone, so the focus order still gets out', async () => {
    const send = await open();
    // NOT PREVENTED: `fireEvent` answers false when the default was stopped,
    // and Tab's default IS the focus move. Asserting only that nothing was
    // sent would stay green while the second way out of this surface was
    // quietly killed.
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Tab' })).toBe(true);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('keys reach the pane in the order they were typed', () => {
  /** A send that answers only when the test says so, one call at a time. */
  function gated() {
    const pending: { key: PaneKey; settle: (result: PaneSendResult) => void }[] = [];
    const send = vi.fn(
      (_project: string, key: PaneKey) =>
        new Promise<PaneSendResult>((resolve) => {
          pending.push({ key, settle: resolve });
        }),
    );
    return { send, pending };
  }

  it('sends the next key only after the previous one has answered', async () => {
    const { send, pending } = gated();
    render(
      <TerminalTab
        projectId={ATLAS}
        rowId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={undefined}
        send={send}
      />,
    );
    await settle();

    // `n`, `o`, Return typed faster than tmux can answer. Unqueued, each of
    // these is a `list-sessions` and a `send-keys` racing the other two, and
    // the Return finishing first SUBMITS a half-typed line to a live agent.
    fireEvent.keyDown(pane() as HTMLElement, { key: 'n' });
    fireEvent.keyDown(pane() as HTMLElement, { key: 'o' });
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter' });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0]?.settle('sent');
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending[1]?.settle('sent');
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledTimes(3);

    await act(async () => {
      pending[2]?.settle('sent');
      await Promise.resolve();
    });
    expect(pending.map((call) => call.key)).toEqual([
      { kind: 'text', text: 'n' },
      { kind: 'text', text: 'o' },
      { kind: 'enter' },
    ]);
  });

  it('drops what is queued behind a refusal instead of sending it into the gap', async () => {
    const { send, pending } = gated();
    render(
      <TerminalTab
        projectId={ATLAS}
        rowId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={undefined}
        send={send}
      />,
    );
    await settle();

    fireEvent.keyDown(pane() as HTMLElement, { key: 'n' });
    fireEvent.keyDown(pane() as HTMLElement, { key: 'o' });
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter' });
    await settle();

    await act(async () => {
      pending[0]?.settle('refused');
      await Promise.resolve();
      await Promise.resolve();
    });
    // The `o` and the Return are gone. Sending them now would submit a line
    // with a hole in it, which reads as the operator's own typing.
    expect(send).toHaveBeenCalledTimes(1);
    expect(q('[data-terminal-refused]')).not.toBeNull();

    // A key typed AFTER the refusal is on screen is a new decision, and runs.
    fireEvent.keyDown(pane() as HTMLElement, { key: 'x' });
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("the pane draws the agent's own colours", () => {
  const ESC = '\u001b';

  it('turns the captured escapes into spans wearing token classes', async () => {
    // The bytes are the shape tmux really emits, taken from `capture-pane -e`
    // on a private server: a colour opened, then closed with `39`.
    await open(ok(ESC + '[31merror: it failed' + ESC + '[39m and then plain'));
    const coloured = document.querySelector('[data-terminal-pane] .text-ansi-red');
    expect(coloured?.textContent).toBe('error: it failed');
    // The rest of the line is drawn, and drawn plain.
    expect(q<HTMLElement>('[data-terminal-pane]')?.textContent).toContain(' and then plain');
  });

  it('never draws an escape character, whatever the agent printed', async () => {
    await open(ok(ESC + '[38;5;208mhalf a sequence follows' + ESC + '[38;5'));
    expect(q<HTMLElement>('[data-terminal-pane]')?.textContent).not.toContain(ESC);
    expect(q<HTMLElement>('[data-terminal-pane]')?.textContent).toContain(
      'half a sequence follows',
    );
  });

  it("keeps the screen's shape, so the measured columns still mean something", async () => {
    // One `pre` with real newlines, not a box per line: the pane's width is
    // measured in characters of this exact font, and a second layout for
    // tmux's own line breaks would fight that measurement.
    await open(ok('first\nsecond'));
    const pre = document.querySelector('[data-terminal-pane] pre');
    expect(pre?.textContent).toBe('first\nsecond');
  });
});

describe('Escape belongs to the pane, and the way out is Tab', () => {
  it('sends Escape to tmux instead of using it to leave', async () => {
    // REVERSED ON THE OPERATOR'S WORDS. Escape was vam's exit; inside a
    // terminal it has to be the key that cancels the picker, leaves insert
    // mode, dismisses the prompt. Keeping it as an exit made the pane the one
    // place in their tools where Escape did not mean escape.
    const send = await open();
    expect(holdsKeyboard()).toBe(true);
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Escape' })).toBe(false);
    await settle();
    expect(keys(send)).toEqual([{ kind: 'escape' }]);
    // And it did NOT let go: the pane still has focus, so the next key is
    // still the pane's.
    expect(holdsKeyboard()).toBe(true);
  });

  it('still lets go on Tab, which is now the only key that does', async () => {
    const send = await open();
    // Not prevented: the default IS the focus move, and it is the whole exit
    // now that Escape is the pane's. The trade is that Tab no longer reaches
    // the shell for completion.
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Tab' })).toBe(true);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('says where the exit is, but only while the pane has focus', async () => {
    // An exit nobody can find is not an exit. It rides the session name on the
    // rule under the screen and is appended only while the pane has focus,
    // which is the only moment the question is asked.
    await open();
    expect(q('[data-terminal-exit-hint]')?.textContent).toContain('Tab');
    expect(q('[data-terminal-exit-hint]')?.closest('[data-terminal-status]')).not.toBeNull();

    fireEvent.blur(pane() as HTMLElement);
    await settle();
    expect(q('[data-terminal-exit-hint]')).toBeNull();
    // The identity does NOT go with it. That was the whole defect.
    expect(q('[data-terminal-badge]')?.textContent).toContain('vam-atlas-a1b2c3');
  });

  it('names the exit in the accessible name too, for a reader that cannot see a corner', async () => {
    await open();
    expect(pane()?.getAttribute('aria-label')).toContain('Tab');
  });
});

describe('the way out stays out', () => {
  it('does not grab focus back when the pane is redrawn for another session', async () => {
    const read = vi.fn(async () => ok());
    const view = render(
      <TerminalTab
        projectId={ATLAS}
        rowId={ATLAS}
        read={read}
        resize={undefined}
        send={vi.fn(async () => 'sent' as const)}
      />,
    );
    await settle();
    expect(holdsKeyboard()).toBe(true);

    // Leaving is Tab now, and happy-dom does not move focus for a synthetic
    // Tab, so the blur it would cause is what is simulated. It is the BOX
    // that holds the keyboard, so it is the box that has to let go.
    (document.activeElement as HTMLElement).blur();
    await settle();
    expect(holdsKeyboard()).toBe(false);

    // `j` in the canvas moves to the next session, which changes the project
    // this tab is about: `view` is cleared during render, so the pane goes
    // away and comes back. It must NOT take focus with it -- if it does, the
    // next `j` is typed into that session's agent instead of moving on, and
    // there is no way out that stays out.
    view.rerender(
      <TerminalTab
        projectId={BEACON}
        rowId={BEACON}
        read={read}
        resize={undefined}
        send={vi.fn(async () => 'sent' as const)}
      />,
    );
    await settle();
    expect(pane()).not.toBeNull();
    expect(holdsKeyboard()).toBe(false);
  });

  it('does not grab focus back after a transient unavailable read', async () => {
    const views: PaneView[] = [
      ok(),
      { kind: 'unavailable', error: { kind: 'unreachable', code: 'timeout', message: 'slow' } },
      ok(),
    ];
    let call = 0;
    const read = vi.fn(async () => views[Math.min(call++, views.length - 1)] as PaneView);
    vi.useFakeTimers();
    try {
      render(
        <TerminalTab
          projectId={ATLAS}
          rowId={ATLAS}
          read={read}
          resize={undefined}
          send={vi.fn(async () => 'sent' as const)}
        />,
      );
      await settle();
      fireEvent.keyDown(pane() as HTMLElement, { key: 'Escape' });
      await settle();

      // The pane goes away on the unavailable read and comes back on the next
      // one. Neither may take focus: the operator left.
      for (const _ of [0, 1]) {
        await act(async () => {
          vi.advanceTimersByTime(REFRESH_MS);
          await Promise.resolve();
          await Promise.resolve();
        });
      }
      expect(q('[data-terminal-pane]')).not.toBeNull();
      expect(holdsKeyboard()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a pairing vam cannot use is said as that, not as an absence', () => {
  const MISPAIRED: PaneView = { kind: 'mispaired', published: 'vam-beacon-ee33ff' };

  it('names the pane the row published, and does not claim vam started nothing', async () => {
    await open(MISPAIRED);
    const said = q('[data-terminal-mispaired]')?.textContent ?? '';
    // The one fact that explains the refusal is the name the row published.
    expect(said).toContain('vam-beacon-ee33ff');
    expect(said).toContain('cannot tell');
    // The sentence this replaced. It sent the operator looking for a session
    // that is running, while vam held the published name it had rejected.
    expect(said).not.toContain('vam did not start a tmux session for this one');
  });

  it('offers no surface to type into, so nothing can be swallowed', async () => {
    const send = await open(MISPAIRED);
    // No pane element at all on this branch: there is nothing to focus and
    // nothing to press a key against, which is the correct shape for a state
    // in which vam must not deliver.
    expect(pane()).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the pane says whether what is typed is going anywhere', () => {
  it('shows which session this is, VISIBLY, without being focused or read aloud', async () => {
    // THE DEFECT THIS PINS. When the two lines came off, the name went into
    // the pane's `aria-label` -- true for a screen reader, invisible to the
    // person looking at the terminal, who then reported that switching to
    // this tab tells them nothing about the session they are in.
    //
    // So the assertion is on what is DRAWN. `textContent` of the tab is what
    // a person can read; an `aria-label` assertion is exactly the test that
    // would have passed all along while the screen said nothing.
    await open();
    fireEvent.blur(pane() as HTMLElement);
    await settle();
    expect(q<HTMLElement>('[data-terminal]')?.textContent).toContain('vam-atlas-a1b2c3');
  });

  it('costs ONE row to say it, under the screen rather than over it', async () => {
    await open();
    const badge = q<HTMLElement>('[data-terminal-badge]');
    // THE BARGAIN CHANGED, AND THIS IS WHERE IT IS RECORDED. It used to be
    // absolutely positioned over the pane's bottom-right corner and was
    // defended as costing no row. It cost no row and it covered the corner a
    // terminal prints its last line into, in the faintest ink vam has. It is
    // now a segment of the rule under the screen: one row, spent once, for a
    // name that can actually be read -- and the row was being spent anyway,
    // because the branch is on it.
    expect(badge?.closest('[data-terminal-status]')).not.toBeNull();
    expect(badge?.getAttribute('class')).not.toContain('absolute');
    // And still OUTSIDE the scrolling box: inside, it would be laid out
    // against the content and scroll out of sight with the first screenful.
    expect(badge?.closest('[data-terminal-pane]')).toBeNull();
    // Still no flow chrome ABOVE the pane -- the rule is under it, which is
    // the half of the operator's request that has not changed.
    expect(q('[data-terminal-name]')).toBeNull();
    expect(q('[data-terminal-typing]')).toBeNull();
    const tab = q<HTMLElement>('[data-terminal]') as HTMLElement;
    const kids = [...tab.children];
    expect(kids.indexOf(q<HTMLElement>('[data-terminal-status]') as HTMLElement)).toBe(
      kids.length - 1,
    );
  });

  it('draws no chrome above the pane at all, which is the space the operator asked for', async () => {
    await open();
    // The two lines that stood here: the session's name, and a caption saying
    // where the keys went. On a tab whose content is a screenful of someone's
    // terminal, two rows of chrome is two rows of their work not shown.
    expect(q('[data-terminal-name]')).toBeNull();
    expect(q('[data-terminal-typing]')).toBeNull();
    // The pane still says whose screen it is to a reader -- and, since the
    // badge, to everybody else as well.
    expect(pane()?.getAttribute('aria-label')).toContain('vam-atlas-a1b2c3');
  });

  it('says so when vam refused, rather than swallowing the keystroke', async () => {
    const send = await open(ok(), 'unaimed');
    fireEvent.keyDown(pane() as HTMLElement, { key: 'h' });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    const said = q('[data-terminal-refused]')?.textContent ?? '';
    expect(said).not.toBe('');
    expect(said.toLowerCase()).toContain('did not');
  });

  it('names the refusal it actually got, rather than always blaming the pairing', async () => {
    const send = await open(ok(), 'refused');
    fireEvent.keyDown(pane() as HTMLElement, { key: 'h' });
    await settle();
    const said = q('[data-terminal-refused]');
    // tmux declined to deliver to a session vam DID name -- almost always one
    // that just ended. Sending the operator after a pairing problem here
    // sends them after something that is not there.
    expect(said?.getAttribute('data-terminal-refusal')).toBe('refused');
    expect(said?.textContent).toContain('may have just ended');
    expect(said?.textContent).not.toContain('name one session');
  });

  it('drops a refusal raised for another session rather than drawing it over this one', async () => {
    const send = vi.fn(async () => 'unaimed' as const);
    const read = vi.fn(async () => ok());
    const view = render(
      <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
    );
    await settle();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'h' });
    await settle();
    expect(q('[data-terminal-refused]')).not.toBeNull();

    view.rerender(
      <TerminalTab projectId={BEACON} rowId={BEACON} read={read} resize={undefined} send={send} />,
    );
    await settle();
    // A claim about Atlas, drawn over Beacon's pane, is a claim about Beacon
    // that nothing ever made.
    expect(q('[data-terminal-refused]')).toBeNull();
  });

  it('eats nothing when there is no send path at all', async () => {
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    // AND THE KEY IS NOT EATEN. A build that cannot deliver must not consume:
    // cancelling first left the browser build swallowing every printable key,
    // Return and Backspace, which killed vam's own keyboard for anyone whose
    // focus had landed here.
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'h' })).toBe(true);
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Backspace' })).toBe(true);
    await settle();
    // No caption says so any more -- the honesty is in the behaviour above:
    // nothing was consumed, so every one of those keys is still vam's.
    expect(q('[data-terminal-typing]')).toBeNull();
  });
});

describe('a keystroke is read back without waiting for the next tick', () => {
  /**
   * THE DELAY THE OPERATOR REPORTED. The send itself is ~5ms; what was slow
   * was that nothing asked for the screen again until the interval came
   * round, so a typed character took up to `REFRESH_MS` to appear. These
   * measure the ASKING -- that a landed key causes a read, that a burst is
   * bounded, and that a key which did NOT land causes none -- not the pixels,
   * which only a real tmux pane can show.
   */
  const openWithRead = async (sent: PaneSendResult = 'sent') => {
    const read = vi.fn(async () => ok());
    const send = vi.fn(async (_p: string, _k: PaneKey, _r?: string) => sent);
    render(
      <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
    );
    await settle();
    return { read, send };
  };

  it('reads the pane as soon as the key lands, long before the interval', async () => {
    const { read } = await openWithRead();
    const before = read.mock.calls.length;
    await act(async () => {
      fireEvent.keyDown(pane() as HTMLElement, { key: 'x' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(read.mock.calls.length).toBeGreaterThan(before);
  });

  it('asks once per window while typing continues, not once per key', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => ok());
      const send = vi.fn(async () => 'sent' as PaneSendResult);
      render(
        <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
      );
      await act(async () => {
        await Promise.resolve();
      });
      const before = read.mock.calls.length;
      // Eight keys inside one window: the first is read immediately, the rest
      // collapse into a single trailing read. Ten reads a second while a
      // person types is the bound; ten per keystroke is not.
      for (let i = 0; i < 8; i += 1) {
        await act(async () => {
          fireEvent.keyDown(pane() as HTMLElement, { key: 'a' });
          await Promise.resolve();
          await Promise.resolve();
        });
      }
      await act(async () => {
        vi.advanceTimersByTime(ECHO_MS);
        await Promise.resolve();
      });
      const added = read.mock.calls.length - before;
      expect(added).toBeGreaterThan(0);
      expect(added).toBeLessThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for nothing when the key did not land', async () => {
    const { read } = await openWithRead('refused');
    const before = read.mock.calls.length;
    await act(async () => {
      fireEvent.keyDown(pane() as HTMLElement, { key: 'x' });
      await Promise.resolve();
      await Promise.resolve();
    });
    // A refused send already stops the run and says so; re-reading the screen
    // would only confirm that nothing happened.
    expect(read.mock.calls.length).toBe(before);
  });
});
