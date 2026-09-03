/**
 * `parseTokenFromSecurityOutput`: the pure half of the Keychain read, tested
 * without spawning `security`.
 */

import { describe, expect, it } from 'vitest';
import { parseTokenFromSecurityOutput } from '../../../src/main/usage/keychain.js';

describe('parseTokenFromSecurityOutput', () => {
  it('reads the token nested under claudeAiOauth.accessToken', () => {
    const blob = JSON.stringify({ claudeAiOauth: { accessToken: 'nested-token' } });
    expect(parseTokenFromSecurityOutput(blob)).toBe('nested-token');
  });

  it('falls back to a top-level accessToken', () => {
    const blob = JSON.stringify({ accessToken: 'top-level-token' });
    expect(parseTokenFromSecurityOutput(blob)).toBe('top-level-token');
  });

  it('returns null for empty output', () => {
    expect(parseTokenFromSecurityOutput('')).toBeNull();
  });

  it('returns null for output that is not JSON', () => {
    expect(parseTokenFromSecurityOutput('not json at all')).toBeNull();
  });

  it('returns null when neither location has a token', () => {
    expect(parseTokenFromSecurityOutput(JSON.stringify({ other: 'field' }))).toBeNull();
  });
});
