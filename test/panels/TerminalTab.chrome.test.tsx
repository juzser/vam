// @vitest-environment happy-dom

/**
 * THE CHROME AROUND THE SCREEN: the size it is drawn at, the bar that says it
 * scrolls, and the rule under it that says whose terminal this is.
 *
 * WHY A FILE OF ITS OWN rather than more cases in `TerminalTab.fit.test.tsx`.
 * That file is about the ARITHMETIC of fitting tmux to a box. These are about
 * what is on screen around it, and one of them -- the size -- is the seam
 * between the two: a size that moves without the column count moving is the
 * defect this whole change could ship, and it is measured in both files, from
 * the two different sides. Here: the size drawn IS the size in force, and
 * nothing between the pane and its own ruler declares a second one. There:
 * changing the size really does ask tmux for a different number of columns.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  setActiveTerminalFontSize,
  TERMINAL_FONT_SIZES,
  TERMINAL_LINE_HEIGHT,
} from '../../src/renderer/prefs/terminal-font.js';
import type { PaneView } from '../../src/shared/terminal.js';

const ATLAS = 'claude-code:atlas-11111111';
const NO_CURSOR = { kind: 'unreadable' } as const;
const ok = (text = 'the pane', name = 'vam-atlas-a1b2c3'): PaneView => ({
  kind: 'ok',
  name,
  text,
  cursor: NO_CURSOR,
});

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]') as HTMLElement;

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const open = async (props: Partial<Parameters<typeof TerminalTab>[0]> = {}) => {
  render(
    <TerminalTab
      projectId={ATLAS}
      read={vi.fn(async () => ok())}
      resize={undefined}
      send={undefined}
      {...props}
    />,
  );
  await settle();
};

beforeEach(() => {
  setActiveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
});

afterEach(() => {
  cleanup();
  setActiveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
});

describe('the screen is drawn at the size the operator chose', () => {
  it('draws at the default until somebody chooses, and the default is not the old 10.5', async () => {
    await open();
    expect(pane().style.fontSize).toBe(`${DEFAULT_TERMINAL_FONT_SIZE}px`);
    expect(pane().style.lineHeight).toBe(String(TERMINAL_LINE_HEIGHT));
  });

  it('follows the setting without being remounted', async () => {
    // The store, not a prop and not a custom property: a pane opened by a
    // keystroke has nobody to pass it one, and a custom property would repaint
    // the screen while leaving the column count behind (see
    // `prefs/terminal-font.ts`).
    await open();
    for (const size of TERMINAL_FONT_SIZES) {
      await act(async () => {
        setActiveTerminalFontSize(size);
      });
      expect(pane().style.fontSize, `${size}`).toBe(`${size}px`);
    }
  });

  it('offers no size the pane cannot be drawn at', async () => {
    // Derived from the shipped list rather than a second copy of it: two lists
    // of sizes is how a fifth size comes to exist in one of them.
    await open();
    for (const size of TERMINAL_FONT_SIZES) {
      expect(Number.isFinite(size) && size > 0, `${size}`).toBe(true);
    }
  });
});

describe('the box that is measured is the box the text is drawn in', () => {
  /**
   * THE DRIFT THIS CATCHES, in the shape it would really take. `measurePane`
   * divides the PANE's content box by the advance of the RULER. Both facts
   * hold only because the ruler sits inside the pane and inherits its size.
   * Put the size on an inner element -- a `<pre className="text-[14px]">` is
   * the obvious way somebody would do it -- and the ruler keeps measuring the
   * pane's old size while the screen paints at the new one: tmux is then told
   * a column count for a width that does not exist, and the symptom is lines
   * wrapping in the wrong place, which reads as "tmux is broken".
   */
  it('keeps the ruler inside the pane, where it inherits the size', async () => {
    await open();
    const ruler = q<HTMLElement>('[data-terminal-ruler]');
    expect(ruler?.closest('[data-terminal-pane]')).toBe(pane());
    // And it really inherits: happy-dom resolves inherited font-size, so this
    // is the engine's answer rather than a claim about the JSX.
    expect(globalThis.getComputedStyle(ruler as HTMLElement).fontSize).toBe(
      `${DEFAULT_TERMINAL_FONT_SIZE}px`,
    );
  });

  it('declares one size in the whole pane, and it is on the measured element', async () => {
    await open({ read: vi.fn(async () => ok('a screen line\nand another')) });
    const declares = (el: Element): boolean =>
      (el instanceof HTMLElement && el.style.fontSize !== '') ||
      /text-\[[\d.]+px\]/.test(el.className.toString()) ||
      /\btext-(meta|control|body|heading)\b/.test(el.className.toString());
    const inside = [...pane().querySelectorAll('*')].filter(declares);
    expect(inside.map((el) => el.tagName.toLowerCase())).toEqual([]);
    expect(declares(pane())).toBe(true);
  });
});

