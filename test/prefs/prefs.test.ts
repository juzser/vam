/**
 * The store that holds what is yours rather than the factory's.
 *
 * Two concerns, and the second is most of the file: keeping the right thing,
 * and surviving everything a real `localStorage` can do to you — be missing,
 * throw on access, be full, or hold junk left by an older vam. None of that may
 * cost you the canvas.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CanvasModel } from '../../src/domain/model.js';
import { DEFAULT_PANES, renderedWidth } from '../../src/prefs/panes.js';
import {
  applyIcons,
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setIcon,
  setPaneWidth,
  setTheme,
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
  it('round-trips a theme', () => {
    const store = fake();
    const saved = setTheme(EMPTY_PREFS, 'light');
    writePrefs(store, saved);
    expect(readPrefs(store, NOW).theme).toBe('light');
  });

  it('round-trips an icon', () => {
    const store = fake();
    const saved = setIcon(EMPTY_PREFS, 'a1', '🛠', NOW);
    writePrefs(store, saved);
    expect(readPrefs(store, NOW)).toEqual(saved);
  });

  it('clearing an icon removes it rather than storing an empty one', () => {
    // An entry holding "" would render as an icon-shaped nothing and, worse,
    // would keep the session out of whatever the absent case does.
    const set = setIcon(EMPTY_PREFS, 'a1', '🛠', NOW);
    expect(setIcon(set, 'a1', '', NOW).icons).toEqual({});
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
    expect(() => writePrefs(full, setIcon(EMPTY_PREFS, 'a1', '🛠', NOW))).not.toThrow();
  });

  it('starts over on junk rather than guessing', () => {
    expect(readPrefs(fake('not json'), NOW)).toEqual(EMPTY_PREFS);
    expect(readPrefs(fake('"a string"'), NOW)).toEqual(EMPTY_PREFS);
    expect(readPrefs(fake('null'), NOW)).toEqual(EMPTY_PREFS);
  });

  it('drops the entries that are malformed and keeps the ones that are not', () => {
    const store = fake(
      JSON.stringify({
        icons: {
          good: { icon: '🛠', at: NOW.toISOString() },
          empty: { icon: '', at: '…' },
        },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(Object.keys(out.icons)).toEqual(['good']);
  });

  it('forgets what has gone stale, and keeps what has not', () => {
    const store = fake(
      JSON.stringify({
        icons: {
          old: { icon: '🛠', at: '2026-01-01T00:00:00.000Z' },
          recent: { icon: '🛠', at: '2026-08-20T00:00:00.000Z' },
        },
      }),
    );
    expect(Object.keys(readPrefs(store, NOW).icons)).toEqual(['recent']);
  });

  it('keeps an entry whose date it cannot read', () => {
    // "I cannot tell how old this is" is not a reason to throw away something
    // somebody arranged on purpose.
    const store = fake(JSON.stringify({ icons: { a1: { icon: '🛠', at: 'yesterday' } } }));
    expect(Object.keys(readPrefs(store, NOW).icons)).toEqual(['a1']);
  });
});

describe('AC-1: a payload written by the currently shipped version still loads', () => {
  // Exactly the shape today's shipped `writePrefs` emits: no `panes` key at
  // all. Real user data, sitting under the real key, on a real machine.
  const SHIPPED_PAYLOAD =
    '{"icons":{"s-1":{"icon":"🔥","at":"2026-08-20T00:00:00.000Z"}},"theme":"light"}';

  it('non-vacuity: the fixture has no panes key and a non-empty icons map', () => {
    expect(SHIPPED_PAYLOAD).not.toContain('panes');
    expect(Object.keys(JSON.parse(SHIPPED_PAYLOAD).icons).length).toBeGreaterThan(0);
  });

  it('loads theme, icons and a defaulted panes from the literal key vam.prefs.v1', () => {
    const store = fake();
    store.setItem('vam.prefs.v1', SHIPPED_PAYLOAD);
    const out = readPrefs(store, NOW);
    expect(out.theme).toBe('light');
    expect(out.icons['s-1']?.icon).toBe('🔥');
    expect(out.panes).toEqual(DEFAULT_PANES);
  });

  it('a first-time browser with no stored prefs at all renders at exactly 264/408', () => {
    expect(readPrefs(fake(), NOW).panes).toEqual({ sidebar: 264, detail: 408 });
  });

  it('round-trips all three fields through a real StorageLike write-then-read', () => {
    const store = fake();
    const saved = setPaneWidth(setTheme(EMPTY_PREFS, 'light'), 'sidebar', 300);
    writePrefs(store, saved);
    const out = readPrefs(store, NOW);
    expect(out.theme).toBe('light');
    expect(out.icons).toEqual({});
    expect(out.panes).toEqual({ sidebar: 300, detail: DEFAULT_PANES.detail });
  });
});

describe('readPanes is defensive on every field', () => {
  it('defaults when panes is absent', () => {
    expect(readPrefs(fake(JSON.stringify({ theme: 'light' })), NOW).panes).toEqual(DEFAULT_PANES);
  });

  it('defaults when panes is not an object', () => {
    expect(readPrefs(fake(JSON.stringify({ panes: 'wide' })), NOW).panes).toEqual(DEFAULT_PANES);
  });

  it('clamps a negative width rather than crashing', () => {
    const store = fake(JSON.stringify({ panes: { sidebar: -1, detail: 408 } }));
    expect(readPrefs(store, NOW).panes.sidebar).toBe(200);
  });

  it('clamps a number larger than any screen', () => {
    const store = fake(JSON.stringify({ panes: { sidebar: 264, detail: 1e9 } }));
    expect(readPrefs(store, NOW).panes.detail).toBe(640);
  });

  it('defaults a NaN-shaped (string) field', () => {
    const store = fake(JSON.stringify({ panes: { sidebar: 'wide', detail: 408 } }));
    expect(readPrefs(store, NOW).panes.sidebar).toBe(DEFAULT_PANES.sidebar);
  });

  it('panes is not pruned by the icons TTL', () => {
    const store = fake(
      JSON.stringify({
        panes: { sidebar: 300, detail: 500 },
        icons: { a1: { icon: '🛠', at: '2020-01-01T00:00:00.000Z' } },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(out.panes).toEqual({ sidebar: 300, detail: 500 });
    expect(out.icons).toEqual({}); // the stale icon is pruned; panes is not.
  });
});

describe('AC-2(c): clamping is render-time only, never a write', () => {
  it('a simulated viewport change calls renderedWidth without ever touching setItem', () => {
    const store = fake();
    const setItem = vi.spyOn(store, 'setItem');
    const saved = setPaneWidth(EMPTY_PREFS, 'sidebar', 300);
    writePrefs(store, saved);
    setItem.mockClear();
    const before = store.value;

    // Simulate a viewport change from wide to 700 (below the 880 floor)
    // and back, re-rendering through renderedWidth each time. Rendering
    // must never call writePrefs/setItem — only a drag end or chord does.
    for (const viewport of [1400, 700, 1400]) {
      renderedWidth('sidebar', saved.panes.sidebar, saved.panes.detail, viewport);
      renderedWidth('detail', saved.panes.detail, saved.panes.sidebar, viewport);
    }

    expect(setItem).not.toHaveBeenCalled();
    expect(store.value).toBe(before);
  });

  it('non-vacuity: a real setPaneWidth + writePrefs calls setItem exactly once', () => {
    const store = fake();
    const setItem = vi.spyOn(store, 'setItem');
    const saved = setPaneWidth(EMPTY_PREFS, 'sidebar', 300);
    writePrefs(store, saved);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});
