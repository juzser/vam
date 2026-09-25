// @vitest-environment happy-dom

/**
 * THE SORT DEFAULT'S OWN ONE-TIME RATCHET -- `Prefs.sortByMigrated`'s header
 * carries the argument; `test/prefs/prefs.streaming-terminal.test.ts` is the
 * shape this borrows. UNLIKE that migration, `'needs-you'` was the only value
 * the OLD default could ever bake in, so a stored `'name'` is unambiguous
 * evidence of a real choice and is never disturbed, even before this ratchet
 * marks itself consumed -- `test/prefs/prefs.view-options.test.ts` already
 * pins that half and is untouched by this file.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_OPTIONS } from '../../src/renderer/domain/selectors.js';
import { EMPTY_PREFS, readPrefs, type StorageLike } from '../../src/renderer/prefs/prefs.js';

const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key: string) {
      return key === KEY ? this.value : null;
    },
    setItem(key: string, value: string) {
      if (key === KEY) this.value = value;
    },
  };
}

describe('readPrefs -- the sortBy default’s one-time migration', () => {
  it('a payload that predates the field entirely reads the NEW default (created)', () => {
    const prefs = readPrefs(fake(JSON.stringify({})));
    expect(prefs.viewOptions.sortBy).toBe('created');
  });

  it('an operator who never touched Sort by was still storing the OLD default (needs-you), baked in by any ordinary prefs write -- the migration cannot tell that apart from a real choice, so it moves them too, once', () => {
    const prefs = readPrefs(
      fake(JSON.stringify({ viewOptions: { groupBy: 'project', sortBy: 'needs-you' } })),
    );
    expect(prefs.viewOptions.sortBy).toBe('created');
  });

  it('an explicit choice of name, recorded before the migration ever ran, is NOT the ambiguous case and survives untouched', () => {
    const prefs = readPrefs(
      fake(JSON.stringify({ viewOptions: { groupBy: 'project', sortBy: 'name' } })),
    );
    expect(prefs.viewOptions.sortBy).toBe('name');
  });

  it('the migration marks itself consumed, so the operator can still choose needs-you afterwards and have THAT respected', () => {
    const storage = fake(
      JSON.stringify({ viewOptions: { groupBy: 'project', sortBy: 'needs-you' } }),
    );
    const first = readPrefs(storage);
    expect(first.viewOptions.sortBy).toBe('created');
    storage.setItem(KEY, JSON.stringify(first));
    // A later load of that SAME (now-migrated) payload must not force it a
    // second time -- the operator has not touched anything since.
    const second = readPrefs(storage);
    expect(second.viewOptions.sortBy).toBe('created');
  });

  it('an explicit needs-you, recorded AFTER the migration already ran once, is respected -- never forced back to created', () => {
    const prefs = readPrefs(
      fake(
        JSON.stringify({
          viewOptions: { groupBy: 'project', sortBy: 'needs-you' },
          sortByMigrated: true,
        }),
      ),
    );
    expect(prefs.viewOptions.sortBy).toBe('needs-you');
  });

  it('a truly empty payload (a fresh install) ships already migrated -- nothing left for the ratchet to do', () => {
    expect(EMPTY_PREFS.sortByMigrated).toBe(true);
    expect(EMPTY_PREFS.viewOptions).toEqual(DEFAULT_VIEW_OPTIONS);
  });
});
