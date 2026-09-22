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

import type { MainFailureEvent } from '../main/errors/log.js';
// `./types.js` ONLY -- never `./content.js` or `./ipc.js`, which need
// `node:crypto`/`node:path`/`Buffer` and would drag this whole preload
// module (imported for types by `src/renderer/App.tsx`) into a typecheck
// (`tsconfig.web.json`) that carries no `node` types at all. See
// `src/main/files/types.ts`'s own header.
import type {
  FileListResult,
  FileReadResult,
  FileRefTarget,
  FileSignature,
  FileWriteResult,
} from '../main/files/types.js';
import { CHANNELS, type IpcResult } from '../main/ipc/channels.js';
// Type only, and the module it comes from imports NOTHING -- same trap as
// `./files/types.js` above: this file is imported for types by
// `src/renderer/App.tsx`, so anything it reaches is typechecked under
// `tsconfig.web.json`, which carries no `node` types.
import type { UnsavedReport } from '../main/quit/unsaved.js';
import type { RemoteState } from '../main/remote/state.js';
import type { Project } from '../renderer/domain/model.js';
import type { SourceError } from '../renderer/sources/port.js';
import type { AgentWork } from '../shared/agent-work.js';
import type { AnswerRequest, AnswerResult, PromptView } from '../shared/answer.js';
import type { HistoryCursor, TranscriptPage } from '../shared/history.js';
import type { LinkOutcome } from '../shared/link.js';
import type { NotifyVerdict } from '../shared/notify.js';
import type { PrAction, PrActionOutcome } from '../shared/pr-action.js';
import type { PrLinkOutcome } from '../shared/pr-link.js';
import type { PreloadSourceApi, SourceDescriptor } from '../shared/preload-api.js';
import type {
  ModelSwitchResult,
  PaneKey,
  PaneReadMode,
  PaneSendResult,
  PaneView,
  SessionModel,
} from '../shared/terminal.js';
import type { UpdateStatus } from '../shared/update.js';
import type { UsageSnapshot } from '../shared/usage.js';

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

/**
 * `unwrap`, for the members that must not reject.
 *
 * An on-demand read has to tell "vam could not read" apart from the ordinary
 * empty answer -- "there is nothing older", "this agent has done nothing yet"
 * -- and both `TranscriptPage` and `AgentWork` already carry the distinction
 * in their own `unavailable` arm. Rejecting for the first would put that state
 * somewhere a caller has to remember to look, and the caller that forgot would
 * draw the second. So every failure -- a refusal main returned, a channel that
 * is not registered, a bridge that is gone -- lands in the arm the type has.
 *
 * ONE COPY FOR BOTH READS. The mapping below decides whether a thrown value is
 * already a `SourceError`, and a second copy of that decision is a second
 * place for it to drift from `port.ts`'s `describeFailure`.
 */
async function unwrapIntoArm(pending: Promise<unknown>): Promise<UnavailableArm | unknown> {
  try {
    return await unwrap<unknown>(pending);
  } catch (reason) {
    // A refusal main RETURNED keeps its own `kind`, `code` and message -- the
    // same shape `port.ts`'s `describeFailure` renders. Only something that is
    // not one of those gets a code minted here.
    if (
      typeof reason === 'object' &&
      reason !== null &&
      'kind' in reason &&
      'code' in reason &&
      'message' in reason
    ) {
      return { kind: 'unavailable', error: reason as SourceError } satisfies UnavailableArm;
    }
    return {
      kind: 'unavailable',
      error: {
        kind: 'unreachable',
        code: 'bridge-failed',
        message: reason instanceof Error ? reason.message : String(reason),
      },
    } satisfies UnavailableArm;
  }
}

/** The arm both on-demand reads carry, and the only shape this file adds. */
type UnavailableArm = { readonly kind: 'unavailable'; readonly error: SourceError };

/**
 * The assertion here is the one thing worth reading twice: `unwrapIntoArm`
 * returns either what main sent -- which IS a `TranscriptPage`, because that is
 * what the channel resolves -- or the `unavailable` arm, which every one of
 * these types contains. Both are the return type; TypeScript cannot see the
 * first half of that sentence, so it is stated here rather than duplicated as
 * two identical catch blocks.
 */
export const unwrapPage = (pending: Promise<unknown>): Promise<TranscriptPage> =>
  unwrapIntoArm(pending) as Promise<TranscriptPage>;

