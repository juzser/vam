// @vitest-environment happy-dom

/**
 * WHAT REMOTE SHOWS ON A PHONE.
 *
 * Operator instruction: "on mobile the settings part can be removed; remote
 * only needs to show the paired devices". Withdrawing the other four sections
 * left one door, and until now that door opened onto a sentence -- "Remote
 * access is part of the desktop app: this page has no bridge to a pairing
 * screen" -- which was true and useless. The phone IS the browser build; it
 * has no `window.api` at all, so the list has to come over HTTP
 * (`/api/devices`, `sources/devices.ts`).
 *
 * THREE STATES, AND EACH SAYS ITS OWN CAUSE. Reading, a list, or the server's
 * own refusal in its own words -- never a shared plausible sentence, which is
 * the rule `RemotePanel`'s own header already states for the two ways there
 * can be no pairing to offer.
 *
 * IT IS A READ AND SAYS SO. There is no route that removes a device and no
 * control here that pretends there is: revoking from a device that can itself
 * be revoked is a fight the operator cannot referee from either end, and the
 * desktop is what holds the registry. A list with no controls is the honest
 * shape, not a limitation to apologise for -- but the operator does need to be
 * told where the controls ARE, or an absent control reads as a missing one.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PairedDeviceList } from '../../src/renderer/settings/PairedDeviceList.js';
import type { PairedDevices } from '../../src/renderer/sources/devices.js';

const ANSWER: PairedDevices = {
  you: 'device-1',
  devices: [
    { deviceId: 'device-1', name: 'the hallway phone', pairedAt: 1, lastSeenAt: 2 },
    { deviceId: 'device-2', name: 'the kitchen tablet', pairedAt: 3, lastSeenAt: 4 },
  ],
};

afterEach(cleanup);

describe('the paired device list', () => {
  it('says it is reading before it has read', () => {
    render(<PairedDeviceList read={() => new Promise<PairedDevices>(() => {})} />);
    expect(screen.getByTestId('devices-loading')).toBeTruthy();
  });

  it('names every paired device', async () => {
    render(<PairedDeviceList read={async () => ANSWER} />);
    expect(await screen.findByText('the hallway phone')).toBeTruthy();
    expect(screen.getByText('the kitchen tablet')).toBeTruthy();
  });

  /**
   * WHICH ONE IS THIS ONE. Two phones with similar names are the case worth
   * building for: without the mark the operator has to remember which name
   * they typed on which device, weeks ago, at a pairing screen.
   */
  it('marks the device doing the asking', async () => {
    render(<PairedDeviceList read={async () => ANSWER} />);
    const rows = await screen.findAllByTestId('device-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-you')).toBe('true');
    expect(rows[1]?.getAttribute('data-you')).toBe('false');
    // Announced, not only painted: the mark is a fact a screen reader needs.
    expect(rows[0]?.textContent).toContain('this device');
  });

  it('offers no control that removes anything', async () => {
    const { container } = render(<PairedDeviceList read={async () => ANSWER} />);
    await screen.findAllByTestId('device-row');
    expect(container.querySelectorAll('button')).toHaveLength(0);
    // And it says where the controls are, so an absent one does not read as a
    // missing one.
    expect(container.textContent).toMatch(/desktop/i);
  });

  it('shows the server’s own refusal, in its own words', async () => {
    render(
      <PairedDeviceList
        read={async () => {
          throw { kind: 'refused', code: 'unauthenticated', message: 'not paired' };
        }}
      />,
    );
    const failed = await screen.findByTestId('devices-failed');
    expect(failed.textContent).toContain('unauthenticated');
    expect(failed.textContent).toContain('not paired');
  });

  /**
   * A THROW THAT IS NOT A `SourceError` STILL HAS TO SAY SOMETHING. This
   * component renders whatever the reader rejected with, and a bare `TypeError`
   * rendered through a `code: message` template is two `undefined`s on screen
   * -- the "something went wrong" this repo refuses to ship.
   */
  it('survives a rejection that is not a SourceError', async () => {
    render(
      <PairedDeviceList
        read={async () => {
          throw new TypeError('Failed to fetch');
        }}
      />,
    );
    const failed = await screen.findByTestId('devices-failed');
    expect(failed.textContent).not.toContain('undefined');
    expect(failed.textContent).toContain('Failed to fetch');
  });

  it('says so plainly when nothing is paired', async () => {
    render(<PairedDeviceList read={async () => ({ you: 'device-1', devices: [] })} />);
    expect(await screen.findByTestId('devices-empty')).toBeTruthy();
  });
});
