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
 * `j` does not also move vam's cursor. A Cmd/Ctrl chord belongs to vam and is
 * never typed -- the canvas already exempts chords from its typing guard, and
 * a chord is not text on any layout.
 *
 * THE WAY OUT: Escape leaves. A focus stop that eats every key and cannot be
 * left from the keyboard is the trap the old comment promised this was not.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_MS, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneSendResult, PaneView } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';
const ok = (text = 'the screen'): PaneView => ({ kind: 'ok', name: 'vam-atlas-a1b2c3', text });

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
    expect(document.activeElement).toBe(pane());
  });

  it('does not take focus while the window is hidden', async () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await open();
      // Nothing is being read either, so there is no pane to focus and no
      // reason to pull focus out of whatever the operator last touched.
      expect(document.activeElement).not.toBe(pane());
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
});

describe('the pane declines the keys that are not its own', () => {
  it('leaves a Cmd chord to vam and types nothing', async () => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      fireEvent.keyDown(pane() as HTMLElement, { key: '1', metaKey: true });
      fireEvent.keyDown(pane() as HTMLElement, { key: 'k', ctrlKey: true });
      await settle();
      expect(send).not.toHaveBeenCalled();
      // Reaching vam is the point: `Cmd+1` picks a tab from anywhere,
      // including from inside a box that is capturing letters.
      expect(heard).toEqual(['1', 'k']);
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

  it('leaves the scrolling keys to the browser, which is why the focus stop exists', async () => {
    const send = await open();
    for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) {
      // NOT PREVENTED, and asserting that is the whole test. `fireEvent`
      // answers false when the default was prevented, and the browser's
      // scrolling of a focused overflow element IS that default: checking
      // only that nothing was sent to tmux would stay green while a stray
      // `preventDefault()` killed keyboard scrolling outright -- which is the
      // one thing this focus stop was created to provide.
      expect(fireEvent.keyDown(pane() as HTMLElement, { key })).toBe(true);
    }
    await settle();
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
    expect(document.activeElement).toBe(pane());
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Escape' })).toBe(false);
    await settle();
    expect(keys(send)).toEqual([{ kind: 'escape' }]);
    // And it did NOT let go: the pane still has focus, so the next key is
    // still the pane's.
    expect(document.activeElement).toBe(pane());
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
    // An exit nobody can find is not an exit, and it may not cost a row: it
    // rides the badge in the pane's corner and is appended only while the
    // pane has focus, which is the only moment the question is asked.
    await open();
    expect(q('[data-terminal-exit-hint]')?.textContent).toContain('Tab');
    expect(q('[data-terminal-badge]')?.getAttribute('class')).toContain('absolute');

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
    expect(document.activeElement).toBe(pane());

    // Leaving is Tab now, and happy-dom does not move focus for a synthetic
    // Tab, so the blur it would cause is what is simulated.
    (pane() as HTMLElement).blur();
    await settle();
    expect(document.activeElement).not.toBe(pane());

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
    expect(document.activeElement).not.toBe(pane());
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
      expect(document.activeElement).not.toBe(pane());
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

  it('costs no row to say it: the badge is out of the flow, not a header', async () => {
    await open();
    const badge = q<HTMLElement>('[data-terminal-badge]');
    // Absolutely positioned against the wrapper, so it takes no vertical
    // space -- the two lines the operator removed were flow content.
    expect(badge?.getAttribute('class')).toContain('absolute');
    // And OUTSIDE the scrolling box: inside, it would be laid out against the
    // content and scroll out of sight with the first screenful.
    expect(badge?.closest('[data-terminal-pane]')).toBeNull();
    // Still no flow chrome above the pane.
    expect(q('[data-terminal-name]')).toBeNull();
    expect(q('[data-terminal-typing]')).toBeNull();
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
