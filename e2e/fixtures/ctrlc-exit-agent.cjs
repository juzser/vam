/**
 * Stands in for `claude`/`codex` in `e2e/shell-first-ctrlc-survives.mjs`: an
 * interactive-shaped program that prints a READY line, then exits on the
 * SECOND `SIGINT` it receives within two seconds of the first.
 *
 * THE SHAPE IS MEASURED, not invented. On a private `-L` tmux socket, real
 * `claude` 2.1.280: the first Ctrl-C prints "Press Ctrl-C again to exit" and
 * arms a short window; a second Ctrl-C inside it ends the process. Real
 * `codex` 0.153.2 exits on the FIRST Ctrl-C alone -- a strict subset of this
 * fixture's own behaviour, so a guard that proves survival across TWO
 * Ctrl-C here proves it across either agent's real exit gesture.
 * `create-session.ts`'s own header carries the full measurement.
 *
 * Requires no login, no network and no real CLI: it is the only way to run
 * this guard in CI, where neither `claude` nor `codex` can authenticate.
 */
process.stdout.write('CTRLC-FIXTURE READY\n');
let armed = false;
let timer = null;
process.on('SIGINT', () => {
  if (armed) {
    process.stdout.write('CTRLC-FIXTURE EXITING\n');
    process.exit(0);
  }
  armed = true;
  process.stdout.write('CTRLC-FIXTURE PRESS AGAIN\n');
  timer = setTimeout(() => {
    armed = false;
  }, 2000);
  timer.unref?.();
});
// Keeps the event loop alive without a busy wait; nothing here is ever
// meant to fire.
setInterval(() => {}, 60_000);