/** The same, for one agent's work. See `unwrapPage`. */
export const unwrapAgentWork = (pending: Promise<unknown>): Promise<AgentWork> =>
  unwrapIntoArm(pending) as Promise<AgentWork>;

/**
 * THE PREFERENCES MAIN NEEDS A COPY OF. Two, now.
 *
 * ITS OWN FACTORY, AND NOT PART OF `DesktopSourceApi`, which is the whole
 * point. `DesktopSourceApi` is `PreloadSourceApi` minus one member -- the
 * shape a paired phone also implements over HTTP -- and adding either of these
 * there would put a desktop-only act on the remote routes: "a directory this
 * machine spawns a process in" for the first, and "what vam types into an
 * agent running on this machine" for the second. They are preferences main
 * happens to need, not things the source can do, so they sit beside
 * `clipboard` and `dialog` as their own desktop-only member. See
 * `main/sources/claude-code/pr-repos.ts` and `main/terminal/concise.ts`.
 *
 * NEITHER DECIDES ANYTHING HERE. Both forward a value main validates on its
 * own side, because the renderer is the least trusted process in the app and a
 * check in the preload is a check the renderer could have skipped.
 */
export function createPrefsBridge(ipc: InvokerLike) {
  return {
    setPrRepos: (map: unknown) => unwrap<void>(ipc.invoke(CHANNELS.setPrRepos, map)),
    setConciseOutput: (on: unknown) => unwrap<void>(ipc.invoke(CHANNELS.setConciseOutput, on)),
  };
}

export function createPreloadApi(ipc: InvokerLike): DesktopSourceApi {
  const reads = {
    describe: () => unwrap<SourceDescriptor>(ipc.invoke(CHANNELS.describe)),
    load: () => unwrap<readonly Project[]>(ipc.invoke(CHANNELS.load)),
  } satisfies Pick<PreloadSourceApi, 'describe' | 'load'>;

  const writes = {
    resumeSession: (sessionId) => unwrap<void>(ipc.invoke(CHANNELS.resumeSession, sessionId)),
    recordPrompt: (sessionId, prompt) =>
      unwrap<void>(ipc.invoke(CHANNELS.recordPrompt, sessionId, prompt)),
    renameSession: (sessionId, title) =>
      unwrap<void>(ipc.invoke(CHANNELS.renameSession, sessionId, title)),
    closeSession: (sessionId, force) =>
      unwrap<void>(
        force === undefined
          ? ipc.invoke(CHANNELS.closeSession, sessionId)
          : ipc.invoke(CHANNELS.closeSession, sessionId, force),
      ),
    // The provider is forwarded ONLY when the renderer named one: main takes
    // an absent third argument as "your default provider", and sending an
    // explicit `undefined` would make the arity two-or-three at every layer
    // for no gain.
    createSession: (projectId, title, provider) =>
      unwrap<void>(
        provider === undefined
          ? ipc.invoke(CHANNELS.createSession, projectId, title)
          : ipc.invoke(CHANNELS.createSession, projectId, title, provider),
      ),
    createSessionIn: (cwd, title, provider) =>
      unwrap<void>(
        provider === undefined
          ? ipc.invoke(CHANNELS.createSessionIn, cwd, title)
          : ipc.invoke(CHANNELS.createSessionIn, cwd, title, provider),
      ),
    pickImageAttachment: (sessionId) =>
      unwrap<string | null>(ipc.invoke(CHANNELS.pickImageAttachment, sessionId)),
  } satisfies Pick<
    PreloadSourceApi,
    | 'recordPrompt'
    | 'renameSession'
    | 'closeSession'
    | 'createSession'
    | 'createSessionIn'
    | 'resumeSession'
    | 'pickImageAttachment'
  >;

  const history = {
    // Cursor-in, page-out, and NEVER a rejection: see `unwrapPage`. The cursor
    // is forwarded as-is, `null` included -- main takes null as "from the
    // newest end", which is the first thing any caller asks for.
    history: (sessionId: string, cursor: HistoryCursor | null) =>
      unwrapPage(ipc.invoke(CHANNELS.sessionHistory, sessionId, cursor)),
    // Same envelope, same never-rejects rule: the Agents pane draws one shape.
    agentWork: (sessionId: string, agentId: string) =>
      unwrapAgentWork(ipc.invoke(CHANNELS.sessionAgentWork, sessionId, agentId)),
  } satisfies Pick<PreloadSourceApi, 'history' | 'agentWork'>;

  const governance = {
    applyWaivers: (sessionId, findingIds) =>
      unwrap<void>(ipc.invoke(CHANNELS.applyWaivers, sessionId, findingIds)),
    transitionLesson: (sessionId, lessonId, status) =>
      unwrap<void>(ipc.invoke(CHANNELS.transitionLesson, sessionId, lessonId, status)),
  } satisfies Pick<PreloadSourceApi, 'applyWaivers' | 'transitionLesson'>;

  return { ...reads, ...writes, ...history, ...governance };
}

