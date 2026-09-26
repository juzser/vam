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
  resumeSession: 'vam:source:resume-session',
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
  /**
   * ONE SUBAGENT's work: what it was asked, what it has said, what it has
   * called. Distinct from `load` for the reason `sessionHistory` is, only more
   * so -- a session here has up to 460 subagent transcripts beside it, and the
   * poll reads a 128 KiB tail per SESSION. Nobody pays this until a person
   * opens the Agents tab and picks a row.
   *
   * Like `sessionHistory` it answers through the `IpcResult` envelope AND has
   * an `unavailable` arm of its own; the preload folds the first into the
   * second so a caller has one shape to draw.
   */
  sessionAgentWork: 'vam:session:agent-work',
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
   * DESKTOP-ONLY, the same standing as `setPrRepos` above, and the second
   * preference main needs a copy of: whether vam asks the agent for a shorter,
   * clearer answer.
   *
   * NOT A MEMBER OF `PreloadSourceApi`, for a reason that is stronger here
   * than for the map. The rules are typed into a tmux pane ON THIS MACHINE;
   * putting the switch on the routes `remote/server.ts` registers would let a
   * paired phone change what vam types into an agent running on the desktop,
   * which is a remote capability nobody asked for. The phone still gets the
   * effect -- a prompt SENT from the phone travels through the same
   * `DESKTOP_SOURCE.recordPrompt` -- it just cannot change the setting.
   *
   * Answers through the `IpcResult` envelope like `setPrRepos`, so a caller
   * has one shape to read. See `main/terminal/concise.ts`.
   */
  setConciseOutput: 'vam:terminal:set-concise-output',
  /**
   * The usage channel. Unlike every channel above, it answers with a bare
   * `UsageSnapshot`, never an `IpcResult` -- see `src/main/usage/ipc.ts`.
   */
  usageGet: 'vam:usage:get',
  /**
   * Codex's own usage, read from its rollout files rather than the network --
   * see `src/main/usage/codex-reader.ts`. Answers bare too, a
   * `CodexUsageSnapshot`, for the same reason `usageGet` does: a reading
   * failure is not a `SourceError`, there is no source and no session to
   * refuse anything on.
   */
  usageCodexGet: 'vam:usage:codex:get',
  /**
   * The clipboard channel. Like `usageGet` it answers bare -- a `boolean`,
   * not an `IpcResult`: "did the text reach the clipboard" is the whole
   * answer, and there is no source to refuse anything in the words of.
   */
  clipboardWrite: 'vam:clipboard:write',
  /**
   * "Open a prefilled vam issue in my own browser."
   *
   * TEXT, NEVER A LOCATION -- `remoteOpenLink`'s rule, kept, through a
   * different door. The renderer sends a TITLE and a BODY; main builds the
   * address from `src/shared/issue.ts` and opens that. A URL sent as a title
   * arrives as a query parameter of vam's own issues page and goes nowhere.
   *
   * It POSTS NOTHING. What opens is the form, prefilled, in the operating
   * system's browser -- pressing submit there stays the operator's decision
   * and their last read of the body before it is public (`report.ts`). Before
   * this channel the only route to github.com was pasting a four-kilobyte URL
   * by hand, out of a panel whose text could not be selected.
   *
   * Answers a bare boolean: did a browser open. Same shape as `updateOpen`.
   */
  issueOpen: 'vam:issue:open',
  /**
   * The update check. Answers bare too -- an `UpdateStatus`, which carries
   * its own four branches (`src/shared/update.ts`). It is the only channel
   * that reaches a host outside this machine, and it does so unauthenticated,
   * with no query and no body; see `src/main/update/check.ts`.
   */
  /**
   * "Open one of the two links the Remote panel draws."
   *
   * THE RENDERER NAMES A KEY, NEVER A URL, and that is the whole design:
   * `window.open` is denied for every page in this app, so a link in the panel
   * did nothing at all -- and the fix must not become an open-anything
   * capability behind a different door. Main maps the key to a destination it
   * owns: a constant for the download page, and for the tailnet admin page the
   * URL main itself read out of `tailscale serve`'s own output.
   *
   * Answers a bare boolean: did a browser open. Same shape as `updateOpen`.
   */
  remoteOpenLink: 'vam:remote:open-link',
  /**
   * "Open the link this agent wrote" -- THE ONE CHANNEL ON THIS BRIDGE THAT
   * TAKES A DESTINATION FROM THE RENDERER, and it owes the sharpest argument
   * here because `remoteOpenLink` directly above and `issueOpen` further up
   * both exist by NOT taking one.
   *
   * Their rule is right and is unchanged: a channel that takes a URL is a
   * navigate-anywhere capability handed to the least trusted process, so
   * wherever main CAN own the destination it must. It cannot here. The
   * addresses in a transcript are whatever a model typed into its answer;
   * there is no key to map onto a constant, and what vam shipped instead was a
   * link that did nothing at all -- the operator selecting an address out of a
   * panel and pasting it into a browser by hand, which is the same defect
   * `issueOpen` was filed about.
   *
   * SO THE ALLOWLIST IS WHAT PAYS FOR IT, AND IT LIVES IN MAIN.
   * `src/shared/link.ts` is the single decision -- `http:` and `https:`, an
   * address parsed by `new URL` and never matched as a string, no credentials
   * hiding the host -- and `src/main/link/ipc.ts` runs it on THIS side of the
   * boundary, on every call, whatever the renderer believed. `javascript:`,
   * `data:`, `file:` and every custom app scheme are refused here; the
   * renderer running the same check first is a convenience whose deletion
   * would change nothing about what can be opened.
   *
   * Answers a bare `LinkOutcome` rather than an `IpcResult`, like
   * `updateCheck` and `terminalRead`: the type carries its own refusal branch,
   * and that branch is a SENTENCE to draw beside the control the operator
   * pressed -- a link that cannot be opened has to say why, or it is the
   * do-nothing control this channel was added to end.
   *
   * NOT A MEMBER OF `PreloadSourceApi`, so `remote/server.ts` has no route to
   * it: a paired phone has a browser of its own, and "open this URL" asked of
   * THIS machine by a remote device is a different act that would need its own
   * decision.
   */
  linkOpen: 'vam:link:open',
  /**
   * OPEN A PULL REQUEST IN THE OPERATOR'S BROWSER.
   *
   * A SECOND CHANNEL RATHER THAN A CALL TO `linkOpen`, and the difference is
   * the allowlist, not the plumbing. `linkOpen` governs an address a MODEL
   * WROTE in prose and lets any http or https address through, because vam
   * cannot enumerate the web an agent might reference. This one governs the
   * address behind a ROW IN VAM'S OWN LIST, where the operator is promised
   * they know where it goes without reading it -- so it accepts https on
   * github.com and nothing else (`src/shared/pr-link.ts`). Routing this
   * through `linkOpen` would have widened it to the whole web for the sake of
   * reusing four lines.
   *
   * Authorised by the operator on 2026-09-18: `pull-requests.ts` had recorded
   * that opening a pull request in a browser was deliberately absent, and this
   * is the decision that changed it.
   *
   * NOT A MEMBER OF `PreloadSourceApi`, for `linkOpen`'s reason: a paired
   * phone has a browser of its own.
   */
  prsOpen: 'vam:prs:open',
  /**
   * MERGE A PULL REQUEST, OR DELETE A BRANCH. The only channel in this table
   * that changes anything on GitHub.
   *
   * Takes a SESSION ID, never a directory. Which repository is acted on is
   * decided by where that session stands, exactly as
   * `sources/claude-code/pull-requests.ts` refuses `--repo` so that a pane can
   * only ever describe the repository vam is actually in. A channel that took
   * a path would hand that invariant straight back.
   *
   * Everything else it needs is validated in main: the number, the branch (it
   * goes into an API PATH -- see `checkBranchName`), and the merge method,
   * which is an ALLOWLIST and is what keeps `--admin` unreachable from the
   * renderer. The runner behind it is non-re-entrant, so a second click while
   * one is in flight is refused rather than run.
   *
   * NOT A MEMBER OF `PreloadSourceApi`: there is no route to this on
   * `remote/server.ts`'s table and there must not be. A paired phone
   * authenticated once, over the network, must not be able to merge the
   * operator's pull requests.
   */
  prsAction: 'vam:prs:action',
  updateCheck: 'vam:update:check',
  /**
   * The same question, asked AGAIN, because a person pressed a button.
   *
   * `updateCheck` answers from the one check made at launch and never makes
   * another -- which is right for a notice that reads it on mount and wrong
   * for the Settings row the operator asked for, where a cached reply from
   * whenever the app was started is a button that lies about having checked.
   * This one really goes out, and its answer REPLACES the stored one, so that
   * `updateOpen` can act on what the operator is looking at.
   *
   * The rate limit is a hand: GitHub allows 60 unauthenticated requests an
   * hour per IP, and `rate-limited` is already a quiet outcome of its own.
   */
  updateRecheck: 'vam:update:recheck',
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
   * WHICH MODEL a session is running -- read off the CLI's own status line, in
   * the pane vam started for that row.
   *
   * It exists because vam ASKS for a model and never reads the CLI's own
   * answer line back (`terminalSwitchModel` below), so what vam asked for is
   * not what the session is on: the operator can switch it in the pane
   * themselves, and a session vam resumed was set by somebody else. The model
   * button therefore either wears a name this channel read a moment ago or
   * wears no name at all.
   *
   * Distinct from `terminalRead` for the reason `terminalPrompt` is: that one
   * hands over a whole screen for the Terminal tab to draw, and this hands
   * over one fact, out of a capture with no scrollback in it, to a control
   * that is on screen whether or not that tab is open.
   *
   * Answers BARE, like the reads beside it: `SessionModel` carries its own
   * "vam could not tell" branch (`shared/terminal.ts`), so an envelope would
   * give the caller two ways to be told the same thing.
   */
  terminalModel: 'vam:terminal:model',
  /**
   * CHANGING which model a session runs -- the write to `terminalModel`'s read.
   *
   * A separate channel from `terminalSend` for the reason `terminalAnswer` is
   * one: it is a separate ACT, not a keystroke. Main opens the CLI's own
   * `/model` menu, proves it is taking arrow keys, walks the cursor onto the
   * row that names the alias and presses `s` -- the key whose answer is `Set
   * model to Haiku 4.5 for this session only`.
   *
   * IT EXISTS BECAUSE THE OBVIOUS ROUTE REWRITES THE OPERATOR'S SETTINGS.
   * `/model <alias>` + Return -- what vam typed over `terminalSend` until this
   * channel existed -- answers `Set model to Opus 5 and saved as your default
   * for new sessions`, measured on Claude Code 2.1.276. The whole policy lives
   * in `main/terminal/model-switch.ts`, so there is ONE rule and it is not in
   * the least trusted process in the app.
   *
   * Answers BARE, like the reads beside it: `ModelSwitchResult` carries every
   * refusal as its own arm (`shared/terminal.ts`), so an envelope would give
   * the caller two ways to be told the same thing.
   */
  terminalSwitchModel: 'vam:terminal:switch-model',
  /**
   * OPEN the Terminal tab's STREAMING connection -- a second, persistent
   * `tmux -C` attached directly to the session the operator is viewing, so
   * `%output` can feed xterm.js instead of `terminalRead` polling
   * `capture-pane` on a timer (`docs/design/terminal-streaming.md`). Resolved
   * the SAME way `terminalRead`/`terminalSend` are, by
   * `listVamSessions`+`targetSession`, so a stream can never attach to a
   * session those channels would have refused -- see
   * `terminal/stream-ipc.ts`. Answers `{ok:true, streamId, seed}` (the first
   * screen rides this response directly) or a typed `{ok:false, reason}`,
   * never a throw across the bridge: a refused session, an unresolvable
   * pairing and a `tmux -V` below this feature's minimum are all facts, not
   * exceptions.
   */
  terminalStreamOpen: 'vam:terminal:stream:open',
  /**
   * CLOSE one streaming connection opened by `terminalStreamOpen`, by its
   * `streamId`. Idempotent -- an already-closed or unknown id is a no-op:
   * this push-based cleanup call may race the connection's own natural
   * teardown (the child dying on its own), the same posture
   * `stream/register.ts`'s ref-counted unsubscribe takes, though this is not
   * ref-counted -- one `StreamClient` per `streamId`.
   */
  terminalStreamClose: 'vam:terminal:stream:close',
  /**
   * ONE keystroke (or a paste, or an escape sequence -- whatever xterm's own
   * `onData` handed the renderer) into the pane a streaming connection is
   * attached to. Silently ignored for an unknown/closed `streamId`: a
   * keystroke arriving a tick after `terminalStreamClose` is not an error.
   * Fire-and-forget like `terminalSend`, for the identical reason -- what
   * tmux did with it arrives as `%output` on `terminalStreamData` regardless.
   */
  terminalStreamWrite: 'vam:terminal:stream:write',
  /**
   * PUSH: decoded `%output` for one open stream, `(streamId, chunk)`. Main
   * sends unprompted, the same shape `vam:stream:change` already uses for a
   * push channel, keyed per stream here rather than global.
   */
  terminalStreamData: 'vam:terminal:stream:data',
  /**
   * PUSH: a fresh screen for one open stream, `(streamId, seed)` -- fired on
   * reconnect and on tmux's own `%pause`/`%continue` flow-control
   * notification, NEVER on the stream's initial open (whose seed already
   * rides `terminalStreamOpen`'s own response). The renderer is expected to
   * replace its xterm buffer wholesale on this event rather than append.
   */
  terminalStreamSeed: 'vam:terminal:stream:seed',
  /**
   * PUSH, `(streamId, event)`: this stream's connection dropped, where
   * `event` is `StreamClient`'s own `StreamDownEvent` (`terminal/stream/
   * client.ts`) -- `{kind:'reconnecting', attempt}` while a backed-off retry
   * is still pending (a `terminalStreamSeed` follows once one lands), or a
   * TERMINAL `{kind:'gave-up', reason:'max-attempts'|'session-gone'}` once
   * this client has stopped trying for good (a review finding: the payload
   * used to be dropped entirely, so a renderer had no way to tell the two
   * apart -- see `StreamClient`'s own `MAX_RECONNECT_ATTEMPTS`). Purely
   * informational either way -- nothing on this side waits for an
   * acknowledgement -- but `gave-up` is the renderer's one signal that
   * NOTHING further will arrive on this `streamId` until it opens a fresh
   * one itself.
   */
  terminalStreamDown: 'vam:terminal:stream:down',
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
   * The file-editor tab's read: one operator-named path, authorised against
   * every LIVE session's own working directory before a byte is opened. See
   * `src/main/files/authorize.ts` for why a prefix check alone cannot do
   * that authorisation and `src/main/files/ipc.ts` for the size ceiling,
   * binary sniff and the full refusal vocabulary. Answers through the
   * `IpcResult` envelope: "outside every session's directory" and "too
   * large" are both refusals in `SourceError`'s own words, not exceptions.
   *
   * DESKTOP-ONLY BY CONSTRUCTION, NOT BY CONVENTION: `src/main/remote/
   * server.ts`'s route table carries no matching path, and its `UNSERVED`
   * ledger names `files` beside `terminal` so the absence is documented
   * rather than merely true. Arbitrary file read/write over a network is at
   * least as serious as typing into a running agent.
   */
  filesRead: 'vam:files:read',
  /**
   * The file-editor tab's write, with its conflict model IN the same
   * request rather than a follow-up: the caller's signature (size, mtime
   * and a content hash -- `src/main/files/content.ts`) must match what is
   * on disk right now, or the write is refused as `changed-on-disk` rather
   * than overwriting an agent's own concurrent edit. See `./files/ipc.ts`.
   * The SAME desktop-only standing as `filesRead`, for the same reason.
   */
  filesWrite: 'vam:files:write',
  /**
   * The file-editor tab's directory listing: given a live session's own id,
   * every regular file under that session's own working directory --
   * `node_modules` and `.git` walked over rather than into (orca's own
   * quick-open exemption, generalised: every OTHER dotfile and dotdirectory
   * stays visible, because `.env` is the file the operator named this
   * feature for), symlinks neither listed nor followed. See
   * `src/main/files/list.ts` for the walk and `./files/list-ipc.ts` for the
   * channel.
   *
   * ADDED AFTER `filesRead`/`filesWrite` SHIPPED, and keyed by SESSION ID
   * rather than by a directory string, for the reason `pickImageAttachment`
   * already is: `renderer/domain/model.ts` carries no `cwd` field, so a
   * channel this shape is the only way the renderer can ever discover a path
   * to hand `filesRead` in the first place. Listing grants no standing of its
   * own -- every path it returns is still independently re-authorised
   * (`authorize.ts`) the moment it is handed to `filesRead`/`filesWrite`.
   *
   * THE SAME DESKTOP-ONLY STANDING AS `filesRead`/`filesWrite` -- covered by
   * the SAME `UNSERVED.files` entry in `remote/server.ts` rather than a
   * second one, since the argument ("arbitrary file access over a network is
   * at least as serious as typing into a running agent") does not change
   * because the payload is names instead of bytes.
   */
  filesList: 'vam:files:list',
  /**
   * `src/foo/bar.ts:42`, as an AGENT wrote it, turned into an absolute path
   * the Files tab may open -- or into a refusal in words.
   *
   * KEYED BY SESSION ID for `filesList`'s reason, and with a sharper one of
   * its own: the reference belongs to the session whose answer it was written
   * in, and `src/index.ts` names a different file in each project vam is
   * watching. So this channel authorises against THAT session's own working
   * directory alone, not against every live root the way `filesRead` does --
   * `filesRead` is right to accept any of them, because the operator typed
   * that path, and this is right not to, because nobody typed this one.
   *
   * IT GRANTS NO STANDING. The path it answers with is re-authorised from
   * scratch the moment it is handed to `filesRead`, exactly as a path out of
   * `filesList` is. What it adds is containment for a string nobody typed --
   * resolved and compared as canonical paths through the real filesystem, so
   * a `..`, a sibling directory whose name merely begins with the root's, and
   * a symlink pointing out of the project are all refused (`resolve-ipc.ts`).
   *
   * THE SAME DESKTOP-ONLY STANDING as `filesRead`/`filesWrite`/`filesList`,
   * covered by the SAME `UNSERVED.files` entry in `remote/server.ts`: turning
   * a name into an authorised path is the listing question asked one reference
   * at a time, and it gets no route for the same reason listing gets none.
   */
  filesResolve: 'vam:files:resolve',
  /**
   * HOW MUCH UNSAVED TEXT THE FILE EDITOR IS HOLDING -- a count and a list of
   * labels, pushed by the renderer whenever that changes and read by
   * `app.on('before-quit')` (`src/main/quit/guard.ts`).
   *
   * NOT A MEMBER OF `PreloadSourceApi`, the same standing as `setPrRepos` and
   * `streamSubscribe`, and here the reason is the plainest of the three: this
   * is about QUITTING THIS APPLICATION, and a paired phone has neither a file
   * editor nor an application to quit. It is covered by the SAME
   * `UNSERVED.files` entry in `remote/server.ts` as the three channels above
   * rather than a second one, because "the remote endpoint carries no file
   * route" is exactly what this is.
   *
   * IT IS A PUSH, NOT A PULL, and that is why it exists at all rather than
   * main simply asking when the operator quits. `beforeunload` cannot cover
   * Cmd-Q -- it is a page hook and `before-quit` is a main-process veto -- and
   * a `before-quit` that WAITS on the renderer for an answer is one a wedged
   * renderer can hang. An app that cannot be quit is a worse bug than the one
   * this closes. Main keeps the last report and reads a local variable, so
   * there is no wait and nothing to time out; `src/main/quit/unsaved.ts` names
   * the staleness that costs and why both directions of it are safe.
   *
   * Answers the `IpcResult` envelope like its neighbours, always `{ok: true}`:
   * the reader is total, so a payload main cannot parse already means "nothing
   * is unsaved" -- which blocks no quit, rather than blocking every one.
   */
  filesUnsaved: 'vam:files:unsaved',
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
  /**
   * DESKTOP NOTIFICATIONS. The renderer decides WHEN (it is the only process
   * holding a previous model, `src/renderer/notify/waiting.ts`); main makes
   * the OS call (`src/main/notify/notify.ts`) because the renderer's own
   * `Notification` sits behind the permission policy this app denies.
   *
   * `show` and `close` answer bare -- a boolean and nothing -- like
   * `clipboardWrite`: there is no source to refuse in the words of, and what
   * went wrong is not the caller's to render. It is written to main's failure
   * buffer (`mainErrorsGet` above) with the OS's text verbatim, which is the
   * whole instrument. `activated` is a PUSH, `{sourceId, sessionId}`, sent
   * when a banner is clicked, so the renderer can go to that session.
   *
   * NOT MEMBERS OF `PreloadSourceApi`, for the reason `setConciseOutput` is
   * not: a paired phone must not be able to raise a banner on the desktop.
   *
   * `test` is the settings button. No argument -- main chooses the title and
   * the body -- and it answers a `NotifyVerdict` (`src/shared/notify.ts`)
   * rather than a boolean, because the button exists to say inline what the
   * OS did with the banner. Same notifier path, so the error log still gets
   * what a real banner's failure would have written.
   */
  notifyShow: 'vam:notify:show',
  notifyClose: 'vam:notify:close',
  notifyTest: 'vam:notify:test',
  notifyActivated: 'vam:notify:activated',
  /**
   * THE WORKTREES FEATURE'S THREE CHANNELS: list the linked worktrees of a
   * project vam already knows, create one, remove one.
   *
   * DESKTOP-ONLY, LIKE `filesRead`/`filesWrite`/`filesList` -- NOT MEMBERS
   * OF `PreloadSourceApi`, so `remote/server.ts`'s route table carries no
   * matching path and a paired phone cannot reach any of the three. A
   * worktree is a checkout on THIS machine's disk, spawning `git` as a
   * child process of the desktop app; the operator's own decision for this
   * feature's v1 is that a remote device may see and use the sessions a
   * worktree already has, exactly as it can for any other project, but may
   * not create or remove the worktree itself. Exposing that over the
   * network is named explicitly as a phase 2 question in
   * `docs/design/worktrees.md`, not decided here by omission.
   *
   * Every one of the three answers through the `IpcResult` envelope, like
   * every other write/read below `describe`/`load` above: `worktrees.ts`'s
   * own functions already resolve to `SourceError | T`, never throw, so the
   * handler only has to fold that union into `{ok:false,error}` /
   * `{ok:true,value}`.
   */
  worktreeList: 'vam:worktree:list',
  worktreeCreate: 'vam:worktree:create',
  worktreeRemove: 'vam:worktree:remove',
  /**
   * PHASE 2A'S OWN FOURTH CHANNEL: a dirty flag and an ahead/behind count,
   * for a caller-chosen subset of the worktrees `worktreeList` already
   * answered. Its OWN channel, not folded into `worktreeList`'s own answer
   * -- see `shared/worktree.ts`'s `WorktreeStatus` header for why eagerly
   * computing this for every worktree on every `list()` call was rejected.
   * Desktop-only, like the three above it, for the identical reason.
   */
  worktreeStatus: 'vam:worktree:status',
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
