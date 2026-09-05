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

  useEffect(() => {
    if (api === undefined || !active) return;
    let live = true;
    const read = () => {
      api.state().then(
        (next) => {
          if (live) setState(next);
        },
        () => {
          if (live) setOff(true);
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
   * moment the operator presses something rather than at the next poll. A
   * rejection means the same thing a failed read does: there is no endpoint.
   */
  const act = useCallback((run: () => Promise<RemoteState>) => {
    run().then(setState, () => setOff(true));
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
        onRegenerate={() => act(() => api.open())}
        onApprove={() => act(() => api.approve())}
        onDeny={() => act(() => api.deny())}
        onCopyUrl={() => {
          if (url !== null && copyText !== undefined) void copyText(url);
        }}
        onRemove={(deviceId) => act(() => api.remove(deviceId))}
        onRevokeAll={() => act(() => api.revokeAll())}
      />
      {state.address.kind === 'unavailable' ? (
        <p data-testid="remote-address-state">{NO_ADDRESS[state.address.reason]}</p>
      ) : null}
    </>
  );
}