/** The bridge's usage member: one read, no write, no argument. */
export type UsageApi = {
  get(): Promise<UsageSnapshot>;
};

/**
 * `usage.get` forwards straight to `vam:usage:get` -- no `unwrap`, because
 * that channel answers with a bare `UsageSnapshot`, never an `IpcResult`
 * (see `src/main/usage/ipc.ts`). The cast is the one place this file trusts
 * main: `ipcRenderer.invoke`'s return type is `unknown` by construction, and
 * `UsageSnapshot`'s own two-branch shape is what a caller can safely narrow
 * on regardless of what actually arrived.
 */
export function createUsageApi(ipc: InvokerLike): UsageApi {
  return {
    get: () => ipc.invoke(CHANNELS.usageGet) as Promise<UsageSnapshot>,
  };
}

/**
 * The bridge's update member: read the launch check's answer, and ask for the
 * release page to be opened. Neither takes an argument -- `open` in
 * particular cannot name a destination, so it is not a general "navigate
 * anywhere" capability handed to the least trusted process.
 */
export type UpdateApi = {
  check(): Promise<UpdateStatus>;
  /**
   * The same question, asked again because the operator pressed a button.
   * Unlike `check`, this really goes out -- and its answer replaces the one
   * `check` and `open` read.
   */
  recheck(): Promise<UpdateStatus>;
  /** True when the operator's own browser was opened on the release page. */
  open(): Promise<boolean>;
};

/**
 * Both forward straight through -- no `unwrap`, because these channels answer
 * bare values rather than an `IpcResult` (see `src/main/update/ipc.ts`).
 * `check` READS an answer main already has: the request went out once, at
 * launch, so calling this more often does not make vam contact GitHub more
 * often. `recheck` is the opposite and is the Settings button's own channel:
 * it really asks, and what it gets back becomes the answer `check` and `open`
 * give from then on. `open` asks for the release page in the operator's browser; it
 * downloads nothing.
 */
export function createUpdateApi(ipc: InvokerLike): UpdateApi {
  return {
    check: () => ipc.invoke(CHANNELS.updateCheck) as Promise<UpdateStatus>,
    recheck: () => ipc.invoke(CHANNELS.updateRecheck) as Promise<UpdateStatus>,
    open: () => ipc.invoke(CHANNELS.updateOpen) as Promise<boolean>,
  };
}

/** The bridge's clipboard member: one write, answered by whether it landed. */
export type ClipboardApi = {
  writeText(text: string): Promise<boolean>;
};

/**
 * `clipboard.writeText` forwards straight to `vam:clipboard:write` -- no
 * `unwrap`, because that channel answers with a bare `boolean` rather than an
 * `IpcResult` (see `src/main/clipboard/ipc.ts`). The renderer uses it in
 * preference to `navigator.clipboard`, whose permission this app denies.
 */
export function createClipboardApi(ipc: InvokerLike): ClipboardApi {
  return {
    writeText: (text) => ipc.invoke(CHANNELS.clipboardWrite, text) as Promise<boolean>,
  };
}

/** The bridge's issue member: one prefilled form, answered by whether it opened. */
export type IssueApi = {
  open(title: string, body: string): Promise<boolean>;
};

/**
 * TEXT, NOT A DESTINATION -- `openLink`'s rule kept through a different door.
 * The renderer hands over the title and body `errors/report.ts` composed and
 * main decides where they go (`src/main/issue/ipc.ts`), so this bridge cannot
 * be asked to navigate anywhere. Forwards straight through: the channel
 * answers a bare boolean, not an `IpcResult`, like `clipboard.writeText`
 * above.
 */
