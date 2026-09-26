// @vitest-environment happy-dom

/**
 * THE ARROWS, HOME, END, PAGEUP AND PAGEDOWN REACH THE PROGRAM IN THE PANE.
 *
 * THE OPERATOR'S REPORT (translated): "In the terminal, the arrow keys can't
 * be used to select options." `TerminalTab.tsx` mapped
 * `ArrowUp`/`ArrowDown`/`PageUp`/`PageDown`/`Home`/`End` to vam's OWN scroll
 * of the pane's view, BEFORE a keystroke ever reached `strokeFor`, and the
 * keydown handler checked that table before it checked anything the pane
 * could send -- so Claude Code's own option pickers (`AskUserQuestion`, a
 * permission prompt, `/model`, `/config`, plan approval — all of them walked
 * with the arrows, and as of 2.1.280 with Home/End/PageUp/PageDown too) could
 * never be driven from inside vam's Terminal tab. `ArrowLeft`/`ArrowRight`
 * were not even that lucky: `strokeFor` declined a named key outright (never
 * one printable character), so they reached neither the pane nor vam's own
 * window listener.
 *
 * THE FIX BEHAVES LIKE A TERMINAL: all eight keys go to the program, exactly
 * as a printable character does, and vam's own scrollback moves to
 * Shift+PageUp/PageDown/Home/End -- the chords xterm and GNOME Terminal both
 * already reserve for their own scrollback rather than the program.
 *
 * SAME DOUBLE MEASUREMENT `TerminalTab.control-chords.test.tsx` USES, for the
 * same reason: a key the pane claims must not ALSO reach vam's window
 * listener (or an arrow key would both walk a picker and move vam's own
 * session-list cursor), and a key it declines must still reach it.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { NavKey, PaneKey, PaneSendResult, PaneView } from '../../src/shared/terminal.js';
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

/** `TerminalTab.control-chords.test.tsx`'s own `press`, unchanged. */
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

const NAV_CASES: readonly [string, NavKey][] = [
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  ['Home', 'home'],
  ['End', 'end'],
  ['PageUp', 'page-up'],
  ['PageDown', 'page-down'],
];

describe('the terminal’s own navigation keys reach the program, not vam', () => {
  it.each(NAV_CASES)('sends %s as { kind: "nav", nav: "%s" }', async (key, nav) => {
    const { sent, heard, notPrevented } = await press({ key });
    expect(sent).toEqual([{ kind: 'nav', nav }]);
    // vam never hears it: an arrow that both walks a picker and moves vam's
    // own session-list cursor is two things happening for one press.
    expect(heard).toEqual([]);
    // And the browser must not act on it either -- there is no default here
    // to leave on, but a surface that both sends AND lets the default through
    // would deliver the keystroke twice in a real DOM.
    expect(notPrevented).toBe(false);
  });

  it('sends a shape main will actually accept, which is the only thing that matters', async () => {
    const { sent } = await press({ key: 'ArrowUp' });
    expect(sent).toHaveLength(1);
    expect(isPaneKey(sent[0])).toBe(true);
  });

  it('does not queue a scroll of vam’s own view for a plain (unshifted) key', async () => {
    const send = await open();
    const box = pane() as HTMLElement;
    Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 1_000, configurable: true });
    box.scrollTop = 500;
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    // The view followed the key to the live end (below), which is a
    // DIFFERENT number than the old per-row scroll (`84` for one row up from
    // `100`) ever produced -- this asserts the mechanism changed, not merely
    // that a number moved.
    expect(box.scrollTop).toBe(1_000);
  });
});

describe('vam’s own scrollback, moved to Shift+PageUp/PageDown/Home/End', () => {
  it.each([
    ['PageUp', 'page-up'],
    ['PageDown', 'page-down'],
    ['Home', 'top'],
    ['End', 'bottom'],
  ])('scrolls the pane on Shift+%s and sends nothing to the program', async (key) => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      const box = pane() as HTMLElement;
      Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true });
      Object.defineProperty(box, 'scrollHeight', { value: 1_000, configurable: true });
      box.scrollTop = 500;
      const notPrevented = fireEvent.keyDown(box, { key, shiftKey: true });
      await settle();
      // CANCELLED (vam performed the scroll) but NOT STOPPED -- these chords
      // still belong to vam's own keyboard afterwards, exactly as the six
      // plain keys they replace always did.
      expect(notPrevented).toBe(false);
      expect(heard).toEqual([key]);
      expect(send).not.toHaveBeenCalled();
      expect(box.scrollTop).not.toBe(500);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  it('never sends Shift+Arrow either -- there is no vam-scroll chord for a single row any more', async () => {
    // Single-row keyboard scrolling of vam's OWN view is gone entirely
    // (vam/terminal-arrows): the wheel still does it, and Shift+PageUp/
    // PageDown/Home/End replace the six keys this tab used to bind bare.
    // Shift+Arrow therefore falls through to the same `nav` forwarding a
    // bare arrow gets -- there is nothing left in the grammar that reads it
    // as a scroll.
    const { sent } = await press({ key: 'ArrowUp', shiftKey: true });
    expect(sent).toEqual([{ kind: 'nav', nav: 'up' }]);
  });
});
