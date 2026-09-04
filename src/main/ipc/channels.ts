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
  /**
   * Start a session in a DIRECTORY rather than in a project vam already
   * knows -- the "new project" path, whose directory has no project id yet.
   * Gated by the same `createSession` capability: same affordance, asked a
   * different way.
   */
  createSessionIn: 'vam:source:create-session-in',
  applyWaivers: 'vam:source:apply-waivers',
  transitionLesson: 'vam:source:transition-lesson',
  /**
   * The push channel: main sends on it, payload-free (AC-18), whenever the
   * upstream change stream ticks. `webContents.send`, never `ipcMain.handle`
   * -- there is no request/response here, only main-initiated delivery.
   */
  stream: 'vam:stream:change',
  /**
   * Preload-internal only -- never a member of `PreloadSourceApi`. Lets the
   * preload's `subscribe()` tell main a listener now cares, so main can open
   * its own change-stream connection lazily rather than unconditionally at
   * startup.
   */
  streamSubscribe: 'vam:stream:subscribe',
  /** Preload-internal only, the other half of `streamSubscribe`'s ref count. */
  streamUnsubscribe: 'vam:stream:unsubscribe',
  /**
   * The usage channel. Unlike every channel above, it answers with a bare
   * `UsageSnapshot`, never an `IpcResult` -- see `src/main/usage/ipc.ts`.
   */
  usageGet: 'vam:usage:get',
  /**
   * The clipboard channel. Like `usageGet` it answers bare -- a `boolean`,
   * not an `IpcResult`: "did the text reach the clipboard" is the whole
   * answer, and there is no source to refuse anything in the words of.
   */
  clipboardWrite: 'vam:clipboard:write',
  /**
   * The Terminal tab's read. Like the two above it answers bare -- a
   * `PaneView`, not an `IpcResult` -- because that type already carries its
   * own failure branch (see `src/main/terminal/ipc.ts`). It is invoked ONLY
   * while the tab is open, which is why there is no push half to it.
   */
  terminalRead: 'vam:terminal:read',
  /**
   * The size the Terminal tab's pane can show, in cells. Answers a bare
   * boolean -- did vam resize a session it could prove was its own -- because
   * there is nowhere on the tab to draw a reason: the screen itself already
   * says what state the session is in. Invoked only while the tab is open, and
   * only when the measured size has actually changed.
   */
  terminalResize: 'vam:terminal:resize',
  /**
   * The directory picker. Answers BARE -- a path or `null` -- never an
   * `IpcResult`: "which directory" has exactly two answers and a cancelled
   * dialog is one of them, not a failure to report in a source's words. There
   * is no source behind this channel at all; it is Electron's own
   * `showOpenDialog`, which is why it cannot exist in the browser build.
   */
  chooseDirectory: 'vam:dialog:choose-directory',
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
