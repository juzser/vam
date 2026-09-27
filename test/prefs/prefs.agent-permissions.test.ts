// @vitest-environment happy-dom

/**
 * SECURITY-SENSITIVE, and the tests read that way: every unreadable-value
 * case falls back to `manual`, never to `yolo` -- the one preference in this
 * tree whose safe direction and its "keep continuity with whatever was
 * stored" direction are NOT the same word.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_PERMISSIONS,
  readAgentPermissions,
} from '../../src/renderer/prefs/agent-permissions.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setAgentPermissions,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

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

describe('the default is manual, and every failure mode lands on manual too', () => {
  it('ships manual, and an absent key reads as manual', () => {
    expect(DEFAULT_AGENT_PERMISSIONS).toBe('manual');
    expect(EMPTY_PREFS.agentPermissions).toBe('manual');
    expect(stored({}).agentPermissions).toBe('manual');
  });

  it('reads back an explicit yolo, and only the literal word is one', () => {
    expect(stored({ agentPermissions: 'yolo' }).agentPermissions).toBe('yolo');
  });

  it('every unreadable value falls back to manual, not to yolo', () => {
    for (const raw of ['Yolo', 'YOLO', 1, true, null, {}, [], 'bypass']) {
      expect(readAgentPermissions(raw), JSON.stringify(raw)).toBe('manual');
      expect(stored({ agentPermissions: raw }).agentPermissions, JSON.stringify(raw)).toBe(
        'manual',
      );
    }
  });

  it('a corrupted payload (not JSON at all) still lands on manual', () => {
    expect(readPrefs(fake('{not json')).agentPermissions).toBe('manual');
  });
});

describe('the setter', () => {
  it('normalises on the way in and touches nothing else', () => {
    const next = setAgentPermissions({ ...EMPTY_PREFS, outFontSize: 15 }, 'yolo');
    expect(next.agentPermissions).toBe('yolo');
    expect(next.outFontSize).toBe(15);
    expect(setAgentPermissions(EMPTY_PREFS, 'nope').agentPermissions).toBe('manual');
  });

  it('survives a round trip through storage', () => {
    const storage = fake(null);
    writePrefs(storage, setAgentPermissions(EMPTY_PREFS, 'yolo'));
    expect(readPrefs(storage).agentPermissions).toBe('yolo');
  });
});
