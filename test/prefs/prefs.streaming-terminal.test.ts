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
  it('defaults off', () => {
    expect(DEFAULT_STREAMING_TERMINAL).toBe(false);
    expect(readStreamingTerminal(undefined)).toBe(false);
  });

  it('is total: only a literal true is on', () => {
    expect(readStreamingTerminal(true)).toBe(true);
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
});

describe('readPrefs', () => {
  it('defaults to off for a payload that predates the field', () => {
    const storage = fake(JSON.stringify({}));
    const prefs = readPrefs(storage);
    expect(prefs.streamingTerminal).toBe(false);
  });
});

describe('the active store', () => {
  it('starts at the default and moves only on a real change', () => {
    setActiveStreamingTerminal(DEFAULT_STREAMING_TERMINAL);
    let ticks = 0;
    const unsubscribe = subscribeStreamingTerminal(() => {
      ticks += 1;
    });
    setActiveStreamingTerminal(false);
    expect(ticks).toBe(0);
    setActiveStreamingTerminal(true);
    expect(activeStreamingTerminal()).toBe(true);
    expect(ticks).toBe(1);
    unsubscribe();
    setActiveStreamingTerminal(false);
    expect(ticks).toBe(1);
  });
});
