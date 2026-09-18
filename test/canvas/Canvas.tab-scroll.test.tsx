// @vitest-environment happy-dom

/**
 * The active tab must be ON SCREEN, and the strip must not move under a
 * pointer that is mid-press.
 *
 * Since every session of the active project is a tab of one pane, a project
 * with a dozen sessions overflows a split pane on first paint, and every
 * route that changes which tab is active could land on a tab scrolled out of
 * view while the strip stayed put.
 *
 * WHAT THIS FILE CANNOT SEE: happy-dom computes no layout, so whether the tab
 * ends up inside the scroller's box is `e2e/tab-strip-shots.mjs`'s question,
 * measured on a strip driven into real overflow. Pinned here is the wiring
 * that check depends on — that the element revealed is the NEWLY active tab
 * and not a stale one, and that a held pointer suppresses the call.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1'), session('a2'), session('a3')],
    },
  ],
};

type Reveal = { readonly title: string; readonly active: boolean; readonly options: unknown };

let revealed: Reveal[] = [];
const original = Element.prototype.scrollIntoView;

beforeEach(() => {
  revealed = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown) {
    const tab = this.closest('[data-session-tab]') ?? this;
    revealed.push({
      title: tab.querySelector('[data-tab-select]')?.textContent ?? '',
      active: tab.getAttribute('data-active') === 'true',
      options,
    });
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = original;
  cleanup();
});

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function fire(target: EventTarget, type: string) {
  act(() => {
    target.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

const strip = () => {
  const el = document.querySelector('[data-tab-strip]');
  if (el === null) throw new Error('no tab strip rendered');
  return el;
};

describe('the strip follows the active tab', () => {
  it('reveals the tab that just became active, not the one that was', () => {
    render(<Canvas model={MODEL} />);
    revealed = [];
    press('j'); // a1 -> a2
    press('j'); // a2 -> a3
    const last = revealed.at(-1);
    expect(last).toBeDefined();
    expect(last?.title).toBe('a3');
    expect(last?.active).toBe(true);
  });

  it('scrolls the least it can, on whichever axis the strip runs', () => {
    // `nearest` on BOTH axes is one call for the horizontal strip and the
    // `flex-col` vertical one alike: minimum movement on the axis with slack,
    // nothing on the other. `center` would jump a tab already in view.
    render(<Canvas model={MODEL} />);
    revealed = [];
    press('j');
    expect(revealed.at(-1)?.options).toEqual({ block: 'nearest', inline: 'nearest' });
  });

  it('holds still while a pointer is pressed on it, then follows again once released', () => {
    render(<Canvas model={MODEL} />);
    fire(strip(), 'pointerdown');
    revealed = [];
    press('j');
    expect(revealed).toEqual([]);

    fire(window, 'pointerup');
    press('j');
    expect(revealed.at(-1)?.title).toBe('a3');
  });
});
