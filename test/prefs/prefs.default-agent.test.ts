// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_DEFAULT, readDefaultAgent } from '../../src/renderer/prefs/default-agent.js';
import {
  EMPTY_PREFS,
  readPrefs,
  resolveDefaultAgentSelection,
  type StorageLike,
  setDefaultAgent,
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

describe('the default is auto -- today’s behaviour, unchanged', () => {
  it('ships auto, and an absent key reads as auto', () => {
    expect(DEFAULT_AGENT_DEFAULT).toBe('auto');
    expect(EMPTY_PREFS.defaultAgent).toBe('auto');
    expect(stored({}).defaultAgent).toBe('auto');
  });

  it('reads back the four stored words', () => {
    expect(stored({ defaultAgent: 'none' }).defaultAgent).toBe('none');
    expect(stored({ defaultAgent: 'claude-code' }).defaultAgent).toBe('claude-code');
    expect(stored({ defaultAgent: 'codex' }).defaultAgent).toBe('codex');
  });

  it('an unreadable value falls back to auto', () => {
    for (const raw of ['Auto', 0, null, {}, [], 'no-agent']) {
      expect(readDefaultAgent(raw), JSON.stringify(raw)).toBe('auto');
    }
  });
});

describe('the setter', () => {
  it('normalises on the way in and touches nothing else', () => {
    const next = setDefaultAgent({ ...EMPTY_PREFS, outFontSize: 15 }, 'codex');
    expect(next.defaultAgent).toBe('codex');
    expect(next.outFontSize).toBe(15);
  });

  it('survives a round trip through storage', () => {
    const storage = fake(null);
    writePrefs(storage, setDefaultAgent(EMPTY_PREFS, 'claude-code'));
    expect(readPrefs(storage).defaultAgent).toBe('claude-code');
  });
});

describe('resolveDefaultAgentSelection -- what StartSession/TerminalOnlyStart/GettingStarted seed their picker with', () => {
  it('auto resolves to whatever defaultProvider already names', () => {
    const prefs = setDefaultAgent({ ...EMPTY_PREFS, defaultProvider: 'codex' }, 'auto');
    expect(resolveDefaultAgentSelection(prefs)).toEqual({
      providerId: 'codex',
      preferNoAgent: false,
    });
  });

  it('a specific provider overrides defaultProvider outright', () => {
    const prefs = setDefaultAgent({ ...EMPTY_PREFS, defaultProvider: 'codex' }, 'claude-code');
    expect(resolveDefaultAgentSelection(prefs)).toEqual({
      providerId: 'claude-code',
      preferNoAgent: false,
    });
  });

  it('none resolves the picker to defaultProvider too, but flags preferNoAgent', () => {
    const prefs = setDefaultAgent({ ...EMPTY_PREFS, defaultProvider: 'codex' }, 'none');
    expect(resolveDefaultAgentSelection(prefs)).toEqual({
      providerId: 'codex',
      preferNoAgent: true,
    });
  });
});
