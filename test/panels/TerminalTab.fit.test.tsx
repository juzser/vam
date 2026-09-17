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
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  setActiveTerminalFontSize,
  TERMINAL_FONT_SIZES,
} from '../../src/renderer/prefs/terminal-font.js';
import {
  NARROW_MAX_CHARACTERS,
  NARROW_TERMINAL_MAX_WIDTH,
  setActiveNarrowViews,
} from '../../src/renderer/prefs/view-width.js';
import type { PaneView } from '../../src/shared/terminal.js';

const ATLAS = 'claude-code:atlas-11111111';
/** A screen with no cursor answer -- what a stub that never asked tmux knows. */
const NO_CURSOR = { kind: 'unreadable' } as const;
const ok = (text = 'the pane'): PaneView => ({
  kind: 'ok',
  name: 'vam-atlas-a1b2c3',
  text,
  cursor: NO_CURSOR,
});

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

/**
 * THE ONE FAILURE A SETTING FOR THE SCREEN'S SIZE CAN INTRODUCE, and it is
 * silent.
 *
 * tmux composes the screen at the size it was TOLD, and vam works that size
 * out by dividing the pane's box by the advance of one rendered character. The
 * advance is a function of the font size. So the moment the size becomes a
 * setting, "the size moved" and "the column count moved" have to be the same
 * event -- and the thing that makes them not be is the obvious
 * implementation: put the size on the document as a custom property, let CSS
 * repaint, and never tell React. The pane's own box does not change when its
 * type does, so its `ResizeObserver` never fires, and tmux goes on composing
 * at the old width. Nothing looks broken. Long lines wrap in the wrong place,
 * and the report is "tmux is broken".
 *
 * THE RULER IS NOT WRITTEN BY HAND IN THIS BLOCK, which is what makes it a
 * test of the chain rather than of the arithmetic. `getBoundingClientRect` is
 * defined to DERIVE the advance from the size the ruler is actually drawn at,
 * read back through `getComputedStyle` -- happy-dom resolves inherited
 * font-size, so this is the engine's answer to "what size is that character",
 * not the test's. Move the size onto an inner element, take the ruler out of
 * the pane, or drop `fontSize` from the effect's dependencies, and the column
 * count stops moving while everything else still passes.
 */
