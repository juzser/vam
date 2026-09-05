/**
 * The address the operator's phone should visit, when this machine can be
 * asked for it -- and three honest ways of not knowing.
 *
 * BEST-EFFORT BY CONSTRUCTION. Reading the MagicDNS name needs the Tailscale
 * CLI, and vam does not depend on one being installed: every failure below is
 * an ordinary answer that leaves the operator reading the address off
 * `tailscale serve` themselves. Nothing here is required for pairing to work.
 *
 * HTTPS ONLY, and never a guess. The certificate `tailscale serve` terminates
 * is what makes the phone's origin a secure context, which is what lets it
 * hold a credential at all; a plain-http MagicDNS URL is not one, so it is
 * never offered. And a name this module could not read is reported as
 * unknown rather than assembled out of parts that looked plausible.
 */

/** The CLI, as a function. Injected so a test never spawns anything. */
export type TailscaleRun = (
  args: readonly string[],
) => Promise<{ readonly code: number; readonly stdout: string }>;

export type ServeAddress =
  | { readonly kind: 'found'; readonly url: string }
  /**
   * `no-cli` -- nothing answered, or what answered was not `tailscale status`.
   * `not-running` -- the CLI is here and the tailnet is not up.
   * `no-name` -- up, but with no MagicDNS name this module will vouch for.
   */
  | { readonly kind: 'unavailable'; readonly reason: 'no-cli' | 'not-running' | 'no-name' };

const unavailable = (reason: 'no-cli' | 'not-running' | 'no-name'): ServeAddress => ({
  kind: 'unavailable',
  reason,
});

/** A MagicDNS name and nothing else: labels, dots, and the tailnet's suffix. */
const MAGIC_DNS = /^[a-z0-9-]+(\.[a-z0-9-]+)+\.ts\.net\.?$/i;

export async function readServeAddress(run: TailscaleRun): Promise<ServeAddress> {
  let answered: { code: number; stdout: string };
  try {
    answered = await run(['status', '--json']);
  } catch {
    // The overwhelmingly common case on a machine with no CLI, and the one
    // this whole module is written to treat as normal.
    return unavailable('no-cli');
  }
  let status: { BackendState?: unknown; Self?: { DNSName?: unknown } };
  try {
    status = JSON.parse(answered.stdout) as typeof status;
  } catch {
    // Something answered, but not with a status. We could not ask -- which is
    // a different sentence from "your tailnet is down", and saying the wrong
    // one sends the operator to fix the wrong thing.
    return unavailable('no-cli');
  }
  if (status.BackendState !== 'Running') {
    return unavailable('not-running');
  }
  const name = status.Self?.DNSName;
  if (typeof name !== 'string' || !MAGIC_DNS.test(name)) {
    return unavailable('no-name');
  }
  return { kind: 'found', url: `https://${name.replace(/\.$/, '')}` };
}
