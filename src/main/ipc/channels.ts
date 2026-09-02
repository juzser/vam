/**
 * The channel names, and the envelope every channel answers in.
 *
 * Names live HERE rather than in `src/shared/`: `src/shared` is the tree the
 * renderer also compiles, and the renderer must never learn a channel name --
 * it talks to `window.api`, never to `ipcRenderer`, which is the whole reason
 * the preload exists. Main owns the transport, so main owns its vocabulary,
 * and the preload -- the only other party to the transport -- imports it from
 * here. This module is pure data: no electron import, nothing to execute.
 */

import type { SourceError } from '../../renderer/sources/port.js';

/** One channel per member of `PreloadSourceApi` that crosses as request/response. */
export const CHANNELS = {
  describe: 'vam:source:describe',
  load: 'vam:source:load',
  recordPrompt: 'vam:source:record-prompt',
  renameSession: 'vam:source:rename-session',
  closeSession: 'vam:source:close-session',
  createSession: 'vam:source:create-session',
  applyWaivers: 'vam:source:apply-waivers',
  transitionLesson: 'vam:source:transition-lesson',
} as const;

/**
 * What a handler returns. A refusal travels as DATA, not as a thrown error:
 * an exception in an `ipcMain.handle` listener reaches the renderer as a
 * rejected promise whose message electron has rewritten, which loses the
 * `kind`/`code` a consumer renders. The preload unwraps this envelope and
 * rejects with the `SourceError` itself, so the port's error shape is what
 * arrives.
 */
export type IpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SourceError };

export type { SourceError };
