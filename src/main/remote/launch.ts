/**
 * Turning the environment into a server, or into a refusal.
 *
 * The remote endpoint is OFF unless a port is asked for, and asking for one
 * without Cloudflare Access is an error rather than a default. There is no
 * arrangement of these variables that produces an open port with no identity
 * in front of it -- that is the whole point of doing the reading here instead
 * of inside the request path.
 */

import type { AccessJwk } from './auth.js';

export type RemoteConfig = {
  readonly port: number;
  readonly allowWrites: boolean;
  readonly auth: {
    readonly audience: string;
    readonly issuer: string;
    keys(): Promise<readonly AccessJwk[]>;
  };
};

/**
 * A team name goes into a URL. Restricting it to a bare DNS label is what
 * stops `VAM_ACCESS_TEAM` from redirecting key fetches at an origin of
 * someone else's choosing -- which would let them supply the signing keys.
 */
const TEAM = /^[a-z0-9][a-z0-9-]{0,62}$/;

const teamOrigin = (team: string): string => `https://${team}.cloudflareaccess.com`;

/** Long enough that a request never waits on Cloudflare, short enough for rotation. */
export const KEY_CACHE_MS = 600_000;

export type Fetcher = (url: string) => Promise<Response>;

/**
 * The team's public keys, cached. A failure answers an EMPTY set and is not
 * cached: an empty set refuses every token, which is the safe direction, and
 * caching it would keep vam locked out for the whole TTL after one blip.
 */
export function accessKeySet(
  team: string,
  ttlMs: number = KEY_CACHE_MS,
  fetcher: Fetcher = (url) => fetch(url),
): () => Promise<readonly AccessJwk[]> {
  const url = `${teamOrigin(team)}/cdn-cgi/access/certs`;
  let cached: readonly AccessJwk[] = [];
  let fetchedAt = 0;
  return async () => {
    if (cached.length > 0 && Date.now() - fetchedAt < ttlMs) {
      return cached;
    }
    try {
      const response = await fetcher(url);
      if (!response.ok) {
        return [];
      }
      const body: unknown = await response.json();
      const keys =
        typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as { keys?: unknown }).keys)
          ? (body as { keys: AccessJwk[] }).keys
          : [];
      if (keys.length === 0) {
        return [];
      }
      cached = keys;
      fetchedAt = Date.now();
      return cached;
    } catch {
      return [];
    }
  };
}

/** Reads the config, or throws a message that says what is missing and why. */
export function remoteConfigFromEnv(env: Record<string, string | undefined>): RemoteConfig | null {
  const asked = env.VAM_REMOTE_PORT;
  if (asked === undefined || asked.length === 0) {
    return null;
  }
  const port = Number(asked);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`VAM_REMOTE_PORT is not a port: ${asked}`);
  }
  const team = env.VAM_ACCESS_TEAM ?? '';
  const audience = env.VAM_ACCESS_AUD ?? '';
  if (team.length === 0 || audience.length === 0) {
    throw new Error(
      'VAM_REMOTE_PORT is set but Cloudflare Access is not configured: set ' +
        'VAM_ACCESS_TEAM (your Zero Trust team name) and VAM_ACCESS_AUD (the ' +
        'Access application audience tag). This endpoint can type into running ' +
        'agents, so vam will not open it to unauthenticated callers.',
    );
  }
  if (!TEAM.test(team)) {
    throw new Error(`VAM_ACCESS_TEAM is not a team name: ${team}`);
  }
  return {
    port,
    // Writes are an explicit act. Anything other than `1` leaves the write
    // routes unregistered, so a typo cannot open them.
    allowWrites: env.VAM_REMOTE_WRITES === '1',
    auth: { audience, issuer: teamOrigin(team), keys: accessKeySet(team) },
  };
}
