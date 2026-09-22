// @vitest-environment happy-dom

/**
 * WHICH READ THE TAB ASKS FOR, and it is the renderer that knows: main cannot
 * see where the operator has scrolled to, and it is the scroll position that
 * decides whether the 500 lines above the screen are worth 78KB and ~5ms of
 * every keystroke's echo (`shared/terminal.ts`, `PaneReadMode`;
 * `test/main/terminal/echo-read.test.ts` is the other half, where the argv
 * that word turns into is asserted).
 *
 * WHAT HAPPY-DOM CAN SAY HERE. It lays nothing out, so every rectangle is
 * written by the test -- which is enough, because the question is arithmetic
 * over three numbers the element reports (`atBottom`) and the word that comes
 * out of it. Whether the pane is scrollable AT ALL in a real engine is
 * `e2e/terminal-scrollback-shots.mjs`, and always was.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ECHO_MS, REFRESH_MS, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneReadMode, PaneSendResult, PaneView } from '../../src/shared/terminal.js';

const ATLAS = 'claude-code:atlas-11111111';
const NAME = 'vam-atlas-a1b2c3';

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');

const ok = (text = 'the screen'): PaneView => ({
  kind: 'ok',
  name: NAME,
  text,
  cursor: { kind: 'unreadable' },
});

/** happy-dom reports zero for all three; the decision reads all three. */
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

