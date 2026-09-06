/**
 * Turning `tailscale serve` on and off, the honest words when it refuses, and
 * the two measured failure modes the coordinator verified against a real
 * `tailscale` (1.102.2) that this module must never reproduce:
 *
 * 1. `tailscale serve --bg --yes 39999` was run against a healthy, logged-in
 *    node with two peers and produced NO output, NEVER RETURNED, and
 *    configured nothing -- `tailscale serve status` still said "No serve
 *    config" two minutes later. An indefinite hang is a real, reachable state
 *    on a working machine, not a hypothetical one.
 * 2. `tailscale serve reset` is, by the CLI's own `--help` text, "Reset
 *    current serve config" -- ALL of it, not vam's one port. vam must never
 *    run it: disabling uses the TARGETED off instead.
 *
 * NOTHING HERE RUNS `tailscale`, and nothing here runs `tailscale serve` for
 * real -- see `hostname.test.ts`'s own note. The CLI is a double in every
 * case: the property under test is the exact argv vam sends it and the exact
 * words vam hands back on a refusal, never a live process.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATTEMPT_TIMEOUT_MS, disableServe, enableServe } from '../../../src/main/remote/serve.js';

afterEach(() => {
  vi.useRealTimers();
});

/** A runner that never settles -- the exact shape of the measured hang. */
const hangs = () => new Promise<{ code: number; stdout: string }>(() => {});

describe('enableServe', () => {
  it('runs `tailscale serve --bg --yes <port>` with the port it was given', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '' }));

    await enableServe(run, 4321);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(['serve', '--bg', '--yes', '4321']);
  });

  it('threads the ACTUAL port through rather than a fixed one', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '' }));

    await enableServe(run, 9999);

    expect(run).toHaveBeenCalledWith(['serve', '--bg', '--yes', '9999']);
    expect(run).not.toHaveBeenCalledWith(['serve', '--bg', '--yes', '4321']);
  });

  it('passes --yes, so Serve’s own confirmation prompt is never a second route to the hang', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '' }));

    await enableServe(run, 4321);

    expect(run).toHaveBeenCalledWith(expect.arrayContaining(['--yes']));
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
        'Command failed: tailscale serve --bg --yes 4321\naccess denied: reauthenticate to use Serve',
      );
    }, 4321);

    expect(result).toEqual({
      kind: 'refused',
      message:
        'Command failed: tailscale serve --bg --yes 4321\naccess denied: reauthenticate to use Serve',
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

  it('gives up and reports timed-out, as a VALUE, when the runner never settles at all', async () => {
    vi.useFakeTimers();
    const pending = enableServe(hangs, 4321);

    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ kind: 'timed-out' });
  });

  it('does not report timed-out for a runner that answers well within the window', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ code: 0, stdout: '' }));

    const pending = enableServe(run, 4321);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS - 1);

    await expect(pending).resolves.toEqual({ kind: 'ok' });
  });
});

describe('disableServe', () => {
  it('runs the TARGETED off, never `tailscale serve reset`', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '' }));

    await disableServe(run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(['serve', '--https=443', '--yes', 'off']);
    expect(run).not.toHaveBeenCalledWith(expect.arrayContaining(['reset']));
  });

  it('reports ok on a clean exit', async () => {
    const result = await disableServe(async () => ({ code: 0, stdout: '' }));

    expect(result).toEqual({ kind: 'ok' });
  });

  it('surfaces a refusal in its own words, same as enabling, and never retries with reset', async () => {
    const run = vi.fn(async () => {
      throw new Error('failed to connect to local tailscaled; it does not appear to be running');
    });

    const result = await disableServe(run);

    expect(result).toEqual({
      kind: 'refused',
      message: 'failed to connect to local tailscaled; it does not appear to be running',
    });
    // A failed narrow command must not silently escalate to a destructive
    // wide one: exactly the one targeted-off attempt, nothing else.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives up and reports timed-out when the runner never settles at all', async () => {
    vi.useFakeTimers();
    const pending = disableServe(hangs);

    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ kind: 'timed-out' });
  });
});
