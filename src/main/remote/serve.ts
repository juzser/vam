/**
 * Turning `tailscale serve` on or off for this machine, on the operator's own
 * click -- never as a side effect of anything else.
 *
 * A STANDING CONFIGURATION CHANGE, undone the SAME NARROW WAY IT WAS MADE.
 * `serve --bg` outlives this process, which is why every caller of
 * `enableServe` MUST offer `disableServe` somewhere equally easy to find --
 * see `RemotePanel.tsx`. `disableServe` runs the TARGETED off
 * (`serve --https=443 off`), NEVER `tailscale serve reset`: confirmed from
 * the CLI's own `--help` text, `reset` is "Reset current serve config" --
 * ALL of it, not vam's one port, so a user serving anything else over
 * Tailscale would lose it to a click on vam's Disable button. vam did not
 * create that configuration and has no business destroying it. THE EXACT
 * ARGV FOR THE TARGETED OFF IS UNVERIFIED: confirming it would have meant
 * mutating a real tailnet's serve config beyond the one read-only probe the
 * operator was willing to run. `--https=443` matches `enableServe`'s own
 * default (`serve --bg` publishes on 443), and `off` is the documented verb
 * for removing one mapping; the flag order is a guess. If the targeted off is
 * itself refused, the caller gets the real refusal back and nothing else --
 * see `RemotePanel.tsx`/`PairingPanel.tsx` for the manual `tailscale serve
 * reset` escape hatch this offers the OPERATOR. A failed narrow command must
 * NEVER silently escalate to a destructive wide one, which is why this module
 * does not retry at all on a refusal.
 *
 * HANGS ARE A MEASURED FAILURE MODE, NOT A HYPOTHETICAL ONE. Verified against
 * a real, logged-in Tailscale node (1.102.2) with a healthy tailnet:
 * `tailscale serve --bg --yes 39999` produced no output, never returned, and
 * configured nothing -- `tailscale serve status` still read "No serve config"
 * two minutes later. There is no error to report as a value here, because
 * there is no return AT ALL, so this module cannot rely on the injected
 * runner ever settling. `--yes` answers Serve's own confirmation prompt
 * unconditionally, which is one known cause and must never be the reason for
 * a hang; `ATTEMPT_TIMEOUT_MS` bounds every OTHER reason by racing the runner
 * against a timer and reporting `timed-out` -- A VALUE, same as `ok` and
 * `refused`, never a promise a caller is left waiting on forever.
 *
 * NO DIAGNOSIS IS INVENTED for any refusal. Missing CLI, not logged in,
 * refused for permissions, HTTPS not enabled on the tailnet -- this module
 * cannot verify against a real binary what Tailscale's exact wording is for
 * every one of those, on every platform, so it does not guess which one
 * happened. It reads whatever the injected runner actually said,
 * `readServeAddress`'s own discipline, and hands that back verbatim.
 *
 * Injected runner, same shape as `hostname.ts`'s `TailscaleRun`, so a test
 * never spawns anything real -- see `hostname.ts` and `hostname.test.ts`.
 */

import type { TailscaleRun } from './hostname.js';

export type ServeToggleResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'refused'; readonly message: string }
  /**
   * The runner never answered within `ATTEMPT_TIMEOUT_MS`. Its OWN kind
   * rather than folded into `refused`: there is no CLI text to show, because
   * nothing came back to show it from.
   */
  | { readonly kind: 'timed-out' };

/**
 * How long `attempt()` waits for the runner before giving up and reporting
 * `timed-out`. Deliberately generous and UNVERIFIED against real `tailscale
 * serve` latency -- a first run that has to provision a certificate could
 * plausibly take longer than this, and there was no way to measure that
 * without mutating a real tailnet's config. It is also deliberately far
 * longer than `runTailscale`'s own 3-second `execFile` timeout in
 * `src/main/index.ts`: THAT is expected to fire first against the real CLI
 * (and already reclaims the child process when it does), so this timer is a
 * backstop for any OTHER `TailscaleRun` implementation -- including the
 * fake runner a test injects -- rather than the layer meant to win the race
 * in ordinary operation.
 */
export const ATTEMPT_TIMEOUT_MS = 20_000;

/** Distinguishes "the timer won the race" from any real value or error `run` could produce. */
const TIMED_OUT = Symbol('vam:remote:serve-attempt-timed-out');

function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(TIMED_OUT), ms);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attempt(run: TailscaleRun, args: readonly string[]): Promise<ServeToggleResult> {
  let answered: { code: number; stdout: string };
  try {
    answered = await withTimeout(run(args), ATTEMPT_TIMEOUT_MS);
  } catch (error) {
    if (error === TIMED_OUT) return { kind: 'timed-out' };
    return { kind: 'refused', message: messageOf(error) };
  }
  if (answered.code !== 0) {
    const said = answered.stdout.trim();
    return {
      kind: 'refused',
      message: said.length > 0 ? said : `tailscale exited with code ${answered.code}`,
    };
  }
  return { kind: 'ok' };
}

/**
 * `tailscale serve --bg --yes <port>`: HTTPS on the tailnet side, proxied to
 * this machine's own loopback port -- the half `launch.ts` binds and assumes
 * something else exposes. `--yes` answers Serve's own confirmation prompt so
 * a headless invocation can never block on it -- a second, distinct cause of
 * the same measured hang `ATTEMPT_TIMEOUT_MS` guards against.
 */
export function enableServe(run: TailscaleRun, port: number): Promise<ServeToggleResult> {
  return attempt(run, ['serve', '--bg', '--yes', String(port)]);
}

/**
 * The TARGETED off -- `tailscale serve --https=443 --yes off` -- reversing
 * only what `enableServe` configured. NEVER `tailscale serve reset`: see the
 * module comment for why, and for what the caller owes the operator when
 * this is refused.
 */
export function disableServe(run: TailscaleRun): Promise<ServeToggleResult> {
  return attempt(run, ['serve', '--https=443', '--yes', 'off']);
}
