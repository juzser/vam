// @vitest-environment happy-dom

/**
 * Making the pane fit, and taking its colours from the theme.
 *
 * THE PART THAT IS NOT CSS. `capture-pane` returns the screen tmux has already
 * composed, at the size the session was created with, so a line tmux wrapped
 * at 80 columns arrives wrapped whatever the wrapper is styled to. The tab
 * therefore MEASURES its wrapper and tells tmux the size in cells. What is
 * pinned here is that it measures rather than guesses a ratio, that it does
 * not spawn a tmux per animation frame, and above all that it never resizes a
 * session vam cannot prove is its own -- that one would reflow a terminal
 * belonging to someone else's work.
 *
 * happy-dom does no layout, so every rectangle here is written by the test.
 * The arithmetic itself is exhaustively covered in `terminal-size.test.ts`,
 * where no layout engine is needed at all.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESIZE_DEBOUNCE_MS, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import { applyPalette } from '../../src/renderer/prefs/prefs.js';
import type { PaneView } from '../../src/shared/terminal.js';

const ATLAS = 'claude-code:atlas-11111111';
const ok = (text = 'the pane'): PaneView => ({ kind: 'ok', name: 'vam-atlas-a1b2c3', text });

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

/** The observer happy-dom will not run for us. Its callbacks are fired by hand. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
    // A real ResizeObserver delivers the element's initial size on `observe`,
    // which is where the tab's FIRST measurement comes from.
    this.callback();
  }
  disconnect() {
    this.disconnected = true;
  }
}

/** Writes the layout happy-dom has none of: a wrapper box and a cell size. */
function layout(input: { box: { width: number; height: number }; cell: number }) {
  const pane = q<HTMLElement>('[data-terminal-pane]');
  const ruler = q<HTMLElement>('[data-terminal-ruler]');
  if (pane === null || ruler === null) throw new Error('the pane was not drawn');
  Object.defineProperty(pane, 'clientWidth', { value: input.box.width, configurable: true });
  Object.defineProperty(pane, 'clientHeight', { value: input.box.height, configurable: true });
  // One rendered character, ten times over -- the tab divides by the count.
  const characters = (ruler.textContent ?? '').length;
  ruler.getBoundingClientRect = () => ({ width: input.cell * characters, height: 16 }) as DOMRect;
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const fire = async () => {
  await act(async () => {
    for (const observer of FakeResizeObserver.instances) {
      if (observer.observed.length > 0 && !observer.disconnected) observer.callback();
    }
    // The measurement is debounced: a drag moves in pixels and must not spawn
    // a tmux per frame.
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS * 2);
    await Promise.resolve();
  });
};

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Terminal tab tells tmux how big the pane is', () => {
  it('measures a rendered character and asks for the columns and rows that fit', async () => {
    const resize = vi.fn(async () => true);
    render(
      <TerminalTab
        projectId={ATLAS}
        rowId="sess-alpha#1"
        read={vi.fn(async () => ok())}
        resize={resize}
        send={undefined}
      />,
    );
    await settle();
    // 800 / 8 = 100 columns, 480 / 16 = 30 rows. The cell width is MEASURED --
    // a plausible 0.6 ratio off the 10.5px font size would have said 127.
    layout({ box: { width: 800, height: 480 }, cell: 8 });
    await fire();

    // The ROW travels with the size: a project vam started two sessions in has
    // two panes, and the one resized has to be the one on screen.
    expect(resize).toHaveBeenCalledWith(ATLAS, 100, 30, 'sess-alpha#1');
  });

  it('asks again when the wrapper changes size, which the pane resizer does', async () => {
    const resize = vi.fn(async () => true);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={resize}
        send={undefined}
      />,
    );
    await settle();
    layout({ box: { width: 800, height: 480 }, cell: 8 });
    await fire();
    // The 300px canvas strip appearing, or a layout preset: the detail pane's
    // width changes a lot, and the pane it holds has to follow.
    layout({ box: { width: 500, height: 480 }, cell: 8 });
    await fire();

    expect(resize.mock.calls).toEqual([
      [ATLAS, 100, 30, undefined],
      [ATLAS, 62, 30, undefined],
    ]);
  });

  it('does not ask again when the size has not changed', async () => {
    // A resizer moves in pixels and a terminal changes in cells, so most
    // frames of a drag produce the size already in force. Each of those would
    // otherwise be a tmux process.
    const resize = vi.fn(async () => true);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={resize}
        send={undefined}
      />,
    );
    await settle();
    layout({ box: { width: 800, height: 480 }, cell: 8 });
    await fire();
    layout({ box: { width: 803, height: 484 }, cell: 8 });
    await fire();
    await fire();

    expect(resize).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing before there is a layout to measure', async () => {
    // happy-dom's zeros are the real state of a pane that has not been laid
    // out. A size derived from them would floor to the clamp minimum and
    // resize a working session to 20x5 on every mount.
    const resize = vi.fn(async () => true);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={resize}
        send={undefined}
      />,
    );
    await settle();
    await fire();

    expect(resize).not.toHaveBeenCalled();
  });

  it.each([
    ['one vam did not start', { kind: 'not-vam' } as PaneView],
    ['one that has ended', { kind: 'gone' } as PaneView],
    ['two answering to one project', { kind: 'ambiguous', names: ['a', 'b'] } as PaneView],
  ])('never resizes for a session vam cannot prove: %s', async (_why, view) => {
    // Resizing the wrong session reflows someone else's terminal. There is no
    // pane on screen in any of these states, so there is nothing to fit -- and
    // nothing is observed and nothing is asked.
    const resize = vi.fn(async () => true);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => view)}
        resize={resize}
        send={undefined}
      />,
    );
    await settle();
    await fire();

    expect(resize).not.toHaveBeenCalled();
    expect(FakeResizeObserver.instances.flatMap((o) => o.observed)).toEqual([]);
  });

  it('stops observing when the tab is left', async () => {
    const { unmount } = render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={vi.fn(async () => true)}
        send={undefined}
      />,
    );
    await settle();
    layout({ box: { width: 800, height: 480 }, cell: 8 });
    await fire();
    unmount();

    expect(FakeResizeObserver.instances.every((o) => o.disconnected)).toBe(true);
  });

  it('asks nothing when there is no bridge, as in the browser build', async () => {
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    await fire();
    // Nothing to assert but the absence of a crash: the browser build has no
    // main process, so there is no tmux to size.
    expect(q('[data-terminal-pane]')).not.toBeNull();
  });
});

