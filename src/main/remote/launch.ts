/**
 * Turning the environment into a server, or into a refusal.
 *
 * The remote endpoint is OFF unless a port is asked for. What it is NOT told
 * here is as deliberate as what it is: no bind address, because the server
 * binds loopback and `tailscale serve` proxies to it from the tailnet side
 * (https://tailscale.com/kb/1312/serve), and no credential, because the
 * credential is a per-device token the operator grants at the pairing screen
 * rather than a secret in a shell.
 *
 * There is no arrangement of these variables that produces an open port with
 * no pairing in front of it -- `startRemoteServer` refuses without a device
 * registry, which is why this file no longer carries that refusal itself.
 */

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

/** Reads the config, or throws a message that says what is wrong and why. */
export function remoteConfigFromEnv(env: Record<string, string | undefined>): RemoteConfig | null {
  const asked = env.VAM_REMOTE_PORT;
  if (asked === undefined || asked.length === 0) {
    return null;
  }
  const port = Number(asked);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`VAM_REMOTE_PORT is not a port: ${asked}`);
  }
  const webRoot = env.VAM_REMOTE_WEB_ROOT ?? '';
  return {
    port,
    ...(webRoot.length > 0 ? { webRoot } : {}),
    // Writes are an explicit act. Anything other than `1` leaves the write
    // routes unregistered, so a typo cannot open them.
    allowWrites: env.VAM_REMOTE_WRITES === '1',
  };
}
