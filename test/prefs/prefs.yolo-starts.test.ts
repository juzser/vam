/**
 * The persistent per-session Yolo indicator's own store.
 *
 * Recorded once, at session creation (`Canvas.tsx`'s `startSessionIn`), never
 * re-derived from the current `agentPermissions` pref -- these tests hold
 * that guarantee at the prefs layer: the mark survives a later change to the
 * live preference, is keyed by PANE (the identity that survives an
 * `unstarted` row becoming a real session, `Canvas.tsx`'s own `paneKey`
 * fallback), round-trips through storage, and is pruned by the same TTL
 * `renames`/`projectIcons` already use.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import {
  applyYoloStarts,
  EMPTY_PREFS,
  type Prefs,
  readPrefs,
  recordYoloStart,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');

function storage(seed?: string) {
  const map = new Map<string, string>();
  if (seed !== undefined) {
    map.set('vam.prefs.v1', seed);
  }
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    read: () => map.get('vam.prefs.v1') ?? null,
  };
}

function session(
  id: string,
  pane: string | null,
): CanvasModel['projects'][number]['sessions'][number] {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...(pane === null ? {} : { pane }),
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', 'vam-alpha-aa11bb'), session('a2', null)],
    },
  ],
};

describe('recordYoloStart', () => {
  it('stores the pane key under the source, with a timestamp', () => {
    const prefs = recordYoloStart(EMPTY_PREFS, 'claude-code', 'vam-alpha-aa11bb', NOW);
    expect(prefs.yoloStarts['claude-code']?.['vam-alpha-aa11bb']?.at).toBe(NOW.toISOString());
  });

  it('keeps two sources apart', () => {
    const both = recordYoloStart(
      recordYoloStart(EMPTY_PREFS, 'claude-code', 'p1', NOW),
      'codex',
      'p1',
      NOW,
    );
    expect(both.yoloStarts['claude-code']?.['p1']).toBeDefined();
    expect(both.yoloStarts['codex']?.['p1']).toBeDefined();
  });
});

describe('applyYoloStarts', () => {
  it('marks the session whose pane matches a recorded start', () => {
    const prefs = recordYoloStart(EMPTY_PREFS, 'claude-code', 'vam-alpha-aa11bb', NOW);
    const model = applyYoloStarts(MODEL, prefs.yoloStarts);
    expect(model.projects[0]?.sessions[0]?.startedWithYolo).toBe(true);
    expect(model.projects[0]?.sessions[1]?.startedWithYolo).toBeUndefined();
  });

  it('falls back to the session id when it has no pane', () => {
    const prefs = recordYoloStart(EMPTY_PREFS, 'claude-code', 'a2', NOW);
    const model = applyYoloStarts(MODEL, prefs.yoloStarts);
    expect(model.projects[0]?.sessions[1]?.startedWithYolo).toBe(true);
  });

  it('is a no-op, and returns the identical model, when nothing is recorded', () => {
    expect(applyYoloStarts(MODEL, {})).toBe(MODEL);
  });

  it("does not apply another source's recording to this project", () => {
    const prefs = recordYoloStart(EMPTY_PREFS, 'codex', 'vam-alpha-aa11bb', NOW);
    const model = applyYoloStarts(MODEL, prefs.yoloStarts);
    expect(model.projects[0]?.sessions[0]?.startedWithYolo).toBeUndefined();
  });
});

describe('the prefs round trip', () => {
  it('carries a recorded start through save and load', () => {
    const store = storage();
    writePrefs(store, recordYoloStart(EMPTY_PREFS, 'claude-code', 'vam-alpha-aa11bb', NOW));
    const loaded = readPrefs(store, NOW);
    expect(loaded.yoloStarts['claude-code']?.['vam-alpha-aa11bb']?.at).toBe(NOW.toISOString());
  });

  it('loads an OLD payload that has no yoloStarts field at all', () => {
    const store = storage(JSON.stringify({ icons: {}, theme: 'dark' }));
    const loaded: Prefs = readPrefs(store, NOW);
    expect(loaded.yoloStarts).toEqual({});
    expect(loaded.theme).toBe('dark');
  });

  it('drops an entry that is not a `{at}` object', () => {
    const store = storage(JSON.stringify({ yoloStarts: { 'claude-code': { p1: 'bare string' } } }));
    expect(readPrefs(store, NOW).yoloStarts['claude-code']).toBeUndefined();
  });

  it('prunes a recording older than the TTL, exactly as it prunes a rename', () => {
    const store = storage();
    writePrefs(store, recordYoloStart(EMPTY_PREFS, 'claude-code', 'p1', NOW));
    const muchLater = new Date(NOW.getTime() + 400 * 24 * 60 * 60 * 1000);
    expect(readPrefs(store, muchLater).yoloStarts['claude-code']).toBeUndefined();
  });
});
