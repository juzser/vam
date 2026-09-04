/**
 * Where the operator was, across a quit and a relaunch.
 *
 * WHAT THIS IS NOT FIXING. A tmux session vam started outlives vam -- the tmux
 * server is a separate process, and the project tag vam writes on the session
 * is still there when vam comes back (measured on a private `-L` socket:
 * `list-sessions -F` reports the user option after the creating client has
 * exited, and it survives a rename). vam re-reads its source on mount and
 * every poll, so the sessions themselves come back on their own. What does not
 * come back is the CURSOR: focus is React state seeded to `null`, so a
 * relaunch drops the operator on whichever card happens to sort first.
 *
 * So the stored thing is a SESSION, not a node. Node ids are derived from the
 * layout and change when the model, the filters or the fold state change; a
 * session id keyed by its source is the same identity `icons` and `renames`
 * already use, and it is what survives being re-laid-out.
 *
 * THE STALE POINTER IS THE INTERESTING CASE and it is pinned below: the
 * remembered session is exactly the one most likely to have ended while vam
 * was closed, and a resolver that answered `null` for it would hand the canvas
 * back the "nobody is pointing at anything" state the whole feature exists to
 * remove. It falls back to the first candidate -- what an unseeded launch
 * already does.
 */

import { describe, expect, it } from 'vitest';
import { resolveFocusNodeId } from '../../src/renderer/prefs/focus.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setLastFocus,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

function store(initial?: string): StorageLike {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
  };
}

const candidates = [
  { nodeId: 'n-alpha', source: 'black-smith', session: 'alpha' },
  { nodeId: 'n-beta', source: 'black-smith', session: 'beta' },
  { nodeId: 'n-beta-other', source: 'other-source', session: 'beta' },
];

describe('the remembered focus, persisted', () => {
  it('defaults to nothing remembered', () => {
    expect(EMPTY_PREFS.lastFocus).toBe(null);
  });

  it('survives a write/read round trip, by value', () => {
    const storage = store();
    writePrefs(storage, setLastFocus(EMPTY_PREFS, { source: 'black-smith', session: 'beta' }));
    expect(readPrefs(storage).lastFocus).toEqual({ source: 'black-smith', session: 'beta' });
  });

  it('restores focus to the remembered session on relaunch', () => {
    const storage = store();
    writePrefs(storage, setLastFocus(EMPTY_PREFS, { source: 'black-smith', session: 'beta' }));
    expect(resolveFocusNodeId(readPrefs(storage).lastFocus, candidates)).toBe('n-beta');
  });

  it('keys the memory by source, so two sources sharing a session id do not collide', () => {
    expect(resolveFocusNodeId({ source: 'other-source', session: 'beta' }, candidates)).toBe(
      'n-beta-other',
    );
  });

  it('lands on the first candidate when the remembered session is gone', () => {
    const storage = store();
    writePrefs(storage, setLastFocus(EMPTY_PREFS, { source: 'black-smith', session: 'ended' }));
    expect(resolveFocusNodeId(readPrefs(storage).lastFocus, candidates)).toBe('n-alpha');
  });

  it('lands on the first candidate when nothing was remembered at all', () => {
    expect(resolveFocusNodeId(null, candidates)).toBe('n-alpha');
  });

  it('answers null only when there is genuinely nothing to point at', () => {
    expect(resolveFocusNodeId({ source: 'black-smith', session: 'beta' }, [])).toBe(null);
    expect(resolveFocusNodeId(null, [])).toBe(null);
  });

  it('forgets the pointer when the operator focuses nothing', () => {
    expect(setLastFocus(EMPTY_PREFS, null).lastFocus).toBe(null);
  });
});

describe('the remembered focus, defended per field', () => {
  it('loads a payload written before the field existed, resetting nothing else', () => {
    const storage = store(
      JSON.stringify({
        theme: 'light',
        outFontSize: 17,
        hiddenProjects: { 'black-smith': ['p1'] },
      }),
    );
    const prefs = readPrefs(storage);
    expect(prefs.lastFocus).toBe(null);
    expect(prefs.theme).toBe('light');
    expect(prefs.outFontSize).toBe(17);
    expect(prefs.hiddenProjects).toEqual({ 'black-smith': ['p1'] });
  });

  it('drops a garbage value without taking a good sibling with it', () => {
    for (const garbage of [
      42,
      'beta',
      null,
      [],
      {},
      { source: 'black-smith' },
      { source: 7, session: 'beta' },
    ]) {
      const storage = store(
        JSON.stringify({ lastFocus: garbage, theme: 'light', outFontSize: 17 }),
      );
      const prefs = readPrefs(storage);
      expect(prefs.lastFocus).toBe(null);
      expect(prefs.theme).toBe('light');
      expect(prefs.outFontSize).toBe(17);
    }
  });
});
