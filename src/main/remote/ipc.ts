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
import type { ServeToggleResult } from './serve.js';
import type { RemoteDeviceView, RemoteState, ServeState } from './state.js';
import type { WritesPreference } from './writes-preference.js';

export type { RemoteState };

export type RemoteIpcOptions = {
  readonly pairing: Pairing;
  readonly devices: DeviceRegistry;
  readonly allowWrites: boolean;
  readonly readAddress: () => Promise<ServeAddress>;
  /**
   * Runs `tailscale serve --bg <port>` for a port this module never sees --
   * the caller (`src/main/index.ts`) already knows its own config's port, and
   * closing over it there keeps that number out of the pairing bridge.
   */
  readonly enableServe: () => Promise<ServeToggleResult>;
  /** Runs the TARGETED off, never `tailscale serve reset` -- see `remote/serve.ts`. */
  readonly disableServe: () => Promise<ServeToggleResult>;
  /** The persisted write-access choice, read at snapshot time and set from the panel. */
  readonly writesPreference: WritesPreference;
  /** `shell.openExternal`, for the panel's two links. See `remoteOpenLink`. */
  readonly openExternal?: (url: string) => Promise<void>;
  readonly now?: () => number;
};

/** What `registerRemoteIpc` hands back to `src/main/index.ts`, beyond the channels themselves. */
export type RemoteIpc = {
  /**
   * Records `startRemoteServer`'s own refusal message so the next
   * `RemoteState` snapshot carries it -- called from `index.ts`'s catch, once
   * the bind attempt has actually failed. See `RemoteState.serverError`.
   */
  reportServerError(message: string): void;
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

/** The one link that is a constant. No interpolation, no caller input. */
const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';

/**
 * The tailnet admin page, IF main has read one and it is still what it claims.
 *
 * Two checks, not one. The key must be the admin key -- so no other string
 * reaches a URL at all -- and the URL itself must still be an https page on
 * Tailscale's own login host, because it was parsed out of a subprocess's
 * stdout and the process that produced it is not this one.
 */
function adminUrl(key: unknown, serve: ServeState): string | null {
  if (key !== 'serve-admin') return null;
  const raw = serve.tailnetServeDisabledUrl;
  if (raw === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'login.tailscale.com') return null;
  return parsed.href;
}

export function registerRemoteIpc(ipcMain: IpcMainLike, options: RemoteIpcOptions): RemoteIpc {
  const now = options.now ?? (() => Date.now());
  // Defaulted rather than required, like `now`: every existing caller in the
  // tests wires this module without a shell, and a link that opens nothing is
  // the correct behaviour for a process that has none.
  const openExternal = options.openExternal ?? (async () => {});
  let cached: { at: number; address: ServeAddress } | null = null;
  /** Set once, by `reportServerError` below, and never cleared -- see `RemoteState.serverError`. */
  let serverError: string | null = null;
  /**
   * When the operator last opened the screen, or null while it has never been
   * open. The status line is derived against this rather than remembered: see
   * `pairedSince` below.
   */
  let openedAt: number | null = null;

  /**
   * vam's own record of the last `enableServe`/`disableServe` outcome --
   * NEVER a live read of the OS. Starts off, and only an explicit act on
   * `serveEnable`/`serveDisable` below ever changes it: `snapshot` below only
   * READS this variable, so polling `remoteState` can never flip it.
   */
  let serve: ServeState = {
    enabled: false,
    lastError: null,
    timedOut: false,
    tailnetServeDisabledUrl: null,
  };

  const address = async (): Promise<ServeAddress> => {
    if (cached !== null && now() - cached.at < ADDRESS_CACHE_MS) {
      return cached.address;
    }
    const read = await options.readAddress();
    cached = { at: now(), address: read };
    return read;
  };

  /**
   * The device this screen actually paired, READ BACK FROM THE REGISTRY.
   *
   * It is not remembered at the moment the operator presses Allow, and that is
   * the whole point. `devices.grant` persists before it returns -- a
   * credential is not valid until its durable write succeeds -- so a full disk
   * means no entry, no token, and no pairing. A `pairedName` captured from the
   * prompt would go on saying "Paired: a phone" beside a device list that
   * correctly showed nothing, and the more prominent of the two surfaces would
   * be the one lying. Derived from the registry, the two cannot disagree.
   *
   * Scoped to the current screen by `pairedAt`, so a device paired last week
   * is not announced as the answer to the code minted a minute ago.
   */
  const pairedSince = (): string | null => {
    const since = openedAt;
    if (since === null) {
      return null;
    }
    const newest = options.devices
      .list()
      .filter((device) => device.pairedAt >= since)
      .reduce<RemoteDeviceView | null>(
        (best, device) => (best === null || device.pairedAt >= best.pairedAt ? device : best),
        null,
      );
    return newest?.name ?? null;
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
        pairedName: pairedSince(),
      },
      devices: options.devices.list(),
      address: await address(),
      allowWrites: options.allowWrites,
      serve,
      // The failure path's only desktop surface. A grant that did not persist
      // and a registry vam refused to overwrite are both known here and were
      // said nowhere -- the phone was the only side told.
      registry: options.devices.trouble(),
      serverError,
      writesPreference: options.writesPreference.get(),
      nowMs: now(),
    };
  };

  ipcMain.handle(CHANNELS.remoteState, snapshot);

  ipcMain.handle(CHANNELS.pairingOpen, async (): Promise<RemoteState> => {
    // Recorded BEFORE the mint, so a grant that lands in the same millisecond
    // is inside this screen's window rather than just outside it.
    openedAt = now();
    options.pairing.open();
    return await snapshot();
  });

  ipcMain.handle(CHANNELS.pairingApprove, async (): Promise<RemoteState> => {
    // Nothing is remembered here. Approving releases the waiting request; what
    // it produced is whatever the registry durably holds, which `pairedSince`
    // reads back -- including "nothing", when the write failed.
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

  /**
   * Folds a toggle attempt's result into the next `ServeState`. `wasEnabling`
   * is what `enabled` becomes on `ok`; on any failure `enabled` is left
   * UNCHANGED, because neither a refusal nor a timeout tells vam the standing
   * configuration actually moved. `lastError`/`timedOut` keep the LAST
   * attempt's own words (or its own honest silence) and clear on the next
   * success -- never flattened into a generic "could not enable/disable".
   */
  const nextServeState = (result: ServeToggleResult, wasEnabling: boolean): ServeState => {
    if (result.kind === 'ok') {
      return {
        enabled: wasEnabling,
        lastError: null,
        timedOut: false,
        tailnetServeDisabledUrl: null,
      };
    }
    if (result.kind === 'timed-out') {
      return {
        enabled: serve.enabled,
        lastError: null,
        timedOut: true,
        tailnetServeDisabledUrl: null,
      };
    }
    if (result.kind === 'tailnet-serve-disabled') {
      return {
        enabled: serve.enabled,
        lastError: null,
        timedOut: false,
        tailnetServeDisabledUrl: result.url,
      };
    }
    return {
      enabled: serve.enabled,
      lastError: result.message,
      timedOut: false,
      tailnetServeDisabledUrl: null,
    };
  };

  ipcMain.handle(CHANNELS.serveEnable, async (): Promise<RemoteState> => {
    serve = nextServeState(await options.enableServe(), true);
    return await snapshot();
  });

  ipcMain.handle(CHANNELS.serveDisable, async (): Promise<RemoteState> => {
    serve = nextServeState(await options.disableServe(), false);
    return await snapshot();
  });

  /**
   * THE TWO LINKS THE PANEL DRAWS, OPENED WHERE A BROWSER CAN OPEN THEM.
   *
   * `setWindowOpenHandler` denies every `window.open` in this app, so an
   * ordinary `<a target="_blank">` in the panel did nothing at all -- which is
   * the operator's report, and the policy working rather than failing. The
   * link goes through here instead, the way the update notice's release page
   * already does.
   *
   * A KEY, NOT A URL. The renderer is the least trusted process in the app,
   * and a channel that took a destination from it would be the navigate-
   * anywhere capability the window policy exists to refuse, reached through a
   * different door. There are exactly two destinations and main owns both: a
   * constant, and the tailnet admin URL main ITSELF parsed out of `tailscale
   * serve`'s output -- of which the renderer only ever had a copy.
   *
   * AND THAT SECOND ONE IS RE-CHECKED AT THE MOMENT IT IS OPENED, because it
   * came out of a subprocess's bytes. `checkForUpdate` does exactly this to
   * GitHub's `html_url` for the same reason: a destination read out of
   * somebody else's output is a destination to verify, never to trust.
   */
  ipcMain.handle(CHANNELS.remoteOpenLink, async (_event, ...args): Promise<boolean> => {
    const [key] = args;
    const url = key === 'download' ? TAILSCALE_DOWNLOAD_URL : adminUrl(key, serve);
    if (url === null) return false;
    try {
      await openExternal(url);
      return true;
    } catch {
      // No browser, or a shell that refused. The panel still shows the
      // address, which is the whole answer either way.
      return false;
    }
  });

  ipcMain.handle(CHANNELS.remoteWritesSet, async (_event, ...args): Promise<RemoteState> => {
    const [next] = args;
    // A value from the least trusted process in the app. There is no control
    // on the panel that sends anything but a boolean, so a malformed one
    // leaves the preference untouched rather than guessing.
    if (args.length === 1 && typeof next === 'boolean') {
      await options.writesPreference.set(next);
    }
    return await snapshot();
  });

  return {
    reportServerError(message: string): void {
      serverError = message;
    },
  };
}
