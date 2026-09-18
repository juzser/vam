// @vitest-environment happy-dom

/**
 * `f` ASKS FOR A LABEL, SO THE LABELS HAVE TO BE ON SCREEN.
 *
 * `jumpLabels` in `Canvas.tsx` built the map and handed it to nobody: it was
 * read inside the window key listener and by no component at all, so the whole
 * visible trace of jump mode was the status bar changing to `JUMP`. The
 * operator was being asked to type a label they could not see, which is not a
 * mode, it is a guess.
 *
 * What every case below is really pinning is the WIRING, and the third one is
 * the assertion that cannot be satisfied by a label that merely exists: it
 * reads the letter off a row and presses THAT, so the drawn label and the key
 * handler cannot drift apart. A test that pressed a hard-coded `s` would pass
 * over a badge painted on the wrong row.
 *
 * happy-dom, because these are drawn elements — but not layout: nothing here
 * asks where the badge sits, only which row wears which letter. Where it is
 * PAINTED (over the row, at a size that reads) is `e2e/mode-truth-shots.mjs`'s
 * to answer, because a jsdom rect is always zero.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

function decision(id: string, over: Partial<Decision> = {}): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [], ...over };
}

function session(id: string, over: Partial<Session> = {}): Session {
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
    decisions: [decision(`d-${id}`)],
    ...over,
  };
}

/** Every session `done`, so the status ranking cannot reorder them and the
 *  list is source order: a1, a2, b1. */
const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
    { id: 'p2', name: 'beta', source: 'claude-code', sessions: [session('b1')] },
  ],
};

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const badges = () => [...document.querySelectorAll('[data-jump-label]')];
/** The letter drawn on ONE row, or null when that row wears none. */
const labelOn = (id: string) =>
  document
    .querySelector(`[data-session-row="${id}"] [data-jump-label]`)
    ?.getAttribute('data-jump-label') ?? null;
const focusedRow = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.getAttribute('data-session-row') ?? null;
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';

describe('jump mode paints the labels it asks you to type', () => {
  it('draws none at rest', () => {
    render(<Canvas model={MODEL} />);
    expect(badges()).toHaveLength(0);
  });

  it('f puts a label on every row it can address, home row first', () => {
    render(<Canvas model={MODEL} />);
    press('f');
    expect(mode()).toBe('JUMP');
    // `JUMP_KEYS` is `asdfghjkl;qwertyuiop`, so three sessions take a, s, d in
    // the order the list ranks them.
    expect([labelOn('a1'), labelOn('a2'), labelOn('b1')]).toEqual(['a', 's', 'd']);
    expect(badges()).toHaveLength(3);
  });

  it('the letter a row wears is the key that jumps to it', () => {
    render(<Canvas model={MODEL} />);
    expect(focusedRow()).toBe('a1');
    press('f');
    // Read the label off the row rather than assuming it: this is the whole
    // point of drawing them, and a badge on the wrong row would pass every
    // other assertion in this file.
    const letter = labelOn('b1');
    expect(letter).not.toBeNull();
    press(letter as string);
    expect(focusedRow()).toBe('b1');
    expect(badges()).toHaveLength(0);
  });

  it('Escape takes them away again', () => {
    render(<Canvas model={MODEL} />);
    press('f');
    expect(badges()).toHaveLength(3);
    press('Escape');
    expect(badges()).toHaveLength(0);
    expect(focusedRow()).toBe('a1');
  });

  it('a key that labels nothing takes them away too — the refusal already said so', () => {
    render(<Canvas model={MODEL} />);
    press('f');
    press('z');
    expect(badges()).toHaveLength(0);
    expect(document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '').toContain(
      'nothing is labelled "z"',
    );
  });
});
