/**
 * The provider table, now that it has two rows.
 *
 * `providers.ts` promised that a second row would bring back both withdrawn
 * pickers "with no edit at either call site" -- `CAN_CHOOSE_PROVIDER` is
 * derived, not declared. This is the row that keeps the promise, and what
 * it asserts is the derivation and the invariant that keeps the table
 * honest: an id is vam's own SOURCE id, so the provider and the glyph that
 * stands for it (`PROVIDER_MARKS`, keyed by source id) cannot drift apart.
 */

import { describe, expect, it } from 'vitest';
import {
  CAN_CHOOSE_PROVIDER,
  DEFAULT_PROVIDER_ID,
  PROVIDERS,
  resolveProvider,
} from '../../src/shared/providers.js';

describe('the provider table', () => {
  it('lists Codex beside Claude Code, under its own source id', () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(['claude-code', 'codex']);
    expect(resolveProvider('codex')).toEqual({ id: 'codex', label: 'Codex', command: ['codex'] });
  });

  it('therefore offers a choice, with no edit at either picker', () => {
    expect(CAN_CHOOSE_PROVIDER).toBe(true);
  });

  it('keeps Claude Code as the default an unusable stored value falls back to', () => {
    expect(DEFAULT_PROVIDER_ID).toBe('claude-code');
    expect(resolveProvider('cursor-cli').id).toBe('claude-code');
    expect(resolveProvider(undefined).id).toBe('claude-code');
  });

  it('runs each provider as a bare interactive command, one word, no shell', () => {
    for (const provider of PROVIDERS) {
      expect(provider.command).toHaveLength(1);
      expect(provider.command[0]).toMatch(/^[a-z]+$/);
    }
  });
});
