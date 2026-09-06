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
 * mutating a real tailnet's serve config beyond the probes actually run.
 * `--https=443` matches `enableServe`'s own default (`serve --bg` publishes
 * on 443), and `off` is the documented verb for removing one mapping; the
 * flag order is a guess. If the targeted off is itself refused, the caller
 * gets the real refusal back and nothing else -- see `RemotePanel.tsx`/
 * `PairingPanel.tsx` for the manual `tailscale serve reset` escape hatch
 * this offers the OPERATOR. A failed narrow command must NEVER silently
 * escalate to a destructive wide one, which is why this module does not
 * retry at all on a refusal.
 *
 * HANGS ARE A MEASURED FAILURE MODE, NOT A HYPOTHETICAL ONE -- verified
 * against a real, logged-in Tailscale node (1.102.2), TWICE, in two
 * different ways:
 *
 * 1. On a healthy tailnet, `tailscale serve --bg --yes 39999` produced no
 *    output, never returned, and configured nothing -- `tailscale serve
 *    status` still read "No serve config" two minutes later.
 * 2. On a tailnet with Serve turned off -- which is the FIRST-RUN STATE for
 *    essentially every new user, since Serve is off by default and enabling
 *    it is a web action a tailnet admin takes in the admin console -- the
 *    same command printed the one actionable thing on screen to STDOUT and
 *    then blocked indefinitely:
 *
 *      Serve is not enabled on your tailnet.
 *      To enable, visit:
 *               https://login.tailscale.com/f/serve?node=<node id>
 *
 *    reproduced twice, killed both times. There is no exit code to read this
 *    from, because the process never exits -- the only way to see it is to
 *    watch stdout WHILE the process is still running, which is why this
 *    module's runner contract hands stdout to the caller as it arrives
 *    rather than as one Promise for the whole invocation. Hiding this behind
 *    a flat 20-second timeout would replace the one thing the operator can
 *    actually go and do with "timed out" -- so it is its own outcome,
 *    detected from live output, never from the process finishing.
 *
 * `--yes` answers Serve's own confirmation prompt unconditionally, which is
 * one known hang cause and must never be the reason for one; `ATTEMPT_TIMEOUT_MS`
 * remains the backstop for every OTHER reason a process might never settle.
 * EVERY exit from `attempt()` -- ok, refused, timed-out or
 * tailnet-serve-disabled -- kills the underlying process: a process this
 * module has stopped waiting on and left running is a leak, not a success.
 *
 * NO DIAGNOSIS IS INVENTED for a refusal. Missing CLI, not logged in,
 * refused for permissions, HTTPS not enabled on the tailnet -- this module
 * cannot verify against a real binary what Tailscale's exact wording is for
 * every one of those, on every platform, so it does not guess which one
 * happened. It reads whatever the injected runner actually said,
 * `readServeAddress`'s own discipline, and hands that back verbatim.
 */

export type ServeToggleResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'refused'; readonly message: string }
  /**
   * The process never answered within `ATTEMPT_TIMEOUT_MS`. Its OWN kind
   * rather than folded into `refused`: there is no CLI text to show, because
   * nothing came back to show it from.
   */
  | { readonly kind: 'timed-out' }
  /**
   * Serve is administratively off for the WHOLE TAILNET -- not a machine
   * problem, not something vam or the operator can fix from this dialog.
   * `url` is the exact enable link the CLI printed, PARSED out of its
   * stdout, never constructed: it embeds a node identifier that identifies
   * the operator's machine, so it is read off the live process, not
   * assembled from parts vam already knows.
   */
  | { readonly kind: 'tailnet-serve-disabled'; readonly url: string };

/**
 * The serve-specific runner. UNLIKE `hostname.ts`'s `TailscaleRun` (one
 * request, one response -- correct for `tailscale status`), `tailscale
 * serve` can print the one thing worth showing to STDOUT and then never
 * exit at all (see the module comment's two measured hangs), so a runner
 * that hands back a single Promise for the whole invocation cannot surface
 * that -- there is nothing for the Promise to ever resolve or reject with.
 * This one hands stdout to the caller AS IT ARRIVES via `onStdout`, and a
 * `kill` so `attempt()` can stop waiting on a process once it has enough to
 * answer with, rather than leaving it running.
 */
