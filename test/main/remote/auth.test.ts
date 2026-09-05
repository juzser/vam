/**
 * Who a request is, under Tailscale.
 *
 * Tailscale authenticates a DEVICE ONTO A NETWORK; it does not authorise that
 * device to drive an agent. Every laptop, phone, tablet, server, CI runner and
 * shared-in external user on the tailnet can reach the Serve URL, so the
 * bearer token these tests exercise is the whole of the authorisation step.
 *
 * Nothing here reaches the network: every token is generated in-process and
 * the directory is a literal map.
 */

import { describe, expect, it } from 'vitest';
import {
  authenticateDevice,
  bearerFrom,
  constantTimeEquals,
  type DeviceDirectory,
  type Identity,
  MAX_TOKEN_LENGTH,
} from '../../../src/main/remote/auth.js';

const PHONE: Identity = { deviceId: 'd-1', name: 'a phone' };

const directory = (tokens: Record<string, Identity>): DeviceDirectory => ({
  find: (token) => tokens[token] ?? null,
});

const only = directory({ 'token-one': PHONE });

describe('bearerFrom', () => {
  it('reads the token out of an Authorization header', () => {
    expect(bearerFrom('Bearer token-one')).toBe('token-one');
  });

  it('accepts the scheme in any case, as RFC 7235 requires', () => {
    expect(bearerFrom('bearer token-one')).toBe('token-one');
  });

  it('refuses a header with no bearer scheme', () => {
    expect(bearerFrom('Basic dXNlcjpwYXNz')).toBeNull();
    expect(bearerFrom('token-one')).toBeNull();
  });

  it('refuses an absent or repeated header rather than picking one', () => {
    expect(bearerFrom(undefined)).toBeNull();
    expect(bearerFrom(['Bearer a', 'Bearer b'])).toBeNull();
  });

  it('refuses an oversized header before anything parses it', () => {
    expect(bearerFrom(`Bearer ${'a'.repeat(MAX_TOKEN_LENGTH + 1)}`)).toBeNull();
  });
});

describe('authenticateDevice', () => {
  it('names the device a valid token belongs to', () => {
    const outcome = authenticateDevice('Bearer token-one', only);
    expect(outcome).toEqual({ ok: true, identity: PHONE });
  });

  it('refuses a request that carries no credential at all', () => {
    expect(authenticateDevice(undefined, only)).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses a malformed header without consulting the directory', () => {
    let consulted = false;
    const watched: DeviceDirectory = {
      find: () => {
        consulted = true;
        return PHONE;
      },
    };
    expect(authenticateDevice('Basic nope', watched)).toEqual({ ok: false, reason: 'malformed' });
    expect(consulted).toBe(false);
  });

  it('refuses a forged token', () => {
    expect(authenticateDevice('Bearer token-two', only)).toEqual({
      ok: false,
      reason: 'unknown-device',
    });
  });

  it('refuses a token the directory no longer carries', () => {
    const revoked = directory({});
    expect(authenticateDevice('Bearer token-one', revoked)).toEqual({
      ok: false,
      reason: 'unknown-device',
    });
  });

  it('keeps its reasons to a closed vocabulary', () => {
    for (const header of [undefined, 'Basic x', 'Bearer nope', 'Bearer ']) {
      const outcome = authenticateDevice(header, only);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(['missing', 'malformed', 'unknown-device']).toContain(outcome.reason);
      }
    }
  });
});

describe('constantTimeEquals', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });

  it('compares strings of different lengths without throwing', () => {
    expect(constantTimeEquals('abc', 'abcdefghij')).toBe(false);
    expect(constantTimeEquals('', 'a')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });
});
