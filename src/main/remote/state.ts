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

export type RemoteState = {
  readonly view: PairingStateView;
  readonly devices: readonly RemoteDeviceView[];
  readonly address: ServeAddress;
  readonly allowWrites: boolean;
  /** Null when the registry is simply fine, which is the ordinary case. */
  readonly registry: RegistryTrouble | null;
  /** MAIN's clock, so the panel's countdown is not drawn against a second one. */
  readonly nowMs: number;
};