export function createIssueApi(ipc: InvokerLike): IssueApi {
  return {
    open: (title, body) => ipc.invoke(CHANNELS.issueOpen, title, body) as Promise<boolean>,
  };
}

/**
 * The bridge's link member: the address an agent wrote, and what became of it.
 *
 * THE ONE MEMBER THAT NAMES A DESTINATION, against the rule `issue.open`
 * directly above exists to keep. `CHANNELS.linkOpen` carries the whole
 * argument; what matters at this seam is that this forwarder decides NOTHING.
 * It does not check the scheme, it does not normalise the address and it does
 * not know which schemes are allowed -- main runs `checkLink` itself on the
 * far side, so a renderer that skipped its own check, or a preload rewritten
 * to skip this comment, cannot widen what opens.
 *
 * Forwards straight through: the channel answers a bare `LinkOutcome`, not an
 * `IpcResult`, because a refusal here is a SENTENCE the control draws beside
 * itself rather than an error to reject with.
 */
export type LinkApi = {
  open(url: string): Promise<LinkOutcome>;
};

export function createLinkApi(ipc: InvokerLike): LinkApi {
  return {
    open: (url) => ipc.invoke(CHANNELS.linkOpen, url) as Promise<LinkOutcome>,
  };
}

/**
 * The bridge's pull-request member: open one, or act on one.
 *
 * SEPARATE FROM `link` ABOVE, ON PURPOSE, and the reason is the allowlist
 * rather than the plumbing -- `CHANNELS.prsOpen` carries it. `link.open` may
 * go anywhere on the web because an agent's prose may reference anywhere;
 * `prs.open` may only go to github.com, because the promise a clickable ROW
 * makes is that the operator knows where it goes without reading an address.
 * Sending pull requests through `link.open` would have quietly widened that.
 *
 * `act` IS THE ONLY MEMBER OF THIS WHOLE BRIDGE THAT CHANGES SOMETHING ON
 * GITHUB. What it does NOT carry is as load-bearing as what it does: no
 * directory (main resolves it from the session id, so a pane cannot act on a
 * repository its session is not in) and no argv (main builds it, so `--admin`
 * is not expressible from this side at all). Like every forwarder here it
 * decides nothing; main validates the number, the branch and the method on its
 * own side of the boundary, whatever this file believes.
 *
 * Both forward straight through: the channels answer a bare outcome, not an
 * `IpcResult`, because a refusal here is a SENTENCE the pane draws beside the
 * row rather than an error to reject with.
 */
export type PrsApi = {
  open(url: string): Promise<PrLinkOutcome>;
  act(sessionId: string, action: PrAction): Promise<PrActionOutcome>;
};

export function createPrsApi(ipc: InvokerLike): PrsApi {
  return {
    open: (url) => ipc.invoke(CHANNELS.prsOpen, url) as Promise<PrLinkOutcome>,
    act: (sessionId, action) =>
      ipc.invoke(CHANNELS.prsAction, sessionId, action) as Promise<PrActionOutcome>,
  };
}

/**
 * The bridge's terminal member: one read, answered by a bare `PaneView`.
 *
 * Asked by PROJECT ID. The pairing between a session and the tmux session vam
 * started for it is recorded on that tmux session at creation and read back
 * (`main/terminal/pane.ts`); the title this once carried was slugged and
 * truncated on the way in and matched nothing that had ever been created.
 */
