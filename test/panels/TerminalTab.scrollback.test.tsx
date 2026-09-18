// @vitest-environment happy-dom

/**
 * THE SCROLLBACK, ON THE RENDERER'S SIDE: every captured line is drawn, an
 * identical capture is not drawn again, and the pane stays at the bottom while
 * output is live unless the operator has scrolled away from it.
 *
 * WHAT HAPPY-DOM CAN AND CANNOT SAY HERE. It lays nothing out, so every
 * rectangle below is written by the test -- which is enough for the PIN,
 * because the pin is arithmetic over three numbers the element reports and a
 * `scrollTop` written back. It is NOT enough for the thing the operator
 * actually reported: whether there is anything to scroll at all. That is
 * `scrollHeight > clientHeight` in a real engine, and it is measured in
 * `e2e/terminal-scrollback-shots.mjs`.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  atBottom,
  REFRESH_MS,
  sameScreen,
  TerminalTab,
} from '../../src/renderer/panels/TerminalTab.js';
import type { PaneCursor, PaneView } from '../../src/shared/terminal.js';

const ATLAS = 'claude-code:atlas-11111111';
const NAME = 'vam-atlas-a1b2c3';

const ok = (text: string, cursor: PaneCursor): PaneView => ({
  kind: 'ok',
  name: NAME,
  text,
  cursor,
});
const plain = (text: string): PaneView => ok(text, { kind: 'unreadable' });

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

/** happy-dom reports zero for all three; the pin reads all three. */
function box(input: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  const pane = q<HTMLElement>('[data-terminal-pane]');
  if (pane === null) throw new Error('the pane was not drawn');
  Object.defineProperty(pane, 'scrollHeight', { value: input.scrollHeight, configurable: true });
  Object.defineProperty(pane, 'clientHeight', { value: input.clientHeight, configurable: true });
  if (input.scrollTop !== undefined) pane.scrollTop = input.scrollTop;
  return pane;
}

