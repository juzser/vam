// @vitest-environment happy-dom

/**
 * The caret on the Terminal tab's screen, and the three answers that draw none.
 *
 * The operator's report was one sentence -- "I don't see the cursor in tmux" --
 * and what it costs is the thing a terminal exists to tell you: where the next
 * character goes. The tab had no answer to that at all, by design, until tmux
 * was asked (`sources/tmux/argv.ts`).
 *
 * WHAT IS PINNED HERE is the drawing decision and the three refusals. The
 * arithmetic that finds the cell has its own file
 * (`test/panels/terminal-cursor.test.ts`), because that is where it can be
 * silently wrong; what a DOM test can hold is that the mark reaches the
 * screen, that it is one cell, that it is on the right character of a coloured
 * line, and that `hidden` and `unreadable` put nothing on screen at all.
 *
 * WHAT NOTHING IN THIS REPO GUARDS, said here rather than left to be
 * discovered. jsdom cannot say where the mark LANDS in pixels, and there is no
 * e2e script for it either: the Terminal tab is unreachable in the web build
 * `e2e/run-web-guards.mjs` drives, because `terminalTab` in `Canvas.tsx` is
 * `source.kind === 'session' && capabilities.terminal` and the demo source is
 * neither of those. Offering the tab there would be a production change made
 * to enable a test, so it was not made.
 *
 * It WAS measured once, by hand, in headless Chromium against the real built
 * stylesheet, on markup dumped from this component rather than hand-written.
 * With the ruler's advance at 6.321875px, the caret's left edge sat 0.006px
 * from `pre.left + 6 * advance` on a line whose first run is red -- so it is
 * on the monospace grid cell tmux named and not on a byte of the capture. The
 * glyphs after it were undisturbed: the tail run began exactly one advance
 * later than the same line rendered unsplit, which is the single cell that
 * moved into the caret's own span and nothing else. `bg-ink`/`text-panel`
 * resolved to #ededed on #141414 in dark and #18181b on #ffffff in light, and
 * `animationName` was `none` in both. A number in a comment is not a guard,
 * and this one is labelled as what it is.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneCursor, PaneView } from '../../src/shared/terminal.js';

afterEach(cleanup);

const ATLAS = 'claude-code:atlas-11111111';
/** The escape byte, spelled rather than typed -- as `terminal-ansi.ts` does. */
const ESC = '\u001b';

const view = (text: string, cursor: PaneCursor): PaneView => ({
  kind: 'ok',
  name: 'vam-atlas-a1b2c3',
  text,
  cursor,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

async function open(text: string, cursor: PaneCursor) {
  const read = vi.fn(async () => view(text, cursor));
  render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
  await settle();
}

const cursors = () => [...document.querySelectorAll('[data-terminal-cursor]')];

describe('the cursor is drawn on the cell tmux named', () => {
  it('marks exactly one cell, and it is the character at that column', async () => {
    await open('$ ls\n', { kind: 'at', column: 2, row: 0 });
    expect(cursors()).toHaveLength(1);
    expect(cursors()[0]?.textContent).toBe('l');
  });

  it('marks the right character on a COLOURED line, where an index would not', async () => {
    // The line the operator actually looks at is coloured: an agent's prompt,
    // a diff, an error. `capture-pane -e` carries those as escape bytes that
    // occupy no cell, so a caret placed by string index walks left by four
    // characters per sequence. Here column 6 is the `o` of `ok`; raw index 6
    // is still inside `ERROR`.
    await open(`${ESC}[31mERROR${ESC}[0m ok\n`, { kind: 'at', column: 6, row: 0 });
    expect(cursors()).toHaveLength(1);
    expect(cursors()[0]?.textContent).toBe('o');
  });

  it('leaves the screen text exactly as tmux composed it', async () => {
    // Splitting a run to mark one cell must not add, drop or reorder a
    // character of somebody's terminal.
    await open(`${ESC}[31mERROR${ESC}[0m ok\n`, { kind: 'at', column: 2, row: 0 });
    expect(document.querySelector('[data-terminal-pane] pre')?.textContent).toBe('ERROR ok\n');
  });

  it('draws it on the second line when tmux says the second line', async () => {
    await open('one\ntwo\n', { kind: 'at', column: 1, row: 1 });
    expect(cursors()[0]?.textContent).toBe('w');
  });

  it('is a block that paints, not a class name that might not exist', async () => {
    // A rule that matched nothing has shipped in this project before, so the
    // assertion is on the classes the span actually carries. What they RESOLVE
    // to is measured in a real browser by the e2e guard; this is the half a
    // DOM test can hold.
    await open('$ ls\n', { kind: 'at', column: 2, row: 0 });
    const classes = cursors()[0]?.getAttribute('class') ?? '';
    expect(classes).toContain('bg-ink');
    expect(classes).toContain('text-panel');
  });

  it('does not blink, and the absence is the deliberate part', async () => {
    // The screen is a snapshot on a one-second poll, not a stream. An
    // animation is the one thing on this surface a person reads as "this is
    // happening now", and there is nothing live behind it to justify the
    // claim. No animate-* utility, ever.
    await open('$ ls\n', { kind: 'at', column: 2, row: 0 });
    expect(cursors()[0]?.getAttribute('class') ?? '').not.toMatch(/animate-|motion-/);
  });
});

describe('three answers draw no cursor at all', () => {
  it('draws none when the application hid it', async () => {
    // A pager, a spinner, a full-screen editor. tmux reports `cursor_flag` 0
    // and vam honours it rather than inventing a caret the program removed.
    await open('$ ls\n', { kind: 'hidden' });
    expect(cursors()).toHaveLength(0);
  });

  it('draws none -- NOT one at 0,0 -- when vam could not read it', async () => {
    // The defect family this repo names in `pull-requests.ts`: "no PRs" and
    // "vam could not ask" must never look the same. Here the wrong answer
    // would be a claim about where the operator's next keystroke lands.
    await open('$ ls\n', { kind: 'unreadable' });
    expect(cursors()).toHaveLength(0);
    // And specifically not on the first character.
    expect(document.querySelector('[data-terminal-pane]')?.textContent).toContain('$ ls');
  });

  it('draws none on a row the captured screen does not have', async () => {
    await open('one\ntwo\n', { kind: 'at', column: 0, row: 40 });
    expect(cursors()).toHaveLength(0);
  });
});
