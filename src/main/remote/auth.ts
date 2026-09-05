/**
 * Cloudflare Access, verified ON THE MAC, on every request.
 *
 * A tunnel is not authentication. `cloudflared` dials out and then delivers
 * whatever reaches it to the local port, so a server that trusts the tunnel
 * trusts anything else on this machine that can open a socket to loopback --
 * and this endpoint can type into a running agent. Access signs an assertion
 * for each request; this module is the half that checks the signature, and it
 * runs per request rather than once per connection, because a connection
 * outlives the identity that opened it.
 *
 * RS256 with node's own `crypto` -- no dependency. Two refusals here are the
 * ones that make the rest meaningful: `alg: none`, which would make the
 * signature optional, and `HS256`, which would let a public key from the
 * team's own key set be presented as the shared secret it is not.
 */

import { createPublicKey, createVerify, timingSafeEqual, type webcrypto } from 'node:crypto';

/**
 * Node's own JWK type, not the DOM's: `tsconfig.node.json` has no DOM lib, and
 * the global `JsonWebKey` this file first used exists only there.
 */
type JsonWebKey = webcrypto.JsonWebKey;

/** One key from a team's `/cdn-cgi/access/certs` set, in JWK form. */
export type AccessJwk = JsonWebKey & { readonly kid?: string };

/**
 * What the server must be told before it may answer anything. `keys` is a
 * function, not an array: Cloudflare rotates its signing keys, and it is
 * injected so a test can hold the key set it generated rather than reach the
 * network.
 */
export type AccessAuth = {
  readonly audience: string;
  readonly issuer: string;
  keys(): Promise<readonly AccessJwk[]>;
};

export type Identity = { readonly email: string };

export type AuthOutcome =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly reason: string };

/**
 * A token far above any real assertion is refused before it is parsed: the
 * bytes arrive from the network and JSON.parse on a header is work an
 * unauthenticated caller must not be able to buy in bulk.
 */
const MAX_TOKEN_LENGTH = 8_192;

const deny = (reason: string): AuthOutcome => ({ ok: false, reason });

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `aud` is a string or an array of them, per RFC 7519. */
function audienceMatches(aud: unknown, expected: string): boolean {
  const list = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];
  const wanted = Buffer.from(expected);
  return list.some((entry) => {
    if (typeof entry !== 'string') {
      return false;
    }
    const got = Buffer.from(entry);
    return got.length === wanted.length && timingSafeEqual(got, wanted);
  });
}

function signedBy(jwk: AccessJwk, body: string, signature: Buffer): boolean {
  try {
    const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(body);
    verifier.end();
    return verifier.verify(key, signature);
  } catch {
    return false;
  }
}

/**
 * Verifies one `Cf-Access-Jwt-Assertion` and answers who it names.
 *
 * The order is deliberate: shape, then algorithm, then the key, then the
 * SIGNATURE, and only then the claims. Reading `email` out of an unverified
 * payload -- even to log it -- is how an attacker gets a value of theirs into
 * a place that treats it as vam's own.
 */
export async function verifyAccessToken(
  token: string,
  auth: AccessAuth,
  nowMs: number = Date.now(),
): Promise<AuthOutcome> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return deny('malformed');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return deny('malformed');
  }
  // Indexed with a fallback rather than destructured: under
  // `noUncheckedIndexedAccess` the length check above does not narrow, and an
  // empty string fails every check below anyway.
  const rawHeader = parts[0] ?? '';
  const rawPayload = parts[1] ?? '';
  const rawSignature = parts[2] ?? '';
  const header = decodeJson(rawHeader);
  if (header === null) {
    return deny('malformed');
  }
  if (header.alg !== 'RS256') {
    return deny('bad-algorithm');
  }
  const kid = header.kid;
  if (typeof kid !== 'string' || kid.length === 0) {
    return deny('unknown-key');
  }
  const keys = await auth.keys();
  const matching = keys.filter((key) => key.kid === kid);
  if (matching.length === 0) {
    return deny('unknown-key');
  }
  const signature = Buffer.from(rawSignature, 'base64url');
  const body = `${rawHeader}.${rawPayload}`;
  if (!matching.some((key) => signedBy(key, body, signature))) {
    return deny('bad-signature');
  }
  const payload = decodeJson(rawPayload);
  if (payload === null) {
    return deny('malformed');
  }
  if (!audienceMatches(payload.aud, auth.audience)) {
    return deny('wrong-audience');
  }
  if (payload.iss !== auth.issuer) {
    return deny('wrong-issuer');
  }
  const seconds = nowMs / 1000;
  if (typeof payload.exp !== 'number' || payload.exp <= seconds) {
    return deny('expired');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > seconds) {
    return deny('not-yet-valid');
  }
  const email = payload.email;
  if (typeof email !== 'string' || email.length === 0) {
    return deny('no-identity');
  }
  return { ok: true, identity: { email } };
}
