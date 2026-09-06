/**
 * Turning `tailscale serve` on and off, the honest words when it refuses, and
 * three measured failure modes -- all verified against a real `tailscale`
 * (1.102.2) -- that this module must never reproduce:
 *
 * 1. `tailscale serve --bg --yes 39999` was run against a healthy, logged-in
 *    node with two peers and produced NO output, NEVER RETURNED, and
 *    configured nothing -- `tailscale serve status` still said "No serve
 *    config" two minutes later. An indefinite hang is a real, reachable state
 *    on a working machine, not a hypothetical one.
 * 2. Separately, on a tailnet with Serve turned off (the FIRST-RUN state for
 *    essentially every new user, since Serve is off by default and enabling
 *    it is a web action a tailnet admin takes), the same command printed
 *
 *      Serve is not enabled on your tailnet.
 *      To enable, visit:
 *               https://login.tailscale.com/f/serve?node=<node id>
 *
 *    to STDOUT and then blocked indefinitely -- reproduced twice, killed both
 *    times. There is no exit to await here; the only way to see this is to
 *    watch stdout while the process is still running.
 * 3. `tailscale serve reset` is, by the CLI's own `--help` text, "Reset
 *    current serve config" -- ALL of it, not vam's one port. vam must never
 *    run it: disabling uses the TARGETED off instead.
 *
 * NOTHING HERE RUNS `tailscale`, and nothing here runs `tailscale serve` for
 * real -- see `hostname.test.ts`'s own note. The CLI is a double in every
 * case: the property under test is the exact argv vam sends it and the exact
 * words vam hands back on a refusal, never a live process. The node id in
 * every fixture below is invented -- a real one identifies the operator's
 * machine and must never appear in a committed file.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT_TIMEOUT_MS,
  disableServe,
  enableServe,
  type TailscaleServeRun,
} from '../../../src/main/remote/serve.js';

afterEach(() => {
  vi.useRealTimers();
});

type ExitResult = { code: number; stdout: string };

/** A runner whose process exits cleanly and immediately, with no stdout. */
function completes(result: ExitResult) {
  const kill = vi.fn();
  const run = vi.fn((_args: readonly string[], _onStdout: (chunk: string) => void) => ({
    exit: Promise.resolve(result),
    kill,
  }));
  return { run: run as TailscaleServeRun, mock: run, kill };
}

/** A runner whose process never gets the chance to start at all -- ENOENT's real shape with `spawn`. */
function failsToStart(error: unknown) {
  const kill = vi.fn();
  const run = vi.fn((_args: readonly string[], _onStdout: (chunk: string) => void) => ({
    exit: Promise.reject(error) as Promise<ExitResult>,
    kill,
  }));
  return { run: run as TailscaleServeRun, mock: run, kill };
}

/**
 * A runner whose process never exits at all -- the measured shape of BOTH
 * hangs above. `emit` delivers a chunk exactly the way a real child
 * process's stdout `data` event would.
 */
function hangs() {
  const kill = vi.fn();
  let deliver: ((chunk: string) => void) | null = null;
  const run = vi.fn((_args: readonly string[], onStdout: (chunk: string) => void) => {
    deliver = onStdout;
    return { exit: new Promise<ExitResult>(() => {}), kill };
  });
  return {
    run: run as TailscaleServeRun,
    mock: run,
    kill,
    emit: (chunk: string) => deliver?.(chunk),
  };
}

/** An obviously invented node id -- never a real one, which identifies the operator's machine. */
const INVENTED_NODE_ID = 'invented-node-id-0000';
const ENABLE_URL_STDOUT = `Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=${INVENTED_NODE_ID}\n`;
const ENABLE_URL = `https://login.tailscale.com/f/serve?node=${INVENTED_NODE_ID}`;

