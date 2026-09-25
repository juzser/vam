/**
 * The store that holds what is yours rather than the factory's.
 *
 * Two concerns, and the second is most of the file: keeping the right thing,
 * and surviving everything a real `localStorage` can do to you — be missing,
 * throw on access, be full, or hold junk left by an older vam. None of that may
 * cost you the canvas.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import { DEMO_MODEL } from '../../src/renderer/fixtures/demo.js';
import { DEFAULT_PANES, DETAIL_MAX, renderedWidth } from '../../src/renderer/prefs/panes.js';
import {
  applyProjectIcons,
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setPaneWidth,
  setProjectIcon,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

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

function session(id: string) {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done' as const,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

function model(): CanvasModel {
  return {
    projects: [{ id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] }],
  };
}

describe('remembering what you arranged', () => {
  it('round-trips a theme', () => {
    const store = fake();
    const saved = setTheme(EMPTY_PREFS, 'light');
    writePrefs(store, saved);
    expect(readPrefs(store, NOW).theme).toBe('light');
  });
});

/**
 * ONE ICON MAP, NOT TWO. A session-scoped twin of every case below used to sit
 * above it, under a `Prefs.icons` key. The operator removed session icons
 * outright once #433 left the picker writing where no surface read, so the
 * project bucket is the only one left -- and every property the pair shared
 * (two sources cannot collide, an empty pick clears, a hostile key survives a
 * round trip, the TTL prunes per source) is asserted here rather than lost
 * with the half that went.
 */
