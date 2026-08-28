/**
 * The store that holds what is yours rather than the factory's.
 *
 * Two concerns, and the second is most of the file: keeping the right thing,
 * and surviving everything a real `localStorage` can do to you — be missing,
 * throw on access, be full, or hold junk left by an older vam. None of that may
 * cost you the canvas.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasModel } from '../../src/domain/model.js';
import {
  applyIcons,
  EMPTY_PREFS,
  movedFromHome,
  pin,
  pinDragged,
  readPrefs,
  type StorageLike,
  setIcon,
  unpinAll,
  writePrefs,
} from '../../src/prefs/prefs.js';

const KEY = 'vam.prefs.v1';
const NOW = new Date('2026-08-27T12:00:00.000Z');

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) {
        this.value = value;
      }
    },
  };
}

function model(icon: string | null = null): CanvasModel {
  return {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'black-smith',
        sessions: [
          {
            id: 'a1',
            title: 'a1',
            icon,
            epic: null,
            status: 'done',
            runningAgents: 0,
            activity: null,
            age: null,
            decisions: [],
          },
        ],
      },
    ],
  };
}

describe('remembering what you arranged', () => {
  it('round-trips a pin and an icon', () => {
    const store = fake();
    const saved = setIcon(pin(EMPTY_PREFS, 'info:a1', { x: 40, y: 12 }, NOW), 'a1', '🛠', NOW);
    writePrefs(store, saved);
    expect(readPrefs(store, NOW)).toEqual(saved);
  });

  it('keeps only the nodes you moved', () => {
    // Every node has a position; only a dragged one has a pin. That difference
    // is what lets auto-layout still re-rank everything else.
    const one = pin(EMPTY_PREFS, 'info:a1', { x: 1, y: 2 }, NOW);
    expect(Object.keys(one.pinned)).toEqual(['info:a1']);
  });

  it('gives the canvas back on unpinAll, without touching the icons', () => {
    const both = setIcon(pin(EMPTY_PREFS, 'info:a1', { x: 1, y: 2 }, NOW), 'a1', '🛠', NOW);
    const after = unpinAll(both);
    expect(after.pinned).toEqual({});
    expect(after.icons).toEqual(both.icons);
  });

  it('clearing an icon removes it rather than storing an empty one', () => {
    // An entry holding "" would render as an icon-shaped nothing and, worse,
    // would keep the session out of whatever the absent case does.
    const set = setIcon(EMPTY_PREFS, 'a1', '🛠', NOW);
    expect(setIcon(set, 'a1', '', NOW).icons).toEqual({});
  });
});

describe('telling a drag from a twitch', () => {
  it('a node put back where it was leaves no pin', () => {
    // A pin is what opts a node out of ever being re-ranked. Minting one for a
    // drag that changed nothing is the quietest way to break §3's ranking.
    expect(movedFromHome({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
    expect(movedFromHome({ x: 10.5, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });

  it('a node genuinely moved does', () => {
    expect(movedFromHome({ x: 40, y: 10 }, { x: 10, y: 10 })).toBe(true);
    expect(movedFromHome({ x: 10, y: 40 }, { x: 10, y: 10 })).toBe(true);
  });

  it('a node the layout no longer draws counts as moved', () => {
    // It has nothing to sort back into, so where the person left it is the only
    // answer there is.
    expect(movedFromHome({ x: 0, y: 0 }, undefined)).toBe(true);
  });
});

describe('what a finished drag changes', () => {
  const home = (id: string) => (id === 'info:a1' ? { x: 30, y: 34 } : { x: 30, y: 268 });

  it('pins the node that moved', () => {
    const after = pinDragged(
      EMPTY_PREFS,
      [{ id: 'info:a1', position: { x: 200, y: 90 } }],
      home,
      NOW,
    );
    expect(after.pinned['info:a1']).toEqual({ x: 200, y: 90, at: NOW.toISOString() });
  });

  it('pins every node of a multi-select drag', () => {
    const after = pinDragged(
      EMPTY_PREFS,
      [
        { id: 'info:a1', position: { x: 200, y: 90 } },
        { id: 'info:b1', position: { x: 210, y: 300 } },
      ],
      home,
      NOW,
    );
    expect(Object.keys(after.pinned).sort()).toEqual(['info:a1', 'info:b1']);
  });

  it('hands back the same object when nothing moved', () => {
    // The caller writes to localStorage only when this changes, so identity is
    // the signal: a drag that goes nowhere must touch no storage at all.
    const after = pinDragged(
      EMPTY_PREFS,
      [{ id: 'info:a1', position: { x: 30, y: 34 } }],
      home,
      NOW,
    );
    expect(after).toBe(EMPTY_PREFS);
  });

  it('re-pins a node that was already pinned, at its new place', () => {
    const once = pin(EMPTY_PREFS, 'info:a1', { x: 200, y: 90 }, NOW);
    const twice = pinDragged(once, [{ id: 'info:a1', position: { x: 400, y: 12 } }], home, NOW);
    expect(twice.pinned['info:a1']).toMatchObject({ x: 400, y: 12 });
  });
});

describe('putting icons on the model', () => {
  it('replaces the factory’s null with your choice', () => {
    const out = applyIcons(model(), { a1: { icon: '🛠', at: NOW.toISOString() } });
    expect(out.projects[0]?.sessions[0]?.icon).toBe('🛠');
  });

  it('leaves a session you never chose for alone', () => {
    const out = applyIcons(model(), { other: { icon: '🛠', at: NOW.toISOString() } });
    expect(out.projects[0]?.sessions[0]?.icon).toBeNull();
  });

  it('returns the same object when there is nothing to apply', () => {
    // Identity matters here: this feeds a useMemo whose result lays out the
    // whole canvas, and a new object every render would relayout every render.
    const before = model();
    expect(applyIcons(before, {})).toBe(before);
  });
});

describe('when localStorage misbehaves', () => {
  it('has no preferences at all when there is no storage', () => {
    expect(readPrefs(null, NOW)).toEqual(EMPTY_PREFS);
    expect(() => writePrefs(null, EMPTY_PREFS)).not.toThrow();
  });

  it('survives a storage that throws on read', () => {
    const angry: StorageLike = {
      getItem() {
        throw new Error('site data blocked');
      },
      setItem() {},
    };
    expect(readPrefs(angry, NOW)).toEqual(EMPTY_PREFS);
  });

  it('survives a storage that throws on write', () => {
    // Quota. The in-memory prefs still work for this session; only the memory
    // of them is lost, and that is not worth a crash.
    const full: StorageLike = {
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writePrefs(full, pin(EMPTY_PREFS, 'n', { x: 0, y: 0 }, NOW))).not.toThrow();
  });

  it('starts over on junk rather than guessing', () => {
    expect(readPrefs(fake('not json'), NOW)).toEqual(EMPTY_PREFS);
    expect(readPrefs(fake('"a string"'), NOW)).toEqual(EMPTY_PREFS);
    expect(readPrefs(fake('null'), NOW)).toEqual(EMPTY_PREFS);
  });

  it('drops the entries that are malformed and keeps the ones that are not', () => {
    const store = fake(
      JSON.stringify({
        pinned: {
          good: { x: 3, y: 4, at: NOW.toISOString() },
          noDate: { x: 3, y: 4 },
          notANumber: { x: 'left', y: 4, at: NOW.toISOString() },
        },
        icons: { good: { icon: '🛠', at: NOW.toISOString() }, empty: { icon: '', at: '…' } },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(Object.keys(out.pinned)).toEqual(['good']);
    expect(Object.keys(out.icons)).toEqual(['good']);
  });

  it('refuses a NaN coordinate, which would place a node nowhere', () => {
    // JSON has no NaN, but `{"x": null}` parses and `null` is not finite —
    // and a node at NaN simply does not draw.
    const store = fake(JSON.stringify({ pinned: { n: { x: null, y: 4, at: NOW.toISOString() } } }));
    expect(readPrefs(store, NOW).pinned).toEqual({});
  });

  it('forgets what has gone stale, and keeps what has not', () => {
    const store = fake(
      JSON.stringify({
        pinned: {
          old: { x: 1, y: 1, at: '2026-01-01T00:00:00.000Z' },
          recent: { x: 2, y: 2, at: '2026-08-20T00:00:00.000Z' },
        },
        icons: {},
      }),
    );
    expect(Object.keys(readPrefs(store, NOW).pinned)).toEqual(['recent']);
  });

  it('keeps an entry whose date it cannot read', () => {
    // "I cannot tell how old this is" is not a reason to throw away something
    // somebody arranged on purpose.
    const store = fake(JSON.stringify({ pinned: { n: { x: 1, y: 1, at: 'yesterday' } } }));
    expect(Object.keys(readPrefs(store, NOW).pinned)).toEqual(['n']);
  });
});
