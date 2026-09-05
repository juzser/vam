// @vitest-environment happy-dom

/**
 * The line at the top of the pane that holds the keyboard.
 *
 * The operator asked to be able to see where the cursor is without hunting for
 * a focus ring, and since the two cursor modes shipped, that question is
 * load-bearing rather than cosmetic: which pane has the keyboard decides what
 * `hjkl` and `Mod+<digit>` do. So the line and the status word must never
 * disagree, and the way they are held to that here is not by comparing two
 * lists of expected strings — it is by asserting they move together off the
 * same state, in the same press.
 *
 * The line is drawn on every SHOWN column that the mode is drawn in: Select is
 * one cursor seen twice, in the sidebar row's ring and the canvas card's, so
 * both columns wear it; Insert is the response pane alone.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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
    decisions: [{ id: `${id}-d`, label: 'plan', input: 'in', output: 'out', commands: [] }],
  };
}

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1')] }],
};

const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
/** Which columns wear the line, named by the pane attribute they sit in. */
function edges(): string[] {
  const names = ['sidebar', 'canvas', 'action'];
  return names.filter(
    (name) => document.querySelector(`[data-${name}-pane] [data-focus-edge]`) !== null,
  );
}

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** `matches` answers every query, which is how reduced motion is simulated. */
function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeAll(() => stubMatchMedia(false));
afterEach(cleanup);

describe('the focused pane wears the line and the unfocused one does not', () => {
  it('draws it on the two columns Select is drawn in, and not on the response', () => {
    render(<Canvas model={MODEL} />);
    expect(edges()).toEqual(['sidebar', 'canvas']);
  });

  it('moves it to the response pane when the keyboard goes there', () => {
    render(<Canvas model={MODEL} />);
    press('I');
    expect(edges()).toEqual(['action']);
  });

  it('moves it back when the keyboard is handed back', () => {
    render(<Canvas model={MODEL} />);
    press('I');
    press('H');
    expect(edges()).toEqual(['sidebar', 'canvas']);
  });

  it('is decoration to a screen reader — the word carries the state', () => {
    render(<Canvas model={MODEL} />);
    const edge = document.querySelector('[data-focus-edge]');
    expect(edge?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the line and the status word cannot disagree', () => {
  it('agrees with the mode in force through every hand-over', () => {
    render(<Canvas model={MODEL} />);
    const seen: { word: string; panes: string[] }[] = [];
    seen.push({ word: mode(), panes: edges() });
    press('I');
    seen.push({ word: mode(), panes: edges() });
    press('H');
    seen.push({ word: mode(), panes: edges() });

    for (const { word, panes } of seen) {
      // One predicate, read twice. `Insert` is the response pane and nothing
      // else; `Select` is every shown column the list cursor is drawn in.
      expect(panes.includes('action')).toBe(word === 'Insert');
      expect(panes.includes('sidebar')).toBe(word === 'Select');
    }
  });
});

describe('reduced motion loses the sweep, not the indicator', () => {
  it('still draws the line when the operator asked for no motion', () => {
    stubMatchMedia(true);
    render(<Canvas model={MODEL} />);
    expect(edges()).toEqual(['sidebar', 'canvas']);
    stubMatchMedia(false);
  });

  it('suppresses only the travelling half in the stylesheet', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    // The sweep is a child pseudo-element over a resting line, so stopping the
    // child is the whole reduced-motion answer: the base rule keeps its own
    // background and the operator still learns where the keyboard is.
    expect(block).toContain('.vam-focus-edge::after');
    expect(/\.vam-focus-edge\s*\{/.test(block)).toBe(false);
    expect(/\.vam-focus-edge\s*\{[^}]*background:/.test(css)).toBe(true);
    // Once on arrival, not forever: permanent chrome that shimmers is motion in
    // the corner of the eye during every minute of reading.
    expect(/\.vam-focus-edge::after\s*\{[^}]*animation:[^;]*infinite/.test(css)).toBe(false);
  });
});

describe('the top line is the ONLY thing the response pane says it with', () => {
  // It shipped saying so twice: a left border AND the line. The operator's
  // word for the border was that it is wrong, and two indicators for one fact
  // is how they come to disagree -- so the border is gone in both states and
  // the pane keeps its ordinary 1px `line`, the same one every other column
  // draws. The amber this border wore before `focus-edge` is doubly gone.
  it('draws no left-border signal in either state, only the line', () => {
    render(<Canvas model={MODEL} />);
    const idle = document.querySelector('[data-action-pane]');
    expect(idle?.className).toContain('border-line');
    expect(idle?.className).not.toContain('border-l-2');

    press('I');
    const pane = document.querySelector('[data-action-pane="active"]');
    expect(pane).not.toBeNull();
    expect(pane?.className).not.toContain('border-l-2');
    expect(pane?.className).not.toContain('border-focus-edge');
    expect(pane?.className).not.toContain('border-waiting');
    // And with the border gone the line is now the whole signal, so it had
    // better be there.
    expect(pane?.querySelector('[data-focus-edge]')).not.toBeNull();
  });

  it('does not restate the mode as a tag in a second vocabulary', () => {
    render(<Canvas model={MODEL} />);
    press('I');
    // The pane wore an `ACTION` chip from before the modes were named. The
    // status bar says `Insert`, once; a tag saying `ACTION` beside it is the
    // same fact in a word the rest of the app stopped using.
    expect(document.querySelector('[data-action-pane]')?.textContent ?? '').not.toContain('ACTION');
  });

  it('keeps the two values the pane attribute has always reported', () => {
    render(<Canvas model={MODEL} />);
    expect(document.querySelector('[data-action-pane]')?.getAttribute('data-action-pane')).toBe(
      'idle',
    );
    press('I');
    expect(document.querySelector('[data-action-pane]')?.getAttribute('data-action-pane')).toBe(
      'active',
    );
  });
});
