/**
 * Turns the Keychain token and the real `/api/oauth/usage` response into a
 * `UsageSnapshot`. This is the only module that ever holds a token in memory
 * outside `keychain.ts` itself, and it holds one only long enough to build
 * one `Authorization` header — the token is never part of anything this
 * function returns, throws, or logs. Every branch below answers a value, not
 * an exception: `readUsage` never throws.
 *
 * Both side effects are injected (`UsageReaderDeps`) so tests exercise the
 * mapping without touching the Keychain or the network. `DEFAULT_USAGE_DEPS`
 * is what main actually registers.
 */

import { parseUsage, type UsageSnapshot, type UsageUnknownReason } from '../../shared/usage.js';
import { readTokenFromKeychain } from './keychain.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/** Names this client the way the real `claude` CLI does, plus a version. */
const USER_AGENT = 'claude-code-vam/1.0.0';

export type Fetcher = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  readonly status: number;
  readonly ok: boolean;
  json(): Promise<unknown>;
}>;

export type UsageReaderDeps = {
  readonly readToken: () => Promise<string | null>;
  readonly fetch: Fetcher;
};

export const DEFAULT_USAGE_DEPS: UsageReaderDeps = {
  readToken: readTokenFromKeychain,
  fetch: (url, init) => globalThis.fetch(url, init),
};

function unknown(reason: UsageUnknownReason): UsageSnapshot {
  return { kind: 'unknown', reason };
}

export async function readUsage(
  deps: UsageReaderDeps = DEFAULT_USAGE_DEPS,
): Promise<UsageSnapshot> {
  let token: string | null;
  try {
    token = await deps.readToken();
  } catch {
    return unknown('no-token');
  }
  if (token === null || token.length === 0) {
    return unknown('no-token');
  }

  let response: { readonly status: number; readonly ok: boolean; json(): Promise<unknown> };
  try {
    response = await deps.fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    });
  } catch {
    return unknown('request-failed');
  }

  if (response.status === 401) {
    return unknown('unauthorized');
  }
  if (!response.ok) {
    return unknown('request-failed');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return unknown('request-failed');
  }

  try {
    const windows = parseUsage(body);
    return { kind: 'ok', windows, observedAt: new Date().toISOString() };
  } catch {
    // `parseUsage` never throws today (§ its own doc comment); this is the
    // 'unavailable' bucket for whatever this reader did not anticipate.
    return unknown('unavailable');
  }
}
