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

/**
 * A `Cookie` header far above anything vam's own cookie can make is refused
 * before it is split at all -- the same reasoning as `MAX_TOKEN_LENGTH`, one
 * layer out. Generous, because the header carries every other cookie the
 * origin has too, and this server is not the only thing that may have set one.
 */
const MAX_COOKIE_HEADER = 8_192;

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
 * The cookie that carries the same token to the ONE route a header cannot
 * reach.
 *
 * `EventSource` cannot send a header. That is not a limitation of this app or
 * of any library -- the constructor takes a URL and nothing else -- so
 * `/api/stream` could carry no credential at all, and a paired phone loaded
 * the model once and then sat there. The alternative, a token in the query
 * string, is refused by name in `server.ts`: a credential in a URL is written
 * into proxy logs and browser history, and making it short-lived narrows the
 * window without changing what was written down. A cookie puts nothing in a
 * URL, and `EventSource` sends it without being asked.
 *
 * IT IS NOT A SECOND CREDENTIAL, and that is structural rather than promised:
 * it carries the SAME per-device token the header carries, resolves through
 * the SAME `DeviceDirectory.find`, and is only ever issued to a request that
 * already proved itself with the header. There is no state in which the cookie
 * is valid and the token is not -- so revocation needs no second path, and
 * cannot grow one that drifts.
 *
 * IT IS NOT A SECOND WAY IN either: `authenticateStream` is the only function
 * that reads it, and `server.ts` calls that for `/api/stream` alone. Every
 * other route answers 401 to a caller holding nothing but this cookie, which
 * `stream-cookie.test.ts` holds to by sweeping the route table rather than a
 * list.
 */
export const STREAM_COOKIE = 'vam_stream';

/**
 * How long the browser keeps it.
 *
 * Long, because a phone that has to re-pair to see updates is a phone the
 * operator stops using -- and short would not be the safety it looks like: the
 * cookie is refused the instant the device leaves the directory, whatever its
 * expiry says, and that check runs on every request. What the expiry really
 * bounds is a device nobody has used in a month, which re-pairs. The cookie is
 * also re-issued on every request that authenticates by header, so a phone in
 * daily use never approaches it.
 */
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The `Set-Cookie` value, as one string.
 *
 * `Secure` UNCONDITIONALLY, and there is no development exception because none
 * is needed. The two origins this server is ever reached on are the HTTPS one
 * `tailscale serve` publishes and `http://127.0.0.1:<port>` -- and loopback is
 * a potentially-trustworthy origin in every browser vam targets, so a `Secure`
 * cookie is stored and sent there. `e2e/stream-cookie.spec.ts` MEASURES that
 * rather than citing it, because a browser-behaviour claim nobody ran is the
 * kind that is wrong for a year. A plain-HTTP LAN origin would not store it --
 * and that is the correct outcome, not a gap: vam's remote path is Tailscale
 * Serve, and a credential sent in clear over a LAN is the thing this whole
 * module exists to refuse.
 *
 * `SameSite=Strict` means a cross-site request never carries it, so it is not
 * a CSRF lever even if some later route did read it. `Path` scopes it to the
 * one route that honours it, so it is not attached to any other request in the
 * first place.
 */
export function streamCookie(token: string): string {
  return [
    `${STREAM_COOKIE}=${token}`,
    'Path=/api/stream',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ].join('; ');
}

/**
 * The token out of a `Cookie` header, or nothing.
 *
 * A REPEATED vam COOKIE IS REFUSED rather than resolved, the same rule
 * `bearerFrom` applies to a repeated `Authorization`: a caller who can get a
 * second cookie in front of the first is a caller choosing which identity the
 * server sees, and picking one of two credentials is not a decision a parser
 * makes on the operator's behalf.
 *
 * Nothing is read out of the value beyond its length before the directory sees
 * it -- same order as `authenticateDevice`, and for the same reason.
 */
export function cookieTokenFrom(header: string | readonly string[] | undefined): string | null {
  if (typeof header !== 'string' || header.length > MAX_COOKIE_HEADER) {
    return null;
  }
  let found: string | null = null;
  for (const pair of header.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    if (pair.slice(0, equals).trim() !== STREAM_COOKIE) continue;
    // A second one is not a tie to break.
    if (found !== null) return null;
    found = pair.slice(equals + 1).trim();
  }
  if (found === null || found.length === 0 || found.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  return found;
}

/**
 * One request's credential for the STREAM, which may arrive either way.
 *
 * ONE CREDENTIAL PER REQUEST. A present-but-broken `Authorization` is a caller
 * asserting an identity, and it is refused rather than quietly answered by a
 * cookie: "which of the two did the server believe" is not a question this
 * code should be able to raise. The cookie is consulted only when no header
 * was sent at all, which is exactly the `EventSource` case it exists for.
 */
export function authenticateStream(
  authorization: string | readonly string[] | undefined,
  cookie: string | readonly string[] | undefined,
  directory: DeviceDirectory,
): AuthOutcome {
  if (authorization !== undefined) {
    return authenticateDevice(authorization, directory);
  }
  const token = cookieTokenFrom(cookie);
  if (token === null) {
    return { ok: false, reason: cookie === undefined ? 'missing' : 'malformed' };
  }
  const identity = directory.find(token);
  return identity === null ? { ok: false, reason: 'unknown-device' } : { ok: true, identity };
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
