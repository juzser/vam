/**
 * The two origin toggles are remembered, and their DEFAULTS are the shipped
 * answer to "what should a fresh browser show".
 *
 * Same treatment as `theme` and `panes`: stored, never pruned by the icon TTL
 * — a view preference is a fact about the person, not about a session that
 * stopped existing.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_FILTERS } from '../../src/renderer/domain/session-filter.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setSessionFilters,
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

describe('the session-origin filters, persisted', () => {
  it('ships hiding agent-made sessions and NOT restricting to what you prompted', () => {
    // Toggle A on: an agent-made session is noise by default. Toggle B off:
    // it would hide `dogfood-mcp-1` (379 events, no `user_prompt`), which is
    // real work — so it is a choice, never a default.
    expect(DEFAULT_SESSION_FILTERS).toEqual({ hideAgentStarted: true, onlyPrompted: false });
    expect(EMPTY_PREFS.filters).toEqual(DEFAULT_SESSION_FILTERS);
  });

  it('survives a write/read round trip', () => {
    const s = store();
    writePrefs(s, setSessionFilters(EMPTY_PREFS, { hideAgentStarted: false, onlyPrompted: true }));
    expect(readPrefs(s).filters).toEqual({ hideAgentStarted: false, onlyPrompted: true });
  });

  it('falls back to the defaults for a payload written before the field existed', () => {
    expect(readPrefs(store('{"theme":"light"}')).filters).toEqual(DEFAULT_SESSION_FILTERS);
  });

  it('leaves a pre-filters payload with every setting it had, plus the default', () => {
    // The migration decision: an operator who never expressed a choice about
    // origin filtering has no choice to preserve, so the shipped default
    // applies to them too -- an ABSENT key is unset, not "off". The popover
    // shows the rule in force and how many rows it holds back, so it is a
    // visible default rather than a silent one, and one click ends it. What
    // they DID choose survives untouched.
    const raw = JSON.stringify({
      theme: 'light',
      panes: { sidebar: 320, detail: 408 },
      collapsedProjects: { 'black-smith': ['p1'] },
    });
    const prefs = readPrefs(store(raw));
    expect(prefs.theme).toBe('light');
    expect(prefs.panes.sidebar).toBe(320);
    expect(prefs.collapsedProjects).toEqual({ 'black-smith': ['p1'] });
    expect(prefs.filters).toEqual(DEFAULT_SESSION_FILTERS);
  });

  it('never overrides a choice already stored -- an explicit `false` stays false', () => {
    const raw = '{"theme":"light","filters":{"hideAgentStarted":false,"onlyPrompted":true}}';
    expect(readPrefs(store(raw)).filters).toEqual({
      hideAgentStarted: false,
      onlyPrompted: true,
    });
  });

  it('takes only real booleans — garbage falls back per field, not wholesale', () => {
    const raw = '{"filters":{"hideAgentStarted":false,"onlyPrompted":"yes"}}';
    expect(readPrefs(store(raw)).filters).toEqual({ hideAgentStarted: false, onlyPrompted: false });
  });
});