/** A tab whose reads are recorded by the mode they asked for. */
async function open(text = 'the screen') {
  const read = vi.fn(async (_p: string, _r?: string, _mode?: PaneReadMode) => ok(text));
  const send = vi.fn(async (_p: string, _k: PaneKey, _r?: string) => 'sent' as PaneSendResult);
  render(
    <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
  );
  await settle();
  return {
    read,
    send,
    modes: () => read.mock.calls.map((call) => call[2]),
    type: async (key = 'x') => {
      await act(async () => {
        fireEvent.keyDown(pane() as HTMLElement, { key });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

describe('a keystroke echo asks for no scrollback while the view is at the live end', () => {
  it('asks as `echo` when the operator is at the bottom', async () => {
    const tab = await open();
    // AT THE BOTTOM of an 800px content in a 200px box.
    box({ scrollHeight: 800, clientHeight: 200, scrollTop: 600 });
    const before = tab.read.mock.calls.length;
    await tab.type();
    expect(tab.read.mock.calls.length).toBeGreaterThan(before);
    expect(tab.modes().slice(before)).toEqual(['echo']);
  });

  it('asks as `echo-scrollback` when the operator has scrolled up', async () => {
    // THE CASE THAT MUST NOT BE OPTIMISED. The scrollback is what they are
    // reading; a screen-only answer would empty the region under their cursor
    // and the pin would put them back at the live end.
    const tab = await open();
    box({ scrollHeight: 800, clientHeight: 200, scrollTop: 120 });
    const before = tab.read.mock.calls.length;
    await tab.type();
    expect(tab.modes().slice(before)).toEqual(['echo-scrollback']);
  });

  it('follows the operator back down without waiting for a tick', async () => {
    const tab = await open();
    box({ scrollHeight: 800, clientHeight: 200, scrollTop: 120 });
    await tab.type();
    expect(tab.modes().at(-1)).toBe('echo-scrollback');
    // They scroll back to the live end and keep typing.
    box({ scrollHeight: 800, clientHeight: 200, scrollTop: 600 });
    await new Promise((resolve) => setTimeout(resolve, ECHO_MS + 5));
    await tab.type();
    expect(tab.modes().at(-1)).toBe('echo');
  });

  it('asks as `poll` on its own interval, whatever the scroll position is', async () => {
    // The tick is the read that re-proves the pairing AND the one that keeps
    // the scrollback in the DOM, so it is never an echo -- not even for an
    // operator sitting at the bottom who has just typed.
    vi.useFakeTimers();
    const read = vi.fn(async (_p: string, _r?: string, _mode?: PaneReadMode) => ok());
    render(
      <TerminalTab
        projectId={ATLAS}
        rowId={ATLAS}
        read={read}
        resize={undefined}
        send={undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    box({ scrollHeight: 800, clientHeight: 200, scrollTop: 600 });
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(read.mock.calls.length).toBeGreaterThan(1);
    expect(read.mock.calls.map((call) => call[2])).toEqual(
      read.mock.calls.map(() => 'poll' as const),
    );
  });

  it('asks as `echo` before anything has been drawn, and never for scrollback it has not got', async () => {
    // Nothing measured yet is the same answer `atBottom` gives for it: a tab
    // that has just opened is showing the live end by definition.
    const tab = await open();
    const before = tab.read.mock.calls.length;
    await tab.type();
    expect(tab.modes().slice(before)).toEqual(['echo']);
  });
});

describe("a screen-shaped answer is drawn in the windowed answer's own coordinates", () => {
  it('keeps the operator at the live end across the flip, and keeps the scrollback drawn', async () => {
    /**
     * THE WAY THIS CHANGE COULD CORRUPT THE PIN -- and the way it DID, which
     * `TerminalTab.echo-splice.test.tsx` records. An echo read at the bottom
     * answers with ~50 lines; the tick a moment later answers with ~550. The
     * first cut put the shorter answer on screen as the whole view, on the
     * argument that the operator could not see it: the screen is the SAME
     * rectangle in both, and a suffix of the longer one (measured -- tmux
     * returns exactly the window's rows for a capture with no `-S`). What
     * they could see was that the pane had nothing left to scroll. Now the
     * shorter answer is spliced onto the history already drawn
     * (`composeScreen`), so the content height does not move at all and the
     * pin has nothing to correct.
     */
    const read = vi.fn(async (_p: string, _r?: string, mode?: PaneReadMode) =>
      ok(
        mode === 'echo' ? 'screen\n'.repeat(40) : `${'history\n'.repeat(500)}${'old\n'.repeat(40)}`,
      ),
    );
    const send = vi.fn(async () => 'sent' as PaneSendResult);
    render(
      <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
    );
    await settle();
    // The window view: 8000px of content in a 200px box, at the bottom.
    const el = box({ scrollHeight: 8000, clientHeight: 200, scrollTop: 7800 });
    await act(async () => {
      fireEvent.keyDown(el, { key: 'x' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(read.mock.calls.at(-1)?.[2]).toBe('echo');
    // Still at the live end, with the history still above it and the screen
    // the echo answered in place of the one the poll had drawn.
    expect(el.scrollTop).toBe(8000);
    const drawn = (el.querySelector('pre')?.textContent ?? '').split('\n');
    expect(drawn.filter((line) => line === 'history')).toHaveLength(500);
    expect(drawn.filter((line) => line === 'screen')).toHaveLength(40);
    expect(drawn.filter((line) => line === 'old')).toHaveLength(0);
  });

  it('bails out of an echo answer identical to the screen already drawn', async () => {
    // THE OTHER HALF, and it used to be asserted the other way round: the two
    // shapes were two coordinate systems that could never be compared, so a
    // screen-only answer was ALWAYS drawn. `composeScreen` puts it into the
    // drawn answer's coordinates first, so `sameScreen` is sound across the
    // flip -- and it matters, because an echo read fires up to thirty times a
    // second and most of those answers are the same screen as the last. Here
    // the session has no scrollback yet, so both questions really do return
    // the same forty lines.
    // WHAT IS OBSERVED, and the obvious assertion cannot be it: two identical
    // texts leave identical DOM whether the answer was drawn or dropped, so
    // reading the screen back would pass against either build. The pin is what
    // separates them -- it runs on every change and not at all on a bail-out
    // (`TerminalTab.scrollback.test.tsx` uses the same lever) -- so the box is
    // made taller behind the tab's back and the pin's own write is the witness.
    // A FRESH OBJECT PER CALL for the reason that file states: a shared
    // reference would make React bail out on its own.
    const read = vi.fn(async (_p: string, _r?: string, mode?: PaneReadMode) => {
      // THE BOX GROWS WHILE THE READ IS IN FLIGHT: it is issued AFTER the tab
      // has decided which question to ask (so the mode below is still `echo`)
      // and BEFORE the answer is applied. A drawn answer would pin to the new
      // height; a dropped one never runs the pin at all.
      if (mode === 'echo') box({ scrollHeight: 1500, clientHeight: 200, scrollTop: 600 });
      return ok('same\n'.repeat(40));
    });
    const send = vi.fn(async () => 'sent' as PaneSendResult);
    render(
      <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
    );
    await settle();
    const el = box({ scrollHeight: 800, clientHeight: 200, scrollTop: 600 });
    await act(async () => {
      fireEvent.keyDown(el, { key: 'x' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(read.mock.calls.at(-1)?.[2]).toBe('echo');
    // Dropped, not drawn: the pin never ran, so the box's own number stands.
    expect(el.scrollTop).toBe(600);
  });
});

describe('the two timers the operator feels', () => {
  it('waits 33ms at most between echoes, and polls four times a second', () => {
    /**
     * PINNED BY VALUE, because the values ARE the change the operator asked
     * for -- translated: "tmux streaming has quite a lot of delay, which makes
     * the prompt-typing experience bad". The research split that in two: the
     * typing half is this echo window (mean added wait `ECHO_MS`/2, so 100 ->
     * 33 takes it from ~50ms to ~17ms), and the streaming half is the poll
     * interval (mean output lag `REFRESH_MS`/2, so 1000 -> 250 takes it from
     * 500ms to 125ms).
     *
     * THE FLOOR IS DELIBERATE: below about 30ms the win stops being
     * perceptible, and every millisecond under it is bought with main-process
     * work on a machine that is running somebody's agents.
     */
    expect(ECHO_MS).toBe(33);
    expect(REFRESH_MS).toBe(250);
  });
});
