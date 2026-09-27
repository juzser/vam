// @vitest-environment happy-dom

/**
 * `applyAutoTabTitles` gates the title vam already derives from an agent's
 * own activity (Claude Code's `ai-title`, Codex's first-prompt preview line
 * -- both computed unconditionally in main, before this preference existed)
 * behind the operator's own switch. OFF replaces an un-renamed session's
 * title with its own id, content-free; a manual rename (`applyRenames`,
 * applied AFTER this one) always wins over either.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import {
  DEFAULT_AUTO_TAB_TITLES,
  readAutoTabTitles,
} from '../../src/renderer/prefs/auto-tab-titles.js';
import {
  applyAutoTabTitles,
  applyRenames,
  EMPTY_PREFS,
  setAutoTabTitles,
} from '../../src/renderer/prefs/prefs.js';

function session(id: string, title: string) {
  return {
    id,
    title,
    epic: null,
    branch: null,
    status: 'done' as const,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', 'fix the flaky test')],
    },
  ],
};

describe('the default is on -- both derivations already ship unconditionally', () => {
  it('ships on', () => {
    expect(DEFAULT_AUTO_TAB_TITLES).toBe(true);
    expect(EMPTY_PREFS.autoTabTitles).toBe(true);
  });

  it('reads back a stored choice, and only a boolean is a choice', () => {
    expect(readAutoTabTitles(false)).toBe(false);
    expect(readAutoTabTitles('off')).toBe(true);
  });
});

describe('applyAutoTabTitles', () => {
  it('leaves the derived title alone while on', () => {
    const next = applyAutoTabTitles(MODEL, true);
    expect(next.projects[0]?.sessions[0]?.title).toBe('fix the flaky test');
  });

  it('replaces an un-renamed title with the session id while off', () => {
    const next = applyAutoTabTitles(MODEL, false);
    expect(next.projects[0]?.sessions[0]?.title).toBe('a1');
  });

  it('returns the identical model reference while on -- no-op, not a copy', () => {
    expect(applyAutoTabTitles(MODEL, true)).toBe(MODEL);
  });

  it('a manual rename still wins over the neutral fallback', () => {
    const prefs = setAutoTabTitles(
      {
        ...EMPTY_PREFS,
        renames: { 'claude-code': { a1: { title: 'my name', at: '2026-01-01' } } },
      },
      false,
    );
    const neutralised = applyAutoTabTitles(MODEL, prefs.autoTabTitles);
    const renamed = applyRenames(neutralised, prefs.renames);
    expect(renamed.projects[0]?.sessions[0]?.title).toBe('my name');
  });
});
