/**
 * The identity layer, asserted against real RS256 signatures.
 *
 * Every key pair here is generated in-process: a token in a fixture is a token
 * in a public repository, and this file is exactly where a real one would be
 * pasted. Nothing reaches the network -- Cloudflare's key set is a parameter,
 * not a fetch.
 */

import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { type AccessAuth, verifyAccessToken } from '../../../src/main/remote/auth.js';

const AUDIENCE = 'test-audience-tag';
const ISSUER = 'https://example.test';

const b64 = (value: object | Buffer): string =>
  (value instanceof Buffer ? value : Buffer.from(JSON.stringify(value))).toString('base64url');

function sign(
  key: KeyObject,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const body = `${b64(header)}.${b64(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  return `${body}.${signer.sign(key).toString('base64url')}`;
}

let auth: AccessAuth;
let privateKey: KeyObject;
let otherKey: KeyObject;

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  aud: [AUDIENCE],
  iss: ISSUER,
  exp: Math.floor(Date.now() / 1000) + 600,
  email: 'operator@example.test',
  ...over,
});

const header = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  alg: 'RS256',
  kid: 'key-one',
  ...over,
});

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  otherKey = second.privateKey;
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key-one' };
  auth = { audience: AUDIENCE, issuer: ISSUER, keys: async () => [jwk] };
});

describe('verifyAccessToken', () => {
  it('accepts a token signed by a key in the set and returns the identity', async () => {
    const outcome = await verifyAccessToken(sign(privateKey, header(), claims()), auth);
    expect(outcome).toEqual({ ok: true, identity: { email: 'operator@example.test' } });
  });

  it('refuses a token signed by a key that is not in the set', async () => {
    const outcome = await verifyAccessToken(sign(otherKey, header(), claims()), auth);
    expect(outcome).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a token whose payload was edited after signing', async () => {
    const token = sign(privateKey, header(), claims());
    const [head, , signature] = token.split('.');
    const forged = `${head}.${b64({ ...claims(), email: 'intruder@example.test' })}.${signature}`;
    expect(await verifyAccessToken(forged, auth)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses an expired token', async () => {
    const expired = claims({ exp: Math.floor(Date.now() / 1000) - 1 });
    expect(await verifyAccessToken(sign(privateKey, header(), expired), auth)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a token for another audience', async () => {
    const other = claims({ aud: ['some-other-application'] });
    expect(await verifyAccessToken(sign(privateKey, header(), other), auth)).toEqual({
      ok: false,
      reason: 'wrong-audience',
    });
  });

  it('refuses a token from another issuer', async () => {
    const other = claims({ iss: 'https://elsewhere.test' });
    expect(await verifyAccessToken(sign(privateKey, header(), other), auth)).toEqual({
      ok: false,
      reason: 'wrong-issuer',
    });
  });

  it('refuses an unsigned `alg: none` token outright', async () => {
    const unsigned = `${b64(header({ alg: 'none' }))}.${b64(claims())}.`;
    expect(await verifyAccessToken(unsigned, auth)).toEqual({ ok: false, reason: 'bad-algorithm' });
  });

  it('refuses an HS256 token, which would let the public key be used as a secret', async () => {
    const token = sign(privateKey, header({ alg: 'HS256' }), claims());
    expect(await verifyAccessToken(token, auth)).toEqual({ ok: false, reason: 'bad-algorithm' });
  });

  it('refuses a token whose kid names no key in the set', async () => {
    const token = sign(privateKey, header({ kid: 'rotated-away' }), claims());
    expect(await verifyAccessToken(token, auth)).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('refuses a token that is not three parts, and anything empty', async () => {
    expect(await verifyAccessToken('not-a-token', auth)).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifyAccessToken('', auth)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a verified token that carries no email', async () => {
    const anonymous = claims({ email: undefined });
    expect(await verifyAccessToken(sign(privateKey, header(), anonymous), auth)).toEqual({
      ok: false,
      reason: 'no-identity',
    });
  });
});
