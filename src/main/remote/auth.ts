/**
 * Per-device bearer tokens, checked ON THIS MACHINE, on every request.
 *
 * TAILSCALE AUTHENTICATES A DEVICE ONTO A NETWORK; IT DOES NOT AUTHORISE THAT
 * DEVICE TO DRIVE YOUR AGENTS. `tailscale serve` puts the whole tailnet in
 * front of this port -- every laptop, phone, tablet, server, CI runner,
 * container and shared-in external user -- and any local process that can open
 * a socket to loopback is already past it. Being on the tailnet is not consent
 * to close sessions and type into a running agent. Pairing is that missing
 * step, and this module is the half that checks its result.
 *
 * Serve also injects `Tailscale-User-Login` and friends. Those are
 * PROXY-ASSERTED, NOT SIGNED: anything that can reach the loopback port can
 * forge them, so they are a display label elsewhere and never a credential
 * here. The token is the credential, and it is checked per request rather than
 * once per connection, because a connection outlives the grant that opened it.
 *
 * Node's own `crypto`, no dependency.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * A credential far above any token this server mints is refused before it is
 * split, hashed or looked up: the bytes arrive from the network, and work an
 * unauthenticated caller can buy in bulk is work worth not doing.
 */
export const MAX_TOKEN_LENGTH = 512;

/** Who a request is, once its token resolved. Replaces the Access `email`. */
export type Identity = { readonly deviceId: string; readonly name: string };

/**
 * A closed vocabulary. These strings reach the client verbatim, so a new one
 * is a deliberate act rather than whatever a call site happened to write --
 * and none of them says which of a token's parts was wrong.
 */
export type AuthReason = 'missing' | 'malformed' | 'unknown-device';

export type AuthOutcome =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly reason: AuthReason };

/**
 * The paired devices, as the request path needs them. `find` MUST compare in
 * constant time over every entry -- see `devices.ts`; a directory that returns
 * early on the first mismatching byte leaks the token it holds.
 */
export type DeviceDirectory = { readonly find: (token: string) => Identity | null };

/**
 * Equality that does not answer faster for a nearly-right value.
 *
 * Both sides are hashed first so the comparison is over two 32-byte digests:
 * `timingSafeEqual` throws on unequal lengths, and a length pre-check would
 * make the answer depend on the length of the secret. THE COMMENT IS THE
 * GUARD: a unit test cannot see timing, so nothing but review stops this from
 * being "simplified" to `===`.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * The token out of an `Authorization` header, or nothing.
 *
 * A repeated header is refused rather than resolved: node hands duplicates as
 * an array, and picking one of two credentials is a decision no parser should
 * make on the operator's behalf.
 */
export function bearerFrom(header: string | readonly string[] | undefined): string | null {
  if (typeof header !== 'string' || header.length > MAX_TOKEN_LENGTH + 7) {
    return null;
  }
  const space = header.indexOf(' ');
  if (space < 0 || header.slice(0, space).toLowerCase() !== 'bearer') {
    return null;
  }
  const token = header.slice(space + 1).trim();
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  return token;
}

/**
 * Resolves one request's credential to the device that holds it.
 *
 * The order is deliberate: shape first, then the directory. Reading anything
 * out of an unverified credential -- even to log it -- is how an attacker gets
 * a value of theirs into a place that treats it as vam's own.
 */
export function authenticateDevice(
  header: string | readonly string[] | undefined,
  directory: DeviceDirectory,
): AuthOutcome {
  if (header === undefined) {
    return { ok: false, reason: 'missing' };
  }
  const token = bearerFrom(header);
  if (token === null) {
    return { ok: false, reason: 'malformed' };
  }
  const identity = directory.find(token);
  return identity === null ? { ok: false, reason: 'unknown-device' } : { ok: true, identity };
}