export type TerminalApi = {
  /**
   * `rowId` is optional and is what makes the answer per SESSION: a project
   * vam started two sessions in has two panes, and only the session itself
   * knows which one it is in (`main/sources/claude-code/session-pane.ts`).
   *
   * `mode` is optional too, and absent means the careful one: main proves the
   * pairing again and captures the whole window. The Terminal tab names its
   * situation instead, because it is the only process that knows where the
   * operator has scrolled to (`shared/terminal.ts`, `PaneReadMode`).
   */
  read(projectId: string, rowId?: string, mode?: PaneReadMode): Promise<PaneView>;
  /**
   * How big the pane can draw, in cells. tmux composes the screen at the
   * session's own size, so this is the only thing that makes a captured screen
   * fit the wrapper. It is aimed by the SAME pairing the read is -- the pane
   * the session published, checked against vam's own listing -- because this
   * one CHANGES a terminal, and the wrong target reflows someone else's work.
   */
  resize(projectId: string, columns: number, rows: number, rowId?: string): Promise<boolean>;
  /**
   * ONE keystroke into the pane, answered by whether it landed.
   *
   * The only member of this bridge that writes into a session an agent is
   * RUNNING in, and the only one whose refusal is drawn on the tab: a surface
   * that took the key and said nothing would be a text box that eats what you
   * type. It answers WHICH refusal (`shared/terminal.ts`) -- vam could not
   * name a single session of its own, or tmux would not deliver to the one it
   * named -- because those are different sentences to the person typing.
   */
  send(projectId: string, key: PaneKey, rowId?: string): Promise<PaneSendResult>;
  /**
   * The operator's answer to the question a session is asking.
   *
   * Beside `send` rather than built out of it, because it is not typing: main
   * reads the picker, walks its cursor onto the chosen LABEL, presses Return
   * and reads back. Typing the option's text instead was measured against a
   * live picker and committed a DIFFERENT option -- so there is deliberately
   * no way to express an answer as a keystroke on this bridge.
   */
  answer(projectId: string, request: AnswerRequest, rowId?: string): Promise<AnswerResult>;
  /**
   * The question the session's PANE is asking, for the shapes nothing wrote
   * down. Beside `answer` because the two are one act: what this returns is
   * what the card offers, and what the card sends back is matched against the
   * same screen.
   */
  prompt(projectId: string, rowId?: string): Promise<PromptView>;
  /**
   * WHICH MODEL the session in that pane is running, read off the CLI's own
   * status line.
   *
   * A read like `prompt`, and beside it for the same reason those two are one
   * act: this is the fact the model BUTTON is drawn from, and the picker
   * underneath sends its choice down `switchModel`. Before this member existed
   * vam typed a request and never looked, so the button could only ever be
   * labelled with the word "model".
   *
   * `{ kind: 'unknown' }` is a normal answer and not a failure: a session with
   * a question open is not painting its status line at all
   * (`shared/terminal.ts`).
   */
  model(projectId: string, rowId?: string): Promise<SessionModel>;
  /**
   * CHANGE the model that session is running -- the write to `model`'s read.
   *
   * NOT BUILT OUT OF `send`, and that is the whole reason this member exists.
   * The picker used to type `/model <alias>` and Return over `send`, which the
   * CLI answers with `Set model to Opus 5 and saved as your default for new
   * sessions` -- so every pick rewrote `~/.claude/settings.json`. Main drives
   * the CLI's own menu instead and presses `s`, which keeps the change to this
   * session; there is deliberately no way to express a model switch as a
   * keystroke on this bridge.
   *
   * `choice` IS ONE OF THE CLI'S FIVE ALIASES, which main walks the menu for.
   * Anything else -- a full model id, say -- has no menu row, and the only
   * form the CLI takes it in is the argument form that ALSO rewrites the
   * default. vam used to send that one and disclose the cost; the operator
   * chose refusal, so it comes back `not-in-menu` with nothing typed, and this
   * bridge offers no second member that would.
   */
  switchModel(projectId: string, choice: string, rowId?: string): Promise<ModelSwitchResult>;
};

/**
 * `terminal.read` forwards straight to `vam:terminal:read` -- no `unwrap`,
 * because that channel answers bare (see `src/main/terminal/ipc.ts`).
 * Called only while the Terminal tab is open: nothing here polls, and the
 * preload starts nothing at expose time.
 */
