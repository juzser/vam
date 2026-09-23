// @vitest-environment happy-dom

/**
 * `docs/design/vam-owns-the-session.md`'s trap, pinned with ONLY Claude Code
 * rows on the canvas -- no Codex project anywhere in the model.
 *
 * Before this fix, `codex/source.ts` was the only source that ever stamped
 * `Session.vamListingGap`, so every test proving `Canvas.tsx`'s stand-down
 * memo (the one right above the `entries` memo) actually fires had a Codex
 * row to reach for. On the operator's own machine Claude Code is the primary
 * source, and `docs/design/vam-owns-the-session.md` names the common case
 * this exists for: a GUI-launched vam whose non-UTF-8 `LC_CTYPE` makes
 * `listVamSessions` answer `unavailable` (`listing-unreadable`). This file
 * pins that a Claude-Code-only load reaches the same stand-down and the same
 * banner -- Canvas's memo reads `e.session.vamListingGap` generically, so
 * this is a regression guard on that genericity, not new behaviour.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

const GAP = { code: 'listing-unreadable', message: 'tmux rewrote its separators' } as const;

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id,
  title: id,
  epic: null,
  branch: null,
  status: 'done',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  vamListingGap: GAP,
  ...over,
});

/** One live row, one ended row and one foreign row -- every reason the two
 * default toggles would ordinarily hide something, all carrying the same
 * gap a single failed `listVamSessions` call would stamp on every row. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'claude-code:alpha',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        session('live-one'),
        session('ended-one', { ended: true, status: 'done' }),
        session('foreign-one', { vamControlled: false }),
      ],
    },
  ],
};

const rowIds = () =>
  [...document.querySelectorAll('[data-session-row]')]
    .map((el) => el.getAttribute('data-session-row') ?? '')
    .sort();

function openMenu() {
  const button = document.querySelector<HTMLButtonElement>('[data-filter-toggle]');
  if (button) fireEvent.click(button);
}

beforeAll(() => {
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a Claude-Code-only load whose own tmux listing failed', () => {
  it('shows the ended row and the foreign row too, both defaults standing down', () => {
    render(<Canvas model={MODEL} />);
    expect(rowIds()).toEqual(['ended-one', 'foreign-one', 'live-one']);
  });

  it('says why, in the filter popover, with no Codex row anywhere in the model', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    const gap = document.querySelector('[data-vam-listing-gap]');
    expect(gap?.textContent).toContain('tmux rewrote its separators');
  });
});
