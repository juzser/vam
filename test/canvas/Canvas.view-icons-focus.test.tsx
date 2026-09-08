// @vitest-environment happy-dom

/**
 * The four view icons belong to the FOCUSED pane and to no other.
 *
 * Operator request: "Hide the four functions at the top-right; show them only
 * when that tab is focused." With several panes open the overlay repeated in
 * every one of them, four glyphs deep, over content that had nothing to do
 * with where the keyboard was.
 *
 * "Focused" is the PANE the canvas says is focused (`focusedPaneId`, the same
 * fact `data-split-focused` already paints), never hover: a mouse crossing a
 * background pane is not the keyboard moving there, and an icon row that
 * appeared under the pointer would draw in a pane whose Alt+digit does
 * nothing.
 *
 * HIDDEN MUST NOT MEAN UNREACHABLE. `ViewIcons` promises every icon is a real
 * button that Tab reaches and `aria-pressed` describes; this file pins that
 * the FOCUSED pane keeps all of that -- the icons are not drawn elsewhere,
 * never drawn-but-inert. The unsplit shell, which is the common case, is the
 * focused pane and keeps them.
 */

import { act, cleanup, render } from '@testing-library/react';
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
    decisions: [{ id: `d-${id}`, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] }],
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
  ],
};

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function pressChord(prefix: string, key: string) {
  press(prefix);
  press(key);
}

const panes = () => [...document.querySelectorAll('[data-split-pane]')];
const focusedPane = () => document.querySelector('[data-split-focused="true"]');
const iconsIn = (pane: Element | null | undefined) =>
  pane === null || pane === undefined ? [] : [...pane.querySelectorAll('[data-view]')];
const bars = () => [...document.querySelectorAll('[data-view-tabs]')];

describe('the view icons are drawn in the focused pane only', () => {
  it('an unsplit shell keeps them: one pane, and it is the focused one', () => {
    render(<Canvas model={MODEL} />);
    expect(panes()).toHaveLength(1);
    expect(bars()).toHaveLength(1);
    expect(iconsIn(panes()[0]).length).toBeGreaterThan(0);
  });

  it('a split draws exactly one bar, in the pane holding the keyboard', () => {
    render(<Canvas model={MODEL} />);
    const before = iconsIn(panes()[0]).length;
    pressChord('z', 'v');
    expect(panes()).toHaveLength(2);
    expect(bars()).toHaveLength(1);
    // In the focused pane, whole: hidden elsewhere is not fewer icons here.
    expect(iconsIn(focusedPane())).toHaveLength(before);
    const other = panes().find((pane) => pane !== focusedPane());
    expect(iconsIn(other)).toHaveLength(0);
  });

  it('follows the keyboard: zw moves focus and the icons move with it', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    const first = focusedPane()?.getAttribute('data-split-pane');
    pressChord('z', 'w');
    const second = focusedPane()?.getAttribute('data-split-pane');
    expect(second).not.toBe(first);
    expect(bars()).toHaveLength(1);
    expect(iconsIn(focusedPane()).length).toBeGreaterThan(0);
    expect(iconsIn(document.querySelector(`[data-split-pane="${first}"]`))).toHaveLength(0);
  });

  it('the focused pane keeps real, reachable buttons — not an inert row', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    const icons = iconsIn(focusedPane());
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.tagName).toBe('BUTTON');
      // Reachable by Tab, described to a screen reader, and not hidden from it.
      expect(icon.getAttribute('tabindex')).toBeNull();
      expect(icon.getAttribute('aria-hidden')).toBeNull();
      expect(icon.getAttribute('aria-pressed')).not.toBeNull();
      expect(icon.getAttribute('aria-label')).not.toBeNull();
    }
    expect(focusedPane()?.querySelector('[data-view-overlay]')).not.toBeNull();
  });
});
