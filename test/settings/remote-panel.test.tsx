// @vitest-environment happy-dom

/**
 * The settings panel that makes pairing reachable: what it asks main for, and
 * what it says when there is nothing to ask.
 *
 * A control that cannot act is not drawn as one -- with no remote endpoint
 * configured there is no code button at all, and the panel names the ACTUAL
 * cause rather than a plausible one. No fixture here is a real machine,
 * tailnet, device or token.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteApi, RemoteState } from '../../src/preload/api.js';
import { RemotePanel } from '../../src/renderer/settings/RemotePanel.js';

afterEach(cleanup);

const NOW = 1_700_000_000_000;

const IDLE: RemoteState = {
  view: {
    code: null,
    expiresAtMs: 0,
    burned: false,
    throttledUntilMs: 0,
    awaiting: null,
    pairedName: null,
  },
  devices: [],
  address: { kind: 'unavailable', reason: 'no-cli' },
  allowWrites: false,
  registry: null,
  nowMs: NOW,
};

function fakeApi(over: Partial<RemoteState> = {}, opened: Partial<RemoteState> = {}): RemoteApi {
  const idle = { ...IDLE, ...over };
  return {
    state: vi.fn(async () => idle),
    open: vi.fn(async () => ({
      ...idle,
      view: { ...idle.view, code: 'ABCD2345', expiresAtMs: NOW + 120_000 },
      ...opened,
    })),
    approve: vi.fn(async () => idle),
    deny: vi.fn(async () => idle),
    remove: vi.fn(async () => idle),
    revokeAll: vi.fn(async () => idle),
  };
}

describe('RemotePanel', () => {
  it('opens the pairing screen in main and shows the code it minted', async () => {
    const api = fakeApi();
    render(<RemotePanel api={api} active />);
    await screen.findByText('Show a pairing code');

    await userEvent.click(screen.getByText('Show a pairing code'));

    expect(api.open).toHaveBeenCalledTimes(1);
    expect((await screen.findByTestId('pairing-code')).textContent).toBe('ABCD-2345');
  });

  it('shows the https address when this machine could be asked for it', async () => {
    const api = fakeApi({
      address: { kind: 'found', url: 'https://example-machine.example-tailnet.ts.net' },
    });
    render(<RemotePanel api={api} active />);

    expect((await screen.findByTestId('pairing-url')).textContent).toBe(
      'https://example-machine.example-tailnet.ts.net',
    );
    expect(screen.queryByTestId('remote-address-state')).toBeNull();
  });

  it.each([
    ['no-cli', /could not ask/i],
    ['not-running', /Tailscale is not running/i],
    ['no-name', /will not guess/i],
  ] as const)('names %s as the reason there is no address', async (reason, said) => {
    render(<RemotePanel api={fakeApi({ address: { kind: 'unavailable', reason } })} active />);

    expect((await screen.findByTestId('remote-address-state')).textContent).toMatch(said);
  });

  it('says the endpoint is off, and draws no control at all, when main has no handler', async () => {
    const api = fakeApi();
    api.state = vi.fn(async () => {
      throw new Error("No handler registered for 'vam:remote:state'");
    });
    render(<RemotePanel api={api} active />);

    expect((await screen.findByTestId('remote-off')).textContent).toMatch(/not running/i);
    expect(screen.queryByText('Show a pairing code')).toBeNull();
  });

  it('says so in the browser build, where there is no bridge to ask', async () => {
    render(<RemotePanel api={undefined} active />);

    expect((await screen.findByTestId('remote-off')).textContent).toMatch(/desktop app/i);
  });

  it('copies the https address through electron clipboard, not the page own', async () => {
    const copyText = vi.fn(async () => true);
    const api = fakeApi({
      address: { kind: 'found', url: 'https://example-machine.example-tailnet.ts.net' },
    });
    render(<RemotePanel api={api} copyText={copyText} active />);

    await userEvent.click(await screen.findByText('Copy address'));

    expect(copyText).toHaveBeenCalledWith('https://example-machine.example-tailnet.ts.net');
  });

  it('forwards allow, remove and revoke-all to main', async () => {
    const api = fakeApi({
      view: { ...IDLE.view, awaiting: { name: 'a phone', source: '127.0.0.1' } },
      devices: [{ deviceId: 'device-1', name: 'a phone', pairedAt: NOW, lastSeenAt: NOW }],
    });
    render(<RemotePanel api={api} active />);

    await userEvent.click(await screen.findByText('Allow this device'));
    await userEvent.click(screen.getByLabelText('Remove a phone'));
    await userEvent.click(screen.getByText('Revoke all'));

    await waitFor(() => expect(api.approve).toHaveBeenCalledTimes(1));
    expect(api.remove).toHaveBeenCalledWith('device-1');
    expect(api.revokeAll).toHaveBeenCalledTimes(1);
  });
});
