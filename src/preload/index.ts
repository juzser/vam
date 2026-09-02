/**
 * The preload script. It exposes NOTHING yet, deliberately.
 *
 * `contextBridge.exposeInMainWorld` runs once, before anything is known about
 * the source, and what it exposes then is what the renderer sees forever
 * (`src/shared/preload-api.ts` explains why). Exposing a placeholder now would
 * fix the shape of the bridge before the shape is decided; this task only has
 * to prove the window boots with a preload attached and no capability granted.
 */

export {};