describe('project icons: keyed (sourceId, projectId)', () => {
  it('round-trips a project icon', () => {
    const saved = setProjectIcon(EMPTY_PREFS, 'factory', 'p1', '📦', NOW);
    expect(saved.projectIcons).toEqual({
      factory: { p1: { icon: '📦', at: NOW.toISOString() } },
    });
  });

  it('clearing a project icon removes it rather than storing an empty one', () => {
    const set = setProjectIcon(EMPTY_PREFS, 'factory', 'p1', '📦', NOW);
    expect(setProjectIcon(set, 'factory', 'p1', '', NOW).projectIcons).toEqual({});
  });

  it('two sources sharing a project id do not share an icon', () => {
    let prefs = setProjectIcon(EMPTY_PREFS, 'factory', 'p1', '📦', NOW);
    prefs = setProjectIcon(prefs, 'orca', 'p1', '🐋', NOW);
    expect(prefs.projectIcons['factory']?.p1?.icon).toBe('📦');
    expect(prefs.projectIcons.orca?.p1?.icon).toBe('🐋');
  });

  it('applyProjectIcons puts the stored project icon onto the model', () => {
    const prefs = setProjectIcon(EMPTY_PREFS, 'factory', 'p1', '📦', NOW);
    const out = applyProjectIcons(model(), prefs.projectIcons);
    expect(out.projects[0]?.icon).toBe('📦');
  });

  it('leaves a project you never chose for alone', () => {
    // Moved off the session map when that went: the "a stored entry for
    // something else must not land here" property is the same one, and it is
    // still worth an assertion of its own.
    const out = applyProjectIcons(model(), {
      factory: { other: { icon: '📦', at: NOW.toISOString() } },
    });
    expect(out.projects[0]?.icon).toBeUndefined();
  });

  it('leaves a project with no source alone — never guesses which bucket to read', () => {
    const sourceless: CanvasModel = { projects: [{ id: 'p1', name: 'alpha', sessions: [] }] };
    const prefs = setProjectIcon(EMPTY_PREFS, 'factory', 'p1', '📦', NOW);
    const out = applyProjectIcons(sourceless, prefs.projectIcons);
    expect(out.projects[0]?.icon).toBeUndefined();
  });

  it('returns the same object when there is no project icon to apply', () => {
    // Identity matters here: this feeds a useMemo whose result lays out the
    // whole canvas, and a new object every render would relayout every render.
    const before = model();
    expect(applyProjectIcons(before, {})).toBe(before);
  });

  it('round-trips through storage alongside theme', () => {
    const store = fake();
    const prefs = setTheme(setProjectIcon(EMPTY_PREFS, 'factory', 'p1', '📦', NOW), 'light');
    writePrefs(store, prefs);
    expect(readPrefs(store, NOW)).toEqual(prefs);
  });

  it('a malformed projectIcons payload is dropped rather than crashing the reader', () => {
    const store = fake(JSON.stringify({ projectIcons: 'not an object' }));
    expect(readPrefs(store, NOW).projectIcons).toEqual({});
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
    expect(() =>
      writePrefs(full, setProjectIcon(EMPTY_PREFS, 'factory', 'p1', '🛠', NOW)),
    ).not.toThrow();
  });

  it('starts over on junk rather than guessing', () => {
    expect(readPrefs(fake('not json'), NOW)).toEqual(EMPTY_PREFS);
    expect(readPrefs(fake('"a string"'), NOW)).toEqual(EMPTY_PREFS);
    expect(readPrefs(fake('null'), NOW)).toEqual(EMPTY_PREFS);
  });

  it('drops the entries that are malformed and keeps the ones that are not', () => {
    const store = fake(
      JSON.stringify({
        projectIcons: {
          factory: {
            good: { icon: '🛠', at: NOW.toISOString() },
            empty: { icon: '', at: '…' },
          },
        },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(Object.keys(out.projectIcons['factory'] ?? {})).toEqual(['good']);
  });

  it('forgets what has gone stale, and keeps what has not', () => {
    const store = fake(
      JSON.stringify({
        projectIcons: {
          factory: {
            old: { icon: '🛠', at: '2026-01-01T00:00:00.000Z' },
            recent: { icon: '🛠', at: '2026-08-20T00:00:00.000Z' },
          },
        },
      }),
    );
    expect(Object.keys(readPrefs(store, NOW).projectIcons['factory'] ?? {})).toEqual(['recent']);
  });

  it('keeps an entry whose date it cannot read', () => {
    // "I cannot tell how old this is" is not a reason to throw away something
    // somebody arranged on purpose. Decision kept as-is from before AC-1: an
    // unparseable `at` never expires.
    const store = fake(
      JSON.stringify({ projectIcons: { factory: { p1: { icon: '🛠', at: 'yesterday' } } } }),
    );
    expect(Object.keys(readPrefs(store, NOW).projectIcons['factory'] ?? {})).toEqual(['p1']);
  });
});

describe('AC-1: a payload written by the currently shipped version still loads', () => {
  // Exactly the shape today's shipped `writePrefs` emits: no `panes` key at
  // all. Real user data, sitting under the real key, on a real machine.
  const SHIPPED_PAYLOAD =
    '{"projectIcons":{"factory":{"p-1":{"icon":"🔥","at":"2026-08-20T00:00:00.000Z"}}},"theme":"light"}';

  it('non-vacuity: the fixture has no panes key and a non-empty icon map', () => {
    expect(SHIPPED_PAYLOAD).not.toContain('panes');
    expect(Object.keys(JSON.parse(SHIPPED_PAYLOAD).projectIcons).length).toBeGreaterThan(0);
  });

  it('loads theme, icons and a defaulted panes from the literal key vam.prefs.v1', () => {
    const store = fake();
    store.setItem('vam.prefs.v1', SHIPPED_PAYLOAD);
    const out = readPrefs(store, NOW);
    expect(out.theme).toBe('light');
    expect(out.projectIcons['factory']?.['p-1']?.icon).toBe('🔥');
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
    expect(out.projectIcons).toEqual({});
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
    expect(readPrefs(store, NOW).panes.detail).toBe(DETAIL_MAX);
  });

  it('defaults a NaN-shaped (string) field', () => {
    const store = fake(JSON.stringify({ panes: { sidebar: 'wide', detail: 408 } }));
    expect(readPrefs(store, NOW).panes.sidebar).toBe(DEFAULT_PANES.sidebar);
  });

  it('panes is not pruned by the icons TTL', () => {
    const store = fake(
      JSON.stringify({
        panes: { sidebar: 300, detail: 500 },
        projectIcons: { factory: { p1: { icon: '🛠', at: '2020-01-01T00:00:00.000Z' } } },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(out.panes).toEqual({ sidebar: 300, detail: 500 });
    // The stale icon is pruned away entirely, panes is not.
    expect(out.projectIcons).toEqual({});
  });
});

describe('AC-1(b): a `/`-containing id cannot reach another source', () => {
  it('a slash in the id does not cross the source boundary', () => {
    let prefs = setProjectIcon(EMPTY_PREFS, 'factory', 'vam-electron-shell/task-4', '🔧', NOW);
    prefs = setProjectIcon(prefs, 'orca', 'vam-electron-shell/task-4', '🐙', NOW);
    expect(prefs.projectIcons['factory']?.['vam-electron-shell/task-4']?.icon).toBe('🔧');
    expect(prefs.projectIcons.orca?.['vam-electron-shell/task-4']?.icon).toBe('🐙');
  });
});

describe('AC-2: a hostile key cannot forge, corrupt or vanish an entry', () => {
  it('falsifier: a bare {} accumulator loses a __proto__-keyed entry on a JSON round trip', () => {
    // This is the exact bug AC-2 rules out, reproduced without any prefs.ts
    // code: proof the risk is real, not a paper tiger.
    const bare: Record<string, unknown> = {};
    bare['__proto__'] = { icon: '🔥' };
    expect(Object.keys(bare)).toEqual([]); // not an own property
    expect(JSON.stringify(bare)).toBe('{}'); // gone on serialization
  });

  it('an icon set on a project literally named __proto__ survives a JSON round trip', () => {
    const prefs = setProjectIcon(EMPTY_PREFS, 'factory', '__proto__', '🔥', NOW);
    const roundTripped = JSON.parse(JSON.stringify(prefs.projectIcons));
    expect(Object.hasOwn(roundTripped['factory'] ?? {}, '__proto__')).toBe(true);
    expect(roundTripped['factory']['__proto__'].icon).toBe('🔥');
  });

  // NOT a falsifier, and labelled so nobody re-files it as one. AC-2 demands a
  // test that fails before the change; this one cannot, in either direction,
  // because `constructor` is not a loss hazard at all. `Object.prototype`
  // carries it as a WRITABLE DATA property, not an accessor, so
  // `bare['constructor'] = v` shadows it with a real own property that
  // serialises like any other — measured: `Object.keys` gives `['constructor']`
  // and `JSON.stringify` gives `{"constructor":{…}}`, whether the accumulator
  // is `Object.create(null)` or a bare `{}`. Contrast the `__proto__` falsifier
  // above, which is the only reserved key that actually vanishes.
  //
  // It is kept rather than deleted because the property it states is still one
  // a future edit could break — a store that sanitised keys by name, or
  // switched to a `Map` keyed by something clever, would fail it — and because
  // deleting it would invite someone to re-add it as the guard it is not.
  it('a project literally named constructor round-trips (documentation, not a guard)', () => {
    const prefs = setProjectIcon(EMPTY_PREFS, 'factory', 'constructor', '🐛', NOW);
    const roundTripped = JSON.parse(JSON.stringify(prefs.projectIcons));
    expect(roundTripped['factory'].constructor.icon).toBe('🐛');
  });

  it('a source id literally named __proto__ survives the same round trip', () => {
    const prefs = setProjectIcon(EMPTY_PREFS, '__proto__' as never, 'p1', '🔥', NOW);
    const roundTripped = JSON.parse(JSON.stringify(prefs.projectIcons));
    expect(roundTripped['__proto__'].p1.icon).toBe('🔥');
  });

  it('the full store round trip (writePrefs then readPrefs) keeps a __proto__-named project', () => {
    const store = fake();
    const saved = setProjectIcon(EMPTY_PREFS, 'factory', '__proto__', '🔥', NOW);
    writePrefs(store, saved);
    const out = readPrefs(store, NOW);
    expect(out.projectIcons['factory']?.['__proto__']?.icon).toBe('🔥');
  });
});

describe('the source id rename (black-smith -> factory) carries existing prefs forward', () => {
  // Real installs already have data keyed by the OLD id, in the CURRENT
  // (post-AC-1, nested) shape -- not the ancient flat shape `migrateSource`
  // exists for. A rename in code changes nothing already on disk, so without
  // an explicit migration this bucket would sit under a key nothing looks up
  // anymore: readable, present in `localStorage`, and permanently invisible.
  it('merges an old-id bucket with one already under the new id, newest write winning', () => {
    // Moved off the session bucket when that went. `migrateSourceKey` is
    // shared by every source-keyed field, so the newest-wins merge is still
    // load-bearing -- and it is the one rule here that a careless rewrite
    // would turn into "whichever `Object.entries` reached last".
    const store = fake(
      JSON.stringify({
        projectIcons: {
          'black-smith': {
            'p-1': { icon: '🔥', at: '2026-08-01T00:00:00.000Z' },
            'p-2': { icon: '📦', at: NOW.toISOString() },
          },
          factory: { 'p-1': { icon: '🛠', at: NOW.toISOString() } },
        },
      }),
    );
    const out = readPrefs(store, NOW);
    // p-1 exists under both; the newer write (factory's) wins.
    expect(out.projectIcons.factory?.['p-1']?.icon).toBe('🛠');
    // p-2 only exists under the old id; it survives the merge.
    expect(out.projectIcons.factory?.['p-2']?.icon).toBe('📦');
    expect(out.projectIcons['black-smith']).toBeUndefined();
  });

  it('carries a project icon, a rename, a fold, a hide, a group and the last-focus pointer', () => {
    const store = fake(
      JSON.stringify({
        projectIcons: { 'black-smith': { p1: { icon: '📦', at: NOW.toISOString() } } },
        renames: { 'black-smith': { s1: { title: 'renamed', at: NOW.toISOString() } } },
        collapsedProjects: { 'black-smith': ['p1'] },
        hiddenProjects: { 'black-smith': ['p2'] },
        collapsedGroups: { 'black-smith': ['g1'] },
        groups: { 'black-smith': [{ id: 'g1', name: 'alpha', projects: ['p1'] }] },
        lastFocus: { source: 'black-smith', session: 's1' },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(out.projectIcons.factory?.p1?.icon).toBe('📦');
    expect(out.renames.factory?.s1?.title).toBe('renamed');
    expect(out.collapsedProjects.factory).toEqual(['p1']);
    expect(out.hiddenProjects.factory).toEqual(['p2']);
    expect(out.collapsedGroups.factory).toEqual(['g1']);
    expect(out.groups.factory?.[0]?.id).toBe('g1');
    expect(out.lastFocus).toEqual({ source: 'factory', session: 's1' });
    expect(out.projectIcons['black-smith']).toBeUndefined();
    expect(out.renames['black-smith']).toBeUndefined();
    expect(out.collapsedProjects['black-smith']).toBeUndefined();
    expect(out.hiddenProjects['black-smith']).toBeUndefined();
    expect(out.collapsedGroups['black-smith']).toBeUndefined();
    expect(out.groups['black-smith']).toBeUndefined();
  });
});

describe('AC-5: the reader stays total', () => {
  it('never throws on garbage icons, and yields usable Prefs', () => {
    const store = fake(JSON.stringify({ projectIcons: 'not an object' }));
    expect(() => readPrefs(store, NOW)).not.toThrow();
    expect(readPrefs(store, NOW).projectIcons).toEqual({});
  });

  it('never throws on a half-written entry (only one of icon/at present)', () => {
    const store = fake(JSON.stringify({ projectIcons: { factory: { p1: { icon: '🔥' } } } }));
    expect(() => readPrefs(store, NOW)).not.toThrow();
    expect(readPrefs(store, NOW).projectIcons).toEqual({});
  });

  it('an unknown source id still loads without throwing', () => {
    const store = fake(
      JSON.stringify({
        projectIcons: { 'a-future-source': { p1: { icon: '🔥', at: NOW.toISOString() } } },
      }),
    );
    expect(() => readPrefs(store, NOW)).not.toThrow();
    expect(readPrefs(store, NOW).projectIcons['a-future-source']?.p1?.icon).toBe('🔥');
  });
});

describe('AC-6: TTL prunes per source', () => {
  it('falsifier: a stale entry under one source drops without touching a fresh one under another, same id', () => {
    const store = fake(
      JSON.stringify({
        projectIcons: {
          factory: { 'p-1': { icon: '🔥', at: '2026-01-01T00:00:00.000Z' } }, // stale
          orca: { 'p-1': { icon: '🌊', at: '2026-08-20T00:00:00.000Z' } }, // fresh
        },
      }),
    );
    const out = readPrefs(store, NOW);
    // A single shared cutoff pass over one merged map would drop both or
    // neither; this asserts exactly one drops.
    expect(out.projectIcons['factory']).toBeUndefined();
    expect(out.projectIcons.orca?.['p-1']?.icon).toBe('🌊');
  });
});

describe('AC-7: theme and panes are not id-keyed maps', () => {
  // Checked by: `grep -n "Record<string" src/renderer/prefs/prefs.ts` — the
  // matches are `IconsById` (project id → IconChoice) and
  // `Prefs['projectIcons']` (source id → IconsById, the same idiom one level
  // up). `theme` is `Theme`, a string union; `panes` is
  // `{ sidebar: number; detail: number }`, a fixed two-field object. Neither
  // is keyed by anything id-shaped.
  it('theme is a plain scalar union, not a keyed map', () => {
    const saved = setTheme(EMPTY_PREFS, 'light');
    expect(typeof saved.theme).toBe('string');
  });

  it('panes has exactly the two known keys, never a session id', () => {
    const saved = setPaneWidth(EMPTY_PREFS, 'sidebar', 300);
    expect(Object.keys(saved.panes).sort()).toEqual(['detail', 'sidebar']);
  });
});

describe('AC-9: the demo path', () => {
  it('an icon set on a demo project lands on it and not the other demo source', () => {
    const prefs = setProjectIcon(EMPTY_PREFS, 'factory', 'factory', '🎯', NOW);
    const out = applyProjectIcons(DEMO_MODEL, prefs.projectIcons);
    // vam's project is tagged 'orca' — an icon meant for the factory bucket
    // must not leak onto it even though DEMO_MODEL renders both at once
    // (AC-9's "must not move or vanish").
    expect(out.projects.find((p) => p.id === 'factory')?.icon).toBe('🎯');
    expect(out.projects.find((p) => p.id === 'vam')?.icon).not.toBe('🎯');
  });

  it('a demo-shaped read (both sources present) keeps each source’s icon independent', () => {
    let prefs = setProjectIcon(EMPTY_PREFS, 'factory', 'factory', '🎯', NOW);
    prefs = setProjectIcon(prefs, 'orca', 'vam', '📌', NOW);
    const store = fake();
    writePrefs(store, prefs);
    const out = applyProjectIcons(DEMO_MODEL, readPrefs(store, NOW).projectIcons);
    expect(out.projects.find((p) => p.id === 'factory')?.icon).toBe('🎯');
    expect(out.projects.find((p) => p.id === 'vam')?.icon).toBe('📌');
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

/**
 * THE VOCABULARY BOUNDARY, frozen by literal key name.
 *
 * A grouping layer above today's project makes "project" mean the OUTER thing
 * in the UI and the INNER thing in the code. That inversion is what makes
 * renaming the inner one look like a tidy-up, and these three keys are the
 * reason it is not: they are already sitting in `localStorage` on the
 * operator's disk under exactly these names. Rename a field and every existing
 * store reads the new key as absent -- which is not a crash and not a warning,
 * it is every project icon, every fold and every removal silently reverting to
 * a fresh install on the next launch.
 *
 * So the assertion is on the SERIALISED JSON, spelled out, rather than on the
 * `Prefs` type: a rename that carries its type and all its call sites along
 * with it still goes red here.
 */
describe('the stored project buckets are named, and stay named', () => {
  it('round-trips projectIcons, collapsedProjects and hiddenProjects by literal key', () => {
    const store = fake();
    const saved: typeof EMPTY_PREFS = {
      ...EMPTY_PREFS,
      projectIcons: { factory: { p1: { icon: '🎯', at: NOW.toISOString() } } },
      collapsedProjects: { factory: ['p1'] },
      hiddenProjects: { factory: ['p2'] },
    };
    writePrefs(store, saved);

    // The bytes, not the object: this is what a store written by today's vam
    // and read by tomorrow's actually contains.
    const stored = JSON.parse(store.value ?? '{}') as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(
      expect.arrayContaining(['projectIcons', 'collapsedProjects', 'hiddenProjects']),
    );
    expect(stored.collapsedProjects).toEqual({ factory: ['p1'] });
    expect(stored.hiddenProjects).toEqual({ factory: ['p2'] });

    const back = readPrefs(store, NOW);
    expect(back.projectIcons['factory']?.p1?.icon).toBe('🎯');
    expect(back.collapsedProjects['factory']).toEqual(['p1']);
    expect(back.hiddenProjects['factory']).toEqual(['p2']);
  });
});
