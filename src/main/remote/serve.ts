/**
 * Turning `tailscale serve` on or off for this machine, on the operator's own
 * click -- never as a side effect of anything else.
 *
 * A STANDING CONFIGURATION CHANGE, undone the same way it was made. `serve
 * --bg <port>` outlives this process, which is why every caller of
 * `enableServe` MUST offer `disableServe` somewhere equally easy to find --
 * see `RemotePanel.tsx`. `disableServe` runs `tailscale serve reset`, the
 * documented full undo; vam only ever configures the one thing `enableServe`
 * set, so resetting everything reverses exactly that, UNLESS the operator has
 * also hand-configured `serve` or Funnel for something else on this machine,
 * in which case this clears that too. Not verified against a real binary.
 *
 * NO DIAGNOSIS IS INVENTED. Missing CLI, not logged in, refused for
 * permissions, HTTPS not enabled on the tailnet -- this module cannot verify
 * against a real binary what Tailscale's exact wording is for every one of
 * those, on every platform, so it does not guess which one happened. It
 * reads whatever the injected runner actually said, `readServeAddress`'s own
 * discipline, and hands that back verbatim.
 *
 * Injected runner, same shape as `hostname.ts`'s `TailscaleRun`, so a test
 * never spawns anything real -- see `hostname.ts` and `hostname.test.ts`.
 */

import type { TailscaleRun } from './hostname.js';

export type ServeToggleResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'refused'; readonly message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attempt(run: TailscaleRun, args: readonly string[]): Promise<ServeToggleResult> {
  let answered: { code: number; stdout: string };
  try {
    answered = await run(args);
  } catch (error) {
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
 * `tailscale serve --bg <port>`: HTTPS on the tailnet side, proxied to this
 * machine's own loopback port -- the half `launch.ts` binds and assumes
 * something else exposes.
 */
export function enableServe(run: TailscaleRun, port: number): Promise<ServeToggleResult> {
  return attempt(run, ['serve', '--bg', String(port)]);
}

/** `tailscale serve reset`. See the module comment for what this does and does not undo. */
export function disableServe(run: TailscaleRun): Promise<ServeToggleResult> {
  return attempt(run, ['serve', 'reset']);
}
