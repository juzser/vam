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
  createMainErrorsApi,
  createPrefsBridge,
  createPreloadApi,
  createRemoteApi,
  createStreamSubscribe,
  createTerminalApi,
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
  terminal: createTerminalApi(ipcRenderer),
  dialog: createDialogApi(ipcRenderer),
  // The pairing screen's own channels. Exposed unconditionally like every
  // other member -- whether main registered them is runtime state, and the
  // bridge's shape may not depend on runtime state.
  remote: createRemoteApi(ipcRenderer),
  // Main's own failure buffer (`src/main/errors/log.ts`), read side. See
  // `src/renderer/errors/main-errors-bridge.ts` for the one caller.
  mainErrors: createMainErrorsApi(ipcRenderer),
  // Preferences main needs a copy of. Exactly one today: where to ask GitHub
  // from, per project. Desktop-only by construction -- it is not a member of
  // the source API a phone implements over HTTP.
  prefs: createPrefsBridge(ipcRenderer),
});
