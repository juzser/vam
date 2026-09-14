/**
 * THE PAIRED DEVICES, READ-ONLY -- what Remote is on a phone.
 *
 * Operator instruction: "on mobile the settings part can be removed; remote
 * only needs to show the paired devices". Withdrawing the other four sections
 * (`sections.ts`, `PHONE_SECTIONS`) left one door, and that door opened onto a
 * sentence -- "Remote access is part of the desktop app: this page has no
 * bridge to a pairing screen" -- which was true and useless. The phone IS the
 * browser build, so the list arrives over HTTP (`sources/devices.ts`).
 *
 * NO CONTROLS, AND THAT IS THE SHAPE RATHER THAN A LIMITATION. The server
 * registers no route that removes a device, deliberately: revocation from a
 * device that can itself be revoked is a fight the operator cannot referee
 * from either end, and the desktop is what holds the registry file. What this
 * surface owes them is therefore not a control but a SENTENCE saying where the
 * controls are -- an absent control with no explanation reads as a missing
 * one, which is the same defect as a dead one wearing a different face.
 *
 * THREE STATES, EACH SAYING ITS OWN CAUSE. Reading, a list, or the server's
 * own refusal in its own words. `RemotePanel`'s header already states this
 * rule for the two ways there can be no pairing to offer; this is the same
 * rule one layer down.
 */

import { useEffect, useState } from 'react';
import { type PairedDevices, readPairedDevices } from '../sources/devices.js';
import { describeFailure } from '../sources/port.js';

export type PairedDeviceListProps = {
  /** Injectable so a test can hold, answer or refuse without a server. */
  readonly read?: () => Promise<PairedDevices>;
};

type State =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly answer: PairedDevices }
  | { readonly kind: 'failed'; readonly note: string };

export function PairedDeviceList({ read }: PairedDeviceListProps) {
  const [state, setState] = useState<State>({ kind: 'reading' });

  useEffect(() => {
    let live = true;
    const ask = read ?? (() => readPairedDevices());
    ask()
      .then((answer) => {
        if (live) setState({ kind: 'read', answer });
      })
      .catch((cause: unknown) => {
        // `describeFailure` renders a `SourceError` as `code: message` and
        // everything else as itself -- which is the whole reason it is used
        // here rather than a template: a bare `TypeError: Failed to fetch`
        // through `${code}: ${message}` is two `undefined`s on screen.
        if (live) setState({ kind: 'failed', note: describeFailure(cause) });
      });
    return () => {
      live = false;
    };
  }, [read]);

  if (state.kind === 'reading') {
    return (
      <p data-testid="devices-loading" className="text-control text-ink-dim">
        Reading the paired devices…
      </p>
    );
  }
  if (state.kind === 'failed') {
    return (
      <p data-testid="devices-failed" role="alert" className="text-control text-ink-dim">
        vam could not read the paired devices — {state.note}
      </p>
    );
  }

  const { you, devices } = state.answer;
  return (
    <div className="flex flex-col gap-2">
      {devices.length === 0 ? (
        <p data-testid="devices-empty" className="text-control text-ink-dim">
          Nothing is paired with this vam.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {devices.map((device) => (
            <li
              key={device.deviceId}
              data-testid="device-row"
              data-you={device.deviceId === you ? 'true' : 'false'}
              className="flex items-baseline gap-2 border-line border-b py-1.5 text-control last:border-b-0"
            >
              <span className="min-w-0 flex-1 break-words text-ink">{device.name}</span>
              {/* ANNOUNCED, NOT ONLY PAINTED. Which device you are holding is
                  a fact a screen reader needs as much as an eye does, and two
                  phones with similar names is the case this exists for. */}
              {device.deviceId === you && (
                <span className="flex-none text-ink-dim text-meta">this device</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* WHERE THE CONTROLS ARE. Pairing, approving and revoking all live on
          the machine that holds the registry, and saying so is what keeps
          their absence here from reading as a missing feature. */}
      <p className="text-ink-faint text-meta">
        Pairing and revoking happen on the desktop, which is where the list is kept.
      </p>
    </div>
  );
}
