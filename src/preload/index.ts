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
import { createPreloadApi, createStreamSubscribe } from './api.js';

contextBridge.exposeInMainWorld('api', {
  ...createPreloadApi(ipcRenderer),
  subscribe: createStreamSubscribe(ipcRenderer),
});
