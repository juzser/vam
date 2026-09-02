/**
 * The preload's implementation of the bridge contract: thin forwarders over
 * `ipcRenderer.invoke`, and the unwrapping of main's envelope.
 *
 * Bound PER SLICE with `satisfies` rather than by annotating the whole object.
 * `satisfies` keeps the inferred literal type -- callbacks still get their
 * contextual parameter types -- while failing the build on drift; per slice so
 * a drift error names the one key that drifted instead of the whole object.
 *
 * `subscribe` IS ABSENT, deliberately, and this is the one place the general
 * rule does not apply. `invoke` is one-shot request/response: it cannot call
 * `onChange` back, and it returns a `Promise` where the port demands an
 * unsubscribe function returned SYNCHRONOUSLY. Written with `invoke` it would
 * typecheck and fail at `stop()`. It needs `ipcRenderer.on` plus a
 * preload-side closure, which is a later task; until then the descriptor
 * declares `liveUpdates: false` and the renderer-side factory therefore never
 * asks for the member.
 */

import { CHANNELS, type IpcResult } from '../main/ipc/channels.js';
import type { Project } from '../renderer/domain/model.js';
import type { PreloadSourceApi, SourceDescriptor } from '../shared/preload-api.js';

/** The slice of `ipcRenderer` used here, so this module is testable without electron. */
export type InvokerLike = { invoke(channel: string, ...args: unknown[]): Promise<unknown> };

/** Everything the bridge carries today. `subscribe` joins it with `ipcRenderer.on`. */
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
