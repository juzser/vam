/**
 * THE PHONE'S OWN CHANNEL INTO A PANE, over `/api/send-key`
 * (`main/remote/send-key.ts`), for the one build that has no
 * `window.api.terminal.send` at all: the browser, served over Tailscale Serve.
 *
 * NOT PART OF `SessionSource`/`PreloadSourceApi` -- deliberately, the same way
 * `window.api.terminal.send` itself is not part of that port on the Electron
 * side. `http-factory.ts`'s own header states the rule this follows: the
 * preload protocol is a fixed ten functions and a descriptor, and terminal
 * access has never been one of them (`capabilities.terminal` gates whether a
 * pane surface exists at all, with no corresponding `SourceWrites` member --
 * see `port.ts`). This is the phone's equivalent of that raw, capability-
 * adjacent channel: a small, direct `fetch`, reusing the SAME bearer token
 * `http-factory.ts` reads per request (`remote-token.ts`) for the same reason
 * that file gives -- a device can be revoked mid-session, and a token read
 * once at construction would go on being sent after the operator withdrew it.
 */

import type { RemoteKeyId } from '../../shared/remote-key.js';
import type { PaneSendResult } from '../../shared/terminal.js';
import { readRemoteToken } from '../sources/remote-token.js';

/** The server's own envelope shape (`remote/server.ts`'s `Envelope`). */
type Envelope =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

/**
 * One allowlisted key, to one session's own pane. `PaneSendResult` is reused
 * as the answer shape rather than inventing a new one -- the phone strip's
 * caption (`stripCaption`/`cycleWording`, `DetailPanel.tsx`) already knows how
 * to word every one of its five values, and this route can only ever land on
 * three of them: `'sent'`, `'refused'` (a `SourceError` came back), or
 * `'unavailable'` (the transport itself failed -- no route, no network, no
 * pairing). It never returns `'unaimed'` or `'mispaired'`: those are the
 * DESKTOP aim-cache's own vocabulary for a proof it re-uses across several
 * keystrokes in a row (`terminal/ipc.ts`'s `AIM_TTL_MS`), and this route
 * proves its pairing fresh on every single call, so there is no cache to be
 * wrong about.
 */
export async function sendKeyRemote(sessionId: string, key: RemoteKeyId): Promise<PaneSendResult> {
  const token = readRemoteToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch('/api/send-key', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId, key }),
    });
  } catch {
    return 'unavailable';
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return 'unavailable';
  }
  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
    return 'unavailable';
  }
  const envelope = parsed as Envelope;
  return envelope.ok ? 'sent' : 'refused';
}