describe('the column count follows the size the screen is drawn at', () => {
  /** A monospace advance, as a fraction of the em -- Geist Mono measures about
   *  0.63 here. The exact ratio does not matter; that it is a RATIO does. */
  const ADVANCE = 0.6;

  /** The layout a real engine would give: a fixed box, and a cell derived from
   *  whatever size the ruler is really inheriting. */
  function layoutDerived(box: { width: number; height: number }) {
    const pane = q<HTMLElement>('[data-terminal-pane]');
    const ruler = q<HTMLElement>('[data-terminal-ruler]');
    if (pane === null || ruler === null) throw new Error('the pane was not drawn');
    Object.defineProperty(pane, 'clientWidth', { value: box.width, configurable: true });
    Object.defineProperty(pane, 'clientHeight', { value: box.height, configurable: true });
    const characters = (ruler.textContent ?? '').length;
    ruler.getBoundingClientRect = () => {
      const em = Number.parseFloat(globalThis.getComputedStyle(ruler).fontSize);
      return { width: em * ADVANCE * characters, height: em * 1.55 } as DOMRect;
    };
  }

  const columnsFor = (px: number, width: number) => Math.floor(width / (px * ADVANCE));

  /**
   * THE DEBOUNCE ONLY -- deliberately NOT `fire()`.
   *
   * `fire()` invokes every observer callback by hand, which is a resize this
   * scenario does not have: the pane's box is identical before and after the
   * size changes, so a real `ResizeObserver` says nothing at all. Using it here
   * would hand the measurement the very trigger whose absence is the defect,
   * and the block would pass with `fontSize` deleted from the effect's
   * dependencies -- measured, exactly that. What may fire is the effect
   * RE-RUNNING, which re-observes, and `observe` delivers an initial size.
   */
  const tick = async () => {
    await act(async () => {
      vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS * 2);
      await Promise.resolve();
    });
  };

  it('asks tmux for a different number of columns at every size it offers', async () => {
    const resize = vi.fn(async () => true);
    setActiveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={resize}
        send={undefined}
      />,
    );
    await settle();
    // The box never changes. Only the type does, which is the whole point:
    // nothing here would make a `ResizeObserver` fire on its own.
    layoutDerived({ width: 800, height: 480 });

    const asked: number[] = [];
    for (const size of TERMINAL_FONT_SIZES) {
      await act(async () => {
        setActiveTerminalFontSize(size);
      });
      await tick();
      const last = resize.mock.calls.at(-1) as unknown[] | undefined;
      asked.push(last?.[1] as number);
      // The arithmetic, said exactly: the columns are the box over the advance
      // AT THIS SIZE, and not at the size that shipped.
      expect(asked.at(-1), `${size}px`).toBe(columnsFor(size, 800));
    }

    // AND THEY ARE ALL DIFFERENT. This is the assertion that fails when the
    // size is applied by CSS alone: every entry would be the same number, and
    // every other test in this file would still be green.
    expect(new Set(asked).size).toBe(TERMINAL_FONT_SIZES.length);
    // Bigger type, fewer columns -- in that direction, not merely "different".
    expect([...asked].sort((a, b) => b - a)).toEqual(asked);
  });

  it('tells tmux nothing when the size is set to the one already in force', async () => {
    // The other half. A resize is a process spawned against somebody's live
    // session, so "the setting was written" must not be the trigger -- "the
    // cell count changed" is.
    const resize = vi.fn(async () => true);
    setActiveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={resize}
        send={undefined}
      />,
    );
    await settle();
    layoutDerived({ width: 800, height: 480 });
    await fire();
    expect(resize).toHaveBeenCalledTimes(1);

    await act(async () => {
      setActiveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    });
    await tick();
    expect(resize).toHaveBeenCalledTimes(1);
  });
});

