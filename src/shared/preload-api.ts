/**
 * The shape of the object the preload script hands the renderer, and the
 * capability descriptor that travels over it. Types only -- no electron
 * import lives here, or anywhere this file reaches, so the renderer and its
 * tests can build against the contract without a browser window.
 *
 * Why the api is flat and unconditional
 * -------------------------------------
 * `contextBridge.exposeInMainWorld` runs exactly once, at preload time, and
 * that moment is *earlier than anything is known about the source*: no
 * backend has been contacted, no capability has been negotiated. Whatever
 * shape is exposed then is the shape the renderer sees forever -- the bridge
 * deep-freezes what it copies, will not proxy a getter, and does not preserve
 * object identity, so the exposed object cannot be grown, swapped or
 * lazily-filled afterwards.
 *
 * The consequence is the rule this module exists to state: **nothing in the
 * preload's shape may depend on runtime state.** Every member below is
 * present unconditionally, whether or not the source behind it can do the
 * thing. Most become a thin `ipcRenderer.invoke` forwarder.
 *
 * `subscribe` IS THE EXCEPTION, and it must not be written with `invoke`.
 * `invoke` is one-shot request/response: it cannot call `onChange` back, and
 * it returns a `Promise` where the port's signature
 * `(onChange: () => void) => () => void` demands an unsubscribe function
 * returned SYNCHRONOUSLY. Built on `invoke` it would typecheck at the bridge
 * and fail at `stop()`. It needs `ipcRenderer.on` plus an unsubscribe closure
 * created preload-side. The temptation a future reader will feel -- "expose only the
 * members the source supports, then the renderer can just use the api
 * directly" -- cannot be satisfied: at expose time there is no source to ask.
 *
 * Capability therefore travels as *data*, not as shape: `describe()` returns
 * a `SourceDescriptor`, a plain object that crosses the bridge intact. The
 * renderer-side factory (`src/renderer/sources/preload-factory.ts`) reads it
 * and builds a real `SessionSource`, assigning `subscribe`, `write` and
 * `governance` only when the flags say so. That is where the port's promise
 * -- absent means absent, never a stub and never a thrower -- is kept, and it
 * is the only place it *can* be kept.
 */

import type { Project, SourceId } from '../renderer/domain/model.js';
import type {
  SessionSource,
  SourceCapabilities,
  SourceDeclines,
  ViewerScope,
} from '../renderer/sources/port.js';

/**
 * Everything about a source that is data rather than behaviour: exactly the
 * non-callable members of `SessionSource`. Returned by `describe()` because
 * it is unknowable at preload time, and plain data because that is what
 * survives the structured clone the bridge performs.
 */
export type SourceDescriptor = {
  readonly id: SourceId;
  readonly label: string;
  readonly capabilities: SourceCapabilities;
  readonly declines: SourceDeclines;
  readonly viewerScope: ViewerScope;
};

/**
 * The always-present function set. A member existing here says nothing about
 * whether the source can perform it -- only `SourceCapabilities` says that.
 * Calling one whose flag is false is a bug in the caller; the factory makes
 * that bug unreachable by never handing such a member to a consumer.
 */
export type PreloadSourceApi = {
  describe(): Promise<SourceDescriptor>;
  load(): Promise<readonly Project[]>;
  subscribe(onChange: () => void): () => void;
  recordPrompt(sessionId: string, prompt: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  createSession(projectId: string, title: string): Promise<void>;
  applyWaivers(sessionId: string, findingIds: readonly string[]): Promise<void>;
  transitionLesson(sessionId: string, lessonId: string, status: string): Promise<void>;
};

/** Re-exported for consumers that hold both halves of the bridge contract. */
export type { SessionSource };
