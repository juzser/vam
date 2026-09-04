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
import type { PaneKey, PaneView } from '../shared/terminal.js';
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
    createSessionIn: (cwd, title) => unwrap<void>(ipc.invoke(CHANNELS.createSessionIn, cwd, title)),
  } satisfies Pick<
    PreloadSourceApi,
    'recordPrompt' | 'renameSession' | 'closeSession' | 'createSession' | 'createSessionIn'
  >;

  const governance = {
    applyWaivers: (sessionId, findingIds) =>
      unwrap<void>(ipc.invoke(CHANNELS.applyWaivers, sessionId, findingIds)),
    transitionLesson: (sessionId, lessonId, status) =>
      unwrap<void>(ipc.invoke(CHANNELS.transitionLesson, sessionId, lessonId, status)),
  } satisfies Pick<PreloadSourceApi, 'applyWaivers' | 'transitionLesson'>;

  return { ...reads, ...writes, ...governance };
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
   */
  read(projectId: string, rowId?: string): Promise<PaneView>;
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
   * RUNNING in, and the only one whose false answer is drawn on the tab: main
   * refuses when the recorded pairing names no single session of vam's, and a
   * surface that took the key and said nothing would be a text box that eats
   * what you type.
   */
  send(projectId: string, key: PaneKey, rowId?: string): Promise<boolean>;
};

/**
 * `terminal.read` forwards straight to `vam:terminal:read` -- no `unwrap`,
 * because that channel answers bare (see `src/main/terminal/ipc.ts`).
 * Called only while the Terminal tab is open: nothing here polls, and the
 * preload starts nothing at expose time.
 */
export function createTerminalApi(ipc: InvokerLike): TerminalApi {
  return {
    read: (projectId, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalRead, projectId)
        : ipc.invoke(CHANNELS.terminalRead, projectId, rowId)) as Promise<PaneView>,
    resize: (projectId, columns, rows, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalResize, projectId, columns, rows)
        : ipc.invoke(CHANNELS.terminalResize, projectId, columns, rows, rowId)) as Promise<boolean>,
    send: (projectId, key, rowId) =>
      (rowId === undefined
        ? ipc.invoke(CHANNELS.terminalSend, projectId, key)
        : ipc.invoke(CHANNELS.terminalSend, projectId, key, rowId)) as Promise<boolean>,
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
