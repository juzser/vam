/**
 * Remote access, as the operator sees it: one code, and the devices it made.
 *
 * TAILSCALE AUTHENTICATES A DEVICE ONTO A NETWORK; IT DOES NOT AUTHORISE THAT
 * DEVICE TO DRIVE YOUR AGENTS. The panel says so in as many words, because the
 * whole screen is otherwise easy to read as "the address is secret" -- and it
 * is not: every laptop, phone, tablet, server, CI runner and shared-in
 * external user on the tailnet can reach it, and the FQDN is public in
 * Certificate Transparency logs. What the operator grants here is the ability
 * to close sessions and type into a running agent, which is why a correct code
 * is not enough on its own and the ALLOW prompt exists.
 *
 * Presentational only: every piece of state arrives as a prop and every act
 * leaves as a callback. The code, its clock and the device list all live in
 * main, where the registry is.
 */

import { Copy, Trash2 } from 'lucide-react';

/** Mirrors main's `PairedDevice`, minus the token, which never leaves main. */
export type PairedDeviceView = {
  readonly deviceId: string;
  readonly name: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number;
};

export type PairingView = {
  /** The eight raw symbols, or null while no screen-opened code is live. */
  readonly code: string | null;
  readonly expiresAtMs: number;
  readonly burned: boolean;
  /** Non-zero while pairing is disabled after a run of failures. */
  readonly throttledUntilMs: number;
  readonly awaiting: { readonly name: string; readonly source: string } | null;
  readonly pairedName: string | null;
};

export type PairingPanelProps = {
  readonly view: PairingView;
  readonly devices: readonly PairedDeviceView[];
  /**
   * The `https://<machine>.<tailnet>.ts.net` address `tailscale serve` prints.
   * NULL IS ORDINARY: reading it needs the Tailscale CLI, and vam does not
   * depend on one being installed. HTTPS only -- the certificate is what makes
   * the phone's origin a secure context, and a plain http MagicDNS URL is not.
   */
  readonly url: string | null;
  readonly allowWrites: boolean;
  readonly nowMs: number;
  readonly onRegenerate: () => void;
  readonly onApprove: () => void;
  readonly onDeny: () => void;
  readonly onCopyUrl: () => void;
  readonly onRemove: (deviceId: string) => void;
  readonly onRevokeAll: () => void;
};

/** `XXXX-XXXX`: a group of four is what a person holds while looking away. */
const grouped = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

function countdown(expiresAtMs: number, nowMs: number): string {
  const left = Math.max(0, Math.round((expiresAtMs - nowMs) / 1000));
  return `expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

const UNITS: readonly [number, string][] = [
  [86_400_000, 'day'],
  [3_600_000, 'hour'],
  [60_000, 'minute'],
];

/** Coarse on purpose: the operator is recognising a device, not auditing it. */
function ago(at: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - at);
  for (const [size, unit] of UNITS) {
    const count = Math.floor(elapsed / size);
    if (count >= 1) {
      return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

export function PairingPanel(props: PairingPanelProps) {
  const { view, nowMs } = props;
  const throttled = view.throttledUntilMs > nowMs;
  return (
    <section className="pairing">
      <h3>Remote access</h3>
      <p>
        Everyone on your tailnet reaches this address — every laptop, phone, server and shared-in
        guest. Being on the tailnet does not authorise a device to drive your agents; pairing it
        here is what does.
      </p>

      {props.url === null ? (
        <p data-testid="pairing-hint">
          Run <code>tailscale serve</code> on this machine and open the https address it prints. It
          must be https: the certificate is what lets the phone keep a credential at all.
        </p>
      ) : (
        <p>
          <span data-testid="pairing-url">{props.url}</span>{' '}
          <button type="button" onClick={props.onCopyUrl}>
            <Copy aria-hidden="true" size={14} /> Copy address
          </button>
        </p>
      )}

      <p data-testid="pairing-writes">
        {props.allowWrites
          ? 'This server accepts writes: a paired device can close sessions and type into a running agent.'
          : 'This server is read-only: the write routes are not registered at all.'}
      </p>

      {view.code === null ? (
        <button type="button" onClick={props.onRegenerate}>
          {view.burned ? 'Regenerate' : 'Show a pairing code'}
        </button>
      ) : (
        <div>
          <p data-testid="pairing-code" className="pairing-code">
            {grouped(view.code)}
          </p>
          <p data-testid="pairing-countdown">{countdown(view.expiresAtMs, nowMs)}</p>
          <button type="button" onClick={props.onRegenerate}>
            Regenerate
          </button>
        </div>
      )}

      {view.awaiting === null ? null : (
        <section data-testid="pairing-approval" aria-label="allow this device">
          {/*
            THE NAME IS ATTACKER-CHOSEN TEXT and it is the operator's only
            discriminator here: `source` behind `tailscale serve` is always
            127.0.0.1 and says nothing. So it is rendered as its own quoted
            block, never inside the sentence -- a name that sat in the prose
            could close a quotation and prepend "Read-only." to argue against
            the warning it is standing in. Main strips the punctuation that
            would let it try; this is the half that means it has nothing to
            close even if some got through.
          */}
          <p>A device is asking to pair. It calls itself:</p>
          <p data-testid="pairing-device-name" className="pairing-device-name">
            {view.awaiting.name}
          </p>
          <p data-testid="pairing-grant">
            Allow it?{' '}
            {props.allowWrites
              ? 'It will be able to read your sessions and to type into a running agent.'
              : 'It will be able to read your sessions; this server is read-only, so it cannot type into an agent.'}
          </p>
          <p data-testid="pairing-source">Connecting from {view.awaiting.source}.</p>
          <button type="button" onClick={props.onApprove}>
            Allow this device
          </button>
          <button type="button" onClick={props.onDeny}>
            Don't allow
          </button>
        </section>
      )}

      {view.burned || throttled ? (
        <p data-testid="pairing-warning" role="alert">
          {throttled
            ? 'Too many failed attempts: an unpaired device is trying to connect. Pairing is off for 15 minutes.'
            : 'Code burned after five wrong answers — press Regenerate for a new one.'}
        </p>
      ) : null}

      <p data-testid="pairing-status">
        {view.pairedName === null
          ? view.code === null
            ? 'No code is live. A device can only pair while one is.'
            : 'Waiting for a device…'
          : `Paired: ${view.pairedName}`}
      </p>

      <h4>Paired devices</h4>
      <div data-testid="paired-devices">
        {props.devices.length === 0 ? (
          <p>No devices are paired.</p>
        ) : (
          <>
            <ul>
              {props.devices.map((device) => (
                <li key={device.deviceId} data-testid={`paired-device-${device.deviceId}`}>
                  <span>{device.name}</span>{' '}
                  <span>
                    paired {ago(device.pairedAt, nowMs)}, last seen {ago(device.lastSeenAt, nowMs)}
                  </span>{' '}
                  <button
                    type="button"
                    aria-label={`Remove ${device.name}`}
                    onClick={() => props.onRemove(device.deviceId)}
                  >
                    <Trash2 aria-hidden="true" size={14} /> Remove
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={props.onRevokeAll}>
              Revoke all
            </button>
          </>
        )}
      </div>
    </section>
  );
}
