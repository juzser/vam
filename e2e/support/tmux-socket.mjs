/**
 * A private, per-run tmux socket name -- distinct on every concurrent
 * invocation on one machine, with no coordination between callers required.
 *
 * Every real-tmux guard already isolates itself from the operator's default
 * server and any `vam-*` session on it with its own `-L <socket>`, but the
 * socket name itself used to be a bare literal (`vam-e2e-latency`,
 * `vam-stream-e2e-resource`, ...). Two agents running the web-guard suite
 * concurrently on one machine both spawned the SAME socket file; the second
 * run's own cleanup (`tmux -L <socket> kill-server`) tore down the first
 * run's session mid-guard, which read as a flaky guard rather than what it
 * was -- a shared socket, not a shared bug.
 *
 * Suffixing with THIS PROCESS's own pid is enough on its own: no two guard
 * processes running at once on one machine can share a pid, so two
 * concurrent runs of the exact same guard always get two different sockets
 * and never share a tmux server -- and because each guard's own
 * `kill-server` addresses only ITS socket, it can never reach a peer's
 * session either.
 */
export function privateTmuxSocket(base) {
  if (typeof base !== 'string' || base.length === 0) {
    throw new Error('privateTmuxSocket requires a non-empty base name');
  }
  return `${base}-${process.pid}`;
}
