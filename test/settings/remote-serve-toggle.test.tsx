// @vitest-environment happy-dom

/**
 * `RemotePanel` wiring the phone-access control into `api.enableServe` and
 * `api.disableServe` -- what main's `no-cli` reason gates, what a click does,
 * and the property this whole feature exists to hold: a click is the only
 * thing that can ever turn this on.
 *
 * No fixture here is a real machine, tailnet, device or token.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteApi, RemoteState } from '../../src/preload/api.js';
import { RemotePanel } from '../../src/renderer/settings/RemotePanel.js';

afterEach(cleanup);

const NOW = 1_700_000_000_000;

const BASE: RemoteState = {
  view: {
    code: null,
    expiresAtMs: 0,
    burned: false,
    throttledUntilMs: 0,
    awaiting: null,
    pairedName: null,
  },
  devices: [],
  address: { kind: 'found', url: 'https://example-machine.example-tailnet.ts.net' },
  allowWrites: false,
  registry: null,
  serve: { enabled: false, lastError: null },
  nowMs: NOW,
};

function fakeApi(over: Partial<RemoteState> = {}): RemoteApi {
  const idle = { ...BASE, ...over };
  return {
    state: vi.fn(async () => idle),
    open: vi.fn(async () => idle),
    approve: vi.fn(async () => idle),
    deny: vi.fn(async () => idle),
    remove: vi.fn(async () => idle),
    revokeAll: vi.fn(async () => idle),
    enableServe: vi.fn(async () => ({ ...idle, serve: { enabled: true, lastError: null } })),
    disableServe: vi.fn(async () => ({ ...idle, serve: { enabled: false, lastError: null } })),
  };
}

describe('RemotePanel: phone access', () => {
  it('is inert, offering nothing, when main reports no CLI', async () => {
    const api = fakeApi({ address: { kind: 'unavailable', reason: 'no-cli' } });
    render(<RemotePanel api={api} active />);

    expect(await screen.findByTestId('serve-no-cli')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /enable phone access/i })).toBeNull();
  });

  it('never calls enableServe merely from rendering or polling the panel', async () => {
    const api = fakeApi();
    render(<RemotePanel api={api} active />);
    await screen.findByRole('button', { name: /enable phone access/i });

    // `POLL_MS` (RemotePanel.tsx) is 1s; wait through several real ticks of
    // `api.state()` without ever clicking anything.
    await waitFor(() => expect(vi.mocked(api.state).mock.calls.length).toBeGreaterThan(2), {
      timeout: 5_000,
    });

    expect(api.enableServe).not.toHaveBeenCalled();
    expect(api.disableServe).not.toHaveBeenCalled();
  }, 10_000);

  it('enables on a click and flips the panel to the on state', async () => {
    const api = fakeApi();
    render(<RemotePanel api={api} active />);
    const enable = await screen.findByRole('button', { name: /enable phone access/i });

    await userEvent.click(enable);

    expect(api.enableServe).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /turn off phone access/i })).toBeTruthy();
  });

  it('disables on a click and flips the panel back off', async () => {
    const api = fakeApi({ serve: { enabled: true, lastError: null } });
    render(<RemotePanel api={api} active />);
    const disable = await screen.findByRole('button', { name: /turn off phone access/i });

    await userEvent.click(disable);

    expect(api.disableServe).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /enable phone access/i })).toBeTruthy();
  });

  it("surfaces a refusal in the CLI's own words, verbatim", async () => {
    const api = fakeApi();
    api.enableServe = vi.fn(async () => ({
      ...BASE,
      serve: { enabled: false, lastError: 'access denied: reauthenticate to use Serve' },
    }));
    render(<RemotePanel api={api} active />);
    const enable = await screen.findByRole('button', { name: /enable phone access/i });

    await userEvent.click(enable);

    const said = await screen.findByTestId('serve-error');
    expect(said.textContent).toBe('access denied: reauthenticate to use Serve');
  });
});