export function createTerminalApi(ipc: InvokerLike): TerminalApi {
  return {
    // THE TRAILING ARGUMENTS ARE OMITTED RATHER THAN PASSED AS `undefined`,
    // exactly as every other member here omits an absent `rowId`: main counts
    // `args.length` to tell "not given" from "given as nothing", and a mode
    // cannot be asked for without a row to ask it about anyway -- the tab
    // always has one.
    read: (projectId, rowId, mode) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalRead, projectId)
        : mode === undefined
          ? ipc.invoke(CHANNELS.terminalRead, projectId, rowId)
          : ipc.invoke(CHANNELS.terminalRead, projectId, rowId, mode)) as Promise<PaneView>,
    resize: (projectId, columns, rows, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalResize, projectId, columns, rows)
        : ipc.invoke(CHANNELS.terminalResize, projectId, columns, rows, rowId)) as Promise<boolean>,
    send: (projectId, key, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalSend, projectId, key)
        : ipc.invoke(CHANNELS.terminalSend, projectId, key, rowId)) as Promise<PaneSendResult>,
    answer: (projectId, request, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalAnswer, projectId, request)
        : ipc.invoke(CHANNELS.terminalAnswer, projectId, request, rowId)) as Promise<AnswerResult>,
    prompt: (projectId, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalPrompt, projectId)
        : ipc.invoke(CHANNELS.terminalPrompt, projectId, rowId)) as Promise<PromptView>,
    model: (projectId, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalModel, projectId)
        : ipc.invoke(CHANNELS.terminalModel, projectId, rowId)) as Promise<SessionModel>,
    switchModel: (projectId, choice, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalSwitchModel, projectId, choice)
        : ipc.invoke(
            CHANNELS.terminalSwitchModel,
            projectId,
            choice,
            rowId,
          )) as Promise<ModelSwitchResult>,
  };
}

/** The bridge's dialog member: one ask, answered by a path or by `null`. */
export type DialogApi = {
  chooseDirectory(): Promise<string | null>;
};

/**
 * `dialog.chooseDirectory` forwards straight to `vam:dialog:choose-directory`
 * -- no `unwrap`, because that channel answers bare (see
 * `src/main/dialog/ipc.ts`). A cancelled dialog answers `null`: it is one of
 * the two normal answers, not a refusal in some source's words -- there is no
 * source behind this channel at all.
 */
export function createDialogApi(ipc: InvokerLike): DialogApi {
  return {
    chooseDirectory: () => ipc.invoke(CHANNELS.chooseDirectory) as Promise<string | null>,
  };
}

/**
 * The bridge's files member: the file-editor tab's read and write, both
 * answering through the `IpcResult` envelope -- there IS a refusal behind
 * each in a source's own words (outside every session's directory, too
 * large, changed on disk since the edit began), so `unwrap` is used here
 * exactly as it is for `pickImageAttachment`. See `src/main/files/ipc.ts`
 * for the full refusal vocabulary and `src/main/files/authorize.ts` for what
 * "outside every session's directory" means and why it is checked the way
 * it is.
 */
export type FilesApi = {
  read(path: string): Promise<FileReadResult>;
  /**
   * `baseSignature` is the signature the edit was based on -- `null` means
   * "this is a new file, nothing should be there yet". A mismatch against
   * what is actually on disk right now is refused as `changed-on-disk`,
   * never silently overwritten or merged.
   */
  write(
    path: string,
    content: string,
    baseSignature: FileSignature | null,
  ): Promise<FileWriteResult>;
  /**
   * Every regular file under a live SESSION's own working directory --
   * `sessionId`, not a path, for the same reason `pickImageAttachment` takes
   * one: the renderer never learns a session's `cwd` (`renderer/domain/
   * model.ts` carries no field for it), so this is the one way it can ever
   * discover a path to hand `read`/`write` above. Rejects with the port's
   * `SourceError`, same as both. See `src/main/files/list-ipc.ts`.
   */
  list(sessionId: string): Promise<FileListResult>;
  /**
   * `src/foo/bar.ts:42` -- an AGENT's own reference -- turned into an absolute
   * path and a line. Takes the session id for `list`'s reason, and authorises
   * against that session's directory ALONE: nobody typed this path, so it may
   * not reach the wider root set `read`/`write` are checked against. Rejects
   * with the port's `SourceError`, whose message is the sentence the control
   * shows when a reference points outside the project or at nothing at all.
   * See `src/main/files/resolve-ipc.ts`.
   */
  resolve(sessionId: string, reference: string): Promise<FileRefTarget>;
  /**
   * HOW MUCH UNSAVED TEXT THE FILE EDITOR IS HOLDING, pushed whenever that
   * changes so `app.on('before-quit')` has something true to say before Cmd-Q
   * throws it away -- the one exit `beforeunload` cannot reach, because it is
   * a page hook and a quit is a main-process veto.
   *
   * THE ONLY MEMBER HERE THAT ANSWERS `void` RATHER THAN A PROMISE, and that
   * is the honest signature rather than a shortcut: this is a state push, not
   * a request. There is no answer the renderer could act on and nothing for it
   * to draw if the push failed, so returning a promise would only manufacture
   * an unhandled rejection in a page with no use for it. The same
   * fire-and-forget bargain `createStreamSubscribe`'s own `invoke` makes.
   */
  reportUnsaved(report: UnsavedReport): void;
};