const settle = async () => {
  await act(async () => {
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
  // BEFORE THE RENDER, and that is not a detail: the tab's poll is a
  // `setInterval` registered on mount, so timers faked afterwards would never
  // own it and `advanceTimersByTime` would drive nothing at all.
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a capture identical to the one on screen is not drawn again', () => {
  it('tells two captures apart by their text, their caret and their session', () => {
    const screen = plain('one\ntwo\n');
    expect(sameScreen(screen, plain('one\ntwo\n'))).toBe(true);
    expect(sameScreen(screen, plain('one\nTWO\n'))).toBe(false);
    // The caret moving IS the screen changing: a character typed at a prompt
    // moves it, and a pane that did not redraw for that is a pane that does
    // not echo.
    expect(sameScreen(screen, ok('one\ntwo\n', { kind: 'at', column: 3, row: 1 }))).toBe(false);
    expect(
      sameScreen(
        ok('one\ntwo\n', { kind: 'at', column: 3, row: 1 }),
        ok('one\ntwo\n', {
          kind: 'at',
          column: 4,
          row: 1,
        }),
      ),
    ).toBe(false);
    expect(sameScreen(screen, ok('one\ntwo\n', { kind: 'hidden' }))).toBe(false);
    // A different SESSION with an identical screen is a different thing to
    // draw -- the name is under it, and the pane's accessible name carries it.
    expect(
      sameScreen(screen, {
        kind: 'ok',
        name: 'vam-other-b2c3d4',
        text: 'one\ntwo\n',
        cursor: { kind: 'unreadable' },
      }),
    ).toBe(false);
  });

  it('never calls two answers the same when either is not a screen', () => {
    // Nothing but `ok` is compared: a failure carries a message, and two
    // failures that read alike are still two answers about a live tmux.
    expect(sameScreen(null, plain('one'))).toBe(false);
    expect(sameScreen({ kind: 'gone' }, { kind: 'gone' })).toBe(false);
    expect(sameScreen(plain('one'), { kind: 'gone' })).toBe(false);
  });
});

describe('the pane stays where the operator left it', () => {
  /** One turn of the tab's own poll, with the answer applied. */
  const poll = async () => {
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('is at the bottom when new output arrives and the operator is there', async () => {
    const read = vi.fn(async () => plain('line\n'.repeat(40)));
    render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
    await settle();
    // THE OPERATOR IS AT THE BOTTOM of an 800px content in a 200px box.
    const pane = box({ scrollHeight: 800, clientHeight: 200, scrollTop: 600 });
    read.mockResolvedValue(plain('line\n'.repeat(60)));
    await poll();
    // MORE OUTPUT, and a screen that really differs -- an identical capture is
    // dropped before React sees it, which is the point of `sameScreen`.
    box({ scrollHeight: 1200, clientHeight: 200 });
    read.mockResolvedValue(plain(`${'line\n'.repeat(60)}the agent said something\n`));
    await poll();
    // Followed the output down: `scrollPane` writes `scrollHeight`, which a
    // real engine clamps to the bottom of the new content.
    expect(pane.scrollTop).toBe(1200);
  });

  it('does not even run for a capture identical to the one on screen', async () => {
    // THE WIRING OF `sameScreen`, which its own unit tests cannot reach: the
    // comparison could be perfect and never consulted. An unchanged capture
    // must not reach React at all -- so the pin, which runs on every change,
    // must not run either. The pane is left at the bottom of an 800px content
    // and the box is then made 1500px tall behind its back: a pin that ran
    // would follow that to 1500, and one that was never asked cannot.
    // A FRESH OBJECT PER CALL, and it is the whole point of the fixture:
    // `mockResolvedValue` would hand back the identical reference every time,
    // which React bails out of on its own -- and this test would then pass
    // against a tab with no comparison in it at all. A real read allocates.
    const read = vi.fn(async () => plain('line\n'.repeat(50)));
    render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
    await settle();
    const pane = box({ scrollHeight: 800, clientHeight: 200, scrollTop: 600 });
    await poll();
    pane.scrollTop = 600;
    box({ scrollHeight: 1500, clientHeight: 200 });
    // The SAME fifty lines again, which is what an idle agent answers with
    // once a second for as long as the tab is open.
    await poll();
    expect(pane.scrollTop).toBe(600);
  });

  it('leaves a scrolled-up operator alone when new output arrives', async () => {
    const read = vi.fn(async () => plain('line\n'.repeat(40)));
    render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
    await settle();
    const pane = box({ scrollHeight: 800, clientHeight: 200, scrollTop: 0 });
    // One turn so the pin has a height to measure the next one against.
    read.mockResolvedValue(plain('line\n'.repeat(50)));
    await poll();
    // THE OPERATOR SCROLLS UP -- a long way up, into the scrollback.
    pane.scrollTop = 120;
    read.mockResolvedValue(plain('line\n'.repeat(60)));
    await poll();
    // NOT YANKED. A terminal that jumps to the live end every second while
    // somebody is reading what the agent printed is worse than no scrollback.
    expect(pane.scrollTop).toBe(120);
  });
});

describe('what counts as "at the bottom"', () => {
  it('is measured against the height the operator was scrolling in', () => {
    // The height BEFORE the update, because the element already holds the new
    // one by the time anything can look: the browser preserves `scrollTop`
    // across a content change, so the only question that can still be asked
    // is where that position sat in the OLD content.
    expect(atBottom(800, { scrollTop: 600, clientHeight: 200 }, 0)).toBe(true);
    expect(atBottom(800, { scrollTop: 599, clientHeight: 200 }, 0)).toBe(false);
    // One row of slack, which is what a partly-drawn last line and a rounded
    // rectangle cost between them.
    expect(atBottom(800, { scrollTop: 599, clientHeight: 200 }, 16)).toBe(true);
    expect(atBottom(800, { scrollTop: 560, clientHeight: 200 }, 16)).toBe(false);
  });

  it('starts pinned: nothing has been measured, so the live end is where to be', () => {
    expect(atBottom(null, { scrollTop: 0, clientHeight: 200 }, 0)).toBe(true);
  });
});

describe('every captured line is drawn', () => {
  it('draws the scrollback as well as the screen, however long it is', async () => {
    // THE MUTATION THIS CATCHES is the tempting one: cap the drawn lines to
    // keep the render cheap. It would make the pane exactly as unscrollable as
    // the defect did, with the capture arriving correctly all the while.
    const text = Array.from({ length: 600 }, (_, i) => `line-${i}`).join('\n');
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => plain(text))}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    const screen = q<HTMLElement>('[data-terminal-pane] pre');
    expect(screen?.textContent?.split('\n')).toHaveLength(600);
    expect(screen?.textContent).toContain('line-0');
    expect(screen?.textContent).toContain('line-599');
  });

  it('marks the caret on the line the capture says, scrollback and all', async () => {
    // `PaneCursor.row` is an index into the TEXT (`shared/terminal.ts`), which
    // main offsets by the history it asked for. Drawing it at the screen's own
    // row would put it 500 lines up, in the scrollback.
    const text = Array.from({ length: 600 }, (_, i) => `line-${i}`).join('\n');
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok(text, { kind: 'at', column: 0, row: 599 }))}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    const caret = q<HTMLElement>('[data-terminal-cursor]');
    expect(caret?.textContent).toBe('l');
    const lines = q<HTMLElement>('[data-terminal-pane] pre')?.textContent?.split('\n') ?? [];
    expect(lines[599]).toBe('line-599');
  });
});
