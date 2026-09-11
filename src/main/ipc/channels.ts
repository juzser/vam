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
  /**
   * SCROLLING BACK through one session: the turns before a point, read on
   * demand. Distinct from `load`, which reads a fixed tail of every live
   * session on a ten-second poll and must stay that cheap -- the median
   * transcript here is three times that tail, and the largest is 157 MB.
   *
   * It answers through the `IpcResult` envelope like every channel above, and
   * `TranscriptPage` carries an `unavailable` arm of its own besides. That is
   * not two ways to say one thing: the envelope's arm is for a request main
   * could not even validate, and the preload folds it into the page type's own
   * arm so a caller has exactly one shape to draw (`preload/api.ts`).
   */
  sessionHistory: 'vam:session:history',
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
   * DESKTOP-ONLY, and never a member of `PreloadSourceApi` -- the same
   * standing as `streamSubscribe` above and for a sharper reason.
   *
   * It carries the operator's per-project pull-request directory overrides
   * from the renderer's prefs into main, where the `gh` read happens. Putting
   * it on `PreloadSourceApi` instead would put it on the routes
   * `remote/server.ts` registers for a paired phone, which would make "a
   * directory this machine spawns a process in" something a remote device
   * names. See `sources/claude-code/pr-repos.ts` for the whole argument.
   */
  setPrRepos: 'vam:source:set-pr-repos',
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
   * The update check. Answers bare too -- an `UpdateStatus`, which carries
   * its own four branches (`src/shared/update.ts`). It is the only channel
   * that reaches a host outside this machine, and it does so unauthenticated,
   * with no query and no body; see `src/main/update/check.ts`.
   */
  updateCheck: 'vam:update:check',
  /**
   * "Take me to the release." Answers a bare boolean -- did the operator's
   * browser open -- and takes NO argument: the URL opened is the one main's
   * own launch check found, never one the renderer supplies. That is what
   * keeps this from being a general "open any URL" capability in a window
   * whose whole navigation policy is deny-by-default.
   */
  updateOpen: 'vam:update:open',
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
   * ONE keystroke, into the pane the Terminal tab is showing. Answers a bare
   * boolean: did vam type it into a session it could prove was its own. It is
   * the only channel that writes into a RUNNING agent, so the false answer is
   * drawn on the tab rather than dropped -- a surface that takes keys and
   * silently discards them is worse than one that will not take focus.
   */
  terminalSend: 'vam:terminal:send',
  /**
   * The operator's ANSWER to the question a session is asking -- the option
   * labels, and whether the tool said multi-select.
   *
   * A separate channel from `terminalSend` because it is a separate act. That
   * one delivers one keystroke and says whether tmux took it. This one reads
   * the picker on screen, walks its cursor onto the chosen LABEL, presses
   * Return and reads back -- and answers with which of those steps it got to
   * (`shared/answer.ts`). The route it does NOT take, delivering the option's
   * text, was measured against a live picker and committed a different option
   * than the one typed.
   */
  terminalAnswer: 'vam:terminal:answer',
  /**
   * The QUESTION a session is asking that nothing wrote down -- read off its
   * pane rather than out of a transcript.
   *
   * It exists because the commonest thing a session blocks on, a tool-approval
   * prompt, leaves no record at all while it is open: `questions` is empty for
   * it and always will be. So the card that answers it has nowhere to get the
   * title and the labels from except the screen, and this is that read.
   *
   * Distinct from `terminalRead`, which hands over a whole screen for the
   * Terminal tab to draw. This hands over a title and a list of options, which
   * go straight back down `terminalAnswer` -- so the two channels together are
   * the read and the write of one act, and the labels the operator sees are
   * the labels vam will match on the pane.
   */
  terminalPrompt: 'vam:terminal:prompt',
  /**
   * The directory picker. Answers BARE -- a path or `null` -- never an
   * `IpcResult`: "which directory" has exactly two answers and a cancelled
   * dialog is one of them, not a failure to report in a source's words. There
   * is no source behind this channel at all; it is Electron's own
   * `showOpenDialog`, which is why it cannot exist in the browser build.
   */
  chooseDirectory: 'vam:dialog:choose-directory',
  /**
   * The image-attach picker. Unlike `chooseDirectory` it answers through the
   * `IpcResult` envelope: there IS a refusal behind this one to report in
   * words -- outside the session's directory, or not really an image -- and
   * cancelling the dialog is `{ok: true, value: null}`, the same "not a
   * failure" reading `chooseDirectory` gives its own cancel. See
   * `./dialog/attach-image.ts`.
   */
  pickImageAttachment: 'vam:dialog:pick-image-attachment',
  /**
   * The pairing screen's channels. Every one of them answers a bare
   * `RemoteState` (`src/main/remote/ipc.ts`) rather than an `IpcResult`: the
   * screen's whole content is that one snapshot, so an act returning the
   * state it produced is what keeps the panel from drawing a stale code for
   * a poll interval after the operator pressed something.
   *
   * THESE ARE DESKTOP-ONLY ACTS. `open`, `approve` and `deny` are reachable
   * from this bridge and from nowhere else -- the remote server is handed a
   * `PairPort` with `submit` alone (`remote/server.ts`), because opening the
   * screen clears the pairing lockout and that is only defensible while it
   * takes a human at this machine.
   */
  remoteState: 'vam:remote:state',
  pairingOpen: 'vam:pairing:open',
  pairingApprove: 'vam:pairing:approve',
  pairingDeny: 'vam:pairing:deny',
  deviceRemove: 'vam:remote:device-remove',
  deviceRemoveAll: 'vam:remote:device-remove-all',
  /**
   * Turning `tailscale serve` on or off, THE SAME DESKTOP-ONLY BRIDGE as
   * `pairingOpen` and for the same reason: it changes this machine's own
   * standing network configuration, which is only defensible while pressing
   * it takes a human sitting here. `remote/serve.ts` is what actually runs
   * the CLI; this channel is only reachable while a remote endpoint is
   * configured at all, same as every channel above it.
   */
  serveEnable: 'vam:remote:serve-enable',
  serveDisable: 'vam:remote:serve-disable',
  /**
   * The persisted "let paired devices write" preference (`remote/writes-preference.ts`).
   * THE SAME DESKTOP-ONLY BRIDGE, for the same reason: it is the explicit act
   * that turns on write routes the NEXT time vam starts.
   */
  remoteWritesSet: 'vam:remote:writes-set',
  /**
   * MAIN's own failure buffer (`src/main/errors/log.ts`), not the renderer's
   * -- the renderer's `errors/log.ts` never leaves the renderer, by design.
   * This is the ROUTE ONTO it for a failure that started in main, most often
   * before any renderer existed to be pushed to. `vam:errors:get` is a plain
   * pull -- the whole backlog, oldest first -- and `vam:errors:changed` is
   * payload-free, the SAME "ask again" shape `vam:stream:change` already
   * uses: a tick means "call `get` again", never a payload of its own. That
   * shape is what makes a late subscriber recover everything recorded before
   * it existed, which a bare push would silently have dropped.
   */
  mainErrorsGet: 'vam:errors:get',
  mainErrorsChanged: 'vam:errors:changed',
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
