/**
 * The pairing screen, connected: main holds the code, this holds nothing.
 *
 * `PairingPanel` is presentational by design -- every value arrives as a prop
 * and every act leaves as a callback -- so this is the whole of the state it
 * needs: one snapshot from main, re-read while the section is open, and
 * replaced by whatever an act answered with. The clock is MAIN's `nowMs`,
 * never a second one here; two clocks disagree about a two-minute code the
 * first time a render is late.
 *
 * A CONTROL THAT CANNOT ACT IS NOT DRAWN AS ONE. There are two ways for there
 * to be no pairing to offer -- a browser build with no bridge at all, and a
 * desktop with no remote endpoint configured, whose channels main never
 * registered -- and each says its own actual cause instead of a shared
 * plausible one.
 */

import { useCallback, useEffect, useState } from 'react';
import type { RemoteApi, RemoteState } from '../../preload/api.js';
import { PairingPanel } from './PairingPanel.js';

/** Matches main's `ADDRESS_CACHE_MS` floor: the poll is cheap by construction. */
const POLL_MS = 1_000;

/** Why there is no address, said in the operator's terms rather than a code. */
const NO_ADDRESS: Record<string, string> = {
  'no-cli':
    'vam could not ask this machine for its address: there is no tailscale command here. Read the https address off `tailscale serve` and type it into the phone.',
  'not-running':
    'Tailscale is not running on this machine, so there is no address for the phone to reach yet.',
  'no-name':
    'Tailscale is running but reported no MagicDNS name, and vam will not guess one. Read the https address off `tailscale serve`.',
};

/**
 * The bridge's `remote` member, which `src/preload/index.ts` exposes beside
 * `usage`, `clipboard`, `terminal` and `dialog`.
 *
 * Read through a local view of the bridge object rather than by widening the
 * `Window` declaration in `App.tsx`: that declaration is the renderer root's,
 * and this is the one section that needs this member. The assertion is not a
 * guess -- the preload puts it there unconditionally -- and it stays `?` so
 * the browser build, which has no bridge at all, still narrows to absent.
 */
type BridgeWithRemote = { readonly remote?: RemoteApi };

/** Every control on the panel, so a failure can be said in its own terms. */
type ActName = 'open' | 'approve' | 'deny' | 'remove' | 'revokeAll';

/**
 * What failed, and -- for the two that revoke access -- what is still true
 * afterwards. An operator removing a device needs to know whether it actually
 * happened, and the answer here is that it did not.
 */
const ACT_FAILED: Record<ActName, string> = {
  open: 'vam could not mint a pairing code.',
  approve: 'vam could not allow that device.',
  deny: 'vam could not turn that device away.',
  remove: 'vam could not remove that device: it is still paired, and its token still works.',
  revokeAll: 'vam could not revoke these devices: they are still paired, and their tokens still work.',
};

/** The registry's own trouble, which no surface said before. */
const REGISTRY_TROUBLE: Record<'unreadable' | 'write-failed', string> = {
  unreadable:
    'vam could not read its device registry, so it is admitting no phone at all. It has NOT overwritten the file -- pairing a device would, so vam refuses until the file is readable again.',
  'write-failed':
    'The last pairing change could not be written to disk, so it did not take effect: a device you allowed is not paired, and one you removed may still be.',
};

/** The same tail on every one: the endpoint answered, so it is not the cause. */
const ACT_TAIL =
  " The remote endpoint is running -- this failed inside vam, most often a device registry it could not write. The list below is the last state vam read.";

export function desktopRemoteApi(): RemoteApi | undefined {
  return (globalThis.window?.api as unknown as BridgeWithRemote | undefined)?.remote;
}

export type RemotePanelProps = {
  /** Absent in the browser build, which has no preload and no bridge. */
  readonly api: RemoteApi | undefined;
  /** Electron's clipboard; the page's own is denied by the permission policy. */
  readonly copyText?: (text: string) => Promise<boolean>;
  /** Polling runs only while the section is on screen. */
  readonly active: boolean;
};

export function RemotePanel({ api, copyText, active }: RemotePanelProps) {
  const [state, setState] = useState<RemoteState | null>(null);
  /** True once a read has failed: main registered no handler, so pairing is off. */
  const [off, setOff] = useState(api === undefined);
  /** The last act that rejected, if the operator has not acted since. */
  const [failed, setFailed] = useState<ActName | null>(null);

  useEffect(() => {
    if (api === undefined || !active) return;
    let live = true;
    // Whether main has EVER answered this section. Kept in the effect rather
    // than in state so a re-render cannot restart the poll under a state it
    // just produced.
    let answered = false;
    const read = () => {
      api.state().then(
        (next) => {
          answered = true;
          if (live) setState(next);
        },
        () => {
          // A read that failed having NEVER succeeded is the one case that
          // means main registered no handler. After a good one the endpoint
          // demonstrably exists, so a later failure is not a reason to take
          // the pairing screen away.
          if (live && !answered) setOff(true);
        },
      );
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, active]);

  /**
   * An act answers with the state it produced, so the panel is truthful the
   * moment the operator presses something rather than at the next poll.
   *
   * A REJECTION HERE IS NOT "THERE IS NO ENDPOINT". Main answered; the work
   * inside it failed -- a registry write on a full or read-only volume is the
   * ordinary way. Saying "the endpoint is not running" for that sends the
   * operator to restart vam over a disk, and it took the device list off
   * screen with it, which is the one surface that shows whether a revocation
   * happened. So the act names ITS OWN failure and the panel stays.
   */
  const act = useCallback((name: ActName, run: () => Promise<RemoteState>) => {
    run().then(
      (next) => {
        setFailed(null);
        setState(next);
      },
      () => setFailed(name),
    );
  }, []);

  if (api === undefined || off) {
    return (
      <p data-testid="remote-off">
        {api === undefined
          ? 'Remote access is part of the desktop app: this page has no bridge to a pairing screen.'
          : "vam's remote endpoint is not running, so there is nothing for a phone to pair with. Start vam with VAM_REMOTE_PORT set."}
      </p>
    );
  }
  if (state === null) {
    return <p data-testid="remote-loading">Reading the pairing screen…</p>;
  }

  const url = state.address.kind === 'found' ? state.address.url : null;
  return (
    <>
      <PairingPanel
        view={state.view}
        devices={state.devices}
        url={url}
        allowWrites={state.allowWrites}
        nowMs={state.nowMs}
        onRegenerate={() => act('open', () => api.open())}
        onApprove={() => act('approve', () => api.approve())}
        onDeny={() => act('deny', () => api.deny())}
        onCopyUrl={() => {
          if (url !== null && copyText !== undefined) void copyText(url);
        }}
        onRemove={(deviceId) => act('remove', () => api.remove(deviceId))}
        onRevokeAll={() => act('revokeAll', () => api.revokeAll())}
      />
      {state.registry !== null ? (
        <p data-testid="remote-registry" role="alert">
          {REGISTRY_TROUBLE[state.registry]}
        </p>
      ) : null}
      {failed !== null ? (
        <p data-testid="remote-act-failed" role="alert">
          {ACT_FAILED[failed]}
          {ACT_TAIL}
        </p>
      ) : null}
      {state.address.kind === 'unavailable' ? (
        <p data-testid="remote-address-state">{NO_ADDRESS[state.address.reason]}</p>
      ) : null}
    </>
  );
}