describe('the narrowed width is eighty COLUMNS, not a number of pixels', () => {
  /**
   * The cap resolved to pixels, the way an engine resolves it.
   *
   * PARSED FROM THE SOURCE'S OWN EXPRESSION rather than restated: this repo
   * has paid four times for a width that existed in a module and again in a
   * test. Every term of `NARROW_TERMINAL_MAX_WIDTH` is read here, so a change
   * to the slack, the padding or the border moves this arithmetic with it.
   */
  const term = /^([\d.]+)(ch|rem|px)$/;
  const terms = (expr: string): readonly { readonly n: number; readonly unit: string }[] =>
    expr
      .replace(/^calc\(/, '')
      .replace(/\)$/, '')
      .split('+')
      .map((piece) => {
        const hit = term.exec(piece.trim());
        if (hit === null) throw new Error(`unreadable term in the cap: ${piece}`);
        return { n: Number(hit[1]), unit: hit[2] as string };
      });

  /** The root font size every `rem` in this app resolves against. */
  const REM = 16;
  /** Everything in the cap that is NOT cells: the pane's own padding and its
   *  1px border, which `measurePane` and `clientWidth` between them subtract
   *  again. The whole claim of the expression is that these cancel. */
  const chrome = terms(NARROW_TERMINAL_MAX_WIDTH)
    .filter((piece) => piece.unit !== 'ch')
    .reduce((sum, piece) => sum + (piece.unit === 'rem' ? piece.n * REM : piece.n), 0);
  const cells = terms(NARROW_TERMINAL_MAX_WIDTH).find((piece) => piece.unit === 'ch')?.n ?? 0;

  /**
   * Monospace advances, as a fraction of the em.
   *
   * THREE OF THEM, AND NOT ONE, because the whole point of writing the cap in
   * `ch` is that nothing here knows the ratio: `TerminalTab.tsx` records
   * 6.6015625px at 10.5px from one browser (0.6287), `e2e/view-width-shots.mjs`
   * measured 0.606 in the shipped bundle on another day, and the face is
   * whatever the platform actually resolved. A test pinned to one of those
   * numbers would be asserting the ratio rather than the arithmetic. What is
   * asserted is that the rounding slack holds across the range a monospace
   * face can plausibly land in -- which is the claim, and it is stronger than
   * any single measurement.
   */
  const ADVANCE_RATIOS = [0.55, 0.606, 6.6015625 / 10.5, 0.7];

  it('resolves to exactly eighty cells of content at every size the dialog offers', () => {
    // WHAT THIS REPLACES A BROWSER FOR. `ch` is the engine's own measurement
    // of one cell, so the cap scales with the text size on its own -- but the
    // CONTENT box is what `measurePane` divides, and `clientWidth` is an
    // INTEGER. An exact `80ch` lands a fraction short at some sizes and
    // `Math.floor` charges a whole column for it. The half cell in the
    // expression is what pays for that, and this is where the claim is
    // checked at all four sizes at once.
    for (const ratio of ADVANCE_RATIOS) {
      for (const size of TERMINAL_FONT_SIZES) {
        const advance = size * ratio;
        const borderBox = cells * advance + chrome;
        // `clientWidth` excludes the border and is rounded; `measurePane` then
        // subtracts the padding. Both are integers, so the two steps collapse.
        const content = Math.round(borderBox) - chrome;
        expect(Math.floor(content / advance), `${size}px at ${ratio}`).toBe(NARROW_MAX_CHARACTERS);
      }
    }
  });

  it('never buys an eighty-first column with its slack', () => {
    // The other direction, and the reason the slack is half a cell rather
    // than "some". A cap that rounded UP to 81 would be a promise of eighty
    // that the screen quietly breaks.
    for (const ratio of ADVANCE_RATIOS) {
      for (const size of TERMINAL_FONT_SIZES) {
        const advance = size * ratio;
        const content = Math.round(cells * advance + chrome) - chrome;
        expect(content / advance, `${size}px at ${ratio}`).toBeLessThan(NARROW_MAX_CHARACTERS + 1);
      }
    }
  });

  it('puts the cap on an element that is actually measured in cells', async () => {
    // THE MUTATION THIS CATCHES is the one that leaves every other assertion
    // green: `ch` resolves against the element's OWN font, so a cap moved onto
    // a box drawn in the app's sans face silently means the advance of a
    // proportional `0` -- 35% wider here -- and the "narrowed" terminal comes
    // out at 59 columns. The face and the size therefore travel WITH the cap,
    // and are asserted with it.
    setActiveNarrowViews(true);
    for (const size of TERMINAL_FONT_SIZES) {
      setActiveTerminalFontSize(size);
      render(
        <TerminalTab
          projectId={ATLAS}
          read={vi.fn(async () => ok())}
          resize={vi.fn(async () => true)}
          send={undefined}
        />,
      );
      await settle();
      const tab = q<HTMLElement>('[data-terminal]');
      expect(tab, `${size}px`).not.toBeNull();
      expect(tab?.style.maxWidth, `${size}px`).toBe(NARROW_TERMINAL_MAX_WIDTH);
      expect(tab?.className, `${size}px`).toContain('font-mono');
      expect(tab?.style.fontSize, `${size}px`).toBe(`${size}px`);
      cleanup();
    }
  });

  it('caps nothing while the operator has not asked for it', async () => {
    setActiveNarrowViews(false);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={vi.fn(async () => true)}
        send={undefined}
      />,
    );
    await settle();
    expect(q<HTMLElement>('[data-terminal]')?.style.maxWidth).toBe('');
  });

  it('keeps the tab’s own sentences in the reading face the cap borrowed the other from', async () => {
    // The cost of carrying `font-mono` for the sake of `ch`: every child that
    // does not declare a family inherits it. The pane and its status rule are
    // monospace anyway; these two are English sentences, and they say so.
    setActiveNarrowViews(true);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok('   '))}
        resize={vi.fn(async () => true)}
        send={undefined}
      />,
    );
    await settle();
    expect(q<HTMLElement>('[data-terminal-blank]')?.className).toContain('font-sans');
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
