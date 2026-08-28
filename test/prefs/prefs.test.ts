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
  readPrefs,
  setIcon,
  setTheme,
  type StorageLike,
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
