/**
 * Turns a remote-endpoint failure into a `MainFailureEvent`-shaped
 * `{code, message}` -- the words `src/main/index.ts` hands to
 * `recordMainFailure`, and from there (`src/main/errors/ipc.ts`, then
 * `src/renderer/errors/main-errors-bridge.ts`) into the operator's own error
 * log.
 *
 * THREE SENTENCES, KEPT APART. "Remote control is switched off" is not
 * written here at all -- it is what `RemotePanel` already says on its own
 * when `vam:remote:state` has no handler, and nothing in this module
 * produces it. What this module distinguishes is the other two, which
 * `src/main/index.ts`'s two `catch` blocks otherwise could not tell apart
 * without re-parsing English: a port already taken (recoverable, and there
 * is something the operator can actually try) from every other refusal
 * (`bindFailureEvent`), and a refusal before the bind was even attempted --
 * opening the device registry or the write-preference file
 * (`setupFailureEvent`), which today collapses into the SAME "switched off"
 * wording `RemotePanel` shows for a normal disabled state -- `RemotePanel`
 * itself is unchanged here, but at least the error log now says the true
 * story even where the settings panel does not yet.
 *
 * NO CLI COMMAND IS EVER NAMED. Whoever reads this is at a packaged,
 * Finder-launched `vam.app` with no terminal in front of them --
 * `VAM_REMOTE_PORT` is not a thing they can type anywhere.
 */

import { RemoteBindError } from './server.js';

export type FailureEvent = { readonly code: string; readonly message: string };

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The bind attempt itself failed -- `startRemoteServer`'s own rejection,
 * caught in `src/main/index.ts` around that call.
 */
export function bindFailureEvent(error: unknown, port: number): FailureEvent {
  if (error instanceof RemoteBindError && error.reason === 'port-in-use') {
    return {
      code: 'remote-port-in-use',
      message:
        `Phone pairing is off: port ${port} is already in use, most likely by another ` +
        'running copy of vam. Quit the other copy (or wait for it to close), then restart ' +
        'vam to bring phone pairing back.',
    };
  }
  return {
    code: 'remote-bind-failed',
    message:
      `Phone pairing is off: ${detailOf(error)}. It will not retry on its own -- restart ` +
      'vam once this is resolved.',
  };
}

/**
 * Everything BEFORE the bind attempt -- opening the device registry or the
 * writes-preference file -- failed. Caught in `src/main/index.ts`'s outer
 * catch, the one whose channels never registered at all.
 */
export function setupFailureEvent(error: unknown): FailureEvent {
  return {
    code: 'remote-setup-failed',
    message:
      `Phone pairing is off: vam could not set up remote access (${detailOf(error)}). ` +
      'It will not retry on its own -- restart vam once this is resolved.',
  };
}
