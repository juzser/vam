/**
 * `parseTokenFromSecurityOutput`: the pure half of the Keychain read, tested
 * without spawning `security`.
 */

import { describe, expect, it } from 'vitest';
import {
  parseTokenFromSecurityOutput,
  readTokenFromKeychain,
} from '../../../src/main/usage/keychain.js';

describe('readTokenFromKeychain', () => {
  // The function returns null before it ever runs the command on a non-darwin
  // platform, so these would pass vacuously on CI (ubuntu) and meaningfully
  // only on a developer's Mac -- the worst of both. The platform is stubbed so
  // the assertions mean the same thing everywhere.
  const asDarwin = <T>(body: () => Promise<T>): Promise<T> => {
    const real = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    return body().finally(() => {
      if (real !== undefined) Object.defineProperty(process, 'platform', real);
    });
  };

  it('answers null when `security` fails rather than propagating the rejection', async () => {
    // The seam exists so the timeout has something to be tested through; this
    // pins the contract the timeout relies on -- every path settles.
    const run = () => Promise.reject(new Error('spawn security ENOENT'));
    await asDarwin(async () => {
      await expect(readTokenFromKeychain(run)).resolves.toBeNull();
    });
  });

  it('parses a token the runner returns', async () => {
    const run = () => Promise.resolve(JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }));
    await asDarwin(async () => {
      await expect(readTokenFromKeychain(run)).resolves.toBe('tok');
    });
  });

  it('does not run the command at all off darwin', async () => {
    let called = false;
    const run = () => {
      called = true;
      return Promise.resolve('{}');
    };
    const real = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      await expect(readTokenFromKeychain(run)).resolves.toBeNull();
      expect(called).toBe(false);
    } finally {
      if (real !== undefined) Object.defineProperty(process, 'platform', real);
    }
  });
});

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
