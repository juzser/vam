// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setStatusBarShowClaudeUsage,
  setStatusBarShowCodexUsage,
  setStatusBarUsageMode,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  DEFAULT_STATUS_BAR_SHOW_CLAUDE_USAGE,
  DEFAULT_STATUS_BAR_SHOW_CODEX_USAGE,
  DEFAULT_USAGE_DISPLAY_MODE,
  readStatusBarShowClaudeUsage,
  readStatusBarShowCodexUsage,
  readUsageDisplayMode,
} from '../../src/renderer/prefs/status-bar-usage.js';

function fake(initial: string | null): StorageLike {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

const stored = (payload: Record<string, unknown>) => readPrefs(fake(JSON.stringify(payload)));

describe('defaults: Claude on, Codex off, mode used', () => {
  it('ships the documented defaults', () => {
    expect(DEFAULT_USAGE_DISPLAY_MODE).toBe('used');
    expect(DEFAULT_STATUS_BAR_SHOW_CLAUDE_USAGE).toBe(true);
    expect(DEFAULT_STATUS_BAR_SHOW_CODEX_USAGE).toBe(false);
    expect(EMPTY_PREFS.statusBarUsageMode).toBe('used');
    expect(EMPTY_PREFS.statusBarShowClaudeUsage).toBe(true);
    expect(EMPTY_PREFS.statusBarShowCodexUsage).toBe(false);
  });

  it('an absent key reads as the default for each of the three', () => {
    const empty = stored({});
    expect(empty.statusBarUsageMode).toBe('used');
    expect(empty.statusBarShowClaudeUsage).toBe(true);
    expect(empty.statusBarShowCodexUsage).toBe(false);
  });

  it('reads back stored choices', () => {
    expect(stored({ statusBarUsageMode: 'remaining' }).statusBarUsageMode).toBe('remaining');
    expect(stored({ statusBarShowClaudeUsage: false }).statusBarShowClaudeUsage).toBe(false);
    expect(stored({ statusBarShowCodexUsage: true }).statusBarShowCodexUsage).toBe(true);
  });

  it('an unreadable value falls back to the default, never the other word', () => {
    for (const raw of ['USED', 0, null]) {
      expect(readUsageDisplayMode(raw), JSON.stringify(raw)).toBe('used');
    }
    for (const raw of ['off', 0, null]) {
      expect(readStatusBarShowClaudeUsage(raw), JSON.stringify(raw)).toBe(true);
      expect(readStatusBarShowCodexUsage(raw), JSON.stringify(raw)).toBe(false);
    }
  });
});

describe('the setters', () => {
  it('normalise on the way in and touch nothing else', () => {
    const next = setStatusBarUsageMode({ ...EMPTY_PREFS, outFontSize: 15 }, 'remaining');
    expect(next.statusBarUsageMode).toBe('remaining');
    expect(next.outFontSize).toBe(15);
    expect(setStatusBarShowClaudeUsage(EMPTY_PREFS, false).statusBarShowClaudeUsage).toBe(false);
    expect(setStatusBarShowCodexUsage(EMPTY_PREFS, true).statusBarShowCodexUsage).toBe(true);
  });

  it('survive a round trip through storage', () => {
    const storage = fake(null);
    writePrefs(
      storage,
      setStatusBarShowCodexUsage(setStatusBarUsageMode(EMPTY_PREFS, 'remaining'), true),
    );
    const back = readPrefs(storage);
    expect(back.statusBarUsageMode).toBe('remaining');
    expect(back.statusBarShowCodexUsage).toBe(true);
  });
});
