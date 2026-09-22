// @vitest-environment happy-dom

/**
 * A WHEEL OVER A PANE WHOSE PROGRAM ASKED FOR THE MOUSE IS DELIVERED TO IT.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * The operator, on the build carrying #439: "still can't scroll in the
 * terminal". MEASURED on a private tmux socket against Claude Code 2.1.278
 * started the way vam starts it (`"tui": "fullscreen"` in the operator's
 * settings): `alternate_on=1 history_size=0 mouse_any_flag=1`, and the
 * window read answers with exactly the pane's rows. The program draws in the
 * alternate screen, tmux keeps no scrollback for it, so the DOM holds one
 * boxful and a wheel over it moves nothing -- while the program, which asked
 * the terminal for mouse reports precisely so it could scroll its own
 * viewport, never hears about the wheel. `test/main/terminal/mouse-wheel.
 * test.ts` holds the measurement and the main-side spelling; this file pins
 * that the tab really sends it, and only when it should.
 *
 * ── WHAT HAPPY-DOM CAN SAY HERE ───────────────────────────────────────────
 * Which key crossed the bridge, and whether the event was claimed. It lays
 * nothing out, so the cell under the pointer is asserted with a stubbed
 * ruler; whether Chromium really delivers a `wheel` to a listener that may
 * `preventDefault` (React's own are passive) is the e2e guard's business
 * (`e2e/terminal-echo-scroll-shots.mjs`, phase B).
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cellUnder, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneSendResult, PaneView } from '../../src/shared/terminal.js';

const ATLAS = 'claude-code:atlas-11111111';
const NAME = 'vam-atlas-a1b2c3';

const SCREEN = Array.from({ length: 40 }, (_, i) => `screen ${i}`).join('\n');

const ok = (mouse: boolean | undefined, text = SCREEN): PaneView => ({
  kind: 'ok',
  name: NAME,
  text,
  cursor: { kind: 'unreadable' },
  ...(mouse === undefined ? {} : { mouse }),
});

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => {
  const el = q<HTMLElement>('[data-terminal-pane]');
  if (el === null) throw new Error('the pane was not drawn');
  return el;
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(view: PaneView) {
  const read = vi.fn(async () => view);
  const send = vi.fn(async (_p: string, _k: PaneKey, _r?: string) => 'sent' as PaneSendResult);
  render(
    <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
  );
  await settle();
  return { read, send };
}

/** A wheel in LINE units: one notch is one line, however the browser scales. */
const notch = (el: HTMLElement, lines: number, at: { x: number; y: number } = { x: 0, y: 0 }) =>
  fireEvent.wheel(el, {
    deltaY: lines,
    deltaMode: 1,
    clientX: at.x,
    clientY: at.y,
  });

const wheels = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map((call) => call[1] as PaneKey).filter((key) => key.kind === 'wheel');

describe('a wheel over a pane whose program asked for the mouse', () => {
  it('is sent to the pane as a wheel key and claimed from the browser', async () => {
    const { send } = await mount(ok(true));
    const el = pane();
    const unclaimed = notch(el, -3);
    await settle();
    expect(unclaimed).toBe(false);
    expect(wheels(send)).toEqual([{ kind: 'wheel', direction: 'up', ticks: 3, column: 1, row: 1 }]);
    notch(el, 2);
    await settle();
    expect(wheels(send).at(-1)).toMatchObject({ direction: 'down', ticks: 2 });
  });

  it('names the cell under the pointer, in the screen the program drew', () => {
    // THE PURE FUNCTION, because happy-dom's `WheelEvent` drops `clientX`
    // and `clientY` on the floor (measured: both read `undefined`), so the
    // component can only ever be seen naming cell 1,1 here. Ten cells of
    // 5.6px, 15px tall; the screen's box at (10, 20); forty rows drawn of a
    // forty-row pane, so nothing is above the screen.
    const advance = { width: 5.6, height: 15 };
    const screen = { left: 10, top: 20 };
    const size = { columns: 120, rows: 40 };
    // 10 + 5.6 * 5 + 1 is inside the sixth cell; 20 + 15 * 2 + 1 the third row.
    expect(cellUnder({ x: 39, y: 51 }, screen, advance, size, 40)).toEqual({ column: 6, row: 3 });
    // Five hundred lines of history above a forty-row screen: the tab's
    // line 505 is the program's row 5.
    expect(cellUnder({ x: 10, y: 20 + 15 * 504 }, screen, advance, size, 540)).toEqual({
      column: 1,
      row: 5,
    });
    // A pointer up in that history names the first row, not a negative one;
    // one past the right edge names the last column, not one the pane lacks.
    expect(cellUnder({ x: 10 + 5.6 * 130, y: 20 }, screen, advance, size, 540)).toEqual({
      column: 120,
      row: 1,
    });
    // No layout yet: the first cell, never a division by zero.
    expect(cellUnder({ x: 39, y: 51 }, screen, { width: 0, height: 0 }, size, 40)).toEqual({
      column: 1,
      row: 1,
    });
  });

  it('turns pixels into notches by the ruler, and carries the remainder to the next event', async () => {
    const { send } = await mount(ok(true));
    const el = pane();
    const ruler = q<HTMLElement>('[data-terminal-ruler]');
    if (ruler === null) throw new Error('no ruler');
    ruler.getBoundingClientRect = () =>
      ({ width: 56, height: 15, left: 0, top: 0, right: 56, bottom: 15 }) as DOMRect;
    // 20px of a 15px row: one notch, 5px carried.
    fireEvent.wheel(el, { deltaY: -20, deltaMode: 0 });
    await settle();
    expect(wheels(send).at(-1)).toMatchObject({ direction: 'up', ticks: 1 });
    // 10px more makes 15: the carried remainder is what turns this into a notch.
    fireEvent.wheel(el, { deltaY: -10, deltaMode: 0 });
    await settle();
    expect(wheels(send)).toHaveLength(2);
    // 4px is not a notch yet, and is not sent as one.
    fireEvent.wheel(el, { deltaY: -4, deltaMode: 0 });
    await settle();
    expect(wheels(send)).toHaveLength(2);
  });

  it('never sends more notches in one key than the bridge admits', async () => {
    const { send } = await mount(ok(true));
    notch(pane(), -400);
    await settle();
    const [only] = wheels(send);
    expect(only).toMatchObject({ direction: 'up', ticks: 40 });
    expect(wheels(send)).toHaveLength(1);
  });
});

describe("a wheel over any other pane is the browser's, as it always was", () => {
  it('is not sent when the program declined the mouse', async () => {
    const { send } = await mount(ok(false));
    const unclaimed = notch(pane(), -3);
    await settle();
    expect(unclaimed).toBe(true);
    expect(wheels(send)).toEqual([]);
  });

  it('is not sent when tmux did not say -- not knowing is the old behaviour', async () => {
    const { send } = await mount(ok(undefined));
    const unclaimed = notch(pane(), -3);
    await settle();
    expect(unclaimed).toBe(true);
    expect(wheels(send)).toEqual([]);
  });
});
