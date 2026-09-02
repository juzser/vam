/**
 * The preload's implementation of the bridge contract: thin forwarders over
 * `ipcRenderer.invoke`, and the unwrapping of main's envelope.
 *
 * Bound PER SLICE with `satisfies` rather than by annotating the whole object.
 * `satisfies` keeps the inferred literal type -- callbacks still get their
 * contextual parameter types -- while failing the build on drift; per slice so
 * a drift error names the one key that drifted instead of the whole object.
 *
 * `subscribe` IS BUILT SEPARATELY, by `createStreamSubscribe` below, and this
 * is the one place the general rule does not apply. `invoke` is one-shot
 * request/response: it cannot call `onChange` back, and it returns a
 * `Promise` where the port demands an unsubscribe function returned
 * SYNCHRONOUSLY. Written with `invoke` it would typecheck and fail at
 * `stop()`. It needs `ipcRenderer.on` plus a preload-side closure -- kept out
 * of `createPreloadApi`'s object literal so that function's signature (and
 * every existing caller that hands it only an `invoke`-shaped object) is
 * untouched. `src/preload/index.ts` assembles the two into one bridge.
 */

import { CHANNELS, type IpcResult } from '../main/ipc/channels.js';
import type { Project } from '../renderer/domain/model.js';
import type { PreloadSourceApi, SourceDescriptor } from '../shared/preload-api.js';

/** The slice of `ipcRenderer` used here, so this module is testable without electron. */
export type InvokerLike = { invoke(channel: string, ...args: unknown[]): Promise<unknown> };

/** The slice of `ipcRenderer` `createStreamSubscribe` needs -- listener add/remove. */
export type ListenerLike = {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
};

/** Everything `createPreloadApi` builds. `subscribe` joins it separately, in `index.ts`. */
export type DesktopSourceApi = Omit<PreloadSourceApi, 'subscribe'>;

/**
 * Turns main's envelope back into a promise: the value on success, and a
 * REJECTION CARRYING THE PORT'S OWN `SourceError` on refusal -- not a rewritten
 * electron error string.
 */
async function unwrap<T>(pending: Promise<unknown>): Promise<T> {
  const result = (await pending) as IpcResult<T>;
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

export function createPreloadApi(ipc: InvokerLike): DesktopSourceApi {
  const reads = {
    describe: () => unwrap<SourceDescriptor>(ipc.invoke(CHANNELS.describe)),
    load: () => unwrap<readonly Project[]>(ipc.invoke(CHANNELS.load)),
  } satisfies Pick<PreloadSourceApi, 'describe' | 'load'>;

  const writes = {
    recordPrompt: (sessionId, prompt) =>
      unwrap<void>(ipc.invoke(CHANNELS.recordPrompt, sessionId, prompt)),
    renameSession: (sessionId, title) =>
      unwrap<void>(ipc.invoke(CHANNELS.renameSession, sessionId, title)),
    closeSession: (sessionId) => unwrap<void>(ipc.invoke(CHANNELS.closeSession, sessionId)),
    createSession: (projectId, title) =>
      unwrap<void>(ipc.invoke(CHANNELS.createSession, projectId, title)),
  } satisfies Pick<
    PreloadSourceApi,
    'recordPrompt' | 'renameSession' | 'closeSession' | 'createSession'
  >;

  const governance = {
    applyWaivers: (sessionId, findingIds) =>
      unwrap<void>(ipc.invoke(CHANNELS.applyWaivers, sessionId, findingIds)),
    transitionLesson: (sessionId, lessonId, status) =>
      unwrap<void>(ipc.invoke(CHANNELS.transitionLesson, sessionId, lessonId, status)),
  } satisfies Pick<PreloadSourceApi, 'applyWaivers' | 'transitionLesson'>;

  return { ...reads, ...writes, ...governance };
}

/**
 * Builds `subscribe`: a closure over the renderer's `onChange`, registered
 * with `ipcRenderer.on` and removed by `ipcRenderer.removeListener` with the
 * SAME listener reference (AC-19) -- never the renderer's own function
 * handed straight to either call, which is not identity-stable across the
 * context-bridge proxy and would make the unsubscribe a no-op (AC-17's
 * mandated falsifier).
 *
 * The `vam:stream:subscribe` invoke tells main a listener now cares, so it
 * can open its own change-stream connection lazily; its result and any
 * rejection are not awaited by the caller (the port's `subscribe` returns
 * synchronously) but a rejection is logged so the launch harness can observe
 * it if the registration is ever missing.
 */
export function createStreamSubscribe(
  ipc: InvokerLike & ListenerLike,
): (onChange: () => void) => () => void {
  return (onChange: () => void) => {
    // No argument forwarded (AC-18): a tick means "something changed", and
    // the data comes back through `load()`, never through this channel.
    const listener = () => onChange();
    ipc.on(CHANNELS.stream, listener);
    ipc.invoke(CHANNELS.streamSubscribe).catch((error: unknown) => {
      console.error('vam: stream subscribe failed:', error);
    });
    // Idempotent on purpose. main REFCOUNTS subscribers, so a second call
    // would decrement for a subscriber that had already left and close the
    // shared stream under everyone still on it -- silently, since nothing
    // errors. React StrictMode invokes effect cleanups twice in development,
    // so a double call is the normal case, not a defensive hypothetical.
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      ipc.removeListener(CHANNELS.stream, listener);
      ipc.invoke(CHANNELS.streamUnsubscribe).catch((error: unknown) => {
        console.error('vam: stream unsubscribe failed:', error);
      });
    };
  };
}
