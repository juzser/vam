/**
 * Turning the environment into a server config -- never a refusal to listen.
 *
 * A packaged app launched from Finder (or by double-clicking the `.app`) has
 * NO ENVIRONMENT VARIABLES: there is no shell around it to have set
 * `VAM_REMOTE_PORT` in. Requiring it made the whole remote/phone feature dead
 * on every packaged build -- the endpoint simply never started, and pairing
 * could never work. So this file now always returns a config: with no env at
 * all it opens on `DEFAULT_REMOTE_PORT`, and `VAM_REMOTE_PORT` still
 * overrides that for a developer who sets one.
 *
 * What it is NOT told here is as deliberate as what it is: no bind address,
 * because the server binds loopback and `tailscale serve` proxies to it from
 * the tailnet side (https://tailscale.com/kb/1312/serve), and no credential,
 * because the credential is a per-device token the operator grants at the
 * pairing screen rather than a secret in a shell.
 *
 * There is no arrangement of these variables that produces an open port with
 * no pairing in front of it -- `startRemoteServer` refuses without a device
 * registry, which is why this file no longer carries that refusal itself.
 */

/**
 * Deliberately unusual: inside the IANA dynamic/private range (49152-65535,
 * https://www.iana.org/assignments/service-names-port-numbers), so it cannot
 * collide with a registered service, and away from the round numbers other
 * local dev tools reach for (3000, 5173, 8080, 8888, ...) so it is unlikely to
 * collide with one of THOSE either. `VAM_REMOTE_PORT` always wins over this.
 */
export const DEFAULT_REMOTE_PORT = 58_217;

export type RemoteConfig = {
  readonly port: number;
  readonly allowWrites: boolean;
  /**
   * Where the browser build lives, when the operator keeps it somewhere other
   * than beside the app. Absent leaves the choice to the caller, which knows
   * the app's own path; an EMPTY value is not a root and is read as absent, so
   * an unset variable expanded by a shell cannot make the process serve `/`.
   */
  readonly webRoot?: string;
};

/**
 * Reads the config, or throws a message that says what is wrong and why.
 * Never returns `null` -- the endpoint is on by default so a packaged app
 * with no shell around it still serves the pairing screen.
 *
 * @param persistedAllowWrites Read from `remote/writes-preference.ts`, the
 *   operator's own explicit choice from the last time they turned writes on
 *   or off, or `false` when nothing has been persisted yet. `VAM_REMOTE_WRITES`
 *   always overrides it, because a developer who sets the env var is making
 *   the same explicit choice a shorter way.
 */
export function remoteConfigFromEnv(
  env: Record<string, string | undefined>,
  persistedAllowWrites = false,
): RemoteConfig {
  const asked = env.VAM_REMOTE_PORT;
  const port = asked === undefined || asked.length === 0 ? DEFAULT_REMOTE_PORT : Number(asked);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`VAM_REMOTE_PORT is not a port: ${asked}`);
  }
  const webRoot = env.VAM_REMOTE_WEB_ROOT ?? '';
  const writesAsked = env.VAM_REMOTE_WRITES;
  return {
    port,
    ...(webRoot.length > 0 ? { webRoot } : {}),
    // Writes are an explicit act -- see the module comment on
    // `writes-preference.ts`. With no env override, the persisted preference
    // decides; anything other than `1` in the env leaves the write routes
    // unregistered, so a typo cannot open them.
    allowWrites: writesAsked === undefined ? persistedAllowWrites : writesAsked === '1',
  };
}