describe('enableServe', () => {
  it('runs `tailscale serve --bg --yes <port>` with the port it was given', async () => {
    const { run, mock } = completes({ code: 0, stdout: '' });

    await enableServe(run, 4321);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toEqual(['serve', '--bg', '--yes', '4321']);
  });

  it('threads the ACTUAL port through rather than a fixed one', async () => {
    const { run, mock } = completes({ code: 0, stdout: '' });

    await enableServe(run, 9999);

    expect(mock.mock.calls[0]?.[0]).toEqual(['serve', '--bg', '--yes', '9999']);
    expect(mock.mock.calls[0]?.[0]).not.toEqual(['serve', '--bg', '--yes', '4321']);
  });

  it('passes --yes, so Serve’s own confirmation prompt is never a second route to a hang', async () => {
    const { run, mock } = completes({ code: 0, stdout: '' });

    await enableServe(run, 4321);

    expect(mock.mock.calls[0]?.[0]).toContain('--yes');
  });

  it('reports ok on a clean exit', async () => {
    const { run } = completes({ code: 0, stdout: '' });

    const result = await enableServe(run, 4321);

    expect(result).toEqual({ kind: 'ok' });
  });

  it('surfaces a missing CLI in its own real words, not a generic error', async () => {
    const { run } = failsToStart(
      Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' }),
    );

    const result = await enableServe(run, 4321);

    expect(result).toEqual({ kind: 'refused', message: 'spawn tailscale ENOENT' });
  });

  it('surfaces a permission refusal in its own real words, verbatim', async () => {
    const { run } = completes({ code: 1, stdout: 'access denied: reauthenticate to use Serve' });

    const result = await enableServe(run, 4321);

    expect(result).toEqual({
      kind: 'refused',
      message: 'access denied: reauthenticate to use Serve',
    });
  });

  it('never invents a diagnosis for a resolved failure with nothing to say', async () => {
    const { run } = completes({ code: 1, stdout: '' });

    const result = await enableServe(run, 4321);

    expect(result).toEqual({ kind: 'refused', message: 'tailscale exited with code 1' });
  });

  it('gives up and reports timed-out, as a VALUE, when the process never exits and says nothing', async () => {
    vi.useFakeTimers();
    const { run, kill } = hangs();

    const pending = enableServe(run, 4321);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ kind: 'timed-out' });
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('does not report timed-out for a process that exits well within the window', async () => {
    vi.useFakeTimers();
    const { run } = completes({ code: 0, stdout: '' });

    const pending = enableServe(run, 4321);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS - 1);

    await expect(pending).resolves.toEqual({ kind: 'ok' });
  });

  /**
   * THE FIRST-RUN CASE. Serve is off by default for a tailnet; the CLI
   * prints the exact enable link to stdout and then hangs -- there is no
   * exit code to read this from at all.
   */
  it('detects the tailnet-Serve-disabled URL from live stdout, never waiting for exit', async () => {
    const { run, emit, kill } = hangs();

    const pending = enableServe(run, 4321);
    emit(ENABLE_URL_STDOUT);

    await expect(pending).resolves.toEqual({ kind: 'tailnet-serve-disabled', url: ENABLE_URL });
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('reaches tailnet-serve-disabled well before the 20s backstop, not by timing out', async () => {
    vi.useFakeTimers();
    const { run, emit } = hangs();

    const pending = enableServe(run, 4321);
    emit(ENABLE_URL_STDOUT);
    // Flush the microtask the stdout handler resolves on, WITHOUT advancing
    // the fake timer by even one millisecond.
    await Promise.resolve();
    await Promise.resolve();

    await expect(pending).resolves.toEqual({ kind: 'tailnet-serve-disabled', url: ENABLE_URL });
  });

  it('parses the URL out of the surrounding prose rather than constructing one', async () => {
    const another = hangs();
    const secondNodeId = 'invented-node-id-1111';
    const secondStdout = `Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=${secondNodeId}\n`;

    const pending = enableServe(another.run, 9999);
    another.emit(secondStdout);

    // A DIFFERENT invented id in stdout produces a DIFFERENT URL out --
    // this is extraction, not a hardcoded constant somewhere in the module.
    await expect(pending).resolves.toEqual({
      kind: 'tailnet-serve-disabled',
      url: `https://login.tailscale.com/f/serve?node=${secondNodeId}`,
    });
  });
});

describe('disableServe', () => {
  it('runs the TARGETED off, never `tailscale serve reset`', async () => {
    const { run, mock } = completes({ code: 0, stdout: '' });

    await disableServe(run);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toEqual(['serve', '--https=443', '--yes', 'off']);
    expect(mock.mock.calls[0]?.[0]).not.toEqual(expect.arrayContaining(['reset']));
  });

  it('reports ok on a clean exit', async () => {
    const { run } = completes({ code: 0, stdout: '' });

    const result = await disableServe(run);

    expect(result).toEqual({ kind: 'ok' });
  });

  it('surfaces a refusal in its own words, same as enabling, and never retries with reset', async () => {
    const { run, mock } = failsToStart(
      new Error('failed to connect to local tailscaled; it does not appear to be running'),
    );

    const result = await disableServe(run);

    expect(result).toEqual({
      kind: 'refused',
      message: 'failed to connect to local tailscaled; it does not appear to be running',
    });
    // A failed narrow command must not silently escalate to a destructive
    // wide one: exactly the one targeted-off attempt, nothing else.
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('gives up and reports timed-out when the process never exits and says nothing', async () => {
    vi.useFakeTimers();
    const { run, kill } = hangs();

    const pending = disableServe(run);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ kind: 'timed-out' });
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('also detects tailnet-Serve-disabled -- the CLI is not known to behave differently turning off', async () => {
    const { run, emit, kill } = hangs();

    const pending = disableServe(run);
    emit(ENABLE_URL_STDOUT);

    await expect(pending).resolves.toEqual({ kind: 'tailnet-serve-disabled', url: ENABLE_URL });
    expect(kill).toHaveBeenCalledTimes(1);
  });
});
