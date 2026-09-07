/**
 * What the pairing screen and main say to each other, as types alone.
 *
 * ITS OWN MODULE BECAUSE OF WHO READS IT. The renderer compiles under
 * `tsconfig.web.json`, which has no node types at all, and the settings panel
 * needs these shapes; a type imported from `devices.ts` would drag that file's
 * `node:fs` and `node:crypto` imports into the web compile and fail it. So
 * nothing here imports anything that touches the filesystem, and
 * `RemoteDeviceView` states the four fields `PairedDevice` renders rather than
 * re-exporting it -- structurally the same value, minus the token, which
 * never leaves main.
 */

import type { ServeAddress } from './hostname.js';

/** Structurally the panel's `PairingView`; main does not import a component. */
export type PairingStateView = {
  readonly code: string | null;
  readonly expiresAtMs: number;
  readonly burned: boolean;
  readonly throttledUntilMs: number;
  readonly awaiting: { readonly name: string; readonly source: string } | null;
  readonly pairedName: string | null;
};

/**
 * What is wrong with the device registry, when "no devices" is not the whole
 * story: a file vam could not read (and will not overwrite), or a durable
 * write that failed. Declared here rather than in `devices.ts` because the
 * pairing panel renders it and the web compile has no node types.
 */
export type RegistryTrouble = 'unreadable' | 'write-failed';

export type RemoteDeviceView = {
  readonly deviceId: string;
  readonly name: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number;
};

/**
 * Whether THIS run of vam has phone access standing up via `tailscale serve`,
 * and the last honest word about it.
 *
 * TRACKED, NOT POLLED. `tailscale serve --bg` is a standing configuration
 * change that outlives vam, but confirming it live would mean parsing
 * `tailscale serve status --json`, whose exact shape `remote/serve.ts` has
 * not verified against a real binary -- so this is vam's own record of what
 * ITS OWN `enableServe`/`disableServe` calls did, never a live read of the
 * operating system. A restart after a previous session left this on starts
 * the panel reading `enabled: false` again; the standing configuration is
 * untouched, only the panel's memory of it is not -- see `RemotePanel.tsx`.
 */
export type ServeState = {
  readonly enabled: boolean;
  /** The literal words of the most recent failed enable/disable, or null. */
  readonly lastError: string | null;
  /**
   * The most recent enable/disable attempt gave up waiting rather than
   * getting an answer (`remote/serve.ts`'s measured hang). Its own field
   * rather than folded into `lastError`: there are no CLI words to carry, so
   * inventing an English sentence for it here would be main making up prose
   * that belongs to the renderer -- see `PairingPanel.tsx`. Mutually
   * exclusive with a non-null `lastError` and a non-null
   * `tailnetServeDisabledUrl`.
   */
  readonly timedOut: boolean;
  /**
   * Serve is administratively OFF FOR THE WHOLE TAILNET -- measured against a
   * real Tailscale (1.102.2): on a tailnet with Serve disabled (the FIRST-RUN
   * state for essentially every new user), `tailscale serve --bg` prints this
   * exact enable link to stdout and then hangs, never exiting.
   * `remote/serve.ts` parses it off the live process rather than main
   * constructing one -- it embeds a node id, which identifies the operator's
   * machine, so it is never invented and never appears in a fixture as a real
   * value. Null once nothing has surfaced it, or once a later attempt
   * succeeds. Mutually exclusive with a non-null `lastError` and `timedOut`.
   */
  readonly tailnetServeDisabledUrl: string | null;
};

/**
 * WHICH ACTION A LINGERING `lastError`/`timedOut`/`tailnetServeDisabledUrl`
 * CAME FROM IS `enabled` ITSELF, never a fourth field. The panel only ever
 * exposes an Enable button while `enabled` is false and a Disable button
 * while it is true, so a failure recorded while `enabled` is true can only be
 * a failed DISABLE (a failed enable leaves `enabled` false), and one recorded
 * while `enabled` is false can only be a failed ENABLE. `PairingPanel.tsx`
 * reads this invariant directly rather than main inventing a
 * `lastFailedAction` to say the same thing a second way.
 */

export type RemoteState = {
  readonly view: PairingStateView;
  readonly devices: readonly RemoteDeviceView[];
  readonly address: ServeAddress;
  readonly allowWrites: boolean;
  /** Null when the registry is simply fine, which is the ordinary case. */
  readonly registry: RegistryTrouble | null;
  readonly serve: ServeState;
  /**
   * `startRemoteServer`'s own refusal message (a port already in use, most
   * often), or null while nothing has failed. Without this the panel had no
   * way to say WHY a phone can never reach the endpoint -- the operator saw a
   * pairing screen that looked live and a phone that could never connect,
   * with nothing on screen to explain the gap. Never cleared automatically:
   * there is no retry, so once set it is true for the rest of this run.
   */
  readonly serverError: string | null;
  /**
   * The persisted write-access preference (`remote/writes-preference.ts`),
   * read back so the panel can show what will be true the NEXT time vam
   * starts. Distinct from `allowWrites` above, which is what THIS running
   * server was actually started with -- the two can disagree the moment the
   * operator flips the toggle and before they restart vam.
   */
  readonly writesPreference: boolean;
  /** MAIN's clock, so the panel's countdown is not drawn against a second one. */
  readonly nowMs: number;
};
