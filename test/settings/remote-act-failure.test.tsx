// @vitest-environment happy-dom

/**
 * What the pairing screen says when an ACT fails rather than the endpoint.
 *
 * A revocation is the act where a wrong cause costs the most: the operator is
 * removing a device's access, and "the remote endpoint is not running" tells
 * them the endpoint is the problem while the device they tried to remove is
 * still paired and its token still opens every route. Reproduced first --
 * before this file the panel answered a rejected `remove` with exactly that
 * sentence and unmounted the device list with it.
 *
 * No fixture here is a real device, machine or token.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteApi, RemoteState } from '../../src/preload/api.js';
import { RemotePanel } from '../../src/renderer/settings/RemotePanel.js';

afterEach(cleanup);
const NOW = 1_700_000_000_000;
const PAIRED: RemoteState = {
  view: {
    code: null,
    expiresAtMs: 0,
    burned: false,
    throttledUntilMs: 0,
    awaiting: null,
    pairedName: null,
  },
  devices: [{ deviceId: 'device-1', name: 'a paired phone', pairedAt: NOW, lastSeenAt: NOW }],
  address: { kind: 'unavailable', reason: 'no-cli' },
  allowWrites: false,
  nowMs: NOW,
};

function api(over: Partial<RemoteApi> = {}): RemoteApi {
  return {
    state: vi.fn(async () => PAIRED),
    open: vi.fn(async () => PAIRED),
    approve: vi.fn(async () => PAIRED),
    deny: vi.fn(async () => PAIRED),
    remove: vi.fn(async () => PAIRED),
    revokeAll: vi.fn(async () => PAIRED),
    ...over,
  };
}

const fails = async (): Promise<RemoteState> => {
  throw new Error('ENOSPC: no space left on device');
};

describe('an act that fails while the endpoint is running', () => {
  it('says the revocation failed, and keeps the device list on screen', async () => {
    render(<RemotePanel api={api({ remove: vi.fn(fails) })} active />);
    await screen.findByTestId('paired-device-device-1');
    await userEvent.click(screen.getByLabelText('Remove a paired phone'));

    const said = await screen.findByTestId('remote-act-failed');
    // The operator's actual question is whether the device lost access.
    expect(said.textContent).toContain('could not remove that device');
    expect(said.textContent).toContain('still paired');
    // The cause it must NOT name: the endpoint answered, it just failed.
    expect(said.textContent).not.toContain('not running');
    expect(screen.queryByTestId('remote-off')).toBeNull();
    // The list is the surface that would show whether it worked.
    expect(screen.getByTestId('paired-device-device-1')).toBeTruthy();
  });

  it('clears the failure once an act succeeds', async () => {
    const remove = vi.fn(fails);
    render(<RemotePanel api={api({ remove })} active />);
    await screen.findByTestId('paired-device-device-1');
    await userEvent.click(screen.getByLabelText('Remove a paired phone'));
    await screen.findByTestId('remote-act-failed');

    remove.mockImplementation(async () => PAIRED);
    await userEvent.click(screen.getByLabelText('Remove a paired phone'));
    await waitFor(() => expect(screen.queryByTestId('remote-act-failed')).toBeNull());
  });

  it('keeps the panel when a POLL fails after one good read', async () => {
    // A read that fails having never succeeded is "main registered no
    // handler"; one that fails after a good one is not, and collapsing the
    // screen for it hides the device list for a transient failure.
    const state = vi.fn(async () => PAIRED);
    render(<RemotePanel api={api({ state })} active />);
    await screen.findByTestId('paired-device-device-1');
    state.mockImplementation(fails);
    await waitFor(() => expect(state.mock.calls.length).toBeGreaterThan(1), { timeout: 3_000 });
    expect(screen.queryByTestId('remote-off')).toBeNull();
    expect(screen.getByTestId('paired-device-device-1')).toBeTruthy();
  });
});
