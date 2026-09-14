/**
 * THE PHONE'S PAIRING REQUEST -- the POST nothing in this repository made.
 *
 * `/api/pair` has existed on the server since pairing was built, and no client
 * ever called it: outside `src/main`, `api/pair` appeared nowhere. The
 * walkthrough told the operator to type a code into the phone; the phone had
 * no field to type it into and no request to send it with.
 *
 * ── WHY THIS IS NOT `createHttpSourceApi` ─────────────────────────────────
 * That module attaches the stored token to every request, and this is the one
 * request that must carry none. A device the operator has REVOKED still has a
 * token in its `localStorage`; sending it here would make its pairing attempt
 * look like an authenticated call, and the single request designed to work
 * without a credential would be the one carrying a rejected one.
 *
 * ── EVERY REFUSAL LOOKS THE SAME, AND THAT IS THE SERVER'S DESIGN ─────────
 * A wrong code, a burned one, an expired one, a screen that was never opened,
 * and a caller past the rate limit all come back as one 401 with one message.
 * The phone is not entitled to tell them apart -- naming the state would make
 * this endpoint an oracle for "is the operator at the pairing screen right
 * now". So this rejects with the server's own `SourceError` and the screen
 * above says exactly that and no more.
 */

import type { SourceError } from './port.js';

type PairTransport = {
  fetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; statusText: string; json(): Promise<unknown> }>;
};

export type PairOptions = { readonly baseUrl?: string; readonly fetch?: PairTransport['fetch'] };

const unreachable = (code: string, message: string): SourceError => ({
  kind: 'unreachable',
  code,
  message,
});

/**
 * Submit a code; resolve with the token, or reject with a `SourceError`.
 *
 * The token arrives in the RESPONSE BODY and is not persisted here -- the
 * caller decides whether this device should remember it, which keeps the
 * storage decision (and its reasoning, in `remote-token.ts`) in one place.
 */
export async function submitPairing(
  code: string,
  name: string,
  options: PairOptions = {},
): Promise<string> {
  const base = options.baseUrl ?? '';
  const send =
    options.fetch ??
    ((url, init) => fetch(url, init) as unknown as ReturnType<PairTransport['fetch']>);

  let answer: Awaited<ReturnType<PairTransport['fetch']>>;
  try {
    answer = await send(`${base}/api/pair`, {
      method: 'POST',
      // NO `authorization`, deliberately -- see the header.
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name }),
    });
  } catch (cause) {
    throw unreachable(
      'transport-failed',
      cause instanceof Error ? cause.message : 'the pairing endpoint did not answer',
    );
  }

  let parsed: unknown;
  try {
    parsed = await answer.json();
  } catch {
    parsed = null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
    throw unreachable(
      `http-${answer.status}`,
      answer.statusText || 'the answer was not an envelope',
    );
  }
  const envelope = parsed as { ok: boolean; error?: SourceError; value?: { token?: unknown } };
  if (!envelope.ok) {
    throw envelope.error ?? unreachable('pairing-failed', 'the pairing request was refused');
  }
  const token = envelope.value?.token;
  if (typeof token !== 'string' || token === '') {
    // A 200 with no token is a server that agreed and granted nothing. Treated
    // as a failure rather than stored, because an empty credential would make
    // every later request a counted failure against this device.
    throw unreachable('pairing-empty', 'the server granted no token');
  }
  return token;
}
