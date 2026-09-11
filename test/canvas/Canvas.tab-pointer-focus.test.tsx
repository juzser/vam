// @vitest-environment happy-dom

/**
 * Operator request: "when a tab is focused, the prompt input should be focused
 * too" — click a session, start typing, without first pressing `i`.
 *
 * Implemented literally it would take the keyboard away from a modal tool:
 * `zv`/`zs` split, `zw`/`zW` step panes, `x` closes, `o` opens, and every one
 * of those is a single letter that would be typed as TEXT the moment focus
 * always landed in the textarea. So the caret follows the ACTIVATION SOURCE,
 * and the source is carried as a fact rather than guessed: `UIEvent.detail` is
 * the click count, which the HTML spec fixes at 0 for the synthetic click a
 * keyboard activation (Enter/Space on a focused button) dispatches and at >= 1
 * for a real pointer press. `TabStrip` reads it once, at the only place that
 * knows, and hands `onSelect` a boolean.
 *
 * What this file pins is both halves of that rule, because only having both
 * makes it a rule rather than a behaviour: a pointer composes, and a chord
 * that changes the focused session does not.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
  ],
};

const tabSelect = (title: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-tab-select]')].find(
    (el) => el.textContent === title,
  ) as HTMLButtonElement;

const promptBox = () =>
  document.querySelector<HTMLTextAreaElement>('[data-split-pane] textarea') ??
  document.querySelector<HTMLTextAreaElement>('textarea');

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

afterEach(cleanup);

describe('a pointer activation means “I am here to type”', () => {
  it('puts the caret in the prompt box when a tab is CLICKED', () => {
    render(<Canvas model={MODEL} />);
    press('j'); // open a2's tab as well, keyboard-only so far
    act(() => {
      fireEvent.click(tabSelect('a1'), { detail: 1 });
    });
    const box = promptBox();
    expect(box).not.toBeNull();
    expect(box?.readOnly).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it('leaves the caret alone when the SAME handler is reached by keyboard', () => {
    // `detail: 0` is what a browser dispatches for Enter/Space on a focused
    // button. The tab still activates; the grammar keeps the keyboard.
    render(<Canvas model={MODEL} />);
    press('j');
    act(() => {
      fireEvent.click(tabSelect('a1'), { detail: 0 });
    });
    expect(document.activeElement).not.toBe(promptBox());
  });
});

describe('a chord that changes the focused session never steals the caret', () => {
  it('keeps single letters as commands after `j` walks the sidebar', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    expect(document.activeElement).not.toBe(promptBox());
  });

  it('keeps the caret out of the box when a split is stepped with `zw`', () => {
    render(<Canvas model={MODEL} />);
    press('z');
    press('v'); // split
    press('z');
    press('w'); // step panes
    expect(document.activeElement).not.toBe(promptBox());
  });
});

describe('there is still a way out of the box a click put you in', () => {
  it('hands the keyboard back after a pointer-composed tab click', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      fireEvent.click(tabSelect('a1'), { detail: 1 });
    });
    expect(document.activeElement).toBe(promptBox());
    act(() => {
      // `Mod-[`, not Escape: Escape in the composer is the agent's interrupt
      // now. A click can still put the keyboard in the box, so a key still has
      // to take it out.
      fireEvent.keyDown(promptBox() as Element, { key: '[', code: 'BracketLeft', metaKey: true });
    });
    expect(document.activeElement).not.toBe(promptBox());
  });
});
