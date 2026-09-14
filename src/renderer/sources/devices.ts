/**
 * WHAT IS PAIRED, asked over HTTP because the phone has no bridge to ask.
 *
 * The desktop reads this straight out of the registry over IPC
 * (`remote/ipc.ts`). The browser build has no `window.api` at all -- that is
 * what `RemotePanel`'s "a control that cannot act is not drawn as one" branch
 * is about -- so on a phone the Remote screen could only apologise. Operator
 * instruction: "on mobile, remote only needs to show the paired devices".
 *
 * ── IT CARRIES THE TOKEN, UNLIKE `pair.ts` ────────────────────────────────
 * The opposite case, for the opposite reason. Pairing is the one request that
 * must send no credential; this is an ordinary authenticated read and the
 * server answers 401 without one. The token is read PER CALL rather than
 * captured, the same rule `http-factory.ts` states: a device can be revoked
 * from the desktop mid-session, and a value captured at construction would go
 * on being sent after the operator withdrew it.
 *
 * ── WHAT COMES BACK CANNOT BE A CREDENTIAL ────────────────────────────────
 * `PairedDevice` on the server has no token field at all (`devices.ts`: "it is
 * returned once and never again"), so there is nothing here to strip and
 * nothing a careless render could leak. There is also no write: the route is a
 * read and the server registers no route that removes a device, so this module
 * has nothing to offer beyond the list.
 */

import type { SourceError } from './port.js';
import { readRemoteToken } from './remote-token.js';

/** One paired device, as a phone may see it. Mirrors main's `PairedDevice`. */
export type PairedDeviceView = {
  readonly deviceId: string;
  readonly name: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number;
};

export type PairedDevices = {
  /** The asking device's own id, so the list can mark "this one". */
  readonly you: string;
  readonly devices: readonly PairedDeviceView[];
};

type Answer = { status: number; statusText: string; json(): Promise<unknown> };
export type DevicesOptions = {
  readonly baseUrl?: string;
  readonly fetch?: (url: string, init: { headers: Record<string, string> }) => Promise<Answer>;
};

const unreachable = (code: string, message: string): SourceError => ({
  kind: 'unreachable',
  code,
  message,
});

const isDevice = (value: unknown): value is PairedDeviceView => {
  const row = value as Record<string, unknown> | null;
  return (
    typeof row === 'object' &&
    row !== null &&
    typeof row.deviceId === 'string' &&
    typeof row.name === 'string' &&
    typeof row.pairedAt === 'number' &&
    typeof row.lastSeenAt === 'number'
  );
};

/**
 * Read the paired devices, or reject with the server's own `SourceError`.
 *
 * The shape is CHECKED rather than cast. This answer is rendered directly, and
 * an older or newer server answering something else would otherwise reach the
 * list as `undefined` in a template -- which reads as a device named
 * "undefined" rather than as a version mismatch anybody could act on.
 */
export async function readPairedDevices(options: DevicesOptions = {}): Promise<PairedDevices> {
  const base = options.baseUrl ?? '';
  const send = options.fetch ?? ((url, init) => fetch(url, init) as unknown as Promise<Answer>);
  const token = readRemoteToken();

  let answer: Answer;
  try {
    answer = await send(`${base}/api/devices`, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    });
  } catch (cause) {
    throw unreachable(
      'transport-failed',
      cause instanceof Error ? cause.message : 'the endpoint did not answer',
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
  const envelope = parsed as { ok: boolean; error?: SourceError; value?: unknown };
  if (!envelope.ok) {
    throw envelope.error ?? unreachable('devices-failed', 'the request was refused');
  }
  const value = envelope.value as { you?: unknown; devices?: unknown } | null;
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.you !== 'string' ||
    !Array.isArray(value.devices) ||
    !value.devices.every(isDevice)
  ) {
    throw unreachable('devices-shape', 'this vam answered a device list it does not understand');
  }
  return { you: value.you, devices: value.devices };
}
