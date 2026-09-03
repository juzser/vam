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

  it('takes only real booleans — garbage falls back per field, not wholesale', () => {
    const raw = '{"filters":{"hideAgentStarted":false,"onlyPrompted":"yes"}}';
    expect(readPrefs(store(raw)).filters).toEqual({ hideAgentStarted: false, onlyPrompted: false });
  });
});