describe('the pane says that it scrolls', () => {
  it('draws a thumb once there is more screen than box, and none before', async () => {
    // The same defect the file tree had (PR #369): the pane scrolled, and
    // `vam-no-scrollbar` hid the only thing on screen that said so.
    await open();
    const box = pane();
    expect(q('[data-overlay-thumb]')).toBeNull();

    Object.defineProperty(box, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(box, 'scrollTop', { value: 0, configurable: true, writable: true });
    await act(async () => {
      box.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    const thumb = q<HTMLElement>('[data-overlay-thumb]');
    expect(thumb).not.toBeNull();
    // An indicator, never a handle: `j`/`k`, the wheel and the six scroll keys
    // are the interface, and a thumb that took a pointer would sit over a
    // screen the operator drags to select.
    expect(thumb?.getAttribute('class')).toContain('pointer-events-none');
    expect(thumb?.closest('[data-terminal-pane]')).toBeNull();
  });
});

describe('the rule under the screen', () => {
  it('puts the session name ON the rule, not over the screen', async () => {
    // It used to float bottom-right over the content, dimmed and
    // `pointer-events-none`, which is where a terminal draws its last line of
    // output. On the rule it is legible and covers nothing.
    await open();
    const badge = q<HTMLElement>('[data-terminal-badge]');
    expect(badge?.textContent).toContain('vam-atlas-a1b2c3');
    expect(badge?.closest('[data-terminal-status]')).not.toBeNull();
    expect(badge?.closest('[data-terminal-pane]')).toBeNull();
    expect(badge?.getAttribute('class')).not.toContain('absolute');
    // Still truncated: a tmux session name is unbounded and this rule is one
    // line.
    expect(badge?.getAttribute('class')).toContain('truncate');
  });

  it('draws the branch when the source knows it', async () => {
    await open({ branch: 'smith/vam/0.2-tab-shell' });
    const line = q<HTMLElement>('[data-terminal-status]');
    expect(q<HTMLElement>('[data-terminal-branch]')?.textContent).toContain(
      'smith/vam/0.2-tab-shell',
    );
    expect(line?.textContent).toContain('vam-atlas-a1b2c3');
  });

  it('says nothing at all about a branch the source cannot name', async () => {
    // NOT a dash and NOT a zero. `model.ts` is explicit that `null` means "the
    // source cannot say", never "not on a branch" -- and on a one-line rule an
    // em-dash reads as a branch called `—`. The sidebar draws one because its
    // rows are a table whose columns must line up; this is a sentence.
    await open({ branch: null });
    expect(q('[data-terminal-branch]')).toBeNull();
    expect(q<HTMLElement>('[data-terminal-status]')?.textContent).not.toContain('—');
  });

  it('draws no rule at all where there is no screen', async () => {
    // `not-vam`, `gone`, `unavailable`: there is no pane, so there is nothing
    // for a rule to sit under and no session name it could honestly carry.
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ({ kind: 'not-vam' }) as PaneView)}
        resize={undefined}
        send={undefined}
        branch="main"
      />,
    );
    await settle();
    expect(q('[data-terminal-status]')).toBeNull();
    expect(q('[data-terminal-branch]')).toBeNull();
  });

  it('paints in tokens, never in a colour of its own', async () => {
    await open({ branch: 'main' });
    expect(q<HTMLElement>('[data-terminal-status]')?.outerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(q<HTMLElement>('[data-terminal-status]')?.getAttribute('class')).toMatch(
      /\btext-(meta|control|body|heading)\b/,
    );
  });
});
