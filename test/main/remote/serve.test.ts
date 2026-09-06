/**
 * Turning `tailscale serve` on and off, and the honest words when it refuses.
 *
 * NOTHING HERE RUNS `tailscale`, and nothing here runs `tailscale serve` for
 * real -- see `hostname.test.ts`'s own note. The CLI is a double in every
 * case: the property under test is the exact argv vam sends it and the exact
 * words vam hands back on a refusal, never a live process.
 */

import { describe, expect, it, vi } from 'vitest';
import { disableServe, enableServe } from '../../../src/main/remote/serve.js';

describe('enableServe', () => {
  it('runs `tailscale serve --bg <port>` with the port it was given', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '' }));

    await enableServe(run, 4321);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(['serve', '--bg', '4321']);
  });

  it('threads the ACTUAL port through rather than a fixed one', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '' }));

    await enableServe(run, 9999);

    expect(run).toHaveBeenCalledWith(['serve', '--bg', '9999']);
    expect(run).not.toHaveBeenCalledWith(['serve', '--bg', '4321']);
  });

  it('reports ok on a clean exit', async () => {
    const result = await enableServe(async () => ({ code: 0, stdout: '' }), 4321);

    expect(result).toEqual({ kind: 'ok' });
  });

  it('surfaces a missing CLI in its own real words, not a generic error', async () => {
    const result = await enableServe(async () => {
      throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' });
    }, 4321);

    expect(result).toEqual({ kind: 'refused', message: 'spawn tailscale ENOENT' });
  });

  it('surfaces a permission refusal in its own real words, verbatim', async () => {
    // A real Node execFile failure carries the child's stderr in the error's
    // own message; this is what that looks like, not a guess at wording.
    const result = await enableServe(async () => {
      throw new Error(
        'Command failed: tailscale serve --bg 4321\naccess denied: reauthenticate to use Serve',
      );
    }, 4321);

    expect(result).toEqual({
      kind: 'refused',
      message:
        'Command failed: tailscale serve --bg 4321\naccess denied: reauthenticate to use Serve',
    });
  });

  it('surfaces a resolved non-zero exit by its own stdout, when the runner does not reject', async () => {
    const result = await enableServe(
      async () => ({ code: 1, stdout: 'HTTPS is not enabled for this tailnet' }),
      4321,
    );

    expect(result).toEqual({ kind: 'refused', message: 'HTTPS is not enabled for this tailnet' });
  });

  it('never invents a diagnosis for a resolved failure with nothing to say', async () => {
    const result = await enableServe(async () => ({ code: 1, stdout: '' }), 4321);

    expect(result).toEqual({ kind: 'refused', message: 'tailscale exited with code 1' });
  });
});

describe('disableServe', () => {
  it('runs `tailscale serve reset`, taking no port at all', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '' }));

    await disableServe(run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(['serve', 'reset']);
  });

  it('reports ok on a clean exit', async () => {
    const result = await disableServe(async () => ({ code: 0, stdout: '' }));

    expect(result).toEqual({ kind: 'ok' });
  });

  it('surfaces a refusal in its own words, same as enabling', async () => {
    const result = await disableServe(async () => {
      throw new Error('failed to connect to local tailscaled; it does not appear to be running');
    });

    expect(result).toEqual({
      kind: 'refused',
      message: 'failed to connect to local tailscaled; it does not appear to be running',
    });
  });
});
