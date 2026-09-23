/**
 * DISMISS: the fallback for a row Close may refuse forever.
 *
 * `docs/design/vam-owns-the-session.md` §5 promises Close never leaves an
 * undismissable row behind. `prefs.ts`'s own header records the first attempt
 * at this -- `dismissedSessions`, shipped in PR 248 with a store, three
 * helpers and a test file, and never called from anywhere real. This is the
 * second attempt, and the guarantees below are what makes it a real one: a
 * dismissal is stored keyed by the ROW (never the bare session id, so two
 * processes of one session id dismiss independently -- the same rule that
 * keeps a Claude Code row's identity `<sessionId>#<pid>`), it round-trips,
 * it is undoable, and it lifts itself the moment the row shows activity newer
 * than what vam saw when it was dismissed -- a resumed session is not the one
 * the operator asked to stop seeing.
 */

import { describe, expect, it } from 'vitest';
import {
  countDismissedSessions,
  EMPTY_PREFS,
  isSessionDismissed,
  type Prefs,
  readPrefs,
  restoreAllDismissedSessions,
  setSessionDismissed,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const NOW = new Date('2026-09-23T00:00:00.000Z');

function storage(seed?: string) {
  const map = new Map<string, string>();
  if (seed !== undefined) {
    map.set('vam.prefs.v1', seed);
  }
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('setSessionDismissed / isSessionDismissed', () => {
  it('is not dismissed until it is dismissed', () => {
    expect(isSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#111', null)).toBe(false);
  });

  it('reads back dismissed, activity unchanged since the dismissal', () => {
    const prefs = setSessionDismissed(
      EMPTY_PREFS,
      'claude-code',
      'a1#111',
      true,
      'Bash: tests',
      NOW,
    );
    expect(isSessionDismissed(prefs, 'claude-code', 'a1#111', 'Bash: tests')).toBe(true);
    // Still not reported by other sources, and not the operator's session.
    expect(isSessionDismissed(prefs, 'codex', 'a1#111', 'Bash: tests')).toBe(false);
  });

  it('un-dismisses on new activity: a resumed session is not the one that was hidden', () => {
    const prefs = setSessionDismissed(
      EMPTY_PREFS,
      'claude-code',
      'a1#111',
      true,
      'Bash: tests',
      NOW,
    );
    expect(isSessionDismissed(prefs, 'claude-code', 'a1#111', 'Bash: build')).toBe(false);
  });

  it('stays dismissed when activity drops to null -- that is silence, not news', () => {
    const prefs = setSessionDismissed(
      EMPTY_PREFS,
      'claude-code',
      'a1#111',
      true,
      'Bash: tests',
      NOW,
    );
    expect(isSessionDismissed(prefs, 'claude-code', 'a1#111', null)).toBe(true);
  });

  it('un-dismisses when the row had no activity at dismissal and gains one', () => {
    const prefs = setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#111', true, null, NOW);
    expect(isSessionDismissed(prefs, 'claude-code', 'a1#111', 'Bash: tests')).toBe(false);
  });

  it('undoes a dismissal outright, on request', () => {
    const dismissed = setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#111', true, null, NOW);
    const restored = setSessionDismissed(dismissed, 'claude-code', 'a1#111', false);
    expect(isSessionDismissed(restored, 'claude-code', 'a1#111', null)).toBe(false);
    expect(restored.dismissedSessions['claude-code']).toBeUndefined();
  });

  it('ROW-KEYED: two processes of one session id dismiss independently', () => {
    // The same conflation that once made Close kill the wrong tmux session --
    // `agents.ts`'s row key is `<sessionId>#<pid>`, never the bare id -- so
    // dismissing one process's row must never touch the other's.
    const prefs = setSessionDismissed(EMPTY_PREFS, 'claude-code', 'abc#111', true, null, NOW);
    expect(isSessionDismissed(prefs, 'claude-code', 'abc#111', null)).toBe(true);
    expect(isSessionDismissed(prefs, 'claude-code', 'abc#222', null)).toBe(false);
  });
});

describe('countDismissedSessions / restoreAllDismissedSessions', () => {
  it('counts across every source', () => {
    const prefs = setSessionDismissed(
      setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#111', true, null, NOW),
      'codex',
      'b2',
      true,
      null,
      NOW,
    );
    expect(countDismissedSessions(prefs)).toBe(2);
  });

  it('is zero on a fresh store', () => {
    expect(countDismissedSessions(EMPTY_PREFS)).toBe(0);
  });

  it('restoring all clears every source’s bucket at once', () => {
    const prefs = setSessionDismissed(
      setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#111', true, null, NOW),
      'codex',
      'b2',
      true,
      null,
      NOW,
    );
    const restored = restoreAllDismissedSessions(prefs);
    expect(countDismissedSessions(restored)).toBe(0);
    expect(isSessionDismissed(restored, 'claude-code', 'a1#111', null)).toBe(false);
    expect(isSessionDismissed(restored, 'codex', 'b2', null)).toBe(false);
  });
});

describe('the prefs round trip', () => {
  it('carries a dismissal through save and load', () => {
    const store = storage();
    const prefs = setSessionDismissed(
      EMPTY_PREFS,
      'claude-code',
      'a1#111',
      true,
      'Bash: tests',
      NOW,
    );
    writePrefs(store, prefs);
    const loaded = readPrefs(store, NOW);
    expect(isSessionDismissed(loaded, 'claude-code', 'a1#111', 'Bash: tests')).toBe(true);
  });

  it('loads an OLD payload that has no dismissedSessions field at all', () => {
    const store = storage(JSON.stringify({ theme: 'dark' }));
    const loaded: Prefs = readPrefs(store, NOW);
    expect(loaded.dismissedSessions).toEqual({});
    expect(loaded.theme).toBe('dark');
  });

  it('drops a dismissal entry that is not a `{at}` object', () => {
    const store = storage(
      JSON.stringify({ dismissedSessions: { 'claude-code': { 'a1#111': 'bare string' } } }),
    );
    expect(readPrefs(store, NOW).dismissedSessions['claude-code']).toBeUndefined();
  });

  it('is NOT pruned by the icon TTL -- a dismissal is a decision, like a hidden project', () => {
    const store = storage();
    writePrefs(store, setSessionDismissed(EMPTY_PREFS, 'claude-code', 'a1#111', true, null, NOW));
    const muchLater = new Date(NOW.getTime() + 400 * 24 * 60 * 60 * 1000);
    expect(isSessionDismissed(readPrefs(store, muchLater), 'claude-code', 'a1#111', null)).toBe(
      true,
    );
  });
});
