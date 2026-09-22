// @vitest-environment happy-dom

/**
 * AN ECHO READ MUST NOT TAKE THE SCROLLBACK OUT OF THE DOM.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * The operator's report, translated: "can't scroll in the terminal view",
 * against a build carrying the echo read's screen-only capture. It was exact,
 * and it was a chicken and egg. An `echo` read answers with the SCREEN alone
 * -- which is the whole of that read's measured win -- and the tab put that
 * answer on screen as the entire view, so the five hundred lines above it
 * left the DOM. A pane holding one screen has `scrollHeight === clientHeight`
 * and nothing to scroll; `atLiveEnd()` is therefore permanently true, so
 * `echo-scrollback` is never asked for; and while typing continues the echo
 * sequence outruns every poll's full window, so the history never comes back.
 * MEASURED in Chromium against the real bundle (`e2e/terminal-echo-scroll-
 * shots.mjs`): scrollHeight collapsed 10401 -> 714 against a clientHeight of
 * 714 the moment typing began, and a wheel over the pane moved scrollTop by 0
 * for as long as it lasted.
 *
 * ── THE FIX THIS FILE PINS ────────────────────────────────────────────────
 * The read stays cheap and the VIEW stays whole: a screen-shaped answer is
 * spliced back onto the history already on screen (`composeScreen`), so main
 * still fetches 7,760 bytes instead of 86,260 while the DOM keeps every line
 * the operator can scroll into. The screen is a byte-suffix of the window
 * (tmux 3.7b), so replacing the shown text's last `n` lines with the `n` the
 * echo answered is the same rectangle, and the caret's row -- an index into
 * whichever text arrived with it (`shared/terminal.ts`, `PaneCursor`) -- is
 * moved onto the composed text rather than left indexing a screen.
 *
 * ── WHAT HAPPY-DOM CAN SAY HERE ───────────────────────────────────────────
 * It lays nothing out, so it can say what is DRAWN and never whether the pane
 * overflows its box. That is the whole reason this defect shipped past a
 * green suite, and it is why the guard that falsifies it is an e2e one
 * (`e2e/terminal-echo-scroll-shots.mjs`). This file owns the arithmetic and
 * the wiring: the splice itself, and that the tab really applies it.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeScreen, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneReadMode, PaneSendResult, PaneView } from '../../src/shared/terminal.js';

const ATLAS = 'claude-code:atlas-11111111';
const NAME = 'vam-atlas-a1b2c3';

const ok = (text: string, row?: number): PaneView => ({
  kind: 'ok',
  name: NAME,
  text,
  cursor: row === undefined ? { kind: 'unreadable' } : { kind: 'at', column: 0, row },
});

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');

function box(input: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const el = pane();
  if (el === null) throw new Error('the pane was not drawn');
  Object.defineProperty(el, 'scrollHeight', { value: input.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: input.clientHeight, configurable: true });
  el.scrollTop = input.scrollTop;
  return el;
}

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
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a screen-shaped answer is put back on top of the history', () => {
  const HISTORY = ['h0', 'h1', 'h2'].join('\n');
  const WINDOW = `${HISTORY}\ns0\ns1`;

  it('replaces exactly the lines the screen answered and keeps the rest', () => {
    const composed = composeScreen(ok(WINDOW), ok('S0\nS1'), 'echo');
    expect(composed).toEqual(ok('h0\nh1\nh2\nS0\nS1'));
  });

  it('moves the caret onto the composed text rather than leaving it indexing a screen', () => {
    // `row` counts from the top of WHATEVER TEXT ARRIVED WITH IT, so row 1 of
    // a two-line screen is row 4 once three lines of history sit above it. A
    // composition that carried the caret across unchanged would draw it four
    // lines up, inside the scrollback, on every keystroke.
    const composed = composeScreen(ok(WINDOW, 4), ok('S0\nS1', 1), 'echo');
    expect(composed).toEqual(ok('h0\nh1\nh2\nS0\nS1', 4));
  });

  it('composes onto its own output, so a burst of echoes does not grow the view', () => {
    const once = composeScreen(ok(WINDOW), ok('S0\nS1'), 'echo');
    const twice = composeScreen(once, ok('T0\nT1'), 'echo');
    expect(twice).toEqual(ok('h0\nh1\nh2\nT0\nT1'));
  });

  it('leaves a windowed answer entirely alone -- it is already the whole view', () => {
    // `poll` and `echo-scrollback` both asked for the scrollback and both got
    // it; splicing one onto another would duplicate the history.
    const whole = ok('a\nb\nc\nd\ne');
    expect(composeScreen(ok(WINDOW), whole, 'poll')).toBe(whole);
    expect(composeScreen(ok(WINDOW), whole, 'echo-scrollback')).toBe(whole);
  });

  it('never invents history it has not got', () => {
    const screen = ok('S0\nS1');
    // Nothing drawn yet.
    expect(composeScreen(null, screen, 'echo')).toBe(screen);
    // A failure carries no text to splice onto, and is not one to splice into.
    expect(composeScreen({ kind: 'gone' }, screen, 'echo')).toBe(screen);
    expect(composeScreen(ok(WINDOW), { kind: 'gone' }, 'echo')).toEqual({ kind: 'gone' });
    // A DIFFERENT SESSION's screen: its history is not this answer's history,
    // and prepending it would put another agent's output above this one.
    const other: PaneView = {
      kind: 'ok',
      name: 'vam-other-b2c3',
      text: 'S0\nS1',
      cursor: { kind: 'unreadable' },
    };
    expect(composeScreen(ok(WINDOW), other, 'echo')).toBe(other);
    // A screen at least as long as the whole view: there is no history above
    // it, so there is nothing to keep.
    expect(composeScreen(ok('a\nb'), screen, 'echo')).toBe(screen);
    expect(composeScreen(ok('a\nb'), ok('S0\nS1\nS2'), 'echo')).toEqual(ok('S0\nS1\nS2'));
  });
});

describe('the tab really applies it', () => {
  it('keeps every line of the scrollback drawn across a keystroke echo', async () => {
    // FAKE TIMERS: `REFRESH_MS` on the real clock lets a `poll` land inside
    // this test's window on a slow runner. Frozen, the interval cannot fire,
    // and the reads recorded are exactly the ones the keystroke caused.
    vi.useFakeTimers();
    // THE WIRING, and the one assertion happy-dom can make about this defect:
    // what is in the DOM. The e2e guard makes the one it cannot -- that the
    // pane still overflows its box.
    const history = Array.from({ length: 500 }, (_, i) => `history ${i}`).join('\n');
    const screen = Array.from({ length: 40 }, (_, i) => `screen ${i}`).join('\n');
    const read = vi.fn(async (_p: string, _r?: string, mode?: PaneReadMode) =>
      mode === 'echo' ? ok(screen) : ok(`${history}\n${screen}`),
    );
    const send = vi.fn(async (_p: string, _k: PaneKey, _r?: string) => 'sent' as PaneSendResult);
    render(
      <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
    );
    await settle();
    const drawn = () => (q<HTMLElement>('[data-terminal-pane] pre')?.textContent ?? '').split('\n');
    expect(drawn()).toHaveLength(540);

    const el = box({ scrollHeight: 8000, clientHeight: 200, scrollTop: 7800 });
    const before = read.mock.calls.length;
    await act(async () => {
      fireEvent.keyDown(el, { key: 'x' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The cheap read really was the one asked for -- the win of the echo read
    // is untouched -- and the expensive thing it used to cost is not.
    //
    // "AMONG the reads since the key", not "the last read". The component's
    // `REFRESH_MS` interval runs on the real clock here, and on a slow runner
    // a `poll` lands after the echo inside this same window: CI saw exactly
    // that -- `expected 'poll' to be 'echo'` -- on a branch that had passed
    // this test three times locally and twice on CI. The property is that a
    // keystroke asks for the cheap read; whether the tick also fired is the
    // runner's business, not this test's.
    const modesSinceKey = read.mock.calls.slice(before).map((call) => call[2]);
    expect(modesSinceKey).toContain('echo');
    expect(drawn()).toHaveLength(540);
    expect(drawn()[0]).toBe('history 0');
  });
});
