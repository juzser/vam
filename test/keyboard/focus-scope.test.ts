// @vitest-environment happy-dom

/**
 * WHO OWNS THE KEYBOARD — the one fact, and the module that reads it.
 *
 * The cursor mode used to be a `useState` in `Canvas.tsx` that a handler set
 * beside whatever it did to DOM focus, which is two sources of truth about one
 * thing. Four audit findings came out of the gap between them, all the same
 * shape: the bar said Select while a read-only textarea still held focus and
 * swallowed `j`; `I` said Insert with nothing focused to insert into.
 *
 * `focus-scope.ts` is the answer: the mode is DERIVED from where focus is, so
 * there is nothing left to disagree with. This file holds the derivation to
 * its contract without a Canvas around it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  cursorModeAt,
  focusInsertStop,
  INSERT_SCOPE,
  INSERT_STOP,
  insertScopeOf,
  releaseInsert,
} from '../../src/renderer/keyboard/focus-scope.js';

/**
 * A pane with a question card and a composer in it, in the order the pane
 * draws them — the card above, the composer below. Document order IS the
 * landing order, which is what `focusInsertStop` leans on.
 */
function pane(options: { readonly question?: boolean; readonly composer?: boolean } = {}) {
  const root = document.createElement('div');
  root.setAttribute('data-split-pane', 'pane-1');
  if (options.question === true) {
    const bar = document.createElement('div');
    bar.setAttribute(INSERT_SCOPE, '');
    for (const label of ['Crimson', 'Cobalt']) {
      const button = document.createElement('button');
      button.setAttribute('data-question-option', '');
      button.textContent = label;
      bar.append(button);
    }
    root.append(bar);
  }
  if (options.composer === true) {
    const bar = document.createElement('div');
    bar.setAttribute(INSERT_SCOPE, '');
    const box = document.createElement('div');
    box.setAttribute(INSERT_STOP, '');
    box.tabIndex = -1;
    const area = document.createElement('textarea');
    box.append(area);
    bar.append(box);
    root.append(bar);
  }
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the mode is read off focus, never stored beside it', () => {
  it('is Select with nothing focused at all', () => {
    expect(cursorModeAt(null)).toBe('select');
    expect(cursorModeAt(document.body)).toBe('select');
  });

  it('is Select for an element outside every insert scope', () => {
    const row = document.createElement('button');
    document.body.append(row);
    expect(cursorModeAt(row)).toBe('select');
  });

  it('is Insert for anything INSIDE a scope, however deep', () => {
    const root = pane({ composer: true });
    const area = root.querySelector('textarea');
    expect(cursorModeAt(area)).toBe('insert');
    expect(cursorModeAt(root.querySelector(`[${INSERT_STOP}]`))).toBe('insert');
  });

  it('is Insert for the scope element itself, not only its descendants', () => {
    const root = pane({ question: true });
    expect(cursorModeAt(root.querySelector(`[${INSERT_SCOPE}]`))).toBe('insert');
  });

  it('names the scope an element belongs to, so a caller can act on it', () => {
    const root = pane({ question: true });
    const option = root.querySelector('[data-question-option]');
    expect(insertScopeOf(option)).toBe(root.querySelector(`[${INSERT_SCOPE}]`));
    expect(insertScopeOf(document.body)).toBeNull();
    expect(insertScopeOf(null)).toBeNull();
  });
});

/**
 * LEAVING INSERT IS A FOCUS MOVE, NOT A FLAG WRITE — audit F4 in one function.
 *
 * `Mod-0` used to set the flag and leave the read-only textarea holding DOM
 * focus, where the window listener's own typing guard then swallowed every
 * bare key. Releasing focus is what hands the keyboard back, and it is the
 * only thing that does.
 */
describe('releasing Insert', () => {
  it('blurs whatever is focused inside a scope and says it did', () => {
    const root = pane({ composer: true });
    const area = root.querySelector('textarea') as HTMLTextAreaElement;
    area.focus();
    expect(document.activeElement).toBe(area);
    expect(releaseInsert(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(area);
    expect(cursorModeAt(document.activeElement)).toBe('select');
  });

  it('leaves focus alone when it is already outside — and says so', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(releaseInsert(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it('is a no-op on nothing at all', () => {
    expect(releaseInsert(null)).toBe(false);
  });
});

/**
 * ENTERING INSERT IS ALSO A FOCUS MOVE, and it can FAIL — audit F5.
 *
 * A pane showing something with nothing to type into has no stop to land on,
 * and the honest answer is to say so rather than to set a flag that claims the
 * keyboard is somewhere it is not.
 */
describe('entering Insert', () => {
  it('lands on the question when one is open — the thing you came to act on', () => {
    const root = pane({ question: true, composer: true });
    expect(focusInsertStop(root)).toBe(true);
    expect(document.activeElement?.getAttribute('data-question-option')).toBe('');
    expect(document.activeElement?.textContent).toBe('Crimson');
  });

  it('lands on the prompt when no question is open', () => {
    const root = pane({ composer: true });
    expect(focusInsertStop(root)).toBe(true);
    expect((document.activeElement as HTMLElement).hasAttribute(INSERT_STOP)).toBe(true);
  });

  it('refuses, rather than lying, when the pane has no stop at all', () => {
    const root = pane();
    expect(focusInsertStop(root)).toBe(false);
    expect(cursorModeAt(document.activeElement)).toBe('select');
  });

  it('refuses on no pane at all', () => {
    expect(focusInsertStop(null)).toBe(false);
  });

  it('does not reach into ANOTHER pane for a stop', () => {
    // Two panes; the second holds the only question. Asking the first to enter
    // Insert must not steal the keyboard into the second — that is the failure
    // every arrangement of the digit row has found in some other form.
    const first = pane({});
    const second = pane({ question: true });
    expect(focusInsertStop(first)).toBe(false);
    expect(second.contains(document.activeElement)).toBe(false);
  });
});
