/**
 * The preload script: it exposes the bridge, and nothing else.
 *
 * `contextBridge.exposeInMainWorld` runs once, before anything is known about
 * the source, and what it exposes then is what the renderer sees forever
 * (`src/shared/preload-api.ts` explains why). So the shape below is
 * unconditional and capability travels as data, through `describe()`.
 *
 * Nothing here decides anything: no channel is chosen at runtime, no argument
 * is interpreted, and `ipcRenderer` itself never reaches the page -- only the
 * closed set of forwarders in `./api.js` does.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  createClipboardApi,
  createDialogApi,
  createFilesApi,
  createIssueApi,
  createLinkApi,
  createMainErrorsApi,
  createNotifyApi,
  createPrefsBridge,
  createPreloadApi,
  createPrsApi,
  createRemoteApi,
  createStreamSubscribe,
  createTerminalApi,
  createTerminalStreamApi,
  createUpdateApi,
  createUsageApi,
} from './api.js';

contextBridge.exposeInMainWorld('api', {
  ...createPreloadApi(ipcRenderer),
  subscribe: createStreamSubscribe(ipcRenderer),
  usage: createUsageApi(ipcRenderer),
  // Reaches github.com, and only when something asks it to -- nothing on
  // this bridge checks on its own.
  update: createUpdateApi(ipcRenderer),
  clipboard: createClipboardApi(ipcRenderer),
  // Opens a PREFILLED issue form in the operator's own browser, and posts
  // nothing. Takes text, never a location -- see `CHANNELS.issueOpen`.
  issue: createIssueApi(ipcRenderer),
  // The address an AGENT wrote, handed to the operating system's browser --
  // and the only member that names a destination. The allowlist that pays for
  // that lives in main (`src/main/link/ipc.ts`), never here: this forwarder
  // decides nothing, so nothing about what opens depends on it.
  link: createLinkApi(ipcRenderer),
  // The PRs tab's own two: open a pull request on github.com, and merge one
  // or delete its branch. Separate from `link` above because the allowlist is
  // narrower -- one host, one scheme -- and separate from the source API
  // because `act` WRITES to the operator's repositories: main resolves the
  // directory from the session id and builds the argv itself, so neither a
  // path nor a gh flag is expressible from this side. See
  // `src/main/pr/ipc.ts`.
  prs: createPrsApi(ipcRenderer),
  terminal: createTerminalApi(ipcRenderer),
  // The Terminal tab's streaming half, behind the `streamingTerminal` pref
  // and currently drawn by nothing -- see `src/preload/api.ts`'s own header.
  terminalStream: createTerminalStreamApi(ipcRenderer),
  dialog: createDialogApi(ipcRenderer),
  // The file-editor tab's read and write, authorised against every live
  // session's own working directory in main before a byte moves either way.
  // See `src/main/files/authorize.ts` and `src/main/files/ipc.ts`.
  files: createFilesApi(ipcRenderer),
  // The pairing screen's own channels. Exposed unconditionally like every
  // other member -- whether main registered them is runtime state, and the
  // bridge's shape may not depend on runtime state.
  remote: createRemoteApi(ipcRenderer),
  // Main's own failure buffer (`src/main/errors/log.ts`), read side. See
  // `src/renderer/errors/main-errors-bridge.ts` for the one caller.
  mainErrors: createMainErrorsApi(ipcRenderer),
  // Desktop notifications: the renderer decides when, main makes the OS
  // call, and what the OS answered lands in `mainErrors` above -- see
  // `src/main/notify/notify.ts` for why that is the whole point.
  notify: createNotifyApi(ipcRenderer),
  // Preferences main needs a copy of. Exactly one today: where to ask GitHub
  // from, per project. Desktop-only by construction -- it is not a member of
  // the source API a phone implements over HTTP.
  prefs: createPrefsBridge(ipcRenderer),
});