export type TailscaleServeRun = (
  args: readonly string[],
  onStdout: (chunk: string) => void,
) => {
  readonly exit: Promise<{ readonly code: number; readonly stdout: string }>;
  readonly kill: () => void;
};

/**
 * How long `attempt()` waits for the process before giving up and reporting
 * `timed-out`. This is the BACKSTOP for a hang this module has never seen
 * before -- both hangs it HAS seen (a bare hang, and tailnet-Serve-disabled)
 * are already handled without waiting this long, one by the process actually
 * exiting and the other by watching stdout. Deliberately generous and
 * UNVERIFIED against real `tailscale serve` latency for anything else -- a
 * first run that has to provision a certificate could plausibly take longer
 * than this, and there was no way to measure that without mutating a real
 * tailnet's config further than the probes actually run.
 */
export const ATTEMPT_TIMEOUT_MS = 20_000;

/**
 * Verified once against a real Tailscale (1.102.2) and reproduced twice; the
 * exact charset Tailscale uses for a node id is otherwise unverified, so this
 * matches up to the next whitespace rather than a specific charset.
 */
const TAILNET_SERVE_DISABLED_URL = /https:\/\/login\.tailscale\.com\/f\/serve\?node=\S+/;

function tailnetServeDisabledUrl(stdout: string): string | null {
  const match = TAILNET_SERVE_DISABLED_URL.exec(stdout);
  return match === null ? null : match[0];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attempt(
  run: TailscaleServeRun,
  args: readonly string[],
): Promise<ServeToggleResult> {
  return new Promise<ServeToggleResult>((resolve) => {
    let settled = false;
    let capturedStdout = '';
    // The process may report a chunk BEFORE `run()` returns its handle (a
    // real `child_process.spawn` never does this synchronously, but nothing
    // stops a different `TailscaleServeRun` from doing so) -- `killRequested`
    // makes that ordering safe rather than losing the kill.
    let kill: (() => void) | null = null;
    let killRequested = false;

    const finish = (result: ServeToggleResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (kill !== null) {
        kill();
      } else {
        killRequested = true;
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ kind: 'timed-out' }), ATTEMPT_TIMEOUT_MS);

    let handle: ReturnType<TailscaleServeRun>;
    try {
      handle = run(args, (chunk) => {
        capturedStdout += chunk;
        const url = tailnetServeDisabledUrl(capturedStdout);
        if (url !== null) {
          finish({ kind: 'tailnet-serve-disabled', url });
        }
      });
    } catch (error) {
      finish({ kind: 'refused', message: messageOf(error) });
      return;
    }
    kill = handle.kill;
    if (killRequested) kill();

    handle.exit.then(
      ({ code, stdout }) => {
        if (code !== 0) {
          const said = stdout.trim();
          finish({
            kind: 'refused',
            message: said.length > 0 ? said : `tailscale exited with code ${code}`,
          });
        } else {
          finish({ kind: 'ok' });
        }
      },
      (error: unknown) => finish({ kind: 'refused', message: messageOf(error) }),
    );
  });
}

/**
 * `tailscale serve --bg --yes <port>`: HTTPS on the tailnet side, proxied to
 * this machine's own loopback port -- the half `launch.ts` binds and assumes
 * something else exposes. `--yes` answers Serve's own confirmation prompt so
 * a headless invocation can never block on it -- a distinct, measured cause
 * of the same class of hang `ATTEMPT_TIMEOUT_MS` and tailnet-serve-disabled
 * detection guard against.
 */
export function enableServe(run: TailscaleServeRun, port: number): Promise<ServeToggleResult> {
  return attempt(run, ['serve', '--bg', '--yes', String(port)]);
}

/**
 * The TARGETED off -- `tailscale serve --https=443 --yes off` -- reversing
 * only what `enableServe` configured. NEVER `tailscale serve reset`: see the
 * module comment for why, and for what the caller owes the operator when
 * this is refused.
 */
export function disableServe(run: TailscaleServeRun): Promise<ServeToggleResult> {
  return attempt(run, ['serve', '--https=443', '--yes', 'off']);
}
