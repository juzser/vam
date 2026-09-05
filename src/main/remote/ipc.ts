/**
 * The channel the pairing screen talks over -- and the only route to `open`.
 *
 * WHY THESE ACTS LIVE HERE AND NOWHERE ELSE. `pairing.open()` clears the
 * failure lockout, on the argument that pressing it is a human standing at
 * this desktop; ten cheap wrong guesses otherwise lock the operator's own
 * phone out for fifteen minutes with no way back. That argument holds exactly
 * as long as `open` is unreachable from the network, so it is exposed on this
 * bridge -- which needs a window, a preload and a keyboard -- while the remote
 * server is handed `submit` alone (`server.ts`, `PairPort`).
 *
 * Every channel answers a bare `RemoteState`, never an `IpcResult`: there is
 * no source to refuse anything in the words of, and an act that answers with
 * the state it produced is what makes the panel truthful the instant the
 * operator presses something rather than at the next poll.
 *
 * THE DESKTOP VOCABULARY STOPS HERE. `PairReason` and the burn/lockout detail
 * are the desktop's to see; the phone gets one uniform refusal, because any
 * message it receives an attacker receives identically.
 */

import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import type { DeviceRegistry } from './devices.js';
import type { ServeAddress } from './hostname.js';
import type { Pairing } from './pairing.js';
import type { RemoteState } from './state.js';

export type { RemoteState };

export type RemoteIpcOptions = {
  readonly pairing: Pairing;
  readonly devices: DeviceRegistry;
  readonly allowWrites: boolean;
  readonly readAddress: () => Promise<ServeAddress>;
  readonly now?: () => number;
};

/**
 * How long a read of the MagicDNS name is reused.
 *
 * The panel polls once a second while it is on screen. Asking the CLI that
 * often would put a subprocess per second behind an address that changes
 * about never -- the same reason `usage/ipc.ts` holds its own floor, and for
 * the same reason it lives on this side of the bridge rather than in the
 * renderer's poll interval.
 */
export const ADDRESS_CACHE_MS = 30_000;

/** A device id is a `randomUUID`; the bound is far above one. */
const MAX_DEVICE_ID_LENGTH = 200;

export function registerRemoteIpc(ipcMain: IpcMainLike, options: RemoteIpcOptions): void {
  const now = options.now ?? (() => Date.now());
  let cached: { at: number; address: ServeAddress } | null = null;
  /**
   * The name of the device the operator allowed since the screen was opened,
   * which is the only thing the panel's "Paired: ..." line can truthfully
   * say. Cleared by `open`, because a new code is a new question.
   */
  let pairedName: string | null = null;

  const address = async (): Promise<ServeAddress> => {
    if (cached !== null && now() - cached.at < ADDRESS_CACHE_MS) {
      return cached.address;
    }
    const read = await options.readAddress();
    cached = { at: now(), address: read };
    return read;
  };

  const snapshot = async (): Promise<RemoteState> => {
    const state = options.pairing.state();
    return {
      view: {
        code: state.live?.code ?? null,
        expiresAtMs: state.live?.expiresAt ?? 0,
        burned: state.burned,
        throttledUntilMs: state.throttledUntil,
        awaiting: state.awaiting,
        pairedName,
      },
      devices: options.devices.list(),
      address: await address(),
      allowWrites: options.allowWrites,
      nowMs: now(),
    };
  };

  ipcMain.handle(CHANNELS.remoteState, snapshot);

  ipcMain.handle(CHANNELS.pairingOpen, async (): Promise<RemoteState> => {
    pairedName = null;
    options.pairing.open();
    return await snapshot();
  });

  ipcMain.handle(CHANNELS.pairingApprove, async (): Promise<RemoteState> => {
    // Read BEFORE approving: settling clears `awaiting`, and the name the
    // operator saw on the prompt is the name the status line must show.
    pairedName = options.pairing.state().awaiting?.name ?? pairedName;
    options.pairing.approve();
    return await snapshot();
  });

  ipcMain.handle(CHANNELS.pairingDeny, async (): Promise<RemoteState> => {
    options.pairing.deny();
    return await snapshot();
  });

  ipcMain.handle(CHANNELS.deviceRemove, async (_event, ...args): Promise<RemoteState> => {
    const [deviceId] = args;
    // An id from the least trusted process in the app. A malformed one removes
    // nothing and still answers the current state: there is no control on the
    // panel that can produce it, so there is nothing to say about it.
    if (
      args.length === 1 &&
      typeof deviceId === 'string' &&
      deviceId.length > 0 &&
      deviceId.length <= MAX_DEVICE_ID_LENGTH
    ) {
      // The registry announces the revocation once the durable write landed,
      // and `onRevoked` is what closes that device's open streams.
      await options.devices.remove(deviceId);
    }
    return await snapshot();
  });

  ipcMain.handle(CHANNELS.deviceRemoveAll, async (): Promise<RemoteState> => {
    await options.devices.removeAll();
    return await snapshot();
  });
}
