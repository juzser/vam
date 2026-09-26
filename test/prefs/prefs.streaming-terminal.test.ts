// @vitest-environment happy-dom

/**
 * WHETHER THE TERMINAL TAB STREAMS: one stored boolean, and the store that
 * puts it in force -- the shape `test/prefs/prefs.terminal-font.test.ts`
 * already holds for a number.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setStreamingTerminal,
} from '../../src/renderer/prefs/prefs.js';
import {
  activeStreamingTerminal,
  DEFAULT_STREAMING_TERMINAL,
  readStreamingTerminal,
  setActiveStreamingTerminal,
  subscribeStreamingTerminal,
} from '../../src/renderer/prefs/streaming-terminal.js';

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

describe('readStreamingTerminal', () => {
  it('defaults on -- the shipping renderer now, not the beta', () => {
    expect(DEFAULT_STREAMING_TERMINAL).toBe(true);
  });

  it('is total: only a literal true is on', () => {
    expect(readStreamingTerminal(true)).toBe(true);
    expect(readStreamingTerminal(undefined)).toBe(false);
    expect(readStreamingTerminal('true')).toBe(false);
    expect(readStreamingTerminal(1)).toBe(false);
    expect(readStreamingTerminal(null)).toBe(false);
  });
});

describe('setStreamingTerminal', () => {
  it('writes the choice, disturbing no neighbour', () => {
    const next = setStreamingTerminal({ ...EMPTY_PREFS, conciseOutput: true }, true);
    expect(next.streamingTerminal).toBe(true);
    expect(next.conciseOutput).toBe(true);
  });

  it('an explicit off sticks, unaffected by the migration below', () => {
    const next = setStreamingTerminal(EMPTY_PREFS, false);
    expect(next.streamingTerminal).toBe(false);
  });
});

describe('readPrefs -- the one-time migration onto the new default', () => {
  it('a payload that predates the field entirely reads the NEW default (on)', () => {
    const storage = fake(JSON.stringify({}));
    const prefs = readPrefs(storage);
    expect(prefs.streamingTerminal).toBe(true);
  });

  it('an operator who never touched the setting was still storing the OLD default (off), baked in by any ordinary prefs write -- the migration cannot tell that apart from a real choice, so it moves them too, once', () => {
    const storage = fake(JSON.stringify({ streamingTerminal: false }));
    const prefs = readPrefs(storage);
    expect(prefs.streamingTerminal).toBe(true);
  });

  it('the migration marks itself consumed, so the operator can still turn it back off afterwards and have THAT respected', () => {
    const storage = fake(JSON.stringify({ streamingTerminal: false }));
    const first = readPrefs(storage);
    expect(first.streamingTerminal).toBe(true);
    storage.setItem('vam.prefs.v1', JSON.stringify(first));
    // A later load of that SAME (now-migrated) payload must not bump it a
    // second time -- the operator has not touched anything since.
    const second = readPrefs(storage);
    expect(second.streamingTerminal).toBe(true);
  });

  it('an explicit off, recorded AFTER the migration already ran once, is respected -- never bumped back on', () => {
    const storage = fake(
      JSON.stringify({ streamingTerminal: false, streamingTerminalMigrated: true }),
    );
    const prefs = readPrefs(storage);
    expect(prefs.streamingTerminal).toBe(false);
  });

  it('an explicit on, recorded after the migration, is unaffected either way', () => {
    const storage = fake(
      JSON.stringify({ streamingTerminal: true, streamingTerminalMigrated: true }),
    );
    const prefs = readPrefs(storage);
    expect(prefs.streamingTerminal).toBe(true);
  });
});

describe('the active store', () => {
  it('starts at the default and moves only on a real change', () => {
    setActiveStreamingTerminal(DEFAULT_STREAMING_TERMINAL);
    let ticks = 0;
    const unsubscribe = subscribeStreamingTerminal(() => {
      ticks += 1;
    });
    // The DEFAULT again -- not yet a change, whatever it currently is.
    setActiveStreamingTerminal(DEFAULT_STREAMING_TERMINAL);
    expect(ticks).toBe(0);
    setActiveStreamingTerminal(!DEFAULT_STREAMING_TERMINAL);
    expect(activeStreamingTerminal()).toBe(!DEFAULT_STREAMING_TERMINAL);
    expect(ticks).toBe(1);
    unsubscribe();
    setActiveStreamingTerminal(DEFAULT_STREAMING_TERMINAL);
    expect(ticks).toBe(1);
  });
});