/**
 * Forwards straight through `unwrap`, like `pickImageAttachment` -- neither
 * channel answers bare, because both have a refusal worth the caller's own
 * words rather than a rejected promise electron has rewritten.
 *
 * `reportUnsaved` IS THE EXCEPTION, deliberately. See its own comment above:
 * it is a push, its rejection is logged here and goes no further, and a
 * failure to deliver it costs main one stale copy rather than anything the
 * page could repair.
 */
export function createFilesApi(ipc: InvokerLike): FilesApi {
  return {
    read: (path) => unwrap<FileReadResult>(ipc.invoke(CHANNELS.filesRead, path)),
    list: (sessionId) => unwrap<FileListResult>(ipc.invoke(CHANNELS.filesList, sessionId)),
    resolve: (sessionId, reference) =>
      unwrap<FileRefTarget>(ipc.invoke(CHANNELS.filesResolve, sessionId, reference)),
    write: (path, content, baseSignature) =>
      unwrap<FileWriteResult>(ipc.invoke(CHANNELS.filesWrite, path, content, baseSignature)),
    reportUnsaved: (report) => {
      ipc.invoke(CHANNELS.filesUnsaved, report).catch((error: unknown) => {
        console.error('vam: unsaved report failed:', error);
      });
    },
  };
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

/**
 * The bridge's main-errors member: the read side of `src/main/errors/log.ts`,
 * MAIN's own failure buffer -- distinct from the renderer's own
 * `src/renderer/errors/log.ts`, which never crosses a process boundary at
 * all. `src/renderer/errors/main-errors-bridge.ts` is the one caller: it
 * pulls `list()` once on mount (recovering anything recorded before this
 * renderer existed, including before `createWindow()` ran) and again on every
 * `subscribe` tick.
 */
export type MainErrorsApi = {
  /** The WHOLE backlog, oldest first -- never a delta. See `src/main/errors/ipc.ts`. */
  list(): Promise<readonly MainFailureEvent[]>;
  /** A payload-free tick meaning "call `list()` again", the same shape `stream` uses. */
  subscribe(onChange: () => void): () => void;
};

/**
 * `list()` forwards straight to `vam:errors:get` -- no `unwrap`, because that
 * channel answers bare (see `src/main/errors/ipc.ts`). `subscribe` needs no
 * refcounted open/close on main's side (unlike `createStreamSubscribe`'s
 * `vam:stream:subscribe`/`unsubscribe`): there is no connection to hold open,
 * only a listener set main already owns, so removing THIS listener is the
 * whole of an unsubscribe.
 */
export function createMainErrorsApi(ipc: InvokerLike & ListenerLike): MainErrorsApi {
  return {
    list: () => ipc.invoke(CHANNELS.mainErrorsGet) as Promise<readonly MainFailureEvent[]>,
    subscribe: (onChange: () => void) => {
      const listener = () => onChange();
      ipc.on(CHANNELS.mainErrorsChanged, listener);
      return () => {
        ipc.removeListener(CHANNELS.mainErrorsChanged, listener);
      };
    },
  };
}

/** Which session a banner is about. Mirrors `src/main/notify/notify.ts`'s target. */
export type NotifyTarget = {
  readonly sourceId: string;
  readonly sessionId: string;
};

/**
 * The bridge's notification member: raise a banner, take one down, and hear
 * which one was clicked. Desktop-only by construction -- these channels are
 * not on the remote server's route table (`CHANNELS.notifyShow`'s header).
 */
export type NotifyApi = {
  /** `true` when main handed the banner to the OS. What the OS did with it is
   *  reported through `mainErrors`, never here. */
  show(request: NotifyTarget & { readonly title: string; readonly body: string }): Promise<boolean>;
  close(target: NotifyTarget): Promise<void>;
  /** The settings button: raise vam's own test banner and hear what the OS
   *  said -- the one call here whose verdict comes back inline. It resolves
   *  when the OS answers, or after main's 10 s verdict timeout. */
  test(): Promise<NotifyVerdict>;
  /** A click on a banner: focus has already been brought to vam by main. */
  onActivated(listener: (target: NotifyTarget) => void): () => void;
};

/**
 * `show` and `close` forward bare, like `clipboard.writeText` -- there is no
 * envelope to unwrap (`src/main/notify/ipc.ts`). `onActivated` keeps the
 * closure-identity rule `createMainErrorsApi.subscribe` keeps: the reference
 * given to `on` is the one given to `removeListener`.
 */
export function createNotifyApi(ipc: InvokerLike & ListenerLike): NotifyApi {
  return {
    show: (request) => ipc.invoke(CHANNELS.notifyShow, request) as Promise<boolean>,
    close: (target) => ipc.invoke(CHANNELS.notifyClose, target) as Promise<void>,
    test: () => ipc.invoke(CHANNELS.notifyTest) as Promise<NotifyVerdict>,
    onActivated: (listener) => {
      const wrapped = (_event: unknown, target: unknown) => listener(target as NotifyTarget);
      ipc.on(CHANNELS.notifyActivated, wrapped);
      return () => {
        ipc.removeListener(CHANNELS.notifyActivated, wrapped);
      };
    },
  };
}

/**
 * The bridge's pairing member: the desktop half of remote access.
 *
 * Every call answers a bare `RemoteState` -- no `unwrap`, because these
 * channels answer bare (see `src/main/remote/ipc.ts`) -- and every ACT
 * answers the state it produced, so the panel never draws a code the operator
 * has already replaced.
 *
 * `open`, `approve` and `deny` exist HERE and on no network route. Opening
 * the screen clears the pairing lockout, which is only defensible while
 * pressing it takes a human at this machine; the remote server is given
 * `submit` alone.
 *
 * A REJECTION IS AN ANSWER. With no `VAM_REMOTE_PORT` configured, main never
 * registers these channels and `invoke` rejects -- which is the honest report
 * that the remote endpoint is off, and the panel says exactly that.
 */
export type RemoteApi = {
  state(): Promise<RemoteState>;
  open(): Promise<RemoteState>;
  approve(): Promise<RemoteState>;
  deny(): Promise<RemoteState>;
  remove(deviceId: string): Promise<RemoteState>;
  revokeAll(): Promise<RemoteState>;
  /** Runs `tailscale serve --bg <port>` on THIS machine. Never called by a read. */
  enableServe(): Promise<RemoteState>;
  /** Runs `tailscale serve reset`, reversing `enableServe`. */
  disableServe(): Promise<RemoteState>;
  /**
   * Persists the write-access preference for the NEXT time vam starts --
   * write routes are registered once, when this server started, same as
   * every other part of `RemoteConfig`. See `remote/writes-preference.ts`.
   */
  setWrites(next: boolean): Promise<RemoteState>;
  /**
   * Opens one of the panel's two links in the operating system's browser.
   *
   * A KEY, NOT A URL: every `window.open` in this app is denied, so an
   * ordinary link in the panel did nothing -- and a channel that took a
   * destination from the renderer would be the navigate-anywhere capability
   * that policy exists to refuse. Main owns both destinations. Answers whether
   * a browser opened.
   */
  openLink(key: RemoteLinkKey): Promise<boolean>;
};

/** The two links the Remote panel draws. Main maps each to a destination. */
export type RemoteLinkKey = 'download' | 'serve-admin';

export function createRemoteApi(ipc: InvokerLike): RemoteApi {
  const ask = (channel: string, ...args: unknown[]) =>
    ipc.invoke(channel, ...args) as Promise<RemoteState>;
  return {
    openLink: (key: RemoteLinkKey) => ipc.invoke(CHANNELS.remoteOpenLink, key) as Promise<boolean>,
    state: () => ask(CHANNELS.remoteState),
    open: () => ask(CHANNELS.pairingOpen),
    approve: () => ask(CHANNELS.pairingApprove),
    deny: () => ask(CHANNELS.pairingDeny),
    remove: (deviceId) => ask(CHANNELS.deviceRemove, deviceId),
    revokeAll: () => ask(CHANNELS.deviceRemoveAll),
    enableServe: () => ask(CHANNELS.serveEnable),
    disableServe: () => ask(CHANNELS.serveDisable),
    setWrites: (next) => ask(CHANNELS.remoteWritesSet, next),
  };
}

export type { RemoteState };
