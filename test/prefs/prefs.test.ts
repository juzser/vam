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
import { DEFAULT_PANES, renderedWidth } from '../../src/renderer/prefs/panes.js';
import {
  applyIcons,
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setIcon,
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

function session(id: string, icon: string | null = null) {
  return {
    id,
    title: id,
    icon,
    epic: null,
    branch: null,
    status: 'done' as const,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

function model(icon: string | null = null): CanvasModel {
  return {
    projects: [{ id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1', icon)] }],
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
    const saved = setIcon(EMPTY_PREFS, 'black-smith', 'a1', '🛠', NOW);
    writePrefs(store, saved);
    expect(readPrefs(store, NOW)).toEqual(saved);
  });

  it('clearing an icon removes it rather than storing an empty one', () => {
    // An entry holding "" would render as an icon-shaped nothing and, worse,
    // would keep the session out of whatever the absent case does.
    const set = setIcon(EMPTY_PREFS, 'black-smith', 'a1', '🛠', NOW);
    expect(setIcon(set, 'black-smith', 'a1', '', NOW).icons).toEqual({});
  });
});

describe('AC-1: two sources sharing a session id do not share an icon', () => {
  it('setting the icon on one source leaves the other source untouched', () => {
    const twoSources: CanvasModel = {
      projects: [
        { id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('D-257')] },
        { id: 'p2', name: 'beta', source: 'orca', sessions: [session('D-257')] },
      ],
    };
    let prefs = setIcon(EMPTY_PREFS, 'black-smith', 'D-257', '🔥', NOW);
    prefs = setIcon(prefs, 'orca', 'D-257', '🌊', NOW);
    const out = applyIcons(twoSources, prefs.icons);
    const blackSmith = out.projects.find((p) => p.source === 'black-smith');
    const orca = out.projects.find((p) => p.source === 'orca');
    // Assert both independently: a shared-key store would make orca read
    // 'black-smith's last write and pass one of these while failing the other.
    expect(blackSmith?.sessions[0]?.icon).toBe('🔥');
    expect(orca?.sessions[0]?.icon).toBe('🌊');
  });
});

describe('putting icons on the model', () => {
  it('replaces the factory’s null with your choice', () => {
    const out = applyIcons(model(), {
      'black-smith': { a1: { icon: '🛠', at: NOW.toISOString() } },
    });
    expect(out.projects[0]?.sessions[0]?.icon).toBe('🛠');
  });

  it('leaves a session you never chose for alone', () => {
    const out = applyIcons(model(), {
      'black-smith': { other: { icon: '🛠', at: NOW.toISOString() } },
    });
    expect(out.projects[0]?.sessions[0]?.icon).toBeNull();
  });

  it('returns the same object when there is nothing to apply', () => {
    // Identity matters here: this feeds a useMemo whose result lays out the
    // whole canvas, and a new object every render would relayout every render.
    const before = model();
    expect(applyIcons(before, {})).toBe(before);
  });
});

describe('project icons: keyed (sourceId, projectId), the same idiom as session icons', () => {
  it('round-trips a project icon', () => {
    const saved = setProjectIcon(EMPTY_PREFS, 'black-smith', 'p1', '📦', NOW);
    expect(saved.projectIcons).toEqual({
      'black-smith': { p1: { icon: '📦', at: NOW.toISOString() } },
    });
  });

  it('clearing a project icon removes it rather than storing an empty one', () => {
    const set = setProjectIcon(EMPTY_PREFS, 'black-smith', 'p1', '📦', NOW);
    expect(setProjectIcon(set, 'black-smith', 'p1', '', NOW).projectIcons).toEqual({});
  });

  it('two sources sharing a project id do not share an icon', () => {
    let prefs = setProjectIcon(EMPTY_PREFS, 'black-smith', 'p1', '📦', NOW);
    prefs = setProjectIcon(prefs, 'orca', 'p1', '🐋', NOW);
    expect(prefs.projectIcons['black-smith']?.p1?.icon).toBe('📦');
    expect(prefs.projectIcons.orca?.p1?.icon).toBe('🐋');
  });

  it('applyIcons puts the stored project icon onto the model', () => {
    const prefs = setProjectIcon(EMPTY_PREFS, 'black-smith', 'p1', '📦', NOW);
    const out = applyIcons(model(), {}, prefs.projectIcons);
    expect(out.projects[0]?.icon).toBe('📦');
  });

  it('leaves a project with no source alone — never guesses which bucket to read', () => {
    const sourceless: CanvasModel = { projects: [{ id: 'p1', name: 'alpha', sessions: [] }] };
    const prefs = setProjectIcon(EMPTY_PREFS, 'black-smith', 'p1', '📦', NOW);
    const out = applyIcons(sourceless, {}, prefs.projectIcons);
    expect(out.projects[0]?.icon).toBeUndefined();
  });

  it('returns the same object when there is no icon and no project icon to apply', () => {
    const before = model();
    expect(applyIcons(before, {}, {})).toBe(before);
  });

  it('round-trips through storage alongside session icons and theme', () => {
    const store = fake();
    let prefs = setProjectIcon(EMPTY_PREFS, 'black-smith', 'p1', '📦', NOW);
    prefs = setIcon(prefs, 'black-smith', 'a1', '🛠', NOW);
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
      writePrefs(full, setIcon(EMPTY_PREFS, 'black-smith', 'a1', '🛠', NOW)),
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
        icons: {
          good: { icon: '🛠', at: NOW.toISOString() },
          empty: { icon: '', at: '…' },
        },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(Object.keys(out.icons['black-smith'] ?? {})).toEqual(['good']);
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
    expect(Object.keys(readPrefs(store, NOW).icons['black-smith'] ?? {})).toEqual(['recent']);
  });

  it('keeps an entry whose date it cannot read', () => {
    // "I cannot tell how old this is" is not a reason to throw away something
    // somebody arranged on purpose. Decision kept as-is from before AC-1: an
    // unparseable `at` never expires.
    const store = fake(JSON.stringify({ icons: { a1: { icon: '🛠', at: 'yesterday' } } }));
    expect(Object.keys(readPrefs(store, NOW).icons['black-smith'] ?? {})).toEqual(['a1']);
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
    expect(out.icons['black-smith']?.['s-1']?.icon).toBe('🔥');
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
    expect(out.icons).toEqual({}); // the stale icon is pruned away entirely, panes is not.
  });
});

describe('AC-1(b): a `/`-containing session id cannot reach another source', () => {
  it('a slash in the session id does not cross the source boundary', () => {
    let prefs = setIcon(EMPTY_PREFS, 'black-smith', 'vam-electron-shell/task-4', '🔧', NOW);
    prefs = setIcon(prefs, 'orca', 'vam-electron-shell/task-4', '🐙', NOW);
    expect(prefs.icons['black-smith']?.['vam-electron-shell/task-4']?.icon).toBe('🔧');
    expect(prefs.icons.orca?.['vam-electron-shell/task-4']?.icon).toBe('🐙');
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

  it('an icon set on a session literally named __proto__ survives a JSON round trip', () => {
    const prefs = setIcon(EMPTY_PREFS, 'black-smith', '__proto__', '🔥', NOW);
    const roundTripped = JSON.parse(JSON.stringify(prefs.icons));
    expect(Object.hasOwn(roundTripped['black-smith'] ?? {}, '__proto__')).toBe(true);
    expect(roundTripped['black-smith']['__proto__'].icon).toBe('🔥');
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
  it('a session literally named constructor round-trips (documentation, not a guard)', () => {
    const prefs = setIcon(EMPTY_PREFS, 'black-smith', 'constructor', '🐛', NOW);
    const roundTripped = JSON.parse(JSON.stringify(prefs.icons));
    expect(roundTripped['black-smith'].constructor.icon).toBe('🐛');
  });

  it('a source id literally named __proto__ survives the same round trip', () => {
    const prefs = setIcon(EMPTY_PREFS, '__proto__' as never, 'a1', '🔥', NOW);
    const roundTripped = JSON.parse(JSON.stringify(prefs.icons));
    expect(roundTripped['__proto__'].a1.icon).toBe('🔥');
  });

  it('the full store round trip (writePrefs then readPrefs) keeps a __proto__-named session', () => {
    const store = fake();
    const saved = setIcon(EMPTY_PREFS, 'black-smith', '__proto__', '🔥', NOW);
    writePrefs(store, saved);
    const out = readPrefs(store, NOW);
    expect(out.icons['black-smith']?.['__proto__']?.icon).toBe('🔥');
  });
});

describe('AC-3 & AC-4: migrating the pre-AC-1 flat shape', () => {
  it('AC-3: every glyph in a realistic multi-entry flat payload survives, on the same session', () => {
    const store = fake(
      JSON.stringify({
        icons: {
          'D-257': { icon: '🔥', at: NOW.toISOString() },
          'vam-electron-shell/task-4': { icon: '🔧', at: NOW.toISOString() },
          's-9': { icon: '📐', at: NOW.toISOString() },
        },
        theme: 'light',
      }),
    );
    const out = readPrefs(store, NOW);
    const bucket = out.icons['black-smith'] ?? {};
    expect(bucket['D-257']?.icon).toBe('🔥');
    expect(bucket['vam-electron-shell/task-4']?.icon).toBe('🔧');
    expect(bucket['s-9']?.icon).toBe('📐');
  });

  it('AC-4: migrated entries follow the resolved source, not a hardcoded literal', () => {
    const store = fake(
      JSON.stringify({ icons: { 'D-257': { icon: '🔥', at: NOW.toISOString() } } }),
    );
    const out = readPrefs(store, NOW, 'orca');
    expect(out.icons.orca?.['D-257']?.icon).toBe('🔥');
    expect(out.icons['black-smith']).toBeUndefined();
  });
});

describe('AC-5: the reader stays total', () => {
  it('never throws on garbage icons, and yields usable Prefs', () => {
    const store = fake(JSON.stringify({ icons: 'not an object' }));
    expect(() => readPrefs(store, NOW)).not.toThrow();
    expect(readPrefs(store, NOW).icons).toEqual({});
  });

  it('never throws on a half-written entry (only one of icon/at present)', () => {
    const store = fake(JSON.stringify({ icons: { a1: { icon: '🔥' } } }));
    expect(() => readPrefs(store, NOW)).not.toThrow();
    expect(readPrefs(store, NOW).icons).toEqual({});
  });

  it('an unknown source id in the new nested shape still loads without throwing', () => {
    const store = fake(
      JSON.stringify({
        icons: { 'a-future-source': { a1: { icon: '🔥', at: NOW.toISOString() } } },
      }),
    );
    expect(() => readPrefs(store, NOW)).not.toThrow();
    expect(readPrefs(store, NOW).icons['a-future-source']?.a1?.icon).toBe('🔥');
  });

  it('a payload holding both the old flat shape and the new nested shape at once merges cleanly', () => {
    // The operator-mid-upgrade case: one tab wrote the flat shape, another
    // already wrote the nested shape, to the same localStorage key.
    const store = fake(
      JSON.stringify({
        icons: {
          'D-257': { icon: '🔥', at: NOW.toISOString() }, // old flat entry
          orca: { 's-9': { icon: '🌊', at: NOW.toISOString() } }, // new nested bucket
        },
      }),
    );
    const out = readPrefs(store, NOW);
    expect(out.icons['black-smith']?.['D-257']?.icon).toBe('🔥');
    expect(out.icons.orca?.['s-9']?.icon).toBe('🌊');
  });
});

/**
 * The both-shapes case where the two shapes CONTEND for one key.
 *
 * The AC-5 test above uses distinct session ids, so the flat and nested
 * entries never touch each other -- it looks like it covers the merge and
 * does not. `migrateSource` is a real source id, so the migrated flat entry
 * and a genuine nested entry can name the SAME session under the SAME source.
 * That is what two tabs mid-upgrade produce, and an unconditional overwrite
 * loses one of the operator's choices to `Object.entries` order.
 */
describe('AC-5(b): both shapes contending for the same session id', () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it('keeps the later choice when the nested entry is newer', () => {
    const now = new Date(3_000_000);
    const raw = JSON.stringify({
      icons: {
        'D-257': { icon: 'older', at: iso(1_000_000) },
        'black-smith': { 'D-257': { icon: 'newer', at: iso(2_000_000) } },
      },
    });
    const got = readPrefs({ getItem: () => raw, setItem: () => {} }, now);
    expect(got.icons['black-smith']?.['D-257']?.icon).toBe('newer');
  });

  it('keeps the later choice when the MIGRATED flat entry is newer', () => {
    const now = new Date(3_000_000);
    const raw = JSON.stringify({
      icons: {
        'D-257': { icon: 'newer', at: iso(2_000_000) },
        'black-smith': { 'D-257': { icon: 'older', at: iso(1_000_000) } },
      },
    });
    const got = readPrefs({ getItem: () => raw, setItem: () => {} }, now);
    // Order-independent: the flat entry is read FIRST here and must still win.
    expect(got.icons['black-smith']?.['D-257']?.icon).toBe('newer');
  });

  it('prefers a readable date over an unreadable one', () => {
    const now = new Date(3_000_000);
    const raw = JSON.stringify({
      icons: {
        'D-257': { icon: 'unreadable', at: 'not-a-date' },
        'black-smith': { 'D-257': { icon: 'readable', at: iso(1_000_000) } },
      },
    });
    const got = readPrefs({ getItem: () => raw, setItem: () => {} }, now);
    expect(got.icons['black-smith']?.['D-257']?.icon).toBe('readable');
  });
});

describe('AC-6: TTL prunes per source', () => {
  it('falsifier: a stale entry under one source drops without touching a fresh one under another, same session id', () => {
    const store = fake(
      JSON.stringify({
        icons: {
          'black-smith': { 'D-257': { icon: '🔥', at: '2026-01-01T00:00:00.000Z' } }, // stale
          orca: { 'D-257': { icon: '🌊', at: '2026-08-20T00:00:00.000Z' } }, // fresh
        },
      }),
    );
    const out = readPrefs(store, NOW);
    // A single shared cutoff pass over one merged map would drop both or
    // neither; this asserts exactly one drops.
    expect(out.icons['black-smith']).toBeUndefined();
    expect(out.icons.orca?.['D-257']?.icon).toBe('🌊');
  });
});

describe('AC-7: theme and panes are not id-keyed maps', () => {
  // Checked by: `grep -n "Record<string" src/renderer/prefs/prefs.ts` — the
  // matches are `IconsBySession` (session or project id → IconChoice),
  // `Prefs['icons']` (source id → IconsBySession) and `Prefs['projectIcons']`
  // (source id → IconsBySession, the same idiom one level up, added by the
  // sidebar-flat project icon). `theme` is `Theme`, a string union; `panes`
  // is `{ sidebar: number; detail: number }`, a fixed two-field object.
  // Neither is keyed by anything id-shaped.
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
  it('an icon set on a demo session lands on that session and not the other demo source', () => {
    const prefs = setIcon(EMPTY_PREFS, 'black-smith', 'factory-sse-1', '🎯', NOW);
    const out = applyIcons(DEMO_MODEL, prefs.icons);
    const bs = out.projects.find((p) => p.id === 'black-smith');
    const vamProject = out.projects.find((p) => p.id === 'vam');
    expect(bs?.sessions.find((s) => s.id === 'factory-sse-1')?.icon).toBe('🎯');
    // vam's project is tagged 'orca' — an icon meant for the black-smith
    // bucket must not leak onto it even though DEMO_MODEL renders both at
    // once (AC-9's "must not move or vanish").
    expect(vamProject?.sessions[0]?.icon).not.toBe('🎯');
  });

  it('a demo-shaped read (both sources present) keeps each source’s icon independent', () => {
    let prefs = setIcon(EMPTY_PREFS, 'black-smith', 'factory-sse-1', '🎯', NOW);
    prefs = setIcon(prefs, 'orca', 'vam-build-1', '📌', NOW);
    const store = fake();
    writePrefs(store, prefs);
    const out = applyIcons(DEMO_MODEL, readPrefs(store, NOW).icons);
    expect(out.projects.find((p) => p.id === 'black-smith')?.sessions[0]?.icon).toBe('🎯');
    expect(out.projects.find((p) => p.id === 'vam')?.sessions[0]?.icon).toBe('📌');
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
