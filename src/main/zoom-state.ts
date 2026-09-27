/**
 * THE ONE ZOOM FACTOR IN FORCE, module state rather than a parameter, for the
 * reason `lockZoom`'s own header gives at length: `app.on('web-contents-
 * created', ...)` calls `lockZoom` once per `webContents` and hands it this
 * module's own getter, so a LATER change here — from `main/zoom-ipc.ts`,
 * driven by the operator's chord or Settings row — reaches every window's
 * `zoom-changed`/`did-finish-load` listener without re-registering any of
 * them.
 *
 * A PERCENT IN, A FACTOR OUT, deliberately two different shapes: everything
 * on the OTHER side of the IPC bridge (the stored preference, the Settings
 * stepper, the chord's own arithmetic) works in the whole number an operator
 * would say out loud, and `webContents.setZoomFactor` wants `1.0` for 100% --
 * this is the one seam that divides by a hundred, so it is done in exactly
 * one place rather than at every reader of `currentZoomFactor()`.
 */

import { clampUiZoomPercent, DEFAULT_UI_ZOOM } from '../shared/ui-zoom.js';

let percent = DEFAULT_UI_ZOOM;

/** What `lockZoom` resets a `webContents` to, as electron's own `setZoomFactor` wants it. */
export function currentZoomFactor(): number {
  return percent / 100;
}

/**
 * Clamped on the way in -- MAIN TRUSTS NOTHING THE RENDERER SENDS, the same
 * rule every handler in `ipc/handlers.ts` states for its own arguments.
 * Returns the value it actually stored, so the IPC handler that calls this
 * can hand the clamped number back rather than echo whatever arrived.
 */
export function setZoomPercent(raw: unknown): number {
  percent = clampUiZoomPercent(raw);
  return percent;
}