describe('the pane takes its colours from the theme', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

  it('draws in tokens, never in a colour of its own', async () => {
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={vi.fn(async () => true)}
        send={undefined}
      />,
    );
    await settle();
    const pane = q<HTMLElement>('[data-terminal-pane]');
    const classes = pane?.getAttribute('class') ?? '';
    expect(classes).toContain('bg-panel');
    expect(classes).toContain('text-ink');
    // `capture-pane` is called WITHOUT `-e`, so the text carries no colour of
    // its own: every pixel in this pane is the theme's, and a literal would be
    // a colour the theme could not reach.
    expect(pane?.outerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('is wired to tokens the operator can actually override', () => {
    // The chain that has to hold: the utility reads `--color-*`, which is
    // defined as the `--vam-*` custom property, which is what the colour
    // picker writes onto the root.
    expect(css).toContain('--color-panel: var(--vam-panel);');
    expect(css).toContain('--color-ink: var(--vam-ink);');
  });

  it('changes colour when the operator overrides the token, not only on reload', async () => {
    // VERIFIED RATHER THAN ASSUMED. The overrides are set as custom properties
    // on the root at runtime, so a pane built from token classes should
    // inherit them for free -- this drives the real `applyPalette` and reads
    // the pane's computed colour back.
    document.head.innerHTML = `<style>
      :root { --vam-panel: #141414; --vam-ink: #ededed; }
      .bg-panel { background-color: var(--vam-panel); }
      .text-ink { color: var(--vam-ink); }
    </style>`;
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={vi.fn(async () => true)}
        send={undefined}
      />,
    );
    await settle();
    const pane = q<HTMLElement>('[data-terminal-pane]') as HTMLElement;
    expect(getComputedStyle(pane).backgroundColor).toBe('#141414');

    applyPalette({ '--vam-panel': '#3b0764', '--vam-ink': '#f5d0fe' });
    expect(getComputedStyle(pane).backgroundColor).toBe('#3b0764');
    expect(getComputedStyle(pane).color).toBe('#f5d0fe');

    applyPalette({});
    expect(getComputedStyle(pane).backgroundColor).toBe('#141414');
  });
});
